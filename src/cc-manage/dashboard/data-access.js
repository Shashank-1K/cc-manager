'use strict';

/**
 * Data access layer — reads and writes the flat files that cc-manage uses.
 * .env, .key-map.json, profiles/*.ps1, .claude_active_profile
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

// ── Paths ──────────────────────────────────────────���─────────────────────────

function getDataRoot() {
  return process.env.CLAUDE_PROFILES_ROOT || path.join(os.homedir(), '.claude-profiles');
}

function envPath() { return path.join(getDataRoot(), '.env'); }
function keyMapPath() { return path.join(getDataRoot(), '.key-map.json'); }
function profilesDir() { return path.join(getDataRoot(), 'profiles'); }
function activeProfilePath() { return path.join(getDataRoot(), '.claude_active_profile'); }
function claudeSettingsPath() { return path.join(os.homedir(), '.claude', 'settings.json'); }
function claudeJsonPath() { return path.join(os.homedir(), '.claude.json'); }

// ── .env operations ──────────────────────────────────────────────────────────

function parseEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const content = fs.readFileSync(filePath, 'utf8');
  const values = {};
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const m = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!m) continue;
    let val = m[2];
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    values[m[1]] = val;
  }
  return values;
}

function writeEnvFile(filePath, envObj) {
  const lines = Object.entries(envObj).map(([k, v]) => `${k}="${String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`);
  fs.writeFileSync(filePath, lines.join('\n') + '\n', 'utf8');
}

function setEnvValue(filePath, key, value) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) throw new Error(`Invalid key name: ${key}`);
  const env = parseEnvFile(filePath);
  env[key] = value;
  writeEnvFile(filePath, env);
}

function removeEnvValue(filePath, key) {
  const env = parseEnvFile(filePath);
  delete env[key];
  writeEnvFile(filePath, env);
}

function redactSecret(value) {
  if (!value) return '<empty>';
  if (value.length <= 8) return '<redacted>';
  return value.slice(0, 4) + '...' + value.slice(-4);
}

// ── .key-map.json operations ─────────────────────────────────────────────────

function readKeyMap(filePath) {
  if (!fs.existsSync(filePath)) return [];
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}

function writeKeyMap(filePath, map) {
  const clean = map.filter(item => item && item.KeyId).map(item => ({
    Profile: String(item.Profile || ''),
    Provider: String(item.Provider || ''),
    KeyId: String(item.KeyId || ''),
    SourceKeyName: String(item.SourceKeyName || ''),
    Label: String(item.Label || ''),
    UpdatedAt: String(item.UpdatedAt || '')
  }));
  clean.sort((a, b) => a.Profile.localeCompare(b.Profile));
  fs.writeFileSync(filePath, JSON.stringify(clean, null, 2), 'utf8');
}

function setKeyMapping(filePath, { profile, provider, keyId, sourceKeyName, label }) {
  const map = readKeyMap(filePath).filter(m => m.Profile !== profile);
  map.push({
    Profile: profile,
    Provider: provider,
    KeyId: keyId,
    SourceKeyName: sourceKeyName || '',
    Label: label || profile,
    UpdatedAt: new Date().toISOString().replace(/\.\d{3}Z$/, '')
  });
  writeKeyMap(filePath, map);
}

function removeKeyMapping(filePath, profile) {
  const map = readKeyMap(filePath).filter(m => m.Profile !== profile);
  writeKeyMap(filePath, map);
}

function getKeyMapping(filePath, profile) {
  return readKeyMap(filePath).find(m => m.Profile === profile) || null;
}

// ── Profile .ps1 operations ──────────────────────────────────────────────────

function parseProfileFile(filePath) {
  if (!fs.existsSync(filePath)) return null;
  const content = fs.readFileSync(filePath, 'utf8');
  const profile = {
    fileName: path.basename(filePath, '.ps1'),
    name: '', provider: '', mode: '', baseUrl: '', authMode: 'api_key',
    apiKeyId: '', apiKeyName: '', upstreamBaseUrl: '', proxyScript: '',
    proxyPort: '', defaultModel: '', models: []
  };

  const str = (varName) => {
    const m = content.match(new RegExp(`\\$script:${varName}\\s*=\\s*"(.*?)"`, 'i'));
    return m ? m[1] : '';
  };
  const num = (varName) => {
    const m = content.match(new RegExp(`\\$script:${varName}\\s*=\\s*(\\d+)`, 'i'));
    return m ? m[1] : '';
  };

  profile.name = str('PROFILE_NAME');
  profile.provider = str('PROVIDER');
  profile.mode = str('MODE');
  profile.baseUrl = str('BASE_URL');
  profile.authMode = str('AUTH_MODE') || 'api_key';
  profile.apiKeyId = str('API_KEY_ID');
  profile.apiKeyName = str('API_KEY_NAME');
  profile.upstreamBaseUrl = str('UPSTREAM_BASE_URL');
  profile.defaultModel = str('DEFAULT_MODEL');

  const proxyRaw = content.match(/\$script:PROXY_SCRIPT\s*=\s*(.*?)\r?$/mi);
  if (proxyRaw) profile.proxyScript = proxyRaw[1].trim();

  const portMatch = content.match(/\$script:PROXY_PORT\s*=\s*(\d+)/i);
  if (portMatch) profile.proxyPort = portMatch[1];

  const modelsMatch = content.match(/\$script:MODELS\s*=\s*@\(([\s\S]*?)\)/i);
  if (modelsMatch) {
    const block = modelsMatch[1];
    const models = [];
    const re = /"([^"]+)"/g;
    let m;
    while ((m = re.exec(block)) !== null) models.push(m[1]);
    profile.models = models;
  }

  if (!profile.provider) profile.provider = guessProvider(profile);
  if (!profile.mode) profile.mode = guessMode(profile.provider, profile.proxyScript);

  return profile;
}

function guessProvider(profile) {
  const hay = `${profile.name} ${profile.baseUrl} ${profile.proxyScript}`.toLowerCase();
  if (hay.includes('gemini')) return 'gemini';
  if (hay.includes('openrouter')) return 'openrouter';
  if (hay.includes('deepseek')) return 'deepseek';
  if (hay.includes('groq')) return 'groq';
  if (hay.includes('opencode') || hay.includes('nemotron')) return 'opencode_nemotron';
  if (hay.includes('codestral')) return 'codestral';
  if (hay.includes('vibe')) return 'mistral-vibe';
  if (hay.includes('mistral')) return 'mistral';
  if (hay.includes('together')) return 'together';
  if (hay.includes('fireworks')) return 'fireworks';
  if (hay.includes('xai') || hay.includes('x.ai')) return 'xai';
  if (hay.includes('ollama')) return 'ollama-cloud';
  if (hay.includes('hug') || hay.includes('huggingface')) return 'huggingface';
  if (hay.includes('nvidia') || hay.includes('nim')) return 'nvidia-nim';
  if (hay.includes('freetheai') || hay.includes('free.ai') || hay.includes('free-ai')) return 'freetheai';
  if (hay.includes('openai')) return 'openai-compatible';
  return 'anthropic';
}

function guessMode(provider, proxyScript) {
  if (proxyScript && proxyScript.includes('gemini')) return 'gemini-proxy';
  if (proxyScript && proxyScript.includes('hug')) return 'huggingface-proxy';
  if (proxyScript && proxyScript.includes('nvidia')) return 'nvidia-proxy';
  if (proxyScript && (proxyScript.includes('opencode') || proxyScript.includes('nemotron'))) return 'opencode-nemotron-proxy';
  if (proxyScript && proxyScript.includes('ollama')) return 'ollama-cloud-proxy';
  if (proxyScript && proxyScript.includes('codestral')) return 'codestral-proxy';
  if (proxyScript && proxyScript.includes('vibe')) return 'mistral-vibe-proxy';
  if (proxyScript && proxyScript.includes('mistral')) return 'mistral-proxy';
  if (proxyScript && proxyScript.includes('openrouter')) return 'openai-chat-proxy';
  if (proxyScript) return 'custom-proxy';
  switch (provider) {
    case 'anthropic': case 'deepseek': case 'fireworks': case 'openrouter': return 'anthropic-direct';
    case 'nvidia-nim': case 'nvidia': return 'nvidia-proxy';
    case 'opencode_nemotron': return 'opencode-nemotron-proxy';
    case 'ollama-cloud': return 'ollama-cloud-proxy';
    case 'codestral': return 'codestral-proxy';
    case 'mistral-vibe': return 'mistral-vibe-proxy';
    case 'mistral': return 'mistral-proxy';
    default: return 'openai-chat-proxy';
  }
}

function writeProfileFile(filePath, profile) {
  const q = (v) => String(v || '').replace(/"/g, '\\"');
  const proxyScriptLine = profile.proxyScript ? `\n$script:PROXY_SCRIPT = ${profile.proxyScript}` : '';
  const proxyPortLine = profile.proxyPort ? `\n$script:PROXY_PORT = ${profile.proxyPort}` : '';
  const upstreamLine = profile.upstreamBaseUrl ? `\n$script:UPSTREAM_BASE_URL = "${q(profile.upstreamBaseUrl)}"` : '';
  const modelsStr = profile.models && profile.models.length > 0
    ? '\n    ' + profile.models.map(m => `"${q(m)}"`).join(',\n    ')
    : '';

  const content = `$script:PROFILE_VERSION = 2
$script:PROFILE_NAME = "${q(profile.name)}"
$script:PROVIDER = "${q(profile.provider)}"
$script:MODE = "${q(profile.mode)}"
$script:BASE_URL = "${q(profile.baseUrl)}"
$script:AUTH_MODE = "${q(profile.authMode || 'api_key')}"
$script:API_KEY_ID = "${q(profile.apiKeyId)}"
$script:API_KEY_NAME = "${q(profile.apiKeyName || profile.apiKeyId)}"${upstreamLine}${proxyScriptLine}${proxyPortLine}
$script:DEFAULT_MODEL = "${q(profile.defaultModel)}"
$script:MODELS = @(${modelsStr}
)
`;
  fs.writeFileSync(filePath, content, 'utf8');
}

function listProfiles() {
  const dir = profilesDir();
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(f => f.endsWith('.ps1'))
    .sort()
    .map(f => {
      const parsed = parseProfileFile(path.join(dir, f));
      if (!parsed) return null;
      // Check if key is resolved
      const env = parseEnvFile(envPath());
      parsed.keyResolved = !!(parsed.apiKeyId && env[parsed.apiKeyId]);
      return parsed;
    })
    .filter(Boolean);
}

function getProfile(name) {
  const filePath = path.join(profilesDir(), name + '.ps1');
  return parseProfileFile(filePath);
}

function createProfile(data) {
  const dir = profilesDir();
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, data.fileName + '.ps1');
  if (fs.existsSync(filePath)) throw new Error(`Profile ${data.fileName} already exists`);
  writeProfileFile(filePath, data);
  // Set key mapping
  if (data.apiKeyId) {
    setKeyMapping(keyMapPath(), {
      profile: data.fileName,
      provider: data.provider,
      keyId: data.apiKeyId,
      sourceKeyName: data.keyName || '',
      label: data.name || data.fileName
    });
  }
  return getProfile(data.fileName);
}

function updateProfile(name, data) {
  const filePath = path.join(profilesDir(), name + '.ps1');
  if (!fs.existsSync(filePath)) throw new Error(`Profile ${name} not found`);
  const existing = parseProfileFile(filePath);
  const merged = { ...existing, ...data, fileName: name };
  writeProfileFile(filePath, merged);
  if (data.apiKeyId && data.apiKeyId !== existing.apiKeyId) {
    setKeyMapping(keyMapPath(), {
      profile: name,
      provider: merged.provider,
      keyId: data.apiKeyId,
      sourceKeyName: data.keyName || '',
      label: merged.name || name
    });
  }
  return getProfile(name);
}

function deleteProfile(name) {
  const filePath = path.join(profilesDir(), name + '.ps1');
  if (!fs.existsSync(filePath)) throw new Error(`Profile ${name} not found`);
  fs.unlinkSync(filePath);
  removeKeyMapping(keyMapPath(), name);
}

// ── Active profile ───────────────────────────────────────────────────────────

function readActiveProfile() {
  const fp = activeProfilePath();
  if (!fs.existsSync(fp)) return null;
  const content = fs.readFileSync(fp, 'utf8');
  const result = {};
  for (const line of content.split('\n')) {
    const m = line.trim().match(/^(PROFILE|MODEL)=(.*)$/);
    if (m) result[m[1].toLowerCase()] = m[2];
  }
  return result.profile ? result : null;
}

// ── Keys with usage info ─────────────────────────────────────────────────────

function listKeysWithUsage() {
  const env = parseEnvFile(envPath());
  const profiles = listProfiles();
  const keyMap = readKeyMap(keyMapPath());

  return Object.entries(env).map(([name, value]) => {
    const usedBy = profiles.filter(p => p.apiKeyId === name || p.apiKeyName === name).map(p => p.fileName);
    const mapping = keyMap.find(m => m.KeyId === name);
    const providerId = mapping ? mapping.Provider : '';
    return {
      name,
      value: redactSecret(value),
      usedBy,
      providerId,
      isGenerated: name.startsWith('CCKEY_')
    };
  });
}

// ── Theme ────────────────────────────────────────────────────────────────────

function getTheme() {
  const fp = claudeJsonPath();
  if (!fs.existsSync(fp)) return { theme: 'default', configPath: fp };
  try {
    const content = fs.readFileSync(fp, 'utf8');
    const m = content.match(/"theme"\s*:\s*"(.*?)"/i);
    return { theme: m ? m[1] : 'default', configPath: fp };
  } catch { return { theme: 'default', configPath: fp }; }
}

function setTheme(themeName) {
  const valid = ['light', 'dark', 'system', 'default'];
  if (!valid.includes(themeName)) throw new Error(`Invalid theme: ${themeName}`);
  const fp = claudeJsonPath();
  if (!fs.existsSync(fp)) throw new Error(`Claude config not found at ${fp}`);
  let content = fs.readFileSync(fp, 'utf8');
  if (themeName === 'default') {
    content = content.replace(/^\s*"theme"\s*.*?,?\r?\n?/gm, '');
  } else {
    if (/"theme"\s*:\s*"/.test(content)) {
      content = content.replace(/("theme"\s*:\s*)".*?"/, `$1"${themeName}"`);
    } else {
      content = content.replace(/^\{/, `{\n  "theme": "${themeName}",`);
    }
  }
  fs.writeFileSync(fp, content, 'utf8');
  return { theme: themeName };
}

// ── Settings repair ──────────────────────────────────────────────────────────

function repairSettings() {
  const fp = claudeSettingsPath();
  if (!fs.existsSync(fp)) return { changed: false, message: 'settings.json not found' };
  try {
    let settings;
    try { settings = JSON.parse(fs.readFileSync(fp, 'utf8')); } catch {
      fs.copyFileSync(fp, fp + '.bak-' + Date.now());
      fs.writeFileSync(fp, '{}', 'utf8');
      return { changed: true, message: 'Invalid JSON — reset to {}' };
    }
    let changed = false;
    const managed = ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_BASE_URL',
      'ANTHROPIC_MODEL', 'ANTHROPIC_DEFAULT_SONNET_MODEL', 'ANTHROPIC_DEFAULT_OPUS_MODEL',
      'ANTHROPIC_DEFAULT_HAIKU_MODEL'];

    if (settings.env && typeof settings.env === 'object') {
      for (const key of managed) {
        if (settings.env[key] !== undefined) { delete settings.env[key]; changed = true; }
      }
      if (Object.keys(settings.env).length === 0) { delete settings.env; changed = true; }
    }
    if (settings.model !== undefined) { delete settings.model; changed = true; }

    if (changed) {
      fs.copyFileSync(fp, fp + '.bak-' + Date.now());
      fs.writeFileSync(fp, JSON.stringify(settings, null, 2), 'utf8');
    }
    return { changed, message: changed ? 'Repaired settings.json' : 'No conflicts found' };
  } catch (e) {
    return { changed: false, message: 'Error: ' + e.message };
  }
}

// ── Dynamic port discovery ────────────────���───────────────────────────────────

const KNOWN_PORTS = [
  { port: 18000, name: 'Gemini' }, { port: 18003, name: 'NVIDIA NIM' },
  { port: 18004, name: 'Hugging Face' }, { port: 18005, name: 'Mistral' },
  { port: 18006, name: 'Codestral' }, { port: 18007, name: 'Mistral Vibe' },
  { port: 18100, name: 'OpenCode Nemotron' }
];

function getProxyPorts() {
  const dir = profilesDir();
  const ports = new Map();
  // Add known registry ports
  for (const { port, name } of KNOWN_PORTS) ports.set(port, name);
  // Scan profile files for actual ports
  if (fs.existsSync(dir)) {
    for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.ps1'))) {
      try {
        const content = fs.readFileSync(path.join(dir, f), 'utf8');
        const m = content.match(/\$script:PROXY_PORT\s*=\s*(\d+)/i);
        if (m) {
          const port = parseInt(m[1], 10);
          if (!ports.has(port)) ports.set(port, f.replace('.ps1', ''));
        }
      } catch {}
    }
  }
  return [...ports.entries()].sort((a, b) => a[0] - b[0]).map(([port, name]) => ({ port, name }));
}

// ── Health checks ─────────────────────────────────────────��──────────────────

const net = require('net');

function checkPort(port) {
  return new Promise(resolve => {
    const socket = new net.Socket();
    socket.setTimeout(300);
    socket.once('connect', () => { socket.destroy(); resolve(true); });
    socket.once('timeout', () => { socket.destroy(); resolve(false); });
    socket.once('error', () => { socket.destroy(); resolve(false); });
    socket.connect(port, '127.0.0.1');
  });
}

async function runHealthChecks() {
  const checks = [];
  // Node.js
  checks.push({ name: 'Node.js', status: 'ok', detail: process.version });
  // Claude Code
  const { execSync } = require('child_process');
  try {
    const claudePath = execSync('where claude 2>nul || which claude 2>/dev/null', { encoding: 'utf8', timeout: 3000 }).trim();
    checks.push({ name: 'Claude Code', status: claudePath ? 'ok' : 'warning', detail: claudePath || 'Not found' });
  } catch { checks.push({ name: 'Claude Code', status: 'warning', detail: 'Not found on PATH' }); }
  // .env
  const envExists = fs.existsSync(envPath());
  checks.push({ name: '.env file', status: envExists ? 'ok' : 'warning', detail: envExists ? envPath() : 'Missing' });
  // Profiles dir
  const dir = profilesDir();
  const profCount = fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => f.endsWith('.ps1')).length : 0;
  checks.push({ name: 'Profiles', status: profCount > 0 ? 'ok' : 'warning', detail: `${profCount} profiles found` });
  // Proxy ports (dynamic from profiles + known registry)
  for (const { port, name } of getProxyPorts()) {
    const listening = await checkPort(port);
    checks.push({ name: `Proxy ${port} (${name})`, status: listening ? 'running' : 'stopped', detail: listening ? 'Listening' : 'Not listening' });
  }
  // Per-profile checks
  const profiles = listProfiles();
  const env = parseEnvFile(envPath());
  for (const p of profiles) {
    const keyOk = p.apiKeyId ? !!env[p.apiKeyId] : false;
    checks.push({
      name: `Profile: ${p.fileName}`,
      status: keyOk ? 'ok' : 'warning',
      detail: keyOk ? `Key ${p.apiKeyId} resolved` : `Key ${p.apiKeyId || '(none)'} missing`
    });
  }
  return checks;
}

async function runDoctor() {
  const checks = [];
  // Node.js
  checks.push({ name: 'Node.js', status: 'ok', detail: process.version });
  // Claude Code
  const { execSync } = require('child_process');
  try {
    const p = execSync('where claude 2>nul || which claude 2>/dev/null', { encoding: 'utf8', timeout: 3000 }).trim();
    checks.push({ name: 'Claude Code', status: p ? 'ok' : 'warning', detail: p || 'Not found' });
  } catch { checks.push({ name: 'Claude Code', status: 'warning', detail: 'Not found' }); }
  // .env
  checks.push({ name: '.env', status: fs.existsSync(envPath()) ? 'ok' : 'warning', detail: envExists() ? 'Present' : 'Missing' });
  // Profiles
  const profiles = listProfiles();
  const env = parseEnvFile(envPath());
  for (const p of profiles) {
    const keyOk = p.apiKeyId ? !!env[p.apiKeyId] : false;
    const proxyOk = !p.proxyScript || fs.existsSync(path.join(__dirname, '..', 'proxy', path.basename(p.proxyScript)));
    checks.push({
      name: `Profile: ${p.fileName}`,
      status: keyOk && proxyOk ? 'ok' : (keyOk ? 'warning' : 'error'),
      detail: `Key: ${keyOk ? 'ok' : 'missing'}, Proxy: ${proxyOk ? 'ok' : 'missing'}`
    });
  }
  return checks;
}

function envExists() { return fs.existsSync(envPath()); }

module.exports = {
  getDataRoot, envPath, keyMapPath, profilesDir, activeProfilePath,
  parseEnvFile, writeEnvFile, setEnvValue, removeEnvValue, redactSecret,
  readKeyMap, writeKeyMap, setKeyMapping, removeKeyMapping, getKeyMapping,
  parseProfileFile, writeProfileFile, listProfiles, getProfile, createProfile, updateProfile, deleteProfile,
  readActiveProfile, listKeysWithUsage,
  getTheme, setTheme, repairSettings,
  checkPort, runHealthChecks, runDoctor, getProxyPorts, KNOWN_PORTS
};
