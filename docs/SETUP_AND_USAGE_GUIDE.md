# cc-manage Setup and Usage Guide

A complete, step-by-step guide to installing, configuring, and using cc-manage for provider-aware Claude Code profile management.

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Installation](#installation)
3. [First-Time Setup](#first-time-setup)
4. [Command Reference](#command-reference)
5. [Profile Management](#profile-management)
6. [API Key Management](#api-key-management)
7. [Model Management](#model-management)
8. [Proxy Architecture](#proxy-architecture)
9. [Troubleshooting](#troubleshooting)
10. [Uninstall](#uninstall)

---

## Prerequisites

Before installing cc-manage, ensure you have the following:

### Required

| Tool | Version | Purpose | Install |
|------|---------|---------|---------|
| **Node.js** | 16+ | Runs compatibility proxies | [nodejs.org](https://nodejs.org) |
| **PowerShell** | 5.1+ (Windows) or pwsh 7+ (macOS/Linux) | CLI engine | Pre-installed on Windows; `brew install powershell` on macOS |
| **Claude Code** | Latest | The CLI tool cc-manage wraps | `npm install -g @anthropic-ai/claude-code` |

### Optional (for development/testing)

| Tool | Version | Purpose |
|------|---------|---------|
| **Python** | 3.8+ | Running proxy conversion tests |
| **Git** | Any | Cloning the repository |

### Verify Prerequisites

```powershell
# Check Node.js
node --version    # Should show v16+

# Check PowerShell (Windows)
$PSVersionTable.PSVersion    # Should show 5.1+

# Check PowerShell Core (macOS/Linux)
pwsh --version    # Should show 7+

# Check Claude Code
claude --version    # Should show installed version
```

---

## Installation

### Option A: One-Line Install (Recommended)

**Windows PowerShell:**

```powershell
irm https://raw.githubusercontent.com/Shashank-1K/cc-manager/main/install.ps1 | iex
```

This will:
1. Download the latest cc-manage from GitHub
2. Extract to `~/.claude-profiles/`
3. Add `~/.claude-profiles` to your user PATH
4. Run `cc-manage doctor` to verify installation

**macOS/Linux:**

```sh
curl -fsSL https://raw.githubusercontent.com/Shashank-1K/cc-manager/main/install.sh | sh
```

This will:
1. Download the latest cc-manage from GitHub
2. Extract to `~/.claude-profiles/`
3. Make shell launchers executable
4. Add PATH entry to your shell RC file (~/.zshrc, ~/.bashrc, or ~/.profile)
5. Run `cc-manage doctor` to verify installation

### Option B: Manual Install from Git

```bash
git clone https://github.com/Shashank-1K/cc-manager.git
cd cc-manage
```

**Windows:**
```powershell
Copy-Item -Path "src\cc-manage\*" -Destination "$HOME\.claude-profiles" -Recurse -Force
New-Item -ItemType Directory -Force -Path "$HOME\.claude-profiles\profiles"
# Add to PATH (User level)
$currentPath = [Environment]::GetEnvironmentVariable("Path", "User")
[Environment]::SetEnvironmentVariable("Path", "$currentPath;$HOME\.claude-profiles", "User")
```

**macOS/Linux:**
```sh
mkdir -p ~/.claude-profiles/profiles
cp -R src/cc-manage/* ~/.claude-profiles/
chmod +x ~/.claude-profiles/ccs ~/.claude-profiles/cc-switch ~/.claude-profiles/cc-status ~/.claude-profiles/cc-manage ~/.claude-profiles/claude
echo 'export PATH="$HOME/.claude-profiles:$PATH"' >> ~/.zshrc  # or ~/.bashrc
source ~/.zshrc  # or ~/.bashrc
```

### Verify Installation

```powershell
cc-manage doctor
```

Expected output:
```
Claude Profiles Doctor
Node: /usr/local/bin/node
Claude Code: /usr/local/bin/claude
Env file: missing        # Normal if no keys configured yet
Doctor passed.
```

---

## First-Time Setup

After installation, follow these steps in order:

### Step 1: Run Doctor

```powershell
cc-manage doctor
```

This checks:
- Node.js is installed (needed for proxies)
- Claude Code is installed
- .env file exists
- All profiles have valid API key references
- All proxy scripts exist

### Step 2: Add Your First Profile

```powershell
cc-manage add
```

This opens an interactive wizard:

1. **Select Provider** — Choose from the list (e.g., "Anthropic", "Gemini", "OpenRouter")
2. **Filename** — Enter a short name (e.g., "my-anthropic", "gemini-flash")
3. **Profile Display Name** — Human-readable name (defaults to filename)
4. **API Key** — Enter or select an existing key
5. **Base URL** — Confirm or change the provider endpoint
6. **Models** — Select from defaults or enter custom model names
7. **Default Model** — Choose which model to use by default

### Step 3: Switch to Your Profile

```powershell
cc-switch
```

This shows a numbered list of profiles. Select one by number or name:

```powershell
cc-switch my-anthropic           # By name
cc-switch 1                      # By number
cc-switch 1 gemini-2.5-flash     # Profile + model
```

### Step 4: Launch Claude Code

```powershell
ccs
```

This reads your active profile, starts any needed proxy, sets environment variables, and launches Claude Code.

---

## Command Reference

### Core Commands

| Command | Description | Example |
|---------|-------------|---------|
| `cc-switch` | Interactive profile/model selector | `cc-switch` |
| `cc-switch <profile> [model]` | Non-interactive switch | `cc-switch 3 1` |
| `ccs [args]` | Launch Claude Code with active profile | `ccs --print "Hello"` |
| `cc-status` | Show active profile details | `cc-status` |
| `cc-dashboard` | Launch web management dashboard | `cc-dashboard` |
| `claude` | Alias for `ccs` | `claude` |

### Management Commands

| Command | Description | Example |
|---------|-------------|---------|
| `cc-manage` | Interactive management menu | `cc-manage` |
| `cc-manage add` | Add a new profile | `cc-manage add` |
| `cc-manage edit [profile]` | Edit an existing profile | `cc-manage edit 2` |
| `cc-manage doctor` | Check installation health | `cc-manage doctor` |
| `cc-manage test <profile> [model]` | Test a profile | `cc-manage test my-profile --level tools` |
| `cc-manage migrate` | Migrate v1 profiles to v2 key IDs | `cc-manage migrate` |
| `cc-manage settings repair` | Fix Claude settings.json conflicts | `cc-manage settings repair` |

### Key Management Commands

| Command | Description | Example |
|---------|-------------|---------|
| `cc-manage key list` | Show all API keys with redacted values | `cc-manage key list` |
| `cc-manage key set <KEY_ID>` | Add/update a key value | `cc-manage key set CCKEY_GEMINI_MY_1234ABCD` |
| `cc-manage key rename <OLD> <NEW>` | Rename a key | `cc-manage key rename OLD_KEY NEW_KEY` |
| `cc-manage key remove <KEY_ID>` | Remove a key from .env | `cc-manage key remove OLD_KEY` |

### Model Commands

| Command | Description | Example |
|---------|-------------|---------|
| `cc-manage models <provider>` | List available models | `cc-manage models groq` |
| `cc-manage models <provider> --refresh` | Fetch live models from provider | `cc-manage models groq --refresh` |

### Help Commands

| Command | Description |
|---------|-------------|
| `cc-manage -help` | Show general help (interactive pages) |
| `cc-manage -help general` | General help page |
| `cc-manage -help commands` | Commands help page |
| `cc-manage -help uninstall` | Uninstall instructions |

---

## Profile Management

### Profile Files

Profiles are stored as PowerShell scripts in `~/.claude-profiles/profiles/`:

```text
~/.claude-profiles/profiles/my-anthropic.ps1
~/.claude-profiles/profiles/gemini-flash.ps1
```

Each profile contains:

```powershell
$script:PROFILE_VERSION = 2
$script:PROFILE_NAME = "My Anthropic Profile"
$script:PROVIDER = "anthropic"
$script:MODE = "anthropic-direct"
$script:BASE_URL = "https://api.anthropic.com"
$script:AUTH_MODE = "api_key"
$script:API_KEY_ID = "CCKEY_ANTHROPIC_MY_1234ABCD"
$script:API_KEY_NAME = "CCKEY_ANTHROPIC_MY_1234ABCD"
$script:DEFAULT_MODEL = "claude-sonnet-4-20250514"
$script:MODELS = @("claude-sonnet-4-20250514", "claude-opus-4-20250514")
```

### Adding Profiles

**Interactive:**
```powershell
cc-manage add
```

**Provider-specific examples:**
```powershell
cc-manage add  # Select Gemini → enter API key → choose gemini-2.5-flash
cc-manage add  # Select OpenRouter → enter API key → choose anthropic/claude-sonnet-4
cc-manage add  # Select Groq → enter API key → select dynamic models
```

### Editing Profiles

```powershell
cc-manage edit           # Interactive selection
cc-manage edit 3         # Edit profile #3
cc-manage edit my-profile  # Edit by name
```

Editable fields:
- Profile display name
- Provider and mode
- Base URL and upstream URL
- API key assignment
- Model list (add/remove/set default)

### Deleting Profiles

```powershell
cc-manage  # Select "Delete Profile" from menu
```

Warning: Deleting a profile does NOT delete its API key from .env. Use `cc-manage key remove` to clean up unused keys.

---

## API Key Management

### Key Storage

API keys are stored in `~/.claude-profiles/.env` as environment variables:

```text
CCKEY_GEMINI_MY_1234ABCD=AIza...
CCKEY_OPENROUTER_WORK_5678EFG=sk-or-...
ANTHROPIC_API_KEY=sk-ant-...
```

### Key Naming Convention (V2)

Keys use generated IDs: `CCKEY_<PROVIDER>_<PROFILE>_<RANDOM>`

This means:
- Profile files never contain raw API keys
- Multiple profiles can share one key
- Key values are stored only in .env

### Managing Keys

```powershell
# List all keys
cc-manage key list

# Add a new key
cc-manage key set CCKEY_GEMINI_NEW_1234ABCD

# Rename a key
cc-manage key rename OLD_KEY_NAME NEW_KEY_NAME

# Remove a key
cc-manage key remove OLD_KEY_NAME
```

### Key Listing Output

```
--- Configured API Keys ---
- CCKEY_GEMINI_MY_1234ABCD (Provider: Gemini, Suffix: MY_1234ABCD)
  Value:   AIza...abcd
  Usage:   Used by: my-gemini-profile

- OPENROUTER_API_KEY (Provider: OpenRouter, Suffix: (default))
  Value:   sk-or...wxyz
  Usage:   Used by: openrouter-free
```

---

## Model Management

### Default Models

Each provider comes with default models. For example:
- **Anthropic:** `claude-sonnet-4-20250514`, `claude-opus-4-20250514`
- **Gemini:** `gemini-2.5-flash`, `gemini-3.5-flash`
- **Groq:** `openai/gpt-oss-120b`, `qwen/qwen3-32b`

### Dynamic Model Refresh

Some providers support fetching live model lists:

```powershell
cc-manage models groq --refresh
cc-manage models mistral --refresh
cc-manage models mistral-vibe --refresh
cc-manage models nvidia-nim --refresh
```

### Custom Models

When adding or editing a profile, you can enter custom models:

```powershell
cc-manage add
# ... select provider ...
# When prompted for models:
Models (comma separated, blank for suggested): my-custom-model, another-model
Default Model [my-custom-model]:
```

### Model Aliases

When launching Claude Code, `ccs` sets model aliases:
- `ANTHROPIC_MODEL` = selected model
- `ANTHROPIC_DEFAULT_SONNET_MODEL` = selected model (or first fallback)
- `ANTHROPIC_DEFAULT_OPUS_MODEL` = first non-selected model
- `ANTHROPIC_DEFAULT_HAIKU_MODEL` = second non-selected model

This means `/model` commands inside Claude Code will map to your chosen models.

---

## Proxy Architecture

### When Proxies Are Used

Not all providers need a proxy:

| Mode | Providers | Proxy Needed |
|------|-----------|--------------|
| `anthropic-direct` | Anthropic, OpenRouter, DeepSeek, Fireworks | No |
| `gemini-proxy` | Gemini | Yes (anthropic-gemini-proxy.js) |
| `openai-chat-proxy` | Groq, Together, xAI, Ollama Cloud, Custom | Yes (openai-chat-proxy.js) |
| `mistral-proxy` | Mistral | Yes (mistral-anthropic-proxy.js -> openai-chat-proxy.js) |
| `mistral-vibe-proxy` | Mistral Vibe | Yes (mistral-vibe-anthropic-proxy.js -> openai-chat-proxy.js) |
| `codestral-proxy` | Codestral | Yes (codestral-anthropic-proxy.js -> openai-chat-proxy.js) |
| `nvidia-proxy` | NVIDIA NIM | Yes (nvidia-anthropic-proxy.js -> openai-chat-proxy.js) |
| `huggingface-proxy` | Hugging Face | Yes (hug-anthropic-proxy.js -> openai-chat-proxy.js) |
| `opencode-nemotron-proxy` | OpenCode Nemotron | Yes (opencode-nemotron-proxy.js) |

### How Proxies Work

1. `ccs` starts the proxy on `127.0.0.1:<port>` (default ports 18000-18100)
2. Claude Code sends Anthropic Messages API requests to `http://127.0.0.1:<port>/v1/messages`
3. The proxy translates to the provider's native format (OpenAI Chat Completions, Gemini generateContent, etc.)
4. The proxy sends the translated request to the upstream provider
5. The proxy translates the response back to Anthropic Messages format
6. Claude Code receives a compatible response

### Proxy Ports

| Provider | Default Port |
|----------|-------------|
| Gemini | 18000 |
| NVIDIA NIM | 18003 |
| Hugging Face | 18004 |
| Mistral | 18005 |
| Codestral | 18006 |
| Mistral Vibe | 18007 |
| OpenCode Nemotron | 18100 |
| OpenAI-compatible (custom) | User-selected |

### Health Checks

All proxies expose a health endpoint:

```bash
curl http://127.0.0.1:18000/health
# {"ok":true,"model":"gemini-2.5-flash"}
```

---

## Web Dashboard

cc-manager includes a local web dashboard for visual management.

### Starting the Dashboard

```powershell
cc-dashboard                    # Default port 18200
cc-dashboard --port 19000       # Custom port
DASHBOARD_PORT=19000 cc-dashboard  # Via environment variable
```

Open `http://127.0.0.1:18200` in your browser.

### Dashboard Sections

| Section | What it does |
|---------|-------------|
| **Dashboard** | Active profile, stat cards, proxy status grid with live indicators, system info. Auto-refreshes every 10 seconds. |
| **Profiles** | Table of all profiles with create/edit/delete. Modal forms for provider selection, key assignment, model configuration. |
| **API Keys** | List all keys with redacted values. Shows which profiles use each key. Add/edit/delete with provider association. |
| **Providers** | Card grid of all 16 providers showing mode, port, auth type, and default models. |
| **Proxy Health** | Live port status check for all proxy services (Gemini, Mistral, NVIDIA, etc.). |
| **Models** | Select a provider to view its models. Click to copy model names. |
| **Doctor** | System health checks: Node.js, Claude Code, .env, per-profile key resolution, proxy script existence. |
| **Settings** | Theme selector (light/dark/system), settings.json repair button. |

### Security

- Binds to `127.0.0.1` only — not accessible from other devices
- API key values are always returned redacted (first 4 + `...` + last 4 chars)
- No npm dependencies — pure Node.js built-in modules
- Reads and writes the same data files as the CLI (fully interchangeable)

### API Endpoints

The dashboard exposes a REST API under `/api/`:

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/overview` | Dashboard summary with active profile, counts, proxy status |
| GET | `/api/providers` | Full provider registry |
| GET/POST/PUT/DELETE | `/api/profiles[/:name]` | Profile CRUD |
| GET/POST/PUT/DELETE | `/api/keys[/:name]` | API key CRUD |
| GET | `/api/health` | Comprehensive health checks |
| GET | `/api/doctor` | Doctor checks |
| GET | `/api/models/:provider` | Provider model list |
| GET/PUT | `/api/theme` | Theme management |
| POST | `/api/settings/repair` | Fix settings.json conflicts |

---

## Troubleshooting

### Common Issues

#### "No active profile found"

```powershell
cc-switch    # Select a profile first
ccs          # Then launch
```

#### "Missing API key id"

The profile references a key that doesn't exist in .env:

```powershell
cc-manage key list              # See what keys exist
cc-manage key set <KEY_ID>      # Add the missing key
# Or edit the profile to use an existing key:
cc-manage edit <profile>
```

#### "Claude Code executable not found"

Set `CLAUDE_CODE_BIN` to the full path:

```powershell
$env:CLAUDE_CODE_BIN = "C:\Users\you\.local\bin\claude.exe"
# Or add to system environment permanently
```

#### Proxy won't start / port already in use

Another process is using the proxy port:

```powershell
# Find what's using the port (Windows)
Get-NetTCPConnection -LocalPort 18000 -State Listen

# Kill the process
Stop-Process -Id <PID>

# Or use a different port by editing the profile
cc-manage edit <profile>    # Change ProxyPort
```

#### "settings.json" conflicts

cc-manage manages certain settings in `~/.claude/settings.json`. If you see conflicts:

```powershell
cc-manage settings repair
```

This removes `ANTHROPIC_API_KEY`, `ANTHROPIC_BASE_URL`, `ANTHROPIC_MODEL`, and related overrides from settings.json while preserving other settings.

#### Provider returns errors

1. Check your API key is valid: `cc-manage key list`
2. Test the profile: `cc-manage test <profile> --level basic`
3. Check proxy logs (if debug enabled):
   ```powershell
   $env:GEMINI_PROXY_DEBUG = "1"    # For Gemini proxy
   ```

#### Models not loading (dynamic providers)

```powershell
cc-manage models groq --refresh
# If it fails, check your API key has model-list permissions
```

### Running Tests

```powershell
# Proxy conversion tests (no API keys needed)
$env:CLAUDE_PROFILES_ROOT = "$PWD\src\cc-manage"
python tests\test_proxy_conversions.py
```

---

## Uninstall

### Backup First

```powershell
# Back up profiles and keys
Copy-Item "$HOME\.claude-profiles" "$HOME\.claude-profiles.backup" -Recurse
```

### Remove on Windows

```powershell
$installDir = Join-Path $HOME ".claude-profiles"
$userPath = [Environment]::GetEnvironmentVariable("Path", "User")
$newUserPath = (($userPath -split ";") | Where-Object { $_ -and $_ -ne $installDir }) -join ";"
[Environment]::SetEnvironmentVariable("Path", $newUserPath, "User")
if (Test-Path -LiteralPath $installDir) {
    Remove-Item -LiteralPath $installDir -Recurse -Force
}
```

### Remove on macOS/Linux

```sh
rm -rf "$HOME/.claude-profiles"
# Remove PATH entry from ~/.zshrc, ~/.bashrc, or ~/.profile:
#   # cc-manage PATH
#   export PATH="$HOME/.claude-profiles:$PATH"
```

### Clean Up Claude Settings

```powershell
cc-manage settings repair    # Remove cc-manage overrides from settings.json
```
