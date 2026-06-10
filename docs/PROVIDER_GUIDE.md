# cc-manage Provider Setup Guide

Step-by-step instructions for configuring each supported LLM provider with cc-manage.

---

## Quick Reference

| Provider | API Key Source | Mode | Proxy |
|----------|---------------|------|-------|
| Anthropic | [console.anthropic.com](https://console.anthropic.com) | Direct | No |
| Gemini | [aistudio.google.com](https://aistudio.google.com/apikey) | Proxy | Yes |
| OpenRouter | [openrouter.ai/keys](https://openrouter.ai/keys) | Direct | No |
| Groq | [console.groq.com](https://console.groq.com/keys) | Proxy | Yes |
| Mistral | [console.mistral.ai](https://console.mistral.ai) | Proxy | Yes |
| Mistral Vibe | [console.mistral.ai](https://console.mistral.ai) | Proxy | Yes |
| Codestral | [console.mistral.ai](https://console.mistral.ai) | Proxy | Yes |
| OpenCode Nemotron | [opencode.ai](https://opencode.ai) | Proxy | Yes |
| NVIDIA NIM | [build.nvidia.com](https://build.nvidia.com) | Proxy | Yes |
| Hugging Face | [huggingface.co/settings/tokens](https://huggingface.co/settings/tokens) | Proxy | Yes |
| DeepSeek | [platform.deepseek.com](https://platform.deepseek.com) | Direct | No |
| Fireworks | [fireworks.ai](https://fireworks.ai) | Direct | No |
| Together | [api.together.xyz](https://api.together.xyz/settings/api-keys) | Proxy | Yes |
| xAI | [console.x.ai](https://console.x.ai) | Proxy | Yes |
| Ollama Cloud | [ollama.com](https://ollama.com) | Proxy | Yes |
| Custom OpenAI-compatible | Any OpenAI-compatible endpoint | Proxy | Yes |

---

## 1. Anthropic

**The simplest setup — no proxy needed.**

### Get API Key
1. Go to [console.anthropic.com](https://console.anthropic.com)
2. Navigate to **API Keys**
3. Click **Create Key**
4. Copy the key (starts with `sk-ant-`)

### Create Profile
```powershell
cc-manage add
```
1. Select **Anthropic** from the provider list
2. Enter filename (e.g., `anthropic-main`)
3. When prompted for API key, choose "Add a new API key"
4. Enter a suffix (e.g., `main`) and paste your API key
5. Accept the default base URL: `https://api.anthropic.com`
6. Select models (defaults: `claude-sonnet-4-20250514`, `claude-opus-4-20250514`)
7. Choose default model

### Launch
```powershell
cc-switch anthropic-main
ccs
```

---

## 2. Gemini

**Uses a local proxy to translate Anthropic Messages to Gemini generateContent.**

### Get API Key
1. Go to [aistudio.google.com/apikey](https://aistudio.google.com/apikey)
2. Click **Create API Key**
3. Copy the key (starts with `AIza`)

### Create Profile
```powershell
cc-manage add
```
1. Select **Gemini** from the provider list
2. Enter filename (e.g., `gemini-flash`)
3. Add new API key with suffix (e.g., `google`)
4. Accept the default base URL: `http://127.0.0.1:18000` (local proxy)
5. Select models (defaults: `gemini-2.5-flash`, `gemini-3.5-flash`)
6. Choose default model

### How It Works
- cc-manage starts a local proxy on port 18000
- The proxy translates Anthropic Messages → Gemini generateContent format
- Supports: text, images, tool calls, tool results, streaming
- API key is sent via `x-goog-api-key` header (not URL)

### Launch
```powershell
cc-switch gemini-flash
ccs
```

---

## 3. OpenRouter

**Uses OpenRouter's Anthropic-compatible endpoint directly.**

### Get API Key
1. Go to [openrouter.ai/keys](https://openrouter.ai/keys)
2. Click **Create Key**
3. Copy the key (starts with `sk-or-`)

### Create Profile
```powershell
cc-manage add
```
1. Select **OpenRouter** from the provider list
2. Enter filename (e.g., `openrouter-free`)
3. Add new API key with suffix (e.g., `or`)
4. Accept the default base URL: `https://openrouter.ai/api`
5. Select models (defaults: `anthropic/claude-sonnet-4`, `google/gemini-2.5-flash`)
6. Choose default model

### Notes
- OpenRouter's Anthropic-compatible path works directly — no proxy needed
- Free models available with `:free` suffix (e.g., `google/gemini-2.0-flash:free`)
- Use `cc-manage models openrouter --refresh` to see all available models

### Launch
```powershell
cc-switch openrouter-free
ccs
```

---

## 4. Groq

**Fast inference with dynamic model discovery.**

### Get API Key
1. Go to [console.groq.com/keys](https://console.groq.com/keys)
2. Click **Create API Key**
3. Copy the key (starts with `gsk_`)

### Create Profile
```powershell
cc-manage add
```
1. Select **Groq** from the provider list
2. Enter filename (e.g., `groq-fast`)
3. Add new API key with suffix (e.g., `groq`)
4. Accept the default base URL: `http://127.0.0.1:18100` (local proxy)
5. Choose whether to fetch live models: `y`
6. Select from available models
7. Choose default model

### Notes
- Groq uses OpenAI-compatible API through the local proxy
- Output tokens are capped at 4096 by default (Groq limitation)
- Oversized requests (>32MB) are rejected locally before hitting the API
- Use `cc-manage models groq --refresh` to update the model list

### Launch
```powershell
cc-switch groq-fast
ccs
```

---

## 5. Mistral

**Mistral's full model lineup through local proxy.**

### Get API Key
1. Go to [console.mistral.ai](https://console.mistral.ai)
2. Navigate to **API Keys**
3. Create a new key

### Create Profile
```powershell
cc-manage add
```
1. Select **Mistral** from the provider list
2. Enter filename (e.g., `mistral-large`)
3. Add new API key with suffix
4. Accept the default base URL: `http://127.0.0.1:18005` (local proxy)
5. Fetch live models or use defaults
6. Choose default model

### Default Models
- `mistral-large-latest`
- `pixtral-large-latest`
- `ministral-8b-latest`

### Launch
```powershell
cc-switch mistral-large
ccs
```

---

## 6. Mistral Vibe

**Mistral's Vibe model family with dedicated defaults.**

### Get API Key
Same as Mistral — uses `console.mistral.ai` keys.

### Create Profile
```powershell
cc-manage add
```
1. Select **Mistral Vibe** from the provider list
2. Enter filename (e.g., `mistral-vibe`)
3. Add new API key (or reuse Mistral key)
4. Accept defaults
5. Fetch live models or use defaults

### Default Models
- `mistral-vibe-cli-latest`
- `mistral-medium-3.5`
- `devstral-small-latest`

### Notes
- Mistral Vibe shares the same API endpoint as Mistral (`https://api.mistral.ai/v1`)
- Uses `MISTRAL_VIBE_API_KEY` by default but can fall back to `MISTRAL_API_KEY`

### Launch
```powershell
cc-switch mistral-vibe
ccs
```

---

## 7. Codestral

**Mistral's code-specialized model.**

### Get API Key
Same as Mistral — uses `console.mistral.ai` keys.

### Create Profile
```powershell
cc-manage add
```
1. Select **Codestral** from the provider list
2. Enter filename (e.g., `codestral`)
3. Add new API key
4. Accept defaults

### Default Models
- `codestral-latest`
- `codestral-2508`

### Notes
- Codestral chat goes through `https://codestral.mistral.ai/v1`
- FIM (fill-in-the-middle) is available upstream at `/v1/fim/completions` but cc-manage uses the chat endpoint

### Launch
```powershell
cc-switch codestral
ccs
```

---

## 8. OpenCode Nemotron

**NVIDIA's Nemotron models through OpenCode's API.**

### Get Auth Token
1. Go to [opencode.ai](https://opencode.ai)
2. Sign up / log in
3. Get your API token from the dashboard

### Create Profile
```powershell
cc-manage add
```
1. Select **OpenCode Nemotron** from the provider list
2. Enter filename (e.g., `opencode-nemotron`)
3. Add new API key (your OpenCode auth token)
4. Accept defaults

### Default Model
- `nemotron-3-ultra-free`

### How It Works
- The proxy strips Claude-only metadata (thinking, context_management, output_config, etc.)
- Preserves tool calls through OpenAI function-calling fields
- Synthesizes Anthropic-compatible SSE from non-streaming upstream response
- Forces `stream: false` upstream regardless of client request

### Launch
```powershell
cc-switch opencode-nemotron
ccs
```

---

## 9. NVIDIA NIM

**NVIDIA's hosted models with dynamic discovery.**

### Get API Key
1. Go to [build.nvidia.com](https://build.nvidia.com)
2. Sign up / log in
3. Navigate to **API Keys**
4. Generate a new key (starts with `nvapi-`)

### Create Profile
```powershell
cc-manage add
```
1. Select **NVIDIA NIM** from the provider list
2. Enter filename (e.g., `nvidia-nim`)
3. Add new API key
4. Fetch live models or use defaults

### Default Models
- `nvidia/nemotron-3-super-120b-a12b`
- `qwen/qwen3.5-397b-a17b`
- `qwen/qwen3.5-122b-a10b`

### Launch
```powershell
cc-switch nvidia-nim
ccs
```

---

## 10. Hugging Face

**Access Hugging Face models through local proxy.**

### Get API Key
1. Go to [huggingface.co/settings/tokens](https://huggingface.co/settings/tokens)
2. Click **Create new token**
3. Copy the token (starts with `hf_`)

### Create Profile
```powershell
cc-manage add
```
1. Select **Hugging Face** from the provider list
2. Enter filename (e.g., `huggingface-kimi`)
3. Add new API key
4. Accept defaults

### Default Models
- `moonshotai/Kimi-K2.6`
- `moonshotai/Kimi-K2.5`

### Notes
- Kimi-K2.6 uses `chat_template_kwargs: {thinking: false}` for compatibility
- Kimi-K2.5 uses `thinking: {type: "disabled"}`

### Launch
```powershell
cc-switch huggingface-kimi
ccs
```

---

## 11. DeepSeek

**Direct Anthropic-compatible API — no proxy.**

### Get API Key
1. Go to [platform.deepseek.com](https://platform.deepseek.com)
2. Navigate to **API Keys**
3. Create a new key

### Create Profile
```powershell
cc-manage add
```
1. Select **DeepSeek** from the provider list
2. Enter filename (e.g., `deepseek-chat`)
3. Add new API key
4. Accept base URL: `https://api.deepseek.com/anthropic`

### Default Models
- `deepseek-chat`
- `deepseek-reasoner`

### Launch
```powershell
cc-switch deepseek-chat
ccs
```

---

## 12. Fireworks

**Direct Anthropic-compatible API — no proxy.**

### Get API Key
1. Go to [fireworks.ai](https://fireworks.ai)
2. Navigate to **API Keys**
3. Create a new key

### Create Profile
```powershell
cc-manage add
```
1. Select **Fireworks** from the provider list
2. Enter filename
3. Add new API key
4. Accept base URL: `https://api.fireworks.ai/inference/v1/anthropic`

### Default Model
- `accounts/fireworks/models/llama-v3p3-70b-instruct`

### Launch
```powershell
cc-switch <your-fireworks-profile>
ccs
```

---

## 13. Together

**OpenAI-compatible API through local proxy.**

### Get API Key
1. Go to [api.together.xyz/settings/api-keys](https://api.together.xyz/settings/api-keys)
2. Create a new key

### Create Profile
```powershell
cc-manage add
```
1. Select **Together** from the provider list
2. Enter filename
3. Add new API key
4. Accept proxy port (default: 18100)

### Default Model
- `meta-llama/Llama-3.3-70B-Instruct-Turbo`

### Launch
```powershell
cc-switch <your-together-profile>
ccs
```

---

## 14. xAI

**OpenAI-compatible API through local proxy.**

### Get API Key
1. Go to [console.x.ai](https://console.x.ai)
2. Navigate to **API Keys**
3. Create a new key

### Create Profile
```powershell
cc-manage add
```
1. Select **xAI** from the provider list
2. Enter filename
3. Add new API key
4. Accept proxy port (default: 18100)

### Default Models
- `grok-4`
- `grok-3`

### Launch
```powershell
cc-switch <your-xai-profile>
ccs
```

---

## 15. Ollama Cloud

**OpenAI-compatible API through local proxy.**

### Get API Key
1. Go to [ollama.com](https://ollama.com)
2. Sign up / log in
3. Get your API key

### Create Profile
```powershell
cc-manage add
```
1. Select **Ollama Cloud** from the provider list
2. Enter filename
3. Add new API key
4. Accept proxy port (default: 18100)

### Default Models
- `gpt-oss:120b`
- `llama3.3:70b`

### Launch
```powershell
cc-switch <your-ollama-profile>
ccs
```

---

## 16. Custom OpenAI-Compatible

**Bring your own endpoint.**

### Create Profile
```powershell
cc-manage add
```
1. Select **Any OpenAI-compatible cloud endpoint** from the provider list
2. Enter filename
3. Add your API key
4. Enter the upstream base URL (e.g., `https://your-provider.com/v1`)
5. Enter the proxy port (default: 18100)
6. Enter your model name(s)

### Requirements
The endpoint must support:
- `POST /chat/completions` (OpenAI Chat Completions format)
- `Authorization: Bearer <key>` header
- Standard `messages`, `model`, `max_tokens` fields

### Launch
```powershell
cc-switch <your-custom-profile>
ccs
```

---

## Provider Comparison

### Response Format Support

| Provider | Text | Images | Tools | Streaming | Max Output |
|----------|------|--------|-------|-----------|------------|
| Anthropic | [x] | [x] | [x] | [x] | Model-dependent |
| Gemini | [x] | [x] | [x] | [x] | 8192 |
| OpenRouter | [x] | [x] | [x] | [x] | Model-dependent |
| Groq | [x] | [x] | [x] | [x] | 4096 |
| Mistral | [x] | [x] | [x] | [x] | Model-dependent |
| Mistral Vibe | [x] | [x] | [x] | [x] | Model-dependent |
| Codestral | [x] | [ ] | [x] | [x] | Model-dependent |
| OpenCode Nemotron | [x] | [ ] | [x] | [x] (fake) | Model-dependent |
| NVIDIA NIM | [x] | [x] | [x] | [x] | Model-dependent |
| Hugging Face | [x] | [x] | [x] | [x] | Model-dependent |
| DeepSeek | [x] | [x] | [x] | [x] | Model-dependent |
| Fireworks | [x] | [x] | [x] | [x] | Model-dependent |
| Together | [x] | [x] | [x] | [x] | Model-dependent |
| xAI | [x] | [x] | [x] | [x] | Model-dependent |
| Ollama Cloud | [x] | [x] | [x] | [x] | Model-dependent |
| Custom | [x] | [x] | [x] | [x] | Endpoint-dependent |

### Speed Tiers

| Tier | Providers | Notes |
|------|-----------|-------|
| **Fastest** | Groq, Anthropic | Sub-second response times |
| **Fast** | OpenRouter, DeepSeek, xAI | Low latency |
| **Medium** | Gemini, Mistral, Together, Fireworks | Good balance |
| **Variable** | NVIDIA NIM, Hugging Face, Ollama Cloud | Depends on model/load |
