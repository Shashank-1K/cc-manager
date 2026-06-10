'use strict';

/* ── Global State ─────────────────────────────────────────────────── */
let currentSection = 'overview';
let refreshInterval = null;

/* ── Fetch Helper ─────────────────────────────────────────────────── */
async function api(method, path, body) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(path, opts);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

/* ── Toast Notifications ──────────────────────────────────────────── */
function toast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.textContent = message;
  container.appendChild(el);
  setTimeout(() => { el.remove(); }, 3000);
}

/* ── Modal ────────────────────────────────────────────────────────── */
function showModal(title, bodyHtml, onSave) {
  const overlay = document.getElementById('modal-overlay');
  document.getElementById('modal-title').textContent = title;
  document.getElementById('modal-body').innerHTML = bodyHtml;
  overlay.classList.remove('hidden');

  const saveBtn = document.getElementById('modal-save');
  const newSave = saveBtn.cloneNode(true);
  saveBtn.parentNode.replaceChild(newSave, saveBtn);
  newSave.addEventListener('click', async () => {
    try { await onSave(); hideModal(); toast('Saved', 'success'); loadSection(); }
    catch (e) { toast(e.message, 'error'); }
  });
}

function hideModal() {
  document.getElementById('modal-overlay').classList.add('hidden');
}

/* ── Router ───────────────────────────────────────────────────────── */
function loadSection() {
  const hash = location.hash.slice(1) || 'overview';
  currentSection = hash;

  // Clear refresh interval
  if (refreshInterval) { clearInterval(refreshInterval); refreshInterval = null; }

  // Update sidebar
  document.querySelectorAll('.nav-link').forEach(link => {
    link.classList.toggle('active', link.dataset.section === hash);
  });

  // Update header
  const titles = {
    overview: 'Dashboard', profiles: 'Profile Management', keys: 'API Key Management',
    providers: 'Provider Registry', health: 'Proxy Health', analytics: 'Analytics & Usage',
    models: 'Model Management', doctor: 'Doctor', settings: 'Settings'
  };
  document.getElementById('page-title').textContent = titles[hash] || 'Dashboard';
  document.getElementById('header-actions').innerHTML = '';

  // Render page
  const renderers = { overview: renderOverview, profiles: renderProfiles, keys: renderKeys,
    providers: renderProviders, health: renderHealth, analytics: renderAnalytics,
    models: renderModels, doctor: renderDoctor, settings: renderSettings };
  const renderer = renderers[hash];
  if (renderer) renderer();
}

/* ── Theme Toggle ─────────────────────────────────────────────────── */
function initTheme() {
  const saved = localStorage.getItem('theme') || 'light';
  document.documentElement.dataset.theme = saved;
  updateThemeButton(saved);
}

function toggleTheme() {
  const current = document.documentElement.dataset.theme;
  const next = current === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  localStorage.setItem('theme', next);
  updateThemeButton(next);
}

function updateThemeButton(theme) {
  const btn = document.getElementById('theme-toggle');
  if (btn) btn.textContent = theme === 'dark' ? '☀️' : '🌙';
}

/* ── Init ─────────────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  initTheme();
  window.addEventListener('hashchange', loadSection);
  document.getElementById('theme-toggle').addEventListener('click', toggleTheme);
  document.getElementById('modal-close').addEventListener('click', hideModal);
  document.getElementById('modal-cancel').addEventListener('click', hideModal);
  document.getElementById('modal-overlay').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) hideModal();
  });
  loadSection();
});
