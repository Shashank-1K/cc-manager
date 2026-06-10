'use strict';

/**
 * Provider registry — ported from providers.ps1
 * 17 LLM providers with their modes, ports, and default models.
 */

const PROVIDER_REGISTRY = [
  {
    id: 'anthropic',
    name: 'Anthropic',
    mode: 'anthropic-direct',
    baseUrl: 'https://api.anthropic.com',
    authMode: 'api_key',
    keyName: 'ANTHROPIC_API_KEY',
    defaultModels: ['claude-sonnet-4-20250514', 'claude-opus-4-20250514']
  },
  {
    id: 'gemini',
    name: 'Gemini',
    mode: 'gemini-proxy',
    baseUrl: 'http://127.0.0.1:18000',
    authMode: 'api_key',
    keyName: 'GEMINI_API_KEY',
    proxyScript: 'anthropic-gemini-proxy.js',
    proxyPort: 18000,
    defaultModels: ['gemini-2.5-flash', 'gemini-3.5-flash', 'gemini-3-flash-preview']
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    mode: 'anthropic-direct',
    baseUrl: 'https://openrouter.ai/api',
    authMode: 'api_key',
    keyName: 'OPENROUTER_API_KEY',
    modelSource: 'dynamic',
    modelsEndpoint: 'https://openrouter.ai/api/v1/models',
    defaultModels: ['anthropic/claude-sonnet-4', 'google/gemini-2.5-flash']
  },
  {
    id: 'ollama-cloud',
    name: 'Ollama Cloud',
    mode: 'ollama-cloud-proxy',
    baseUrl: 'http://127.0.0.1:18108',
    authMode: 'api_key',
    keyName: 'OLLAMA_API_KEY',
    proxyScript: 'ollama-cloud-proxy.js',
    proxyPort: 18108,
    defaultModels: ['gpt-oss:120b', 'llama3.3:70b']
  },
  {
    id: 'groq',
    name: 'Groq',
    mode: 'openai-chat-proxy',
    baseUrl: 'https://api.groq.com/openai/v1',
    authMode: 'api_key',
    keyName: 'GROQ_API_KEY',
    modelSource: 'dynamic',
    modelsEndpoint: 'https://api.groq.com/openai/v1/models',
    defaultModels: ['openai/gpt-oss-120b', 'openai/gpt-oss-20b', 'qwen/qwen3-32b']
  },
  {
    id: 'mistral',
    name: 'Mistral',
    mode: 'mistral-proxy',
    baseUrl: 'http://127.0.0.1:18005',
    authMode: 'api_key',
    keyName: 'MISTRAL_API_KEY',
    modelSource: 'dynamic',
    modelsEndpoint: 'https://api.mistral.ai/v1/models',
    proxyScript: 'mistral-anthropic-proxy.js',
    proxyPort: 18005,
    defaultModels: ['mistral-large-latest', 'pixtral-large-latest', 'ministral-8b-latest']
  },
  {
    id: 'mistral-vibe',
    name: 'Mistral Vibe',
    mode: 'mistral-vibe-proxy',
    baseUrl: 'http://127.0.0.1:18007',
    authMode: 'api_key',
    keyName: 'MISTRAL_VIBE_API_KEY',
    modelSource: 'dynamic',
    modelsEndpoint: 'https://api.mistral.ai/v1/models',
    proxyScript: 'mistral-vibe-anthropic-proxy.js',
    proxyPort: 18007,
    defaultModels: ['mistral-vibe-cli-latest', 'mistral-medium-3.5', 'devstral-small-latest']
  },
  {
    id: 'codestral',
    name: 'Codestral',
    mode: 'codestral-proxy',
    baseUrl: 'http://127.0.0.1:18006',
    authMode: 'api_key',
    keyName: 'CODESTRAL_API_KEY',
    proxyScript: 'codestral-anthropic-proxy.js',
    proxyPort: 18006,
    defaultModels: ['codestral-latest', 'codestral-2508']
  },
  {
    id: 'opencode_nemotron',
    name: 'OpenCode Nemotron',
    mode: 'opencode-nemotron-proxy',
    baseUrl: 'http://127.0.0.1:18100',
    authMode: 'auth_token',
    keyName: 'OPENCODE_API_KEY',
    proxyScript: 'opencode-nemotron-proxy.js',
    proxyPort: 18100,
    defaultModels: ['nemotron-3-ultra-free']
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    mode: 'anthropic-direct',
    baseUrl: 'https://api.deepseek.com/anthropic',
    authMode: 'api_key',
    keyName: 'DEEPSEEK_API_KEY',
    modelSource: 'dynamic',
    modelsEndpoint: 'https://api.deepseek.com/v1/models',
    defaultModels: ['deepseek-chat', 'deepseek-reasoner']
  },
  {
    id: 'together',
    name: 'Together',
    mode: 'openai-chat-proxy',
    baseUrl: 'https://api.together.xyz/v1',
    authMode: 'api_key',
    keyName: 'TOGETHER_API_KEY',
    modelSource: 'dynamic',
    modelsEndpoint: 'https://api.together.xyz/v1/models',
    defaultModels: ['meta-llama/Llama-3.3-70B-Instruct-Turbo']
  },
  {
    id: 'fireworks',
    name: 'Fireworks',
    mode: 'anthropic-direct',
    baseUrl: 'https://api.fireworks.ai/inference/v1/anthropic',
    authMode: 'api_key',
    keyName: 'FIREWORKS_API_KEY',
    defaultModels: ['accounts/fireworks/models/llama-v3p3-70b-instruct']
  },
  {
    id: 'xai',
    name: 'xAI',
    mode: 'openai-chat-proxy',
    baseUrl: 'https://api.x.ai/v1',
    authMode: 'api_key',
    keyName: 'XAI_API_KEY',
    modelSource: 'dynamic',
    modelsEndpoint: 'https://api.x.ai/v1/models',
    defaultModels: ['grok-4', 'grok-3']
  },
  {
    id: 'freetheai',
    name: 'FreeTheAi',
    mode: 'openai-chat-proxy',
    baseUrl: 'https://api.freetheai.xyz/v1',
    authMode: 'api_key',
    keyName: 'FREETHEAI_API_KEY',
    modelSource: 'dynamic',
    modelsEndpoint: 'https://api.freetheai.xyz/v1/models',
    defaultModels: ['opc/mimo-v2.5-free', 'opc/nemotron-3-ultra-free', 'glm/glm-5.1', 'kai/poolside/laguna-m.1:free', 'bbl/gemini-2.5-flash']
  },
  {
    id: 'nvidia-nim',
    name: 'NVIDIA NIM',
    mode: 'nvidia-proxy',
    baseUrl: 'http://127.0.0.1:18003',
    authMode: 'api_key',
    keyName: 'NVIDIA_API_KEY',
    modelSource: 'dynamic',
    modelsEndpoint: 'https://integrate.api.nvidia.com/v1/models',
    proxyScript: 'nvidia-anthropic-proxy.js',
    proxyPort: 18003,
    defaultModels: ['nvidia/nemotron-3-super-120b-a12b', 'qwen/qwen3.5-397b-a17b', 'qwen/qwen3.5-122b-a10b']
  },
  {
    id: 'openai-compatible',
    name: 'Any OpenAI-compatible',
    mode: 'openai-chat-proxy',
    baseUrl: '',
    authMode: 'api_key',
    keyName: 'CUSTOM_API_KEY',
    defaultModels: []
  },
  {
    id: 'huggingface',
    name: 'Hugging Face',
    mode: 'huggingface-proxy',
    baseUrl: 'http://127.0.0.1:18004',
    authMode: 'api_key',
    keyName: 'HUGGINGFACE_API_KEY',
    proxyScript: 'hug-anthropic-proxy.js',
    proxyPort: 18004,
    defaultModels: ['moonshotai/Kimi-K2.6', 'moonshotai/Kimi-K2.5']
  }
];

function getProviderRegistry() {
  return PROVIDER_REGISTRY;
}

function getProviderDefinition(idOrName) {
  return PROVIDER_REGISTRY.find(p =>
    p.id === idOrName || p.name.toLowerCase() === idOrName.toLowerCase()
  ) || null;
}

function getDefaultKeyNameForProvider(providerId) {
  const provider = getProviderDefinition(providerId);
  return provider ? provider.keyName : 'CUSTOM_API_KEY';
}

module.exports = {
  getProviderRegistry,
  getProviderDefinition,
  getDefaultKeyNameForProvider,
  PROVIDER_REGISTRY
};
