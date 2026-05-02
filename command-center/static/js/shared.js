// ── Shared utilities ──────────────────────────────────────────────────────────

const BASE = '';

// ── Fetch wrapper ─────────────────────────────────────────────────────────────
async function apiFetch(path, options = {}) {
  const res = await fetch(BASE + path, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options,
    body: options.body ? (typeof options.body === 'string' ? options.body : JSON.stringify(options.body)) : undefined,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HTTP ${res.status}: ${text}`);
  }
  return res.json();
}

// ── Toast notifications ───────────────────────────────────────────────────────
(function initToasts() {
  const container = document.createElement('div');
  container.className = 'toast-container';
  container.id = 'toast-container';
  document.body.appendChild(container);
})();

function showToast(message, type = 'success', duration = 3500) {
  const container = document.getElementById('toast-container');
  const icons = { success: '✅', error: '❌', warning: '⚠️', info: 'ℹ️' };
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `<span>${icons[type] || 'ℹ️'}</span><span>${message}</span>`;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transition = 'opacity 0.3s';
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

// ── Sidebar ───────────────────────────────────────────────────────────────────
function initSidebar() {
  const pages = [
    { href: '/',              icon: '🏠', label: 'Dashboard' },
    { href: '/agents.html',   icon: '🤖', label: 'Agentes' },
    { href: '/channels.html', icon: '📡', label: 'Canais' },
    { href: '/skills.html',   icon: '🛠️', label: 'Skills' },
    { href: '/costs.html',    icon: '📊', label: 'Custos' },
    { href: '/settings.html', icon: '⚙️', label: 'Configurações' },
  ];

  const nav = document.getElementById('sidebar-nav');
  if (!nav) return;

  const current = location.pathname;

  pages.forEach(p => {
    const el = document.createElement('a');
    el.href = p.href;
    el.className = 'nav-item' + (current === p.href || (p.href !== '/' && current.endsWith(p.href)) ? ' active' : '');
    el.innerHTML = `<span class="nav-icon">${p.icon}</span><span>${p.label}</span>`;
    nav.appendChild(el);
  });
}

// ── Gateway banner ────────────────────────────────────────────────────────────
async function checkGatewayBanner() {
  try {
    const data = await apiFetch('/api/openclaw/status');
    const banner = document.getElementById('gateway-banner');
    const dot = document.getElementById('sidebar-status-dot');
    const dotText = document.getElementById('sidebar-status-text');
    if (!data.online) {
      if (banner) { banner.classList.add('visible'); }
      if (dot) { dot.className = 'status-dot offline'; }
      if (dotText) { dotText.textContent = 'Gateway offline'; }
    } else {
      if (banner) { banner.classList.remove('visible'); }
      if (dot) { dot.className = 'status-dot online'; }
      if (dotText) { dotText.textContent = 'Gateway online'; }
    }
    return data.online;
  } catch {
    const banner = document.getElementById('gateway-banner');
    if (banner) banner.classList.add('visible');
    return false;
  }
}

// ── Time helpers ──────────────────────────────────────────────────────────────
function relativeTime(isoString) {
  if (!isoString) return '—';
  const diff = (Date.now() - new Date(isoString + 'Z').getTime()) / 1000;
  if (diff < 60)      return `há ${Math.round(diff)}s`;
  if (diff < 3600)    return `há ${Math.round(diff / 60)}min`;
  if (diff < 86400)   return `há ${Math.round(diff / 3600)}h`;
  return `há ${Math.round(diff / 86400)}d`;
}

function fmtDate(isoString) {
  if (!isoString) return '—';
  return new Date(isoString).toLocaleString('pt-BR');
}

function fmtBRL(value) {
  if (value === undefined || value === null) return '—';
  return `R$ ${Number(value).toFixed(4)}`;
}

// ── Chips helper ──────────────────────────────────────────────────────────────
function initChips(wrapperId, inputId, addBtnId, onChange) {
  const wrapper = document.getElementById(wrapperId);
  const input = document.getElementById(inputId);
  const addBtn = document.getElementById(addBtnId);
  if (!wrapper || !input) return;

  function render(values) {
    wrapper.innerHTML = '';
    values.forEach((v, i) => {
      const chip = document.createElement('span');
      chip.className = 'chip';
      chip.innerHTML = `${v} <span class="chip-remove" data-i="${i}">×</span>`;
      chip.querySelector('.chip-remove').addEventListener('click', () => {
        values.splice(i, 1);
        render(values);
        onChange && onChange(values);
      });
      wrapper.appendChild(chip);
    });
  }

  const values = [];
  const add = () => {
    const v = input.value.trim();
    if (v && !values.includes(v)) { values.push(v); render(values); onChange && onChange(values); }
    input.value = '';
  };

  if (addBtn) addBtn.addEventListener('click', add);
  input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); add(); } });

  return {
    getValues: () => [...values],
    setValues: (arr) => { values.length = 0; values.push(...arr); render(values); },
  };
}

// ── Masked input reveal ───────────────────────────────────────────────────────
function initReveal(inputId, btnId) {
  const inp = document.getElementById(inputId);
  const btn = document.getElementById(btnId);
  if (!inp || !btn) return;
  btn.addEventListener('click', () => {
    if (inp.type === 'password') { inp.type = 'text'; btn.textContent = '🙈'; }
    else { inp.type = 'password'; btn.textContent = '👁️'; }
  });
}

// ── Modal helpers ─────────────────────────────────────────────────────────────
function openModal(id) {
  const el = document.getElementById(id);
  if (el) el.classList.add('open');
}
function closeModal(id) {
  const el = document.getElementById(id);
  if (el) el.classList.remove('open');
}

document.addEventListener('click', e => {
  if (e.target.classList.contains('modal-overlay')) {
    e.target.classList.remove('open');
  }
  if (e.target.classList.contains('modal-close') || e.target.dataset.closeModal) {
    const modal = e.target.closest('.modal-overlay');
    if (modal) modal.classList.remove('open');
  }
});

// ── Page Visibility polling ───────────────────────────────────────────────────
function visiblePolling(fn, interval) {
  let timer = null;
  const start = () => { if (!timer) { fn(); timer = setInterval(fn, interval); } };
  const stop  = () => { clearInterval(timer); timer = null; };
  document.addEventListener('visibilitychange', () => document.hidden ? stop() : start());
  start();
  return { start, stop };
}

// ── Init on load ──────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  initSidebar();
  checkGatewayBanner();
  setInterval(checkGatewayBanner, 30000);
});
