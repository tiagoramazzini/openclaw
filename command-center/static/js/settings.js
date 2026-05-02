// ── Settings ──────────────────────────────────────────────────────────────────

async function loadSettings() {
  try {
    const [modelsData, cfg] = await Promise.all([
      fetch('/api/models').then(r => r.json()),
      apiFetch('/api/config').catch(() => ({})),
    ]);
    document.getElementById('s-gateway-url').value = cfg?.gateway?.url || 'http://127.0.0.1:18789';
    document.getElementById('s-usd-brl').value      = modelsData.usd_brl_rate || 5.70;
    document.getElementById('s-cc-port').value      = cfg?.command_center?.port || 8090;
    renderPricesTable(modelsData.models || {});
    renderRawConfig(cfg);
  } catch (e) {
    showToast('Erro ao carregar configurações: ' + e.message, 'error');
  }
}

function renderPricesTable(models) {
  const tbody = document.getElementById('prices-table-body');
  if (!tbody) return;
  tbody.innerHTML = Object.entries(models).map(([model, prices]) => `
    <tr class="price-row">
      <td style="padding:8px 14px;font-size:13px">${model}</td>
      <td style="padding:8px 14px"><input type="number" step="0.01" value="${prices.input}" data-model="${model}" data-type="input"></td>
      <td style="padding:8px 14px"><input type="number" step="0.01" value="${prices.output}" data-model="${model}" data-type="output"></td>
    </tr>`).join('');
}

function renderRawConfig(cfg) {
  const el = document.getElementById('raw-config');
  if (el) el.value = JSON.stringify(cfg, null, 2);
}

async function testGateway() {
  const btn = document.getElementById('btn-test-gateway');
  if (btn) { btn.disabled = true; btn.textContent = 'Testando…'; }
  try {
    const data = await apiFetch('/api/openclaw/status');
    showToast(data.online ? 'Gateway online e respondendo' : 'Gateway offline: ' + (data.error || 'sem resposta'), data.online ? 'success' : 'error');
  } catch (e) {
    showToast('Erro: ' + e.message, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Testar conexão'; }
  }
}

async function saveGateway() {
  const url   = document.getElementById('s-gateway-url')?.value.trim();
  const token = document.getElementById('s-gateway-token')?.value.trim();
  const patch = { gateway: { url } };
  if (token && token !== '***masked***') patch.gateway.token = token;
  try {
    await apiFetch('/api/config', { method: 'PATCH', body: patch });
    showToast('Gateway salvo', 'success');
  } catch (e) { showToast('Erro: ' + e.message, 'error'); }
}

async function saveModels() {
  const rate = parseFloat(document.getElementById('s-usd-brl')?.value || '5.70');
  const models = {};
  document.querySelectorAll('.price-row input[data-model]').forEach(inp => {
    const m = inp.dataset.model;
    if (!models[m]) models[m] = {};
    models[m][inp.dataset.type] = parseFloat(inp.value);
  });
  try {
    await fetch('/api/models', { method: 'PATCH', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ usd_brl_rate: rate, models }) });
    showToast('Preços atualizados', 'success');
  } catch (e) { showToast('Erro: ' + e.message, 'error'); }
}

async function saveCCSettings() {
  const port = parseInt(document.getElementById('s-cc-port')?.value || '8090');
  try {
    await apiFetch('/api/config', { method: 'PATCH', body: { command_center: { port } } });
    showToast('Configurações salvas', 'success');
  } catch (e) { showToast('Erro: ' + e.message, 'error'); }
}

async function saveRawConfig() {
  const val = document.getElementById('raw-config')?.value;
  if (!confirm('Sobrescrever o openclaw.json?')) return;
  try {
    const parsed = JSON.parse(val);
    await apiFetch('/api/config', { method: 'PATCH', body: parsed });
    showToast('Configuração salva', 'success');
  } catch (e) { showToast('JSON inválido ou erro: ' + e.message, 'error'); }
}

function toggleCollapse(id) {
  const el = document.getElementById(id);
  if (el) el.classList.toggle('open');
}

// ── Alert rules ───────────────────────────────────────────────────────────────

const ALERT_LABELS = {
  cost_daily:     'Custo diário (R$)',
  cost_monthly:   'Custo mensal (R$)',
  agent_offline:  'Agente offline (minutos)',
  error_repeated: 'Erros em 1h (quantidade)',
};

async function loadAlertRules() {
  const list = document.getElementById('alert-rules-list');
  if (!list) return;
  try {
    const rules = await apiFetch('/api/alerts/rules');
    if (!rules.length) {
      list.innerHTML = '<div style="padding:16px 20px;color:var(--muted);font-size:13px">Nenhuma regra configurada</div>';
    } else {
      list.innerHTML = rules.map(r => `
        <div style="display:flex;align-items:center;gap:12px;padding:12px 20px;border-bottom:1px solid var(--border)">
          <label class="toggle"><input type="checkbox" ${r.active ? 'checked' : ''} onchange="patchAlertRule(${r.id}, {active: this.checked})"><span class="toggle-slider"></span></label>
          <div style="flex:1">
            <div style="font-size:13px;font-weight:500">${{cost_daily:'Custo diário', cost_monthly:'Custo mensal', agent_offline:'Agente offline', error_repeated:'Erros repetidos'}[r.type] || r.type}</div>
            <div style="font-size:11px;color:var(--muted)">Threshold: ${r.threshold} ${r.type.includes('cost') ? 'R$' : r.type === 'agent_offline' ? 'min' : 'ocorrências'}${r.channel ? ' · Notificar: ' + r.channel : ''}</div>
          </div>
          <button class="btn btn-ghost btn-sm" style="color:var(--danger)" onclick="deleteAlertRule(${r.id})">🗑️</button>
        </div>`).join('');
    }
  } catch (e) {
    list.innerHTML = `<div style="padding:16px;color:var(--danger)">${e.message}</div>`;
  }
}

async function loadAlertEvents() {
  const el = document.getElementById('alert-events-list');
  if (!el) return;
  try {
    const events = await apiFetch('/api/alerts/events');
    if (!events.length) {
      el.innerHTML = '<div style="color:var(--muted);font-size:12px">Nenhum alerta disparado ainda</div>';
      return;
    }
    el.innerHTML = events.slice(0, 5).map(e => `
      <div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid rgba(42,47,69,0.4)">
        <span class="badge ${e.acknowledged ? 'badge-muted' : 'badge-danger'}" style="font-size:10px">${e.acknowledged ? 'OK' : 'Novo'}</span>
        <div style="flex:1;font-size:12px">
          <div style="font-weight:500">${{cost_daily:'Custo diário', cost_monthly:'Custo mensal', agent_offline:'Agente offline', error_repeated:'Erros repetidos'}[e.rule_type] || e.rule_type}</div>
          <div style="color:var(--muted)">${relativeTime(e.triggered_at)} · ${JSON.stringify(e.context)}</div>
        </div>
        ${!e.acknowledged ? `<button class="btn btn-ghost btn-sm" style="font-size:11px" onclick="ackAlertSettings(${e.id})">✓ ACK</button>` : ''}
      </div>`).join('');
  } catch {}
}

async function ackAlertSettings(id) {
  await fetch(`/api/alerts/events/${id}/acknowledge`, { method: 'POST' });
  loadAlertEvents();
  updateAlertBell();
}

async function patchAlertRule(id, patch) {
  try {
    await apiFetch(`/api/alerts/rules/${id}`, { method: 'PATCH', body: patch });
    showToast('Regra atualizada', 'success');
    loadAlertRules();
  } catch (e) { showToast(e.message, 'error'); }
}

async function deleteAlertRule(id) {
  if (!confirm('Remover esta regra?')) return;
  try {
    await apiFetch(`/api/alerts/rules/${id}`, { method: 'DELETE' });
    showToast('Regra removida', 'success');
    loadAlertRules();
  } catch (e) { showToast(e.message, 'error'); }
}

async function saveAlertRule() {
  const type      = document.getElementById('alert-type')?.value;
  const threshold = parseFloat(document.getElementById('alert-threshold')?.value || '0');
  const channel   = document.getElementById('alert-channel')?.value || null;
  const active    = document.getElementById('alert-active')?.checked;
  if (!threshold) { showToast('Insira um threshold', 'warning'); return; }
  try {
    await apiFetch('/api/alerts/rules', { method: 'POST', body: { type, threshold, channel, active } });
    showToast('Regra criada', 'success');
    closeModal('modal-alert');
    loadAlertRules();
    updateAlertBell();
  } catch (e) { showToast(e.message, 'error'); }
}

// Dynamic label for threshold
document.addEventListener('change', e => {
  if (e.target.id === 'alert-type') {
    const lbl = document.getElementById('alert-threshold-label');
    if (lbl) lbl.textContent = ALERT_LABELS[e.target.value] || 'Threshold';
  }
});

// ── Workspaces ────────────────────────────────────────────────────────────────

async function loadWorkspaces() {
  const el = document.getElementById('workspace-list');
  if (!el) return;
  try {
    const wss = await fetch('/api/workspaces').then(r => r.json());
    if (wss.length <= 1) {
      el.innerHTML = '<div style="padding:16px 20px;color:var(--muted);font-size:13px">Nenhum workspace adicional configurado</div>';
    } else {
      el.innerHTML = wss.filter(w => w.id !== null).map(w => `
        <div style="display:flex;align-items:center;gap:12px;padding:12px 20px;border-bottom:1px solid var(--border)">
          <span id="ws-dot-${w.id}" class="status-dot"></span>
          <div style="flex:1">
            <div style="font-size:13px;font-weight:600">${w.name}</div>
            <div style="font-size:11px;color:var(--muted)">${w.gateway_url} · USD/BRL: ${w.usd_brl_rate}</div>
          </div>
          <button class="btn btn-ghost btn-sm" onclick="testWorkspace(${w.id})">Testar</button>
          <button class="btn btn-ghost btn-sm" onclick="editWorkspace(${w.id}, '${escStr(w.name)}', '${escStr(w.gateway_url)}', ${w.usd_brl_rate})">Editar</button>
          <button class="btn btn-ghost btn-sm" style="color:var(--danger)" onclick="deleteWorkspace(${w.id})">🗑️</button>
        </div>`).join('');
      wss.filter(w => w.id).forEach(w => testWorkspace(w.id, true));
    }
  } catch (e) {
    el.innerHTML = `<div style="padding:16px;color:var(--danger)">${e.message}</div>`;
  }
}

function escStr(s) { return String(s).replace(/'/g, "\\'"); }

async function testWorkspace(id, silent = false) {
  if (!silent) showToast('Testando workspace…', 'info');
  try {
    const data = await fetch(`/api/workspaces/${id}/test`, { method: 'POST' }).then(r => r.json());
    const dot = document.getElementById(`ws-dot-${id}`);
    if (dot) dot.className = `status-dot ${data.online ? 'online' : 'offline'}`;
    if (!silent) showToast(data.online ? 'Workspace online' : 'Workspace offline: ' + (data.error || ''), data.online ? 'success' : 'error');
  } catch {}
}

async function deleteWorkspace(id) {
  if (!confirm('Remover este workspace?')) return;
  try {
    await fetch(`/api/workspaces/${id}`, { method: 'DELETE' });
    showToast('Workspace removido', 'success');
    loadWorkspaces();
  } catch (e) { showToast(e.message, 'error'); }
}

function editWorkspace(id, name, url, rate) {
  document.getElementById('ws-id').value    = id;
  document.getElementById('ws-name').value  = name;
  document.getElementById('ws-url').value   = url;
  document.getElementById('ws-rate').value  = rate;
  document.getElementById('ws-token').value = '';
  document.getElementById('modal-ws-title').textContent = `Editar — ${name}`;
  openModal('modal-workspace');
}

async function saveWorkspace() {
  const id    = document.getElementById('ws-id')?.value;
  const name  = document.getElementById('ws-name')?.value.trim();
  const url   = document.getElementById('ws-url')?.value.trim();
  const token = document.getElementById('ws-token')?.value.trim();
  const rate  = parseFloat(document.getElementById('ws-rate')?.value || '5.70');
  if (!name || !url) { showToast('Nome e URL são obrigatórios', 'warning'); return; }

  const btn = document.getElementById('btn-save-ws');
  btn.disabled = true; btn.textContent = 'Salvando…';
  try {
    const body = { name, gateway_url: url, usd_brl_rate: rate };
    if (token) body.gateway_token = token;
    if (id) {
      await fetch(`/api/workspaces/${id}`, { method: 'PATCH', headers: {'Content-Type':'application/json'}, body: JSON.stringify(body) });
    } else {
      await fetch('/api/workspaces', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(body) });
    }
    showToast('Workspace salvo', 'success');
    closeModal('modal-workspace');
    loadWorkspaces();
    _initWorkspaceSelector();
  } catch (e) { showToast(e.message, 'error'); }
  finally { btn.disabled = false; btn.textContent = 'Salvar'; }
}

async function testWsModal() {
  const url   = document.getElementById('ws-url')?.value.trim();
  const token = document.getElementById('ws-token')?.value.trim();
  showToast('Testando…', 'info');
  try {
    const r = await fetch('/api/workspaces/0/test', { method: 'POST' }).then(r => r.json());
    showToast(r.online ? 'Conexão OK' : 'Falha: ' + (r.error || ''), r.online ? 'success' : 'error');
  } catch (e) { showToast(e.message, 'error'); }
}

// ── Init ──────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  loadSettings();
  loadAlertRules();
  loadAlertEvents();
  loadWorkspaces();

  initReveal('s-gateway-token', 's-reveal-token');
  initReveal('ws-token', 'ws-reveal-token');

  document.getElementById('btn-test-gateway')?.addEventListener('click', testGateway);
  document.getElementById('btn-save-gateway')?.addEventListener('click', saveGateway);
  document.getElementById('btn-save-models')?.addEventListener('click', saveModels);
  document.getElementById('btn-save-cc')?.addEventListener('click', saveCCSettings);
  document.getElementById('btn-save-raw')?.addEventListener('click', saveRawConfig);
  document.getElementById('btn-toggle-raw')?.addEventListener('click', () => toggleCollapse('raw-config-section'));

  document.getElementById('btn-add-alert')?.addEventListener('click', () => openModal('modal-alert'));
  document.getElementById('btn-save-alert')?.addEventListener('click', saveAlertRule);

  document.getElementById('btn-add-workspace')?.addEventListener('click', () => {
    document.getElementById('ws-id').value = '';
    document.getElementById('ws-name').value = '';
    document.getElementById('ws-url').value = '';
    document.getElementById('ws-token').value = '';
    document.getElementById('ws-rate').value = '5.70';
    document.getElementById('modal-ws-title').textContent = 'Adicionar Workspace';
    openModal('modal-workspace');
  });
  document.getElementById('btn-save-ws')?.addEventListener('click', saveWorkspace);
  document.getElementById('btn-test-ws')?.addEventListener('click', testWsModal);
});
