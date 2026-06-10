const http = require('http');
const https = require('https');
const {
  makeId, safeParseJson, compactJson, fallbackPartText, extractText,
  estimateInputTokens, parsePositiveInt, buildToolNameMaps,
  toOpenAiToolName, fromOpenAiToolName, toOpenAiTools, toOpenAiToolChoice,
  openAiContentToText, contentBlocksFromOpenAiMessage, stopReasonFromChoice,
  sendSse, emitContentBlocks, mergeToolCallDelta, parseUpstreamError,
  errorTypeForStatus, writeAnthropicError: writeAnthropicErrorBase,
  gracefulShutdown: gracefulShutdownFn
} = require('./proxy-utils');

const PORT = parseInt(process.argv[2], 10) || 18100;
const UPSTREAM_BASE_URL = process.env.CC_UPSTREAM_BASE_URL || process.env.OPENAI_COMPAT_BASE_URL || '';
const PROVIDER = process.env.CC_PROVIDER || 'openai-compatible';
const AVAILABLE_MODELS = (process.env.CC_MODELS || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

const PROVIDER_ID = PROVIDER.toLowerCase();
const GROQ_MAX_COMPLETION_TOKENS = parsePositiveInt(process.env.CC_GROQ_MAX_COMPLETION_TOKENS, 4096);
const PROVIDER_REQUEST_LIMITS = {
  groq: 32 * 1024 * 1024
};

function providerRequestLimitBytes() {
  return parsePositiveInt(process.env.CC_MAX_REQUEST_BYTES, PROVIDER_REQUEST_LIMITS[PROVIDER_ID] || 0);
}

function payloadTooLargeError(bytes, limit) {
  const mb = (limit / (1024 * 1024)).toFixed(0);
  const err = new Error(`Request too large for ${PROVIDER}. Maximum is ${mb}MB; reduce attached/read file size or ask Claude to inspect a smaller slice.`);
  err.status = 413;
  err.anthropicType = 'invalid_request_error';
  err.bytes = bytes;
  err.limit = limit;
  return err;
}

function assertProviderPayloadSize(postData) {
  const limit = providerRequestLimitBytes();
  if (!limit) return;
  const bytes = Buffer.byteLength(postData);
  if (bytes > limit) throw payloadTooLargeError(bytes, limit);
}

function getApiKey(req) {
  const h = req.headers['x-api-key'] || req.headers.authorization || '';
  return h.replace(/^Bearer\s+/i, '').trim();
}

function readBody(req, maxBytes = 0) {
  return new Promise((resolve, reject) => {
    let body = '';
    let bytes = 0;
    let tooLarge = null;
    req.on('data', chunk => {
      if (tooLarge) return;
      bytes += chunk.length;
      if (maxBytes && bytes > maxBytes) {
        tooLarge = payloadTooLargeError(bytes, maxBytes);
        body = '';
        return;
      }
      body += chunk;
    });
    req.on('end', () => {
      if (tooLarge) reject(tooLarge);
      else resolve(body);
    });
    req.on('error', err => {
      reject(tooLarge || err);
    });
  });
}

function applyProviderRequestOptions(body) {
  if (PROVIDER !== 'huggingface') return;
  if (process.env.CC_HUGGINGFACE_DISABLE_KIMI_THINKING === '0') return;

  const model = String(body.model || '').toLowerCase();
  if (model.includes('kimi-k2.6')) {
    body.chat_template_kwargs = { ...(body.chat_template_kwargs || {}), thinking: false };
  } else if (model.includes('kimi-k2.5')) {
    body.thinking = { type: 'disabled' };
  }
}

function outputTokenLimit() {
  const envLimit = parsePositiveInt(process.env.CC_MAX_OUTPUT_TOKENS, 0);
  if (envLimit) return envLimit;
  if (PROVIDER_ID === 'groq') return GROQ_MAX_COMPLETION_TOKENS;
  return 0;
}

function outputTokensForRequest(anthropicReq) {
  const requested = parsePositiveInt(anthropicReq.max_tokens, 8192);
  const limit = outputTokenLimit();
  return limit ? Math.min(requested, limit) : requested;
}

function toOpenAiMessages(anthropicReq, toolMaps) {
  const messages = [];
  const system = extractText(anthropicReq.system);
  if (system) messages.push({ role: 'system', content: system });

  function toOpenAiImageUrl(part) {
    const source = part.source || {};
    if (source.type === 'url' && source.url) return source.url;
    if (source.url) return source.url;
    if (source.type === 'base64' && source.data) {
      const mediaType = source.media_type || source.mediaType || 'image/png';
      return `data:${mediaType};base64,${source.data}`;
    }
    if (source.data) {
      const mediaType = source.media_type || source.mediaType || 'image/png';
      return `data:${mediaType};base64,${source.data}`;
    }
    return null;
  }

  function toOpenAiContentParts(parts) {
    const out = [];
    for (const part of parts || []) {
      if (part.type === 'text' && part.text) {
        out.push({ type: 'text', text: part.text });
      } else if (part.type === 'image') {
        const url = toOpenAiImageUrl(part);
        if (url) out.push({ type: 'image_url', image_url: { url } });
      } else if (part.type !== 'tool_result' && part.type !== 'tool_use') {
        const text = fallbackPartText(part);
        if (text) out.push({ type: 'text', text });
      }
    }
    return out;
  }

  function userContentFromParts(parts) {
    const contentParts = toOpenAiContentParts(parts);
    const hasImage = contentParts.some(part => part.type === 'image_url');
    if (hasImage) return contentParts;
    const text = contentParts.map(part => part.text || '').join('\n').trim();
    return text || extractText(parts);
  }

  for (const msg of anthropicReq.messages || []) {
    if (msg.role === 'assistant' && Array.isArray(msg.content)) {
      const textParts = [];
      const toolCalls = [];
      for (const part of msg.content) {
        if (part.type === 'text') textParts.push(part.text || '');
        if (part.type === 'tool_use') {
          toolCalls.push({
            id: part.id || makeId('call_'),
            type: 'function',
            function: {
              name: toOpenAiToolName(part.name, toolMaps),
              arguments: JSON.stringify(part.input || {})
            }
          });
        } else if (part.type !== 'text') {
          const text = fallbackPartText(part);
          if (text && part.type !== 'tool_use') textParts.push(text);
        }
      }
      const out = { role: 'assistant', content: textParts.join('\n') || null };
      if (toolCalls.length) out.tool_calls = toolCalls;
      messages.push(out);
      continue;
    }

    if (msg.role === 'user' && Array.isArray(msg.content)) {
      let userParts = [];
      let emitted = false;
      const flushText = () => {
        if (userParts.length) {
          const content = userContentFromParts(userParts);
          messages.push({ role: 'user', content });
          emitted = true;
        }
        userParts = [];
      };

      for (const part of msg.content) {
        if (part.type === 'tool_result') {
          flushText();
          messages.push({
            role: 'tool',
            tool_call_id: part.tool_use_id || part.id || makeId('call_'),
            content: extractText(part.content) || (part.is_error ? 'Tool returned an error.' : '')
          });
          emitted = true;
        } else if (part.type === 'text' || part.type === 'image' || part.type !== 'tool_use') {
          userParts.push(part);
        }
      }
      flushText();
      if (!emitted) messages.push({ role: 'user', content: extractText(msg.content) });
      continue;
    }

    messages.push({
      role: msg.role === 'assistant' ? 'assistant' : 'user',
      content: extractText(msg.content)
    });
  }

  return messages;
}

function toOpenAiBody(anthropicReq) {
  const toolMaps = buildToolNameMaps(anthropicReq.tools || []);
  const outputTokens = outputTokensForRequest(anthropicReq);
  const body = {
    model: anthropicReq.model || process.env.CC_DEFAULT_MODEL || AVAILABLE_MODELS[0],
    messages: toOpenAiMessages(anthropicReq, toolMaps),
    stream: anthropicReq.stream === true
  };
  if (PROVIDER_ID === 'groq') body.max_completion_tokens = outputTokens;
  else body.max_tokens = outputTokens;
  const tools = toOpenAiTools(anthropicReq.tools, toolMaps);
  if (tools.length) {
    body.tools = tools;
    body.tool_choice = toOpenAiToolChoice(anthropicReq.tool_choice, toolMaps) || 'auto';
  }
  if (anthropicReq.temperature !== undefined) body.temperature = anthropicReq.temperature;
  if (anthropicReq.top_p !== undefined) body.top_p = anthropicReq.top_p;
  if (anthropicReq.stop_sequences !== undefined) body.stop = anthropicReq.stop_sequences;
  if (anthropicReq.response_format !== undefined) body.response_format = anthropicReq.response_format;
  if (anthropicReq.parallel_tool_calls !== undefined) body.parallel_tool_calls = anthropicReq.parallel_tool_calls;
  applyProviderRequestOptions(body);
  return body;
}

function upstreamUrl(path) {
  if (!UPSTREAM_BASE_URL) throw new Error('Missing CC_UPSTREAM_BASE_URL for OpenAI-compatible proxy');
  const base = UPSTREAM_BASE_URL.replace(/\/+$/, '');
  return new URL(base + path);
}

function requestOpenAi(apiKey, postData) {
  return new Promise((resolve, reject) => {
    let u;
    try {
      u = upstreamUrl('/chat/completions');
    } catch (e) {
      reject(e);
      return;
    }
    const transport = u.protocol === 'http:' ? http : https;
    const opts = {
      hostname: u.hostname,
      port: u.port || (u.protocol === 'http:' ? 80 : 443),
      path: u.pathname + u.search,
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      }
    };
    const upstream = transport.request(opts, upstreamRes => {
      let body = '';
      upstreamRes.on('data', chunk => body += chunk);
      upstreamRes.on('end', () => resolve({ status: upstreamRes.statusCode, body }));
    });
    upstream.on('error', reject);
    upstream.write(postData);
    upstream.end();
  });
}

function writeAnthropicError(res, status, type, message) {
  writeAnthropicErrorBase(res, status, type, message, PROVIDER);
}

function toAnthropicResponse(openAiResp, model, anthropicReq) {
  const choice = openAiResp.choices?.[0] || {};
  const message = choice.message || {};
  const content = contentBlocksFromOpenAiMessage(message, anthropicReq);
  const usage = openAiResp.usage || {};
  return {
    id: makeId('msg_'),
    type: 'message',
    role: 'assistant',
    content,
    model,
    stop_reason: stopReasonFromChoice(choice, content),
    usage: {
      input_tokens: usage.prompt_tokens || 0,
      output_tokens: usage.completion_tokens || 0
    }
  };
}

function forwardStream(apiKey, anthropicReq, res) {
  const model = anthropicReq.model || process.env.CC_DEFAULT_MODEL || AVAILABLE_MODELS[0];
  let postData;
  try {
    postData = JSON.stringify(toOpenAiBody({ ...anthropicReq, stream: true }));
    assertProviderPayloadSize(postData);
  } catch (e) {
    return writeAnthropicError(res, e.status || 502, e.anthropicType || 'api_error', e.message);
  }
  let u;
  try {
    u = upstreamUrl('/chat/completions');
  } catch (e) {
    return writeAnthropicError(res, 502, 'api_error', e.message);
  }

  const opts = {
    hostname: u.hostname,
    port: u.port || (u.protocol === 'http:' ? 80 : 443),
    path: u.pathname + u.search,
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
      'Content-Length': Buffer.byteLength(postData)
    }
  };

  const transport = u.protocol === 'http:' ? http : https;
  const upstream = transport.request(opts, upstreamRes => {
    if (upstreamRes.statusCode < 200 || upstreamRes.statusCode >= 300) {
      let errorBody = '';
      upstreamRes.on('data', chunk => errorBody += chunk);
      upstreamRes.on('end', () => {
        const status = upstreamRes.statusCode || 502;
        writeAnthropicError(res, status, errorTypeForStatus(status), parseUpstreamError(errorBody, 'OpenAI-compatible stream failed'));
      });
      return;
    }

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no'
    });
    sendSse(res, 'message_start', {
      type: 'message_start',
      message: {
        id: makeId('msg_'),
        type: 'message',
        role: 'assistant',
        content: [],
        model,
        stop_reason: null,
        usage: { input_tokens: estimateInputTokens(anthropicReq), output_tokens: 0 }
      }
    });

    let buf = '';
    let text = '';
    let finalChoice = {};
    let usage = {};
    const toolCalls = [];

    upstreamRes.on('data', chunk => {
      buf += chunk.toString();
      const lines = buf.split('\n');
      buf = lines.pop() || '';
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const raw = line.slice(6).trim();
        if (!raw || raw === '[DONE]') continue;
        let data;
        try {
          data = JSON.parse(raw);
        } catch (e) {
          continue;
        }
        const choice = data.choices?.[0] || {};
        if (choice.delta?.content) text += choice.delta.content;
        if (choice.delta?.tool_calls) mergeToolCallDelta(toolCalls, choice.delta.tool_calls);
        if (choice.finish_reason) finalChoice = choice;
        if (data.usage) usage = data.usage;
      }
    });
    upstreamRes.on('end', () => {
      const blocks = contentBlocksFromOpenAiMessage({ content: text, tool_calls: toolCalls.filter(Boolean) }, anthropicReq);
      emitContentBlocks(res, blocks);
      sendSse(res, 'message_delta', {
        type: 'message_delta',
        delta: { stop_reason: stopReasonFromChoice(finalChoice, blocks), stop_sequence: null },
        usage: { output_tokens: usage.completion_tokens || 0 }
      });
      sendSse(res, 'message_stop', { type: 'message_stop' });
      res.end();
    });
  });

  upstream.on('error', err => {
    if (!res.headersSent) writeAnthropicError(res, 502, 'api_error', err.message);
    else res.end();
  });
  upstream.write(postData);
  upstream.end();
}

function writeModels(res) {
  const data = AVAILABLE_MODELS.map(id => ({
    id,
    type: 'model',
    display_name: id,
    created_at: '2026-01-01T00:00:00Z'
  }));
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    data,
    has_more: false,
    first_id: data[0]?.id || null,
    last_id: data[data.length - 1]?.id || null
  }));
}

const server = http.createServer(async (req, res) => {
  const requestPath = (req.url || '').split('?')[0];
  const apiKey = getApiKey(req);

  if (req.method === 'GET' && (requestPath === '/health' || requestPath === '/')) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: true, provider: PROVIDER, model: AVAILABLE_MODELS[0] || null }));
  }

  if (!apiKey) return writeAnthropicError(res, 401, 'authentication_error', 'No API key provided.');
  if (req.method === 'GET' && requestPath === '/v1/models') return writeModels(res);
  if (req.method !== 'POST' || (requestPath !== '/v1/messages' && requestPath !== '/v1/messages/count_tokens')) {
    return writeAnthropicError(res, 404, 'invalid_request_error', 'Not found. Use POST /v1/messages or /v1/messages/count_tokens');
  }

  let anthropicReq;
  try {
    anthropicReq = JSON.parse(await readBody(req, providerRequestLimitBytes()));
  } catch (e) {
    if (e.status === 413) return writeAnthropicError(res, 413, e.anthropicType || 'invalid_request_error', e.message);
    return writeAnthropicError(res, 400, 'invalid_request_error', 'Invalid JSON: ' + e.message);
  }

  if (requestPath === '/v1/messages/count_tokens') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ input_tokens: estimateInputTokens(anthropicReq) }));
  }

  if (anthropicReq.stream === true) return forwardStream(apiKey, anthropicReq, res);

  try {
    const model = anthropicReq.model || process.env.CC_DEFAULT_MODEL || AVAILABLE_MODELS[0];
    const postData = JSON.stringify(toOpenAiBody({ ...anthropicReq, stream: false }));
    assertProviderPayloadSize(postData);
    const result = await requestOpenAi(apiKey, postData);
    if (result.status >= 200 && result.status < 300) {
      const data = toAnthropicResponse(JSON.parse(result.body), model, anthropicReq);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(data));
    } else {
      const status = result.status || 502;
      writeAnthropicError(res, status, errorTypeForStatus(status), parseUpstreamError(result.body, 'OpenAI-compatible request failed'));
    }
  } catch (e) {
    writeAnthropicError(res, e.status || 502, e.anthropicType || 'api_error', e.message);
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`OpenAI-compatible proxy ready for ${PROVIDER} on http://127.0.0.1:${PORT}`);
});

server.on('error', e => {
  console.error('Proxy error:', e.message);
  process.exit(1);
});

process.on('SIGTERM', () => gracefulShutdownFn(server));
process.on('SIGINT', () => gracefulShutdownFn(server));
