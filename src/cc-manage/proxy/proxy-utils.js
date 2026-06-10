'use strict';

/**
 * Shared utility functions for cc-manage compatibility proxies.
 * Used by openai-chat-proxy.js and opencode-nemotron-proxy.js.
 */

function makeId(prefix) {
  return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function safeParseJson(text) {
  if (text && typeof text === 'object') return text;
  try {
    return JSON.parse(text || '{}');
  } catch (e) {
    return {};
  }
}

function compactJson(value) {
  try {
    return JSON.stringify(value);
  } catch (e) {
    return String(value || '');
  }
}

function fallbackPartText(part) {
  if (!part) return '';
  if (typeof part === 'string') return part;
  if (part.type === 'text') return part.text || '';
  if (part.type === 'image') return '[image]';
  if (part.type === 'tool_result') return extractText(part.content);
  if (part.type === 'tool_use') return `${part.name || 'tool'}(${compactJson(part.input || {})})`;
  if (part.type === 'thinking' && part.thinking) return `[thinking] ${part.thinking}`;
  if (part.type === 'redacted_thinking') return '[redacted_thinking]';
  if (part.text) return String(part.text);
  if (part.content) return extractText(part.content);
  return `[${part.type || 'content'}] ${compactJson(part)}`;
}

function extractText(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.map(fallbackPartText).filter(Boolean).join('\n');
}

function estimateInputTokens(anthropicReq) {
  const pieces = [];
  if (anthropicReq.system) pieces.push(extractText(anthropicReq.system));
  for (const msg of anthropicReq.messages || []) pieces.push(extractText(msg.content));
  return Math.max(1, Math.ceil(pieces.join('\n').length / 4));
}

function parsePositiveInt(value, fallback = 0) {
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function sanitizeOpenAiToolName(name, index) {
  const fallback = `tool_${index}`;
  const cleaned = String(name || fallback).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64);
  return cleaned || fallback;
}

function buildToolNameMaps(tools) {
  const originalToOpen = {};
  const openToOriginal = {};
  (tools || []).forEach((tool, index) => {
    const original = String(tool.name || `tool_${index}`);
    let openName = sanitizeOpenAiToolName(original, index);
    let suffix = 2;
    while (openToOriginal[openName] && openToOriginal[openName] !== original) {
      const suffixText = `_${suffix++}`;
      openName = sanitizeOpenAiToolName(original, index).slice(0, 64 - suffixText.length) + suffixText;
    }
    originalToOpen[original] = openName;
    openToOriginal[openName] = original;
  });
  return { originalToOpen, openToOriginal };
}

function toOpenAiToolName(name, toolMaps) {
  return toolMaps.originalToOpen[name] || sanitizeOpenAiToolName(name, 0);
}

function fromOpenAiToolName(name, toolMaps) {
  const cleaned = String(name || '').replace(/^functions\./, '').replace(/:\d+$/, '');
  return toolMaps.openToOriginal[cleaned] || cleaned || 'tool';
}

function toOpenAiTools(tools, toolMaps) {
  return (tools || []).map((tool, index) => ({
    type: 'function',
    function: {
      name: toOpenAiToolName(tool.name || `tool_${index}`, toolMaps),
      description: tool.description || '',
      parameters: tool.input_schema || { type: 'object', properties: {} }
    }
  }));
}

function toOpenAiToolChoice(toolChoice, toolMaps) {
  if (!toolChoice) return undefined;
  if (typeof toolChoice === 'string') return toolChoice;
  if (toolChoice.type === 'auto') return 'auto';
  if (toolChoice.type === 'any') return 'required';
  if (toolChoice.type === 'none') return 'none';
  if (toolChoice.type === 'tool' && toolChoice.name) {
    return { type: 'function', function: { name: toOpenAiToolName(toolChoice.name, toolMaps) } };
  }
  return undefined;
}

function openAiContentToText(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.map(part => {
    if (!part) return '';
    if (typeof part === 'string') return part;
    if (part.type === 'text') return part.text || '';
    if (part.text) return String(part.text);
    if (part.type === 'image_url') return '[image]';
    return compactJson(part);
  }).filter(Boolean).join('\n');
}

function contentBlocksFromOpenAiMessage(message, anthropicReq) {
  const toolMaps = buildToolNameMaps(anthropicReq.tools || []);
  const blocks = [];
  const text = openAiContentToText(message.content);
  if (text) blocks.push({ type: 'text', text });

  for (const toolCall of message.tool_calls || []) {
    const fn = toolCall.function || {};
    const args = typeof fn.arguments === 'string' ? fn.arguments : compactJson(fn.arguments || {});
    blocks.push({
      type: 'tool_use',
      id: String(toolCall.id || '').startsWith('toolu_') ? toolCall.id : makeId('toolu_'),
      name: fromOpenAiToolName(fn.name, toolMaps),
      input: safeParseJson(args)
    });
  }

  if (!blocks.length) blocks.push({ type: 'text', text: '' });
  return blocks;
}

function stopReasonFromChoice(choice, contentBlocks) {
  if (contentBlocks.some(block => block.type === 'tool_use')) return 'tool_use';
  if (choice.finish_reason === 'length') return 'max_tokens';
  if (choice.finish_reason === 'content_filter') return 'stop_sequence';
  return choice.finish_reason === 'stop' ? 'end_turn' : (choice.finish_reason || 'end_turn');
}

function sendSse(res, event, data) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function emitContentBlocks(res, blocks) {
  blocks.forEach((block, index) => {
    if (block.type === 'tool_use') {
      sendSse(res, 'content_block_start', {
        type: 'content_block_start',
        index,
        content_block: { type: 'tool_use', id: block.id, name: block.name, input: {} }
      });
      sendSse(res, 'content_block_delta', {
        type: 'content_block_delta',
        index,
        delta: { type: 'input_json_delta', partial_json: JSON.stringify(block.input || {}) }
      });
      sendSse(res, 'content_block_stop', { type: 'content_block_stop', index });
      return;
    }

    sendSse(res, 'content_block_start', {
      type: 'content_block_start',
      index,
      content_block: { type: 'text', text: '' }
    });
    if (block.text) {
      sendSse(res, 'content_block_delta', {
        type: 'content_block_delta',
        index,
        delta: { type: 'text_delta', text: block.text }
      });
    }
    sendSse(res, 'content_block_stop', { type: 'content_block_stop', index });
  });
}

function mergeToolCallDelta(toolCalls, deltaToolCalls) {
  for (const delta of deltaToolCalls || []) {
    const index = delta.index ?? toolCalls.length;
    if (!toolCalls[index]) {
      toolCalls[index] = { id: delta.id || makeId('call_'), type: 'function', function: { name: '', arguments: '' } };
    }
    const existing = toolCalls[index];
    if (delta.id) existing.id = delta.id;
    if (delta.function?.name) existing.function.name += delta.function.name;
    if (delta.function?.arguments) existing.function.arguments += delta.function.arguments;
  }
}

function parseUpstreamError(body, fallback) {
  try {
    const parsed = JSON.parse(body);
    if (typeof parsed.error === 'string') return parsed.error;
    if (parsed.error?.message) return parsed.error.message;
    if (parsed.message) return parsed.message;
  } catch (e) {
    // Keep fallback for non-JSON provider errors.
  }
  return fallback;
}

function errorTypeForStatus(status) {
  if (status === 401 || status === 403) return 'authentication_error';
  if (status === 400 || status === 404) return 'invalid_request_error';
  if (status === 429) return 'rate_limit_error';
  return 'api_error';
}

function writeAnthropicError(res, status, type, message, provider) {
  res.writeHead(status || 502, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    type: 'error',
    error: { type, message: provider ? `${provider}: ${message}` : message }
  }));
}

function gracefulShutdown(server) {
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2000);
}

module.exports = {
  makeId,
  safeParseJson,
  compactJson,
  fallbackPartText,
  extractText,
  estimateInputTokens,
  parsePositiveInt,
  sanitizeOpenAiToolName,
  buildToolNameMaps,
  toOpenAiToolName,
  fromOpenAiToolName,
  toOpenAiTools,
  toOpenAiToolChoice,
  openAiContentToText,
  contentBlocksFromOpenAiMessage,
  stopReasonFromChoice,
  sendSse,
  emitContentBlocks,
  mergeToolCallDelta,
  parseUpstreamError,
  errorTypeForStatus,
  writeAnthropicError,
  gracefulShutdown
};
