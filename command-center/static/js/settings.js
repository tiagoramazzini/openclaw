// ── Settings ──────────────────────────────────────────────────────────────────

async function loadSettings() {
  try {
    const [modelsData, cfg] = await Promise.all([
      apiFetch('/api/models'),
      apiFetch('/api/config').catch(() => ({})),
    ]);

    document.getElementById('s-gateway-url').value  = cfg?.gateway?.url || 'http://127.0.0.1:18789';
    document.getElementById('s-usd-brl').value       = modelsData.usd_brl_rate || 5.70;
    document.getElementById('s-cc-port').value       = cfg?.command_center?.port || 8090;

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
    if (data.online) showToast('Gateway online e respondendo', 'success');
    else showToast('Gateway offline: ' + (data.error || 'sem resposta'), 'error');
  } catch (e) {
    showToast('Erro: ' + e.message, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Testar conexão'; }
  }
}

async function saveGateway() {
  const url = document.getElementById('s-gateway-url')?.value.trim();
  const token = document.getElementById('s-gateway-token')?.value.trim();
  const patch = { gateway: { url } };
  if (token && token !== '***masked***') patch.gateway.token = token;
  try {
    await apiFetch('/api/config', { method: 'PATCH', body: patch });
    showToast('Gateway salvo', 'success');
  } catch (e) {
    showToast('Erro: ' + e.message, 'error');
  }
}

async function saveModels() {
  const rate = parseFloat(document.getElementById('s-usd-brl')?.value || '5.70');
  const rows = document.querySelectorAll('.price-row');
  const models = {};
  rows.forEach(row => {
    const inputs = row.querySelectorAll('input[data-model]');
    inputs.forEach(inp => {
      const m = inp.dataset.model;
      if (!models[m]) models[m] = {};
      models[m][inp.dataset.type] = parseFloat(inp.value);
    });
  });
  try {
    await apiFetch('/api/models', { method: 'PATCH', body: { usd_brl_rate: rate, models } });
    showToast('Preços de modelos atualizados', 'success');
  } catch (e) {
    showToast('Erro: ' + e.message, 'error');
  }
}

async function saveCCSettings() {
  const port = parseInt(document.getElementById('s-cc-port')?.value || '8090');
  try {
    await apiFetch('/api/config', { method: 'PATCH', body: { command_center: { port } } });
    showToast('Configurações salvas', 'success');
  } catch (e) {
    showToast('Erro: ' + e.message, 'error');
  }
}

async function saveRawConfig() {
  const val = document.getElementById('raw-config')?.value;
  if (!confirm('Tem certeza que deseja sobrescrever o openclaw.json? Esta ação não pode ser desfeita.')) return;
  try {
    const parsed = JSON.parse(val);
    await apiFetch('/api/config', { method: 'PATCH', body: parsed });
    showToast('Configuração salva com sucesso', 'success');
  } catch (e) {
    showToast('JSON inválido ou erro ao salvar: ' + e.message, 'error');
  }
}

function toggleCollapse(id) {
  const el = document.getElementById(id);
  if (el) el.classList.toggle('open');
}

document.addEventListener('DOMContentLoaded', () => {
  loadSettings();

  initReveal('s-gateway-token', 's-reveal-token');

  document.getElementById('btn-test-gateway')?.addEventListener('click', testGateway);
  document.getElementById('btn-save-gateway')?.addEventListener('click', saveGateway);
  document.getElementById('btn-save-models')?.addEventListener('click', saveModels);
  document.getElementById('btn-save-cc')?.addEventListener('click', saveCCSettings);
  document.getElementById('btn-save-raw')?.addEventListener('click', saveRawConfig);
  document.getElementById('btn-toggle-raw')?.addEventListener('click', () => toggleCollapse('raw-config-section'));
});
