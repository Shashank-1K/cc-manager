'use strict';

/**
 * cc-manage Dashboard Server
 * Local-only web interface for managing profiles, keys, providers, and proxies.
 * Zero npm dependencies — uses only Node.js built-in modules.
 * Port: 18200 (configurable via DASHBOARD_PORT env or --port arg)
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');
const os = require('os');

const data = require('./data-access');
const providers = require('./providers');
const usageApi = require('./usage-api');

// ── Configuration ────────────────────────────────────────────────────────────

const PORT = parseInt(process.argv.find((a, i, arr) => arr[i - 1] === '--port') || '', 10)
  || parseInt(process.env.DASHBOARD_PORT || '', 10)
  || 18200;

const PUBLIC_DIR = path.join(__dirname, 'public');

const MIME_TYPES = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function json(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' });
  res.end(JSON.stringify(data));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try { resolve(JSON.parse(body || '{}')); }
      catch (e) { reject(new Error('Invalid JSON')); }
    });
    req.on('error', reject);
  });
}

function serveStatic(res, filePath) {
  const ext = path.extname(filePath);
  const mime = MIME_TYPES[ext] || 'application/octet-stream';
  try {
    const content = fs.readFileSync(filePath);
    res.writeHead(200, { 'Content-Type': mime });
    res.end(content);
  } catch {
    // Fallback to index.html for SPA routing
    try {
      const html = fs.readFileSync(path.join(PUBLIC_DIR, 'index.html'));
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(html);
    } catch {
      res.writeHead(404);
      res.end('Not Found');
    }
  }
}

// ── API Routes ───────────────────────────────────────────────────────────────

async function handleApi(req, res, pathname, method) {
  try {
    // GET /api/overview
    if (method === 'GET' && pathname === '/api/overview') {
      const active = data.readActiveProfile();
      const profiles = data.listProfiles();
      const keys = data.listKeysWithUsage();
      const proxyPortList = data.getProxyPorts();
      const proxyStatus = {};
      for (const { port } of proxyPortList) proxyStatus[port] = await data.checkPort(port);
      return json(res, 200, {
        activeProfile: active,
        profileCount: profiles.length,
        keyCount: keys.length,
        providerCount: providers.getProviderRegistry().length,
        proxyStatus,
        systemInfo: { nodeVersion: process.version, platform: os.platform(), dataRoot: data.getDataRoot() }
      });
    }

    // GET /api/providers
    if (method === 'GET' && pathname === '/api/providers') {
      return json(res, 200, { providers: providers.getProviderRegistry() });
    }

    // GET /api/profiles
    if (method === 'GET' && pathname === '/api/profiles') {
      const active = data.readActiveProfile();
      return json(res, 200, { profiles: data.listProfiles(), activeProfile: active ? active.profile : null });
    }

    // GET /api/profiles/:name
    const profileGetMatch = pathname.match(/^\/api\/profiles\/([^/]+)$/);
    if (method === 'GET' && profileGetMatch) {
      const name = decodeURIComponent(profileGetMatch[1]);
      const profile = data.getProfile(name);
      if (!profile) return json(res, 404, { error: 'Profile not found' });
      return json(res, 200, profile);
    }

    // POST /api/profiles
    if (method === 'POST' && pathname === '/api/profiles') {
      const body = await readBody(req);
      if (!body.fileName) return json(res, 400, { error: 'fileName is required' });
      if (!/^[a-zA-Z0-9_-]+$/.test(body.fileName)) return json(res, 400, { error: 'Invalid fileName' });
      const created = data.createProfile(body);
      return json(res, 201, created);
    }

    // PUT /api/profiles/:name
    const profilePutMatch = pathname.match(/^\/api\/profiles\/([^/]+)$/);
    if (method === 'PUT' && profilePutMatch) {
      const name = decodeURIComponent(profilePutMatch[1]);
      const body = await readBody(req);
      const updated = data.updateProfile(name, body);
      return json(res, 200, updated);
    }

    // DELETE /api/profiles/:name
    const profileDelMatch = pathname.match(/^\/api\/profiles\/([^/]+)$/);
    if (method === 'DELETE' && profileDelMatch) {
      const name = decodeURIComponent(profileDelMatch[1]);
      data.deleteProfile(name);
      return json(res, 200, { success: true });
    }

    // GET /api/keys
    if (method === 'GET' && pathname === '/api/keys') {
      return json(res, 200, { keys: data.listKeysWithUsage() });
    }

    // POST /api/keys
    if (method === 'POST' && pathname === '/api/keys') {
      const body = await readBody(req);
      if (!body.name || !body.value) return json(res, 400, { error: 'name and value required' });
      data.setEnvValue(data.envPath(), body.name, body.value);
      return json(res, 201, { name: body.name, value: data.redactSecret(body.value) });
    }

    // PUT /api/keys/:name
    const keyPutMatch = pathname.match(/^\/api\/keys\/([^/]+)$/);
    if (method === 'PUT' && keyPutMatch) {
      const name = decodeURIComponent(keyPutMatch[1]);
      const body = await readBody(req);
      if (!body.value) return json(res, 400, { error: 'value required' });
      data.setEnvValue(data.envPath(), name, body.value);
      return json(res, 200, { name, value: data.redactSecret(body.value) });
    }

    // DELETE /api/keys/:name
    const keyDelMatch = pathname.match(/^\/api\/keys\/([^/]+)$/);
    if (method === 'DELETE' && keyDelMatch) {
      const name = decodeURIComponent(keyDelMatch[1]);
      data.removeEnvValue(data.envPath(), name);
      return json(res, 200, { success: true });
    }

    // GET /api/health
    if (method === 'GET' && pathname === '/api/health') {
      const checks = await data.runHealthChecks();
      return json(res, 200, { checks });
    }

    // GET /api/doctor
    if (method === 'GET' && pathname === '/api/doctor') {
      const checks = await data.runDoctor();
      return json(res, 200, { checks });
    }

    // GET /api/models/:provider
    const modelsMatch = pathname.match(/^\/api\/models\/([^/]+)$/);
    if (method === 'GET' && modelsMatch) {
      const providerId = decodeURIComponent(modelsMatch[1]);
      const def = providers.getProviderDefinition(providerId);
      if (!def) return json(res, 404, { error: 'Provider not found' });

      // Check if dynamic fetch is requested
      const parsedUrl = url.parse(req.url, true);
      const wantsRefresh = parsedUrl.query.refresh === 'true';

      if (wantsRefresh && def.modelSource === 'dynamic' && def.modelsEndpoint) {
        // Try to fetch live models from the provider's API
        const env = data.parseEnvFile(data.envPath());
        const apiKey = env[def.keyName] || '';
        if (apiKey) {
          try {
            const https_ = require('https');
            const http_ = require('http');
            const u = new URL(def.modelsEndpoint);
            const transport = u.protocol === 'https:' ? https_ : http_;
            const liveModels = await new Promise((resolve, reject) => {
              const req_ = transport.request({
                hostname: u.hostname,
                port: u.port || (u.protocol === 'https:' ? 443 : 80),
                path: u.pathname + u.search,
                method: 'GET',
                headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
                timeout: 15000
              }, res_ => {
                let body = '';
                res_.on('data', c => body += c);
                res_.on('end', () => {
                  try {
                    const parsed = JSON.parse(body);
                    const models = [];
                    if (parsed.data && Array.isArray(parsed.data)) {
                      models.push(...parsed.data.map(m => m.id).filter(Boolean));
                    } else if (parsed.models && Array.isArray(parsed.models)) {
                      models.push(...parsed.models.map(m => m.id).filter(Boolean));
                    }
                    resolve(models);
                  } catch { resolve([]); }
                });
              });
              req_.on('error', () => resolve([]));
              req_.on('timeout', () => { req_.destroy(); resolve([]); });
              req_.end();
            });
            if (liveModels.length > 0) {
              return json(res, 200, { provider: def.id, models: liveModels, modelSource: 'live', count: liveModels.length });
            }
          } catch {}
        }
      }

      return json(res, 200, { provider: def.id, models: def.defaultModels, modelSource: def.modelSource || 'static', count: def.defaultModels.length });
    }

    // GET /api/theme
    if (method === 'GET' && pathname === '/api/theme') {
      return json(res, 200, data.getTheme());
    }

    // PUT /api/theme
    if (method === 'PUT' && pathname === '/api/theme') {
      const body = await readBody(req);
      const result = data.setTheme(body.theme || 'default');
      return json(res, 200, result);
    }

    // POST /api/settings/repair
    if (method === 'POST' && pathname === '/api/settings/repair') {
      const result = data.repairSettings();
      return json(res, 200, result);
    }

    // GET /api/analytics/usage/:provider — Fetch provider usage data
    const usageMatch = pathname.match(/^\/api\/analytics\/usage\/([^/]+)$/);
    if (method === 'GET' && usageMatch) {
      const providerId = decodeURIComponent(usageMatch[1]);
      const def = providers.getProviderDefinition(providerId);
      if (!def) return json(res, 404, { error: 'Provider not found' });
      // Find the API key for this provider
      const env = data.parseEnvFile(data.envPath());
      const keyName = def.keyName;
      const apiKey = env[keyName] || '';
      // Also check for CCKEY_* variants
      let resolvedKey = apiKey;
      if (!resolvedKey) {
        for (const [k, v] of Object.entries(env)) {
          if (k.startsWith('CCKEY_') && k.includes(providerId.toUpperCase().replace('-', '_'))) {
            resolvedKey = v;
            break;
          }
        }
      }
      const usage = await usageApi.fetchProviderUsage(providerId, resolvedKey);
      return json(res, 200, { provider: providerId, usage });
    }

    // GET /api/analytics/metrics — Local proxy request metrics
    if (method === 'GET' && pathname === '/api/analytics/metrics') {
      return json(res, 200, { metrics: usageApi.getProxyMetrics() });
    }

    // GET /api/analytics/overview — Full analytics overview
    if (method === 'GET' && pathname === '/api/analytics/overview') {
      const profiles = data.listProfiles();
      const keys = data.listKeysWithUsage();
      const env = data.parseEnvFile(data.envPath());
      const portStatus = {};
      for (const { port } of data.getProxyPorts()) {
        portStatus[port] = await data.checkPort(port);
      }
      // Get usage for providers that have API access
      const usageResults = {};
      const providersWithKeys = new Set();
      for (const k of keys) {
        if (k.providerId) providersWithKeys.add(k.providerId);
      }
      for (const pid of providersWithKeys) {
        const def = providers.getProviderDefinition(pid);
        if (def) {
          const keyVal = env[def.keyName] || '';
          if (keyVal) {
            usageResults[pid] = await usageApi.fetchProviderUsage(pid, keyVal);
          }
        }
      }
      return json(res, 200, {
        profiles: profiles.length,
        keys: keys.length,
        providers: providersWithKeys.size,
        portStatus,
        usage: usageResults,
        metrics: usageApi.getProxyMetrics()
      });
    }

    return null; // Not an API route
  } catch (e) {
    return json(res, 500, { error: e.message });
  }
}

// ── Server ─────────────────���─────────────────────────────────────────────────

const server = http.createServer(async (req, res) => {
  const parsed = url.parse(req.url, true);
  const pathname = parsed.pathname;
  const method = req.method;

  // CORS (localhost only)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (method === 'OPTIONS') { res.writeHead(204); return res.end(); }

  // API routes
  if (pathname.startsWith('/api/')) {
    const result = await handleApi(req, res, pathname, method);
    if (result !== null) return;
    return json(res, 404, { error: 'Unknown API endpoint' });
  }

  // Path traversal protection
  if (pathname.includes('..')) {
    res.writeHead(400);
    return res.end('Bad Request');
  }

  // Static files
  const filePath = path.join(PUBLIC_DIR, pathname === '/' ? 'index.html' : pathname);
  serveStatic(res, filePath);
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`cc-manage dashboard ready at http://127.0.0.1:${PORT}`);
  console.log(`Data root: ${data.getDataRoot()}`);
});

server.on('error', e => {
  console.error('Dashboard error:', e.message);
  process.exit(1);
});

function gracefulShutdown() {
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2000);
}
process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);
