// ── History ───────────────────────────────────────────────────────────────────

let currentPage = 1;
const PER_PAGE = 20;
let expandedRow = null;

function getFilters() {
  return {
    q:         document.getElementById('f-q')?.value.trim() || '',
    agent_id:  document.getElementById('f-agent')?.value.trim() || '',
    model:     document.getElementById('f-model')?.value || '',
    date_from: document.getElementById('f-from')?.value || '',
    date_to:   document.getElementById('f-to')?.value || '',
  };
}

function buildQuery(extra = {}) {
  const f = { ...getFilters(), page: currentPage, per_page: PER_PAGE, ...extra };
  return Object.entries(f).filter(([, v]) => v !== '' && v !== null && v !== undefined)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
}

async function loadHistory() {
  const tbody = document.getElementById('history-table-body');
  if (tbody) tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:24px"><div class="spinner" style="margin:auto"></div></td></tr>';

  try {
    const data = await apiFetch(`/api/history?${buildQuery()}`);
    const kpis = data.kpis || {};

    const setText = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    setText('kpi-sessions', kpis.total_sessions ?? '—');
    setText('kpi-msgs',     kpis.total_messages ?? '—');
    setText('kpi-cost',     fmtBRL(kpis.total_cost_brl));
    setText('kpi-model',    kpis.top_model || '—');

    const countEl = document.getElementById('history-count');
    if (countEl) countEl.textContent = `${data.total} sessão(ões) encontrada(s) · Página ${data.page}`;

    const prevBtn = document.getElementById('btn-prev');
    const nextBtn = document.getElementById('btn-next');
    if (prevBtn) prevBtn.disabled = currentPage <= 1;
    if (nextBtn) nextBtn.disabled = (currentPage * PER_PAGE) >= data.total;

    if (!data.items.length) {
      tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;color:var(--muted);padding:32px">Nenhum resultado encontrado</td></tr>';
      return;
    }

    tbody.innerHTML = data.items.map(item => {
      const dur = item.duration_sec ? `${Math.round(item.duration_sec / 60)}min` : '—';
      const totalTok = (item.input_tokens || 0) + (item.output_tokens || 0);
      return `
        <tr class="history-row" data-id="${item.id}" onclick="toggleExpand(this, ${item.id})" style="cursor:pointer">
          <td>${fmtDate(item.started_at)}</td>
          <td>${item.agent_id || '—'}</td>
          <td><span class="badge badge-muted">${item.channel || 'chat'}</span></td>
          <td><span class="badge badge-primary" style="font-size:10px">${item.model || '—'}</span></td>
          <td style="text-align:right">${item.message_count}</td>
          <td style="text-align:right">${totalTok.toLocaleString('pt-BR')}</td>
          <td style="text-align:right;color:var(--alert)">${fmtBRL(item.cost_brl)}</td>
          <td style="text-align:right">${dur}</td>
        </tr>
        <tr class="expand-row" id="expand-${item.id}" style="display:none">
          <td colspan="8" style="padding:0;background:var(--bg)">
            <div id="expand-content-${item.id}" style="padding:14px 20px"></div>
          </td>
        </tr>`;
    }).join('');
  } catch (e) {
    if (tbody) tbody.innerHTML = `<tr><td colspan="8" style="color:var(--danger);padding:14px">Erro: ${e.message}</td></tr>`;
  }
}

async function toggleExpand(rowEl, sessionId) {
  const expandRow = document.getElementById(`expand-${sessionId}`);
  const contentEl = document.getElementById(`expand-content-${sessionId}`);
  if (!expandRow) return;

  const isOpen = expandRow.style.display !== 'none';
  document.querySelectorAll('.expand-row').forEach(r => r.style.display = 'none');
  document.querySelectorAll('.history-row').forEach(r => r.style.background = '');

  if (isOpen) return;

  expandRow.style.display = '';
  rowEl.style.background = 'rgba(0,180,216,0.06)';
  contentEl.innerHTML = '<div class="loader"><div class="spinner"></div></div>';

  try {
    const msgs = await apiFetch(`/api/chat/sessions/${sessionId}`);
    if (!msgs.length) {
      contentEl.innerHTML = '<p style="color:var(--muted);font-size:12px">Sem mensagens registradas</p>';
      return;
    }
    contentEl.innerHTML = `<div style="display:flex;flex-direction:column;gap:10px;max-height:300px;overflow-y:auto">` +
      msgs.map(m => `
        <div class="activity-item">
          <div class="activity-icon">${m.role === 'user' ? '🧑' : '🤖'}</div>
          <div class="activity-info">
            <div class="activity-summary" style="white-space:normal">${escHtml(m.content)}</div>
            <div class="activity-meta">${fmtDate(m.timestamp)} · ${m.role}
              ${m.cost_usd > 0 ? `<span class="badge badge-alert" style="font-size:10px;margin-left:6px">${fmtBRL(m.cost_usd * 5.7)}</span>` : ''}
            </div>
          </div>
        </div>`).join('') + `</div>`;
  } catch (e) {
    contentEl.innerHTML = `<p style="color:var(--danger)">Erro: ${e.message}</p>`;
  }
}

function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>');
}

async function exportCSV() {
  const qs = buildQuery({ page: 1, per_page: 10000 });
  const url = `/api/history/export?${qs}`;
  window.location.href = WS.addParam(url);
}

async function loadModelOptions() {
  try {
    const data = await fetch('/api/models').then(r => r.json());
    const sel = document.getElementById('f-model');
    if (!sel) return;
    const opts = Object.keys(data.models || {}).map(m => `<option value="${m}">${m}</option>`).join('');
    sel.innerHTML = '<option value="">Todos os modelos</option>' + opts;
  } catch {}
}

document.addEventListener('DOMContentLoaded', () => {
  loadModelOptions();
  loadHistory();

  document.getElementById('btn-filter')?.addEventListener('click', () => { currentPage = 1; loadHistory(); });
  document.getElementById('btn-clear-filters')?.addEventListener('click', () => {
    ['f-q','f-agent','f-from','f-to'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
    const modelEl = document.getElementById('f-model'); if (modelEl) modelEl.value = '';
    currentPage = 1; loadHistory();
  });
  document.getElementById('btn-export')?.addEventListener('click', exportCSV);
  document.getElementById('btn-prev')?.addEventListener('click', () => { if (currentPage > 1) { currentPage--; loadHistory(); } });
  document.getElementById('btn-next')?.addEventListener('click', () => { currentPage++; loadHistory(); });

  const fq = document.getElementById('f-q');
  if (fq) fq.addEventListener('keydown', e => { if (e.key === 'Enter') { currentPage = 1; loadHistory(); } });
});
