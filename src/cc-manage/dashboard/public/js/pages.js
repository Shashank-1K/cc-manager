'use strict';

/* ── Helper: create element with text ─────────────────────────────── */
function el(tag, attrs, ...children) {
  const e = document.createElement(tag);
  if (attrs) Object.entries(attrs).forEach(([k, v]) => {
    if (k === 'className') e.className = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2).toLowerCase(), v);
    else e.setAttribute(k, v);
  });
  children.forEach(c => {
    if (typeof c === 'string') e.appendChild(document.createTextNode(c));
    else if (c) e.appendChild(c);
  });
  return e;
}

/* ── 1. Dashboard Overview ────────────────────────────────────────── */
async function renderOverview() {
  const content = document.getElementById('page-content');
  content.innerHTML = '<p>Loading...</p>';

  try {
    const data = await api('GET', '/api/overview');
    content.innerHTML = '';

    // Stat cards
    const grid = el('div', { className: 'stat-grid' });
    const stats = [
      { value: data.activeProfile ? data.activeProfile.profile : 'None', label: 'Active Profile', color: 'var(--accent)' },
      { value: data.profileCount, label: 'Profiles', color: 'var(--success)' },
      { value: data.keyCount, label: 'API Keys', color: 'var(--warning)' },
      { value: data.providerCount, label: 'Providers', color: 'var(--info)' }
    ];
    stats.forEach(s => {
      const card = el('div', { className: 'stat-card' },
        el('div', { className: 'stat-value', style: `color:${s.color}` }, String(s.value)),
        el('div', { className: 'stat-label' }, s.label)
      );
      grid.appendChild(card);
    });
    content.appendChild(grid);

    // Active model
    if (data.activeProfile && data.activeProfile.model) {
      const modelInfo = el('div', { className: 'card', style: 'margin-bottom:16px' },
        el('div', { className: 'card-title' }, 'Active Model'),
        el('p', {}, data.activeProfile.model)
      );
      content.appendChild(modelInfo);
    }

    // Proxy status
    const proxyCard = el('div', { className: 'card' });
    proxyCard.appendChild(el('div', { className: 'card-header' },
      el('div', { className: 'card-title' }, 'Proxy Status')
    ));
    const proxyGrid = el('div', { className: 'proxy-grid' });
    const portNames = { 18000: 'Gemini', 18003: 'NVIDIA NIM', 18004: 'Hugging Face', 18005: 'Mistral', 18006: 'Codestral', 18007: 'Mistral Vibe', 18100: 'OpenCode' };
    Object.entries(data.proxyStatus).forEach(([port, running]) => {
      const item = el('div', { className: 'proxy-item' },
        el('div', { className: `proxy-dot ${running ? 'running' : 'stopped'}` }),
        el('span', {}, `${portNames[port] || port} (${port})`)
      );
      proxyGrid.appendChild(item);
    });
    proxyCard.appendChild(proxyGrid);
    content.appendChild(proxyCard);

    // System info
    const sysCard = el('div', { className: 'card', style: 'margin-top:16px' },
      el('div', { className: 'card-title', style: 'margin-bottom:8px' }, 'System Info'),
      el('p', { style: 'font-size:13px;color:var(--text-secondary)' },
        `Node ${data.systemInfo.nodeVersion} • ${data.systemInfo.platform} • ${data.systemInfo.dataRoot}`
      )
    );
    content.appendChild(sysCard);

    // Auto-refresh every 10s
    refreshInterval = setInterval(() => renderOverview(), 10000);
  } catch (e) {
    content.innerHTML = `<div class="empty-state"><div class="icon">⚠️</div><p>${e.message}</p></div>`;
  }
}

/* ── 2. Profile Management ────────────────────────────────────────── */
async function renderProfiles() {
  const content = document.getElementById('page-content');
  content.innerHTML = '<p>Loading...</p>';

  try {
    const [profData, provData] = await Promise.all([api('GET', '/api/profiles'), api('GET', '/api/providers')]);
    content.innerHTML = '';

    const actions = document.getElementById('header-actions');
    actions.innerHTML = '';
    const addBtn = el('button', { className: 'btn btn-primary', onClick: () => showProfileModal(null, provData.providers) }, '+ Add Profile');
    actions.appendChild(addBtn);

    if (profData.profiles.length === 0) {
      content.appendChild(el('div', { className: 'empty-state' },
        el('div', { className: 'icon' }, '📁'), el('p', {}, 'No profiles yet. Create your first one!')
      ));
      return;
    }

    const wrapper = el('div', { className: 'card table-wrapper' });
    const table = el('table');
    const thead = el('thead', {}, el('tr', {},
      el('th', {}, '#'), el('th', {}, 'Name'), el('th', {}, 'Provider'),
      el('th', {}, 'Mode'), el('th', {}, 'Port'), el('th', {}, 'Model'), el('th', {}, 'Key'), el('th', {}, 'Actions')
    ));
    table.appendChild(thead);

    // Detect port conflicts
    const portUsage = {};
    profData.profiles.forEach(p => {
      if (p.proxyPort) {
        if (!portUsage[p.proxyPort]) portUsage[p.proxyPort] = [];
        portUsage[p.proxyPort].push(p.fileName);
      }
    });

    const tbody = el('tbody');
    profData.profiles.forEach((p, i) => {
      const keyBadge = p.keyResolved
        ? el('span', { className: 'badge badge-success' }, '✓ Resolved')
        : el('span', { className: 'badge badge-danger' }, '✗ Missing');
      const isActive = profData.activeProfile === p.fileName;
      const hasPortConflict = p.proxyPort && portUsage[p.proxyPort] && portUsage[p.proxyPort].length > 1;
      const portCell = p.proxyPort
        ? el('td', { style: 'font-family:monospace;font-size:12px' },
            el('span', { className: hasPortConflict ? 'badge badge-danger' : 'badge badge-gray', title: hasPortConflict ? `Conflict: also used by ${portUsage[p.proxyPort].filter(n => n !== p.fileName).join(', ')}` : '' }, p.proxyPort),
            hasPortConflict ? el('span', { style: 'color:var(--danger);font-size:11px;margin-left:4px' }, '⚠') : null
          )
        : el('td', { style: 'color:var(--text-secondary)' }, '-');
      const row = el('tr', {},
        el('td', {}, String(i + 1)),
        el('td', {}, el('strong', {}, p.name || p.fileName), isActive ? el('span', { className: 'badge badge-info', style: 'margin-left:6px' }, 'Active') : null),
        el('td', {}, p.provider),
        el('td', {}, p.mode),
        portCell,
        el('td', { style: 'font-size:12px;font-family:monospace' }, p.defaultModel || '-'),
        el('td', {}, keyBadge),
        el('td', {},
          el('button', { className: 'btn btn-sm btn-secondary', onClick: () => showProfileModal(p, provData.providers) }, 'Edit'),
          el('button', { className: 'btn btn-sm btn-danger', style: 'margin-left:4px', onClick: () => deleteProfile(p.fileName) }, 'Delete')
        )
      );
      tbody.appendChild(row);
    });
    table.appendChild(tbody);
    wrapper.appendChild(table);
    content.appendChild(wrapper);
  } catch (e) {
    content.innerHTML = `<div class="empty-state"><div class="icon">⚠️</div><p>${e.message}</p></div>`;
  }
}

function showProfileModal(profile, providers) {
  const isEdit = !!profile;
  const providerOpts = providers.map(p => `<option value="${p.id}" ${profile && profile.provider === p.id ? 'selected' : ''}>${p.name} (${p.mode})</option>`).join('');
  const modelStr = profile ? (profile.models || []).join(', ') : '';
  const html = `
    <div class="form-group"><label class="form-label">Filename</label>
      <input class="form-input" id="pf-file" value="${profile ? profile.fileName : ''}" ${isEdit ? 'disabled' : ''} placeholder="my-profile"></div>
    <div class="form-group"><label class="form-label">Display Name</label>
      <input class="form-input" id="pf-name" value="${profile ? profile.name : ''}" placeholder="My Profile"></div>
    <div class="form-group"><label class="form-label">Provider</label>
      <select class="form-select" id="pf-provider">${providerOpts}</select></div>
    <div class="form-group"><label class="form-label">Base URL</label>
      <input class="form-input" id="pf-url" value="${profile ? profile.baseUrl : ''}" placeholder="https://api.example.com/v1"></div>
    <div class="form-group"><label class="form-label">API Key ID</label>
      <input class="form-input" id="pf-key" value="${profile ? profile.apiKeyId : ''}" placeholder="CCKEY_PROVIDER_NAME_ABCD1234"></div>
    <div class="form-group"><label class="form-label">Default Model</label>
      <input class="form-input" id="pf-model" value="${profile ? profile.defaultModel : ''}" placeholder="model-name"></div>
    <div class="form-group"><label class="form-label">Models (comma separated)</label>
      <input class="form-input" id="pf-models" value="${modelStr}" placeholder="model1, model2"></div>
  `;
  showModal(isEdit ? 'Edit Profile' : 'Add Profile', html, async () => {
    const data = {
      fileName: document.getElementById('pf-file').value.trim(),
      name: document.getElementById('pf-name').value.trim(),
      provider: document.getElementById('pf-provider').value,
      baseUrl: document.getElementById('pf-url').value.trim(),
      apiKeyId: document.getElementById('pf-key').value.trim(),
      apiKeyName: document.getElementById('pf-key').value.trim(),
      defaultModel: document.getElementById('pf-model').value.trim(),
      models: document.getElementById('pf-models').value.split(',').map(s => s.trim()).filter(Boolean)
    };
    if (!data.fileName) throw new Error('Filename required');
    if (isEdit) await api('PUT', `/api/profiles/${profile.fileName}`, data);
    else await api('POST', '/api/profiles', data);
  });
}

async function deleteProfile(name) {
  if (!confirm(`Delete profile "${name}"?`)) return;
  try { await api('DELETE', `/api/profiles/${name}`); toast('Deleted', 'success'); loadSection(); }
  catch (e) { toast(e.message, 'error'); }
}

/* ── 3. API Key Management ────────────────────────────────────────── */
async function renderKeys() {
  const content = document.getElementById('page-content');
  content.innerHTML = '<p>Loading...</p>';

  try {
    const data = await api('GET', '/api/keys');
    content.innerHTML = '';

    const actions = document.getElementById('header-actions');
    actions.innerHTML = '';
    actions.appendChild(el('button', { className: 'btn btn-primary', onClick: showKeyModal }, '+ Add Key'));

    if (data.keys.length === 0) {
      content.appendChild(el('div', { className: 'empty-state' },
        el('div', { className: 'icon' }, '🔑'), el('p', {}, 'No API keys configured yet.')
      ));
      return;
    }

    const wrapper = el('div', { className: 'card table-wrapper' });
    const table = el('table');
    table.appendChild(el('thead', {}, el('tr', {},
      el('th', {}, 'Name'), el('th', {}, 'Value'), el('th', {}, 'Provider'),
      el('th', {}, 'Used By'), el('th', {}, 'Actions')
    )));
    const tbody = el('tbody');
    data.keys.forEach(k => {
      tbody.appendChild(el('tr', {},
        el('td', { style: 'font-family:monospace;font-size:12px' }, k.name),
        el('td', {}, k.value),
        el('td', {}, k.providerId || '-'),
        el('td', {}, k.usedBy.length > 0 ? k.usedBy.join(', ') : el('span', { className: 'badge badge-gray' }, 'Unused')),
        el('td', {},
          el('button', { className: 'btn btn-sm btn-secondary', onClick: () => showKeyModal(k) }, 'Edit'),
          el('button', { className: 'btn btn-sm btn-danger', style: 'margin-left:4px', onClick: () => deleteKey(k.name) }, 'Delete')
        )
      ));
    });
    table.appendChild(tbody);
    wrapper.appendChild(table);
    content.appendChild(wrapper);
  } catch (e) {
    content.innerHTML = `<div class="empty-state"><div class="icon">⚠️</div><p>${e.message}</p></div>`;
  }
}

function showKeyModal(key) {
  const isEdit = !!key;
  const html = `
    <div class="form-group"><label class="form-label">Key Name</label>
      <input class="form-input" id="key-name" value="${key ? key.name : ''}" ${isEdit ? 'disabled' : ''} placeholder="CCKEY_PROVIDER_PROFILE_ABCD1234"></div>
    <div class="form-group"><label class="form-label">Value</label>
      <input class="form-input" id="key-value" type="password" placeholder="Enter API key value"></div>
  `;
  showModal(isEdit ? 'Edit Key' : 'Add Key', html, async () => {
    const name = document.getElementById('key-name').value.trim();
    const value = document.getElementById('key-value').value.trim();
    if (!name || !value) throw new Error('Name and value required');
    if (isEdit) await api('PUT', `/api/keys/${key.name}`, { value });
    else await api('POST', '/api/keys', { name, value });
  });
}

async function deleteKey(name) {
  if (!confirm(`Delete key "${name}"?`)) return;
  try { await api('DELETE', `/api/keys/${name}`); toast('Deleted', 'success'); loadSection(); }
  catch (e) { toast(e.message, 'error'); }
}

/* ── 4. Provider Registry ─────────────────────────────────────────── */
async function renderProviders() {
  const content = document.getElementById('page-content');
  content.innerHTML = '<p>Loading...</p>';

  try {
    const data = await api('GET', '/api/providers');
    content.innerHTML = '';

    const grid = el('div', { className: 'provider-grid' });
    data.providers.forEach(p => {
      const card = el('div', { className: 'provider-card' },
        el('h3', {}, p.name),
        el('div', { className: 'provider-meta' },
          el('span', {}, `ID: ${p.id}`),
          el('span', {}, `Mode: ${p.mode}`),
          el('span', {}, `Auth: ${p.authMode}`),
          el('span', {}, `Key: ${p.keyName}`),
          p.proxyPort ? el('span', {}, `Port: ${p.proxyPort}`) : null,
          el('span', {}, `Models: ${(p.defaultModels || []).length} defaults`)
        )
      );
      grid.appendChild(card);
    });
    content.appendChild(grid);
  } catch (e) {
    content.innerHTML = `<div class="empty-state"><div class="icon">⚠️</div><p>${e.message}</p></div>`;
  }
}

/* ── 5. Proxy Health ──────────────────────────────────────────────── */
async function renderHealth() {
  const content = document.getElementById('page-content');
  content.innerHTML = '<p>Running health checks...</p>';

  try {
    const data = await api('GET', '/api/health');
    content.innerHTML = '';

    const actions = document.getElementById('header-actions');
    actions.innerHTML = '';
    actions.appendChild(el('button', { className: 'btn btn-secondary', onClick: renderHealth }, '↻ Refresh'));

    const wrapper = el('div', { className: 'card' });
    const list = el('ul', { className: 'check-list' });
    data.checks.forEach(c => {
      const icon = c.status === 'ok' || c.status === 'running' ? '✅' : c.status === 'warning' ? '⚠️' : c.status === 'error' ? '❌' : 'ℹ️';
      list.appendChild(el('li', { className: 'check-item' },
        el('span', { className: 'check-icon' }, icon),
        el('span', { className: 'check-name' }, c.name),
        el('span', { className: 'check-detail' }, c.detail)
      ));
    });
    wrapper.appendChild(list);
    content.appendChild(wrapper);
  } catch (e) {
    content.innerHTML = `<div class="empty-state"><div class="icon">⚠️</div><p>${e.message}</p></div>`;
  }
}

/* ── 6. Model Management ──────────────────────────────────────────── */
async function renderModels() {
  const content = document.getElementById('page-content');
  content.innerHTML = '<p>Loading...</p>';

  try {
    const provData = await api('GET', '/api/providers');
    content.innerHTML = '';

    // Provider selector
    const selectRow = el('div', { style: 'display:flex;gap:12px;align-items:center;margin-bottom:16px;flex-wrap:wrap' });
    const select = el('select', { className: 'form-select', id: 'model-provider', style: 'max-width:300px' });
    provData.providers.forEach(p => {
      const hasDynamic = p.modelSource === 'dynamic';
      select.appendChild(el('option', { value: p.id }, `${p.name}${hasDynamic ? ' ⚡' : ''} (${p.defaultModels.length})`));
    });
    select.addEventListener('change', () => loadProviderModels(select.value));
    selectRow.appendChild(select);

    // Search filter
    const searchInput = el('input', { className: 'form-input', id: 'model-search', placeholder: 'Filter models...', style: 'max-width:250px' });
    searchInput.addEventListener('input', () => filterModels(searchInput.value));
    selectRow.appendChild(searchInput);

    // Refresh button
    const refreshBtn = el('button', { className: 'btn btn-primary', id: 'model-refresh-btn', onClick: () => refreshProviderModels(select.value) }, '⚡ Fetch Live Models');
    selectRow.appendChild(refreshBtn);

    content.appendChild(selectRow);

    const modelsDiv = el('div', { id: 'models-list' });
    content.appendChild(modelsDiv);

    if (provData.providers.length > 0) loadProviderModels(provData.providers[0].id);
  } catch (e) {
    content.innerHTML = `<div class="empty-state"><div class="icon">⚠️</div><p>${e.message}</p></div>`;
  }
}

let currentModels = [];

async function loadProviderModels(providerId) {
  const div = document.getElementById('models-list');
  div.innerHTML = '<p>Loading models...</p>';
  try {
    const data = await api('GET', `/api/models/${providerId}`);
    currentModels = data.models || [];
    renderModelList(data);
  } catch (e) {
    div.innerHTML = `<p style="color:var(--danger)">${e.message}</p>`;
  }
}

function renderModelList(data) {
  const div = document.getElementById('models-list');
  div.innerHTML = '';
  const card = el('div', { className: 'card' },
    el('div', { className: 'card-header' },
      el('div', { className: 'card-title' }, `${data.provider} Models`),
      el('div', { style: 'display:flex;gap:8px;align-items:center' },
        el('span', { className: `badge ${data.modelSource === 'dynamic' ? 'badge-success' : 'badge-gray'}` }, data.modelSource === 'dynamic' ? 'Live' : 'Static'),
        el('span', { className: 'badge badge-info' }, `${data.models.length} models`)
      )
    )
  );
  if (data.models.length === 0) {
    card.appendChild(el('p', { style: 'color:var(--text-secondary)' }, 'No models available. Try fetching live models.'));
  } else {
    const list = el('div', { className: 'model-grid', id: 'model-tags', style: 'display:flex;flex-wrap:wrap;gap:8px' });
    data.models.forEach(m => {
      const tag = el('span', { className: 'badge badge-info', style: 'cursor:pointer;font-family:monospace;font-size:12px', title: 'Click to copy' }, m);
      tag.addEventListener('click', () => { navigator.clipboard.writeText(m); toast('Copied!', 'info'); });
      list.appendChild(tag);
    });
    card.appendChild(list);
  }
  div.appendChild(card);
}

function filterModels(query) {
  const tags = document.getElementById('model-tags');
  if (!tags) return;
  const q = query.toLowerCase();
  tags.querySelectorAll('.badge').forEach(tag => {
    tag.style.display = tag.textContent.toLowerCase().includes(q) ? '' : 'none';
  });
}

async function refreshProviderModels(providerId) {
  const btn = document.getElementById('model-refresh-btn');
  if (btn) { btn.textContent = '⏳ Fetching...'; btn.disabled = true; }
  try {
    const data = await api('GET', `/api/models/${providerId}?refresh=true`);
    currentModels = data.models || [];
    renderModelList(data);
    toast(`Loaded ${data.models.length} models`, 'success');
  } catch (e) {
    toast(e.message, 'error');
  } finally {
    if (btn) { btn.textContent = '⚡ Fetch Live Models'; btn.disabled = false; }
  }
}

/* ── 7. Doctor ────────────────────────────────────────────────────── */
async function renderDoctor() {
  const content = document.getElementById('page-content');
  content.innerHTML = '<p>Running doctor checks...</p>';

  try {
    const data = await api('GET', '/api/doctor');
    content.innerHTML = '';

    const actions = document.getElementById('header-actions');
    actions.innerHTML = '';
    actions.appendChild(el('button', { className: 'btn btn-secondary', onClick: renderDoctor }, '↻ Run Again'));

    const wrapper = el('div', { className: 'card' });
    const list = el('ul', { className: 'check-list' });
    data.checks.forEach(c => {
      const icon = c.status === 'ok' ? '✅' : c.status === 'warning' ? '⚠️' : '❌';
      list.appendChild(el('li', { className: 'check-item' },
        el('span', { className: 'check-icon' }, icon),
        el('span', { className: 'check-name' }, c.name),
        el('span', { className: 'check-detail' }, c.detail)
      ));
    });
    wrapper.appendChild(list);
    content.appendChild(wrapper);
  } catch (e) {
    content.innerHTML = `<div class="empty-state"><div class="icon">⚠️</div><p>${e.message}</p></div>`;
  }
}

/* ── 8. Settings ──────────────────────────────────────────────────── */
async function renderSettings() {
  const content = document.getElementById('page-content');
  content.innerHTML = '<p>Loading...</p>';

  try {
    const themeData = await api('GET', '/api/theme');
    content.innerHTML = '';

    // Theme section
    const themeCard = el('div', { className: 'card', style: 'margin-bottom:16px' },
      el('div', { className: 'card-title', style: 'margin-bottom:12px' }, 'Theme'),
      el('div', { className: 'form-row' },
        el('div', { className: 'form-group' },
          el('label', { className: 'form-label' }, 'Current Theme'),
          (() => {
            const sel = el('select', { className: 'form-select', id: 'theme-select' });
            ['light', 'dark', 'system', 'default'].forEach(t => {
              const opt = el('option', { value: t }, t);
              if (themeData.theme === t) opt.selected = true;
              sel.appendChild(opt);
            });
            sel.addEventListener('change', async () => {
              try { await api('PUT', '/api/theme', { theme: sel.value }); toast('Theme updated', 'success'); }
              catch (e) { toast(e.message, 'error'); }
            });
            return sel;
          })()
        )
      )
    );
    content.appendChild(themeCard);

    // Settings repair
    const repairCard = el('div', { className: 'card' },
      el('div', { className: 'card-title', style: 'margin-bottom:12px' }, 'Settings Repair'),
      el('p', { style: 'font-size:13px;color:var(--text-secondary);margin-bottom:12px' },
        'Remove cc-manager-managed auth/model overrides from ~/.claude/settings.json'
      ),
      el('button', { className: 'btn btn-secondary', onClick: async () => {
        try {
          const result = await api('POST', '/api/settings/repair');
          toast(result.message, result.changed ? 'success' : 'info');
        } catch (e) { toast(e.message, 'error'); }
      } }, 'Repair settings.json')
    );
    content.appendChild(repairCard);

    // Data paths
    const pathsCard = el('div', { className: 'card', style: 'margin-top:16px' },
      el('div', { className: 'card-title', style: 'margin-bottom:8px' }, 'Data Paths'),
      el('p', { style: 'font-size:12px;font-family:monospace;color:var(--text-secondary)' },
        `Config: ${themeData.configPath}`
      )
    );
    content.appendChild(pathsCard);
  } catch (e) {
    content.innerHTML = `<div class="empty-state"><div class="icon">⚠️</div><p>${e.message}</p></div>`;
  }
}

/* ── Analytics & Usage ────────────────────────────────────────────── */
async function renderAnalytics() {
  const content = document.getElementById('page-content');
  content.innerHTML = '<p>Loading analytics...</p>';

  try {
    const data = await api('GET', '/api/analytics/overview');
    content.innerHTML = '';

    const actions = document.getElementById('header-actions');
    actions.innerHTML = '';
    actions.appendChild(el('button', { className: 'btn btn-secondary', onClick: renderAnalytics }, '↻ Refresh'));

    // Summary stats
    const grid = el('div', { className: 'stat-grid' });
    const stats = [
      { value: data.profiles, label: 'Profiles', color: 'var(--accent)' },
      { value: data.keys, label: 'API Keys', color: 'var(--success)' },
      { value: data.providers, label: 'Active Providers', color: 'var(--info)' },
      { value: Object.values(data.portStatus).filter(Boolean).length, label: 'Proxies Running', color: 'var(--warning)' }
    ];
    stats.forEach(s => {
      grid.appendChild(el('div', { className: 'stat-card' },
        el('div', { className: 'stat-value', style: `color:${s.color}` }, String(s.value)),
        el('div', { className: 'stat-label' }, s.label)
      ));
    });
    content.appendChild(grid);

    // Provider Usage Section
    const usageCard = el('div', { className: 'card', style: 'margin-bottom:16px' });
    usageCard.appendChild(el('div', { className: 'card-header' },
      el('div', { className: 'card-title' }, 'Provider Usage & Limits')
    ));

    const usageKeys = Object.keys(data.usage);
    if (usageKeys.length === 0) {
      usageCard.appendChild(el('p', { style: 'color:var(--text-secondary);font-size:13px' },
        'No providers with API keys configured. Add API keys to see usage data.'
      ));
    } else {
      const usageTable = el('div', { className: 'table-wrapper' });
      const table = el('table');
      table.appendChild(el('thead', {}, el('tr', {},
        el('th', {}, 'Provider'), el('th', {}, 'Status'), el('th', {}, 'Details')
      )));
      const tbody = el('tbody');
      for (const [pid, usage] of Object.entries(data.usage)) {
        const statusBadge = usage.available
          ? el('span', { className: 'badge badge-success' }, 'API Available')
          : el('span', { className: 'badge badge-gray' }, 'No API');
        let details;
        if (usage.available) {
          if (pid === 'deepseek' && usage.balances) {
            details = usage.balances.map(b =>
              el('span', { style: 'display:block;font-size:12px' },
                `${b.currency}: Total ${b.total} | Granted ${b.granted} | Topped Up ${b.toppedUp}`
              )
            );
          } else if (pid === 'openrouter') {
            details = [
              el('span', { style: 'display:block;font-size:12px' },
                `Credits: $${usage.totalCredits?.toFixed(2) || 0} total, $${usage.remaining?.toFixed(2) || 0} remaining`
              ),
              el('span', { style: 'display:block;font-size:12px;color:var(--text-secondary)' },
                `Usage: $${usage.totalUsage?.toFixed(2) || 0}`
              )
            ];
            if (usage.dailyUsage && usage.dailyUsage.length > 0) {
              details.push(el('span', { style: 'display:block;font-size:11px;color:var(--text-secondary);margin-top:4px' },
                `${usage.dailyUsage.length} days of activity data`
              ));
            }
          } else {
            details = [el('span', { style: 'font-size:12px' }, JSON.stringify(usage).slice(0, 200))];
          }
        } else {
          details = [
            el('span', { style: 'font-size:12px;color:var(--text-secondary)' }, usage.error || 'Unknown'),
            usage.hint ? el('span', { style: 'display:block;font-size:11px;color:var(--accent);margin-top:2px' }, usage.hint) : null,
            usage.needsManagementKey ? el('span', { style: 'display:block;font-size:11px;color:var(--warning);margin-top:2px' },
              '💡 Requires Management API key for full usage data') : null,
            usage.needsAdminKey ? el('span', { style: 'display:block;font-size:11px;color:var(--warning);margin-top:2px' },
              '💡 Requires Admin API key for full usage data') : null
          ].filter(Boolean);
        }
        tbody.appendChild(el('tr', {},
          el('td', { style: 'font-weight:600' }, pid),
          el('td', {}, statusBadge),
          el('td', {}, ...details)
        ));
      }
      table.appendChild(tbody);
      usageTable.appendChild(table);
      usageCard.appendChild(usageTable);
    }
    content.appendChild(usageCard);

    // Local Proxy Metrics Section
    const metricsCard = el('div', { className: 'card' });
    metricsCard.appendChild(el('div', { className: 'card-header' },
      el('div', { className: 'card-title' }, 'Local Proxy Metrics')
    ));
    const metricsKeys = Object.keys(data.metrics);
    if (metricsKeys.length === 0) {
      metricsCard.appendChild(el('p', { style: 'color:var(--text-secondary);font-size:13px' },
        'No proxy requests recorded yet. Metrics are collected when you use profiles through the dashboard proxy.'
      ));
    } else {
      const mTable = el('div', { className: 'table-wrapper' });
      const table = el('table');
      table.appendChild(el('thead', {}, el('tr', {},
        el('th', {}, 'Port'), el('th', {}, 'Requests'), el('th', {}, 'Errors'),
        el('th', {}, 'Avg Latency'), el('th', {}, 'Error Rate'), el('th', {}, 'Top Models')
      )));
      const tbody = el('tbody');
      for (const [port, m] of Object.entries(data.metrics)) {
        const topModels = (m.topModels || []).map(([name, count]) => `${name} (${count})`).join(', ') || '-';
        tbody.appendChild(el('tr', {},
          el('td', {}, port),
          el('td', {}, String(m.requests)),
          el('td', {}, String(m.errors)),
          el('td', {}, `${m.avgLatency}ms`),
          el('td', {}, m.errorRate),
          el('td', { style: 'font-size:11px;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap' }, topModels)
        ));
      }
      table.appendChild(tbody);
      mTable.appendChild(table);
      metricsCard.appendChild(mTable);
    }
    content.appendChild(metricsCard);

  } catch (e) {
    content.innerHTML = `<div class="empty-state"><div class="icon">⚠️</div><p>${e.message}</p></div>`;
  }
}
