'use strict';

/**
 * Provider usage/quota API integrations.
 * Fetches real usage data from providers that expose usage APIs.
 * Falls back to "No API available" for providers without programmatic access.
 */

const https = require('https');
const http = require('http');

// ── HTTP helper ──────────────────────────────────────────────────────────────

function httpRequest(url, headers, timeout = 10000) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const transport = u.protocol === 'https:' ? https : http;
    const opts = {
      hostname: u.hostname,
      port: u.port || (u.protocol === 'https:' ? 443 : 80),
      path: u.pathname + u.search,
      method: 'GET',
      headers: { ...headers, Accept: 'application/json' },
      timeout
    };
    const req = transport.request(opts, res => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
    req.end();
  });
}

// ── DeepSeek ─────────────────────────────────────────────────────────────────

async function fetchDeepSeekUsage(apiKey) {
  try {
    const res = await httpRequest('https://api.deepseek.com/user/balance', {
      Authorization: `Bearer ${apiKey}`
    });
    if (res.status !== 200) return { available: false, error: `HTTP ${res.status}` };
    const data = JSON.parse(res.body);
    const info = data.balance_infos || [];
    return {
      available: true,
      provider: 'deepseek',
      balances: info.map(b => ({
        currency: b.currency,
        total: parseFloat(b.total_balance) || 0,
        granted: parseFloat(b.granted_balance) || 0,
        toppedUp: parseFloat(b.topped_up_balance) || 0
      })),
      isAvailable: data.is_available
    };
  } catch (e) {
    return { available: false, error: e.message };
  }
}

// ── OpenRouter ───────────────────────────────────────────────────────────────

async function fetchOpenRouterUsage(apiKey) {
  try {
    const [creditsRes, activityRes] = await Promise.all([
      httpRequest('https://openrouter.ai/api/v1/credits', {
        Authorization: `Bearer ${apiKey}`
      }).catch(() => ({ status: 0, body: '{}' })),
      httpRequest('https://openrouter.ai/api/v1/activity', {
        Authorization: `Bearer ${apiKey}`
      }).catch(() => ({ status: 0, body: '{}' }))
    ]);

    if (creditsRes.status === 401 || creditsRes.status === 403) {
      return { available: false, error: 'Requires Management API key (not inference key)', needsManagementKey: true };
    }

    const credits = JSON.parse(creditsRes.body);
    const activity = JSON.parse(activityRes.body);

    const totalCredits = credits.data?.total_credits || 0;
    const totalUsage = credits.data?.total_usage || 0;

    const dailyUsage = [];
    if (activity.data && Array.isArray(activity.data)) {
      const byDate = {};
      for (const item of activity.data) {
        const date = item.date || 'unknown';
        if (!byDate[date]) byDate[date] = { date, requests: 0, promptTokens: 0, completionTokens: 0, cost: 0 };
        byDate[date].requests += item.requests || 0;
        byDate[date].promptTokens += item.prompt_tokens || 0;
        byDate[date].completionTokens += item.completion_tokens || 0;
        byDate[date].cost += item.usage || 0;
      }
      dailyUsage.push(...Object.values(byDate).sort((a, b) => a.date.localeCompare(b.date)));
    }

    return {
      available: true,
      provider: 'openrouter',
      totalCredits,
      totalUsage,
      remaining: totalCredits - totalUsage,
      dailyUsage
    };
  } catch (e) {
    return { available: false, error: e.message };
  }
}

// ── Anthropic ────────────────────────────────────────────────────────────────

async function fetchAnthropicUsage(apiKey) {
  // Standard keys can't access the usage API, but we can try and report
  try {
    const res = await httpRequest('https://api.anthropic.com/v1/organizations/rate_limits', {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    });
    if (res.status === 401 || res.status === 403) {
      return { available: false, error: 'Requires Admin API key for usage data', needsAdminKey: true };
    }
    if (res.status !== 200) return { available: false, error: `HTTP ${res.status}` };
    const data = JSON.parse(res.body);
    return {
      available: true,
      provider: 'anthropic',
      rateLimits: data.data || []
    };
  } catch (e) {
    return { available: false, error: e.message };
  }
}

// ── Fireworks ────────────────────────────────────────────────────────────────

async function fetchFireworksUsage(apiKey) {
  try {
    // Fireworks quotas endpoint needs account_id, try without it first
    const res = await httpRequest('https://api.fireworks.ai/v1/accounts', {
      Authorization: `Bearer ${apiKey}`
    });
    if (res.status !== 200) return { available: false, error: `HTTP ${res.status}` };
    // If we get accounts, fetch quotas for the first one
    const accounts = JSON.parse(res.body);
    const accountId = accounts[0]?.name?.split('/')?.pop();
    if (!accountId) return { available: false, error: 'No accounts found' };

    const quotaRes = await httpRequest(`https://api.fireworks.ai/v1/accounts/${accountId}/quotas`, {
      Authorization: `Bearer ${apiKey}`
    });
    if (quotaRes.status !== 200) return { available: false, error: `HTTP ${quotaRes.status}` };
    const quotas = JSON.parse(quotaRes.body);
    return {
      available: true,
      provider: 'fireworks',
      quotas: (quotas.quotas || []).map(q => ({
        name: q.name?.split('/')?.pop() || 'unknown',
        limit: q.value || 0,
        maxLimit: q.maxValue || 0,
        usage: q.usage || 0
      }))
    };
  } catch (e) {
    return { available: false, error: e.message };
  }
}

// ── Provider dispatcher ──────────────────────────────────────────────────────

async function fetchProviderUsage(providerId, apiKey) {
  if (!apiKey) return { available: false, error: 'No API key configured' };

  switch (providerId) {
    case 'deepseek': return fetchDeepSeekUsage(apiKey);
    case 'openrouter': return fetchOpenRouterUsage(apiKey);
    case 'anthropic': return fetchAnthropicUsage(apiKey);
    case 'fireworks': return fetchFireworksUsage(apiKey);
    default:
      return {
        available: false,
        error: 'No usage API available',
        hint: getDashboardHint(providerId)
      };
  }
}

function getDashboardHint(providerId) {
  const hints = {
    gemini: 'View usage at aistudio.google.com/rate-limit',
    groq: 'View usage at console.groq.com/settings/limits',
    mistral: 'View usage at console.mistral.ai',
    'mistral-vibe': 'View usage at console.mistral.ai',
    codestral: 'View usage at console.mistral.ai',
    together: 'View usage at api.together.xyz/settings/organization',
    xai: 'View usage at console.x.ai',
    'nvidia-nim': 'View usage at build.nvidia.com',
    huggingface: 'View usage at huggingface.co/settings/inference-providers',
    'ollama-cloud': 'View usage at ollama.com/settings',
    opencode_nemotron: 'View usage at opencode.ai',
    'openai-compatible': 'Usage tracking depends on your provider'
  };
  return hints[providerId] || 'Check your provider dashboard for usage details';
}

// ── Local proxy metrics ──────────────────────────────────────────────────────

// In-memory request counter (resets on server restart)
const proxyMetrics = {};

function recordProxyRequest(port, model, latencyMs, success) {
  const key = String(port);
  if (!proxyMetrics[key]) {
    proxyMetrics[key] = { requests: 0, errors: 0, totalLatency: 0, models: {}, history: [] };
  }
  const m = proxyMetrics[key];
  m.requests++;
  if (!success) m.errors++;
  m.totalLatency += latencyMs;
  if (model) m.models[model] = (m.models[model] || 0) + 1;
  // Keep last 100 entries
  m.history.push({ time: Date.now(), model, latencyMs, success });
  if (m.history.length > 100) m.history.shift();
}

function getProxyMetrics() {
  const result = {};
  for (const [port, m] of Object.entries(proxyMetrics)) {
    result[port] = {
      requests: m.requests,
      errors: m.errors,
      avgLatency: m.requests > 0 ? Math.round(m.totalLatency / m.requests) : 0,
      errorRate: m.requests > 0 ? (m.errors / m.requests * 100).toFixed(1) + '%' : '0%',
      topModels: Object.entries(m.models).sort((a, b) => b[1] - a[1]).slice(0, 5),
      recentRequests: m.history.slice(-20)
    };
  }
  return result;
}

module.exports = {
  fetchProviderUsage,
  getDashboardHint,
  recordProxyRequest,
  getProxyMetrics
};
