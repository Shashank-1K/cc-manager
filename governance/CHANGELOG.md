# Changelog

## Unreleased

- Added web management dashboard (`cc-dashboard`) with visual profile, key, provider, and health management at `http://127.0.0.1:18200`.
- Added shared proxy utilities module (`proxy-utils.js`) to reduce code duplication across proxies.
- Added graceful shutdown handlers (SIGTERM/SIGINT) to all proxy servers.
- Added `/health` endpoint to Gemini and OpenAI-compatible proxies.
- Added request size limits (`CC_MAX_REQUEST_BYTES`) to Gemini and OpenCode Nemotron proxies.
- Added `.env` value caching for faster repeated reads during doctor/migrate operations.
- Moved Gemini proxy API key from URL query string to `x-goog-api-key` header for security.
- Replaced fixed proxy startup sleep with port-polling for reliable readiness detection.
- Fixed `cc-theme.ps1` cross-platform home directory detection.
- Fixed `Get-ProfileProviderGuess` to handle "openai" keyword.
- Added Linux to CI test matrix.
- Renamed `cc` command to `ccs` for clearer distinction from `cc-switch`/`cc-status`/`cc-manage`.
- Updated repository URL to `Shashank-1K/cc-manager`.

- Added OpenCode Nemotron provider support through a dedicated local proxy.
- Added OpenCode-safe request cleaning for Claude-only thinking, metadata, container, MCP, service tier, and beta fields while preserving tool calls/results.
- Routed OpenCode Nemotron through OpenCode Zen's documented `/v1/chat/completions` endpoint and token-style local auth mode.
- Added Anthropic-compatible response normalization and fake SSE streaming for OpenCode/Nemotron responses.

## v2.0.0

- Added provider-aware V2 implementation plan.
- Added `.env` key-name based profile migration design.
- Added production repo docs and secret-handling policy.
- Added shared OpenAI-compatible proxy plan and implementation.
- Added Gemini tool-call and thought-signature support.
- Added dynamic Groq model discovery requirement and CLI command.
