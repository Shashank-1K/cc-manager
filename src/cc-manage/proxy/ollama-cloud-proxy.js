'use strict';

/**
 * Ollama Cloud proxy — translates Anthropic Messages to Ollama native format.
 * Ollama Cloud does NOT support OpenAI-compatible API.
 * It uses its own native format at https://ollama.com/api/chat
 */

const http = require('http');
const https = require('https');
const {
  makeId, safeParseJson, compactJson, fallbackPartText, extractText,
  estimateInputTokens, buildToolNameMaps, toOpenAiToolName, fromOpenAiToolName,
  contentBlocksFromOpenAiMessage, stopReasonFromChoice,
  sendSse, emitContentBlocks, parseUpstreamError, errorTypeForStatus,
  writeAnthropicError: writeAnthropicErrorBase, gracefulShutdown: gracefulShutdownFn
} = require('./proxy-utils');

const PORT = parseInt(process.argv[2], 10) || 18108;
const UPSTREAM_BASE = 'https://ollama.com';
const PROVIDER = 'ollama-cloud';
const DEFAULT_MODEL = 'gpt-oss:120b';
const AVAILABLE_MODELS = (process.env.CC_MODELS || DEFAULT_MODEL)
  .split(',').map(s => s.trim()).filter(Boolean);

function writeAnthropicError(res, status, type, message) {
  writeAnthropicErrorBase(res, status, type, message, PROVIDER);
}

function getApiKey(req) {
  const h = req.headers['x-api-key'] || req.headers.authorization || '';
  return h.replace(/^Bearer\s+/i, '').trim();
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

// ── Convert Anthropic Messages to Ollama native format ───────────────────────

function toOllamaMessages(anthropicReq, toolMaps) {
  const messages = [];
  const system = extractText(anthropicReq.system);
  if (system) messages.push({ role: 'system', content: system });

  for (const msg of anthropicReq.messages || []) {
    if (msg.role === 'assistant' && Array.isArray(msg.content)) {
      const textParts = [];
      const toolCalls = [];
      for (const part of msg.content) {
        if (part.type === 'text') textParts.push(part.text || '');
        else if (part.type === 'tool_use') {
          toolCalls.push({
            function: {
              name: toOpenAiToolName(part.name, toolMaps),
              arguments: compactJson(part.input || {})
            }
          });
        } else {
          const text = fallbackPartText(part);
          if (text) textParts.push(text);
        }
      }
      const assistantMsg = { role: 'assistant', content: textParts.join('\n') || '' };
      if (toolCalls.length) assistantMsg.tool_calls = toolCalls;
      messages.push(assistantMsg);
      continue;
    }

    if (msg.role === 'user' && Array.isArray(msg.content)) {
      let textParts = [];
      for (const part of msg.content) {
        if (part.type === 'tool_result') {
          if (textParts.length) {
            messages.push({ role: 'user', content: textParts.join('\n') });
            textParts = [];
          }
          messages.push({
            role: 'tool',
            content: extractText(part.content) || (part.is_error ? 'Error' : '')
          });
        } else if (part.type !== 'tool_use') {
          const text = fallbackPartText(part);
          if (text) textParts.push(text);
        }
      }
      if (textParts.length) messages.push({ role: 'user', content: textParts.join('\n') });
      continue;
    }

    messages.push({ role: msg.role === 'assistant' ? 'assistant' : 'user', content: extractText(msg.content) });
  }
  return messages;
}

function toOllamaBody(anthropicReq) {
  const toolMaps = buildToolNameMaps(anthropicReq.tools || []);
  const body = {
    model: anthropicReq.model || process.env.CC_DEFAULT_MODEL || AVAILABLE_MODELS[0],
    messages: toOllamaMessages(anthropicReq, toolMaps),
    stream: false
  };
  if (anthropicReq.max_tokens) body.options = { num_predict: anthropicReq.max_tokens };
  if (anthropicReq.temperature !== undefined) {
    if (!body.options) body.options = {};
    body.options.temperature = anthropicReq.temperature;
  }
  if (anthropicReq.tools && anthropicReq.tools.length) {
    body.tools = anthropicReq.tools.map((tool, index) => ({
      type: 'function',
      function: {
        name: toOpenAiToolName(tool.name || `tool_${index}`, toolMaps),
        description: tool.description || '',
        parameters: tool.input_schema || { type: 'object', properties: {} }
      }
    }));
  }
  return { body, toolMaps };
}

// ── Convert Ollama response to Anthropic format ──────────────────────────────

function toAnthropicResponse(ollamaResp, model, toolMaps) {
  const message = ollamaResp.message || {};
  const content = [];

  if (message.content) content.push({ type: 'text', text: message.content });

  if (message.tool_calls && message.tool_calls.length) {
    for (const tc of message.tool_calls) {
      const fn = tc.function || {};
      content.push({
        type: 'tool_use',
        id: makeId('toolu_'),
        name: fromOpenAiToolName(fn.name, toolMaps),
        input: safeParseJson(typeof fn.arguments === 'string' ? fn.arguments : compactJson(fn.arguments || {}))
      });
    }
  }

  if (!content.length) content.push({ type: 'text', text: '' });

  let stopReason = 'end_turn';
  if (content.some(b => b.type === 'tool_use')) stopReason = 'tool_use';
  else if (ollamaResp.done_reason === 'length') stopReason = 'max_tokens';

  return {
    id: makeId('msg_'),
    type: 'message',
    role: 'assistant',
    content,
    model,
    stop_reason: stopReason,
    usage: {
      input_tokens: ollamaResp.prompt_eval_count || estimateInputTokens({ messages: [] }),
      output_tokens: ollamaResp.eval_count || 0
    }
  };
}

// ── Upstream request ─────────────────────────────────────────────────────────

function ollamaPost(apiKey, postData) {
  return new Promise((resolve, reject) => {
    const u = new URL(`${UPSTREAM_BASE}/api/chat`);
    const transport = https;
    const opts = {
      hostname: u.hostname,
      port: 443,
      path: u.pathname,
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      }
    };
    const req = transport.request(opts, res => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

// ── Server ───────────────────────────────────────────────────────────────────

const server = http.createServer(async (req, res) => {
  const requestPath = (req.url || '').split('?')[0];
  const apiKey = getApiKey(req);

  if (req.method === 'GET' && (requestPath === '/health' || requestPath === '/')) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: true, provider: PROVIDER, model: AVAILABLE_MODELS[0] }));
  }

  if (!apiKey) return writeAnthropicError(res, 401, 'authentication_error', 'No API key provided.');

  if (req.method === 'GET' && requestPath === '/v1/models') {
    const data = AVAILABLE_MODELS.map(id => ({ id, type: 'model', display_name: id }));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ data, has_more: false }));
  }

  if (req.method !== 'POST' || (requestPath !== '/v1/messages' && requestPath !== '/v1/messages/count_tokens')) {
    return writeAnthropicError(res, 404, 'invalid_request_error', 'Not found. Use POST /v1/messages');
  }

  let anthropicReq;
  try {
    anthropicReq = JSON.parse(await readBody(req));
  } catch (e) {
    return writeAnthropicError(res, 400, 'invalid_request_error', 'Invalid JSON: ' + e.message);
  }

  if (requestPath === '/v1/messages/count_tokens') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ input_tokens: estimateInputTokens(anthropicReq) }));
  }

  const model = anthropicReq.model || process.env.CC_DEFAULT_MODEL || AVAILABLE_MODELS[0];
  const { body: ollamaBody, toolMaps } = toOllamaBody(anthropicReq);

  try {
    const postData = JSON.stringify(ollamaBody);
    const result = await ollamaPost(apiKey, postData);

    if (result.status < 200 || result.status >= 300) {
      const msg = parseUpstreamError(result.body, `Ollama Cloud HTTP ${result.status}`);
      return writeAnthropicError(res, result.status || 502, errorTypeForStatus(result.status), msg);
    }

    let ollamaResp;
    try { ollamaResp = JSON.parse(result.body); } catch {
      return writeAnthropicError(res, 502, 'api_error', 'Invalid Ollama Cloud response');
    }

    const anthropicResp = toAnthropicResponse(ollamaResp, model, toolMaps);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(anthropicResp));
  } catch (e) {
    writeAnthropicError(res, 502, 'api_error', e.message || 'Ollama Cloud request failed');
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Ollama Cloud proxy ready on http://127.0.0.1:${PORT}`);
});

server.on('error', e => {
  console.error('Proxy error:', e.message);
  process.exit(1);
});

process.on('SIGTERM', () => gracefulShutdownFn(server));
process.on('SIGINT', () => gracefulShutdownFn(server));
