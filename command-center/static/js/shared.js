// ── Shared utilities ──────────────────────────────────────────────────────────

const BASE = '';

// ── Workspace state ───────────────────────────────────────────────────────────
const WS = {
  get id()   { const v = localStorage.getItem('workspace_id'); return v === 'null' || v === null ? null : Number(v); },
  set id(v)  { localStorage.setItem('workspace_id', v === null ? 'null' : String(v)); },
  get name() { return localStorage.getItem('workspace_name') || 'Padrão (env)'; },
  set name(v){ localStorage.setItem('workspace_name', v); },
  param()    { return this.id ? `?workspace_id=${this.id}` : ''; },
  addParam(url) {
    if (!this.id) return url;
    return url + (url.includes('?') ? '&' : '?') + `workspace_id=${this.id}`;
  },
};

// ── Fetch wrapper ─────────────────────────────────────────────────────────────
async function apiFetch(path, options = {}) {
  const finalPath = WS.addParam(path);
  const res = await fetch(BASE + finalPath, {
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
    { href: '/',               icon: '🏠', label: 'Dashboard' },
    { href: '/chat.html',      icon: '💬', label: 'Chat' },
    { href: '/agents.html',    icon: '🤖', label: 'Agentes' },
    { href: '/channels.html',  icon: '📡', label: 'Canais' },
    { href: '/skills.html',    icon: '🛠️', label: 'Skills' },
    { href: '/history.html',   icon: '📜', label: 'Histórico' },
    { href: '/cron.html',      icon: '⏰', label: 'Agendador' },
    { href: '/costs.html',     icon: '📊', label: 'Custos' },
    { href: '/settings.html',  icon: '⚙️', label: 'Configurações' },
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

  _initWorkspaceSelector();
}

// ── Workspace selector in sidebar ─────────────────────────────────────────────
async function _initWorkspaceSelector() {
  const el = document.getElementById('workspace-selector');
  if (!el) return;
  try {
    const workspaces = await fetch('/api/workspaces').then(r => r.json());
    el.innerHTML = workspaces.map(w =>
      `<option value="${w.id ?? 'null'}" ${(w.id === WS.id || (w.id === null && WS.id === null)) ? 'selected' : ''}>${w.name}</option>`
    ).join('');
    el.addEventListener('change', () => {
      const val = el.value;
      const opt = el.options[el.selectedIndex];
      WS.id   = val === 'null' ? null : Number(val);
      WS.name = opt.text;
      location.reload();
    });
  } catch {}
}

// ── Alert bell ────────────────────────────────────────────────────────────────
async function updateAlertBell() {
  const bell = document.getElementById('alert-bell-badge');
  if (!bell) return;
  try {
    const events = await fetch('/api/alerts/events').then(r => r.json());
    const unread = events.filter(e => !e.acknowledged).length;
    bell.textContent = unread || '';
    bell.style.display = unread ? 'flex' : 'none';

    const dropdown = document.getElementById('alert-dropdown');
    if (dropdown) {
      dropdown.innerHTML = unread === 0
        ? '<div style="padding:14px;color:var(--muted);text-align:center;font-size:13px">Nenhum alerta</div>'
        : events.filter(e => !e.acknowledged).slice(0, 8).map(e => `
            <div class="alert-item" style="padding:10px 14px;border-bottom:1px solid var(--border);font-size:12px">
              <div style="font-weight:600;margin-bottom:3px">${_alertTypeLabel(e.rule_type)}</div>
              <div style="color:var(--muted)">${relativeTime(e.triggered_at)}</div>
              <button class="btn btn-ghost btn-sm" style="margin-top:6px;font-size:11px" onclick="ackAlert(${e.id})">Reconhecer</button>
            </div>`).join('');
    }
  } catch {}
}

function _alertTypeLabel(type) {
  return { cost_daily: '⚠️ Custo diário excedido', cost_monthly: '⚠️ Custo mensal excedido',
           agent_offline: '🔴 Agente offline', error_repeated: '❌ Erros repetidos' }[type] || type;
}

async function ackAlert(id) {
  await fetch(`/api/alerts/events/${id}/acknowledge`, { method: 'POST' });
  updateAlertBell();
}

function toggleAlertDropdown() {
  const d = document.getElementById('alert-dropdown');
  if (d) d.style.display = d.style.display === 'none' ? 'block' : 'none';
}

// ── Gateway banner ────────────────────────────────────────────────────────────
async function checkGatewayBanner() {
  try {
    const data = await fetch(WS.addParam('/api/openclaw/status')).then(r => r.json());
    const banner  = document.getElementById('gateway-banner');
    const dot     = document.getElementById('sidebar-status-dot');
    const dotText = document.getElementById('sidebar-status-text');
    const nav     = document.getElementById('sidebar-nav');
    const online  = data.online;

    if (!online) {
      if (banner) banner.classList.add('visible');
      if (dot)    dot.className = 'status-dot offline';
      if (dotText) dotText.textContent = 'Gateway offline';
      if (nav) {
        nav.querySelectorAll('.nav-item').forEach(el => {
          const href = el.getAttribute('href') || '';
          if (!href.includes('settings') && !href.includes('workspaces')) {
            el.style.opacity = '0.4';
            el.style.pointerEvents = 'none';
          }
        });
      }
    } else {
      if (banner) banner.classList.remove('visible');
      if (dot)    dot.className = 'status-dot online';
      if (dotText) dotText.textContent = 'Gateway online';
      if (nav) nav.querySelectorAll('.nav-item').forEach(el => {
        el.style.opacity = '';
        el.style.pointerEvents = '';
      });
    }
    return online;
  } catch {
    const banner = document.getElementById('gateway-banner');
    if (banner) banner.classList.add('visible');
    return false;
  }
}

// ── Time helpers ──────────────────────────────────────────────────────────────
function relativeTime(isoString) {
  if (!isoString) return '—';
  const diff = (Date.now() - new Date(isoString + (isoString.endsWith('Z') ? '' : 'Z')).getTime()) / 1000;
  if (diff < 60)    return `há ${Math.round(diff)}s`;
  if (diff < 3600)  return `há ${Math.round(diff / 60)}min`;
  if (diff < 86400) return `há ${Math.round(diff / 3600)}h`;
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
  const input   = document.getElementById(inputId);
  const addBtn  = document.getElementById(addBtnId);
  if (!wrapper || !input) return;
  const values = [];

  function render() {
    wrapper.innerHTML = '';
    values.forEach((v, i) => {
      const chip = document.createElement('span');
      chip.className = 'chip';
      chip.innerHTML = `${v} <span class="chip-remove" data-i="${i}">×</span>`;
      chip.querySelector('.chip-remove').addEventListener('click', () => {
        values.splice(i, 1); render(); onChange && onChange(values);
      });
      wrapper.appendChild(chip);
    });
  }

  const add = () => {
    const v = input.value.trim();
    if (v && !values.includes(v)) { values.push(v); render(); onChange && onChange(values); }
    input.value = '';
  };

  if (addBtn) addBtn.addEventListener('click', add);
  input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); add(); } });

  return {
    getValues: () => [...values],
    setValues: (arr) => { values.length = 0; values.push(...arr); render(); },
  };
}

// ── Masked input reveal ───────────────────────────────────────────────────────
function initReveal(inputId, btnId) {
  const inp = document.getElementById(inputId);
  const btn = document.getElementById(btnId);
  if (!inp || !btn) return;
  btn.addEventListener('click', () => {
    inp.type = inp.type === 'password' ? 'text' : 'password';
    btn.textContent = inp.type === 'password' ? '👁️' : '🙈';
  });
}

// ── Modal helpers ─────────────────────────────────────────────────────────────
function openModal(id)  { const el = document.getElementById(id); if (el) el.classList.add('open'); }
function closeModal(id) { const el = document.getElementById(id); if (el) el.classList.remove('open'); }

document.addEventListener('click', e => {
  if (e.target.classList.contains('modal-overlay'))  e.target.classList.remove('open');
  if (e.target.classList.contains('modal-close') || e.target.dataset.closeModal) {
    const m = e.target.closest('.modal-overlay');
    if (m) m.classList.remove('open');
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

// ── Init ──────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  initSidebar();
  checkGatewayBanner();
  updateAlertBell();
  setInterval(checkGatewayBanner, 30000);
  setInterval(updateAlertBell, 15000);

  document.getElementById('alert-bell')?.addEventListener('click', toggleAlertDropdown);
  document.addEventListener('click', e => {
    const bell = document.getElementById('alert-bell');
    const dd   = document.getElementById('alert-dropdown');
    if (dd && bell && !bell.contains(e.target) && !dd.contains(e.target)) {
      dd.style.display = 'none';
    }
  });
});
