// ── Costs ─────────────────────────────────────────────────────────────────────

let lineChart = null, modelChart = null, channelChart = null;

async function loadCosts(period = 'month') {
  try {
    const [today, month] = await Promise.all([
      apiFetch('/api/costs?period=today'),
      apiFetch('/api/costs?period=month'),
    ]);

    setText('kpi-today',      fmtBRL(today.total_brl));
    setText('kpi-month',      fmtBRL(month.total_brl));
    setText('kpi-projection', fmtBRL(month.projection_brl));
    setText('kpi-top-model',  month.most_used_model || '—');

    renderLineChart(month.daily || {});
    renderModelChart(month.by_model || {});
    renderChannelChart(month.by_channel || {});
    renderTable(period);
  } catch (e) {
    showToast('Erro ao carregar custos: ' + e.message, 'error');
  }
}

function setText(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}

const CHART_COLORS = ['#00b4d8','#00c853','#f77f00','#d62828','#9b59b6','#e74c3c','#1abc9c'];

function renderLineChart(daily) {
  const ctx = document.getElementById('chart-line');
  if (!ctx || !window.Chart) return;
  if (lineChart) lineChart.destroy();
  const labels = Object.keys(daily);
  const values = Object.values(daily);
  lineChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: 'Custo R$',
        data: values,
        borderColor: '#00b4d8',
        backgroundColor: 'rgba(0,180,216,0.1)',
        tension: 0.3,
        fill: true,
        pointRadius: 3,
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { grid: { color: '#2a2f45' }, ticks: { color: '#7c8498', maxTicksLimit: 10 } },
        y: { grid: { color: '#2a2f45' }, ticks: { color: '#7c8498' } },
      }
    }
  });
}

function renderModelChart(byModel) {
  const ctx = document.getElementById('chart-model');
  if (!ctx || !window.Chart) return;
  if (modelChart) modelChart.destroy();
  const labels = Object.keys(byModel);
  const values = Object.values(byModel);
  modelChart = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels,
      datasets: [{ data: values, backgroundColor: CHART_COLORS, borderWidth: 0 }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { position: 'bottom', labels: { color: '#7c8498', font: { size: 11 } } }
      }
    }
  });
}

function renderChannelChart(byChannel) {
  const ctx = document.getElementById('chart-channel');
  if (!ctx || !window.Chart) return;
  if (channelChart) channelChart.destroy();
  const labels = Object.keys(byChannel);
  const values = Object.values(byChannel);
  channelChart = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels,
      datasets: [{ data: values, backgroundColor: CHART_COLORS.slice(2), borderWidth: 0 }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { position: 'bottom', labels: { color: '#7c8498', font: { size: 11 } } }
      }
    }
  });
}

async function renderTable(period) {
  const body = document.getElementById('costs-table-body');
  if (!body) return;

  try {
    const data = await apiFetch(`/api/activity?per_page=50`);
    const items = data.items || [];
    if (!items.length) {
      body.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--muted);padding:24px">Sem dados</td></tr>';
      return;
    }
    body.innerHTML = items.map(i => `
      <tr>
        <td>${fmtDate(i.timestamp)}</td>
        <td>${i.agent_id || '—'}</td>
        <td><span class="badge badge-primary">—</span></td>
        <td>${i.channel || '—'}</td>
        <td style="text-align:right">—</td>
        <td style="text-align:right">—</td>
        <td style="text-align:right">—</td>
      </tr>`).join('');
  } catch (e) {
    body.innerHTML = `<tr><td colspan="7" style="color:var(--danger);padding:12px">Erro: ${e.message}</td></tr>`;
  }
}

async function estimateCost() {
  const model  = document.getElementById('est-model')?.value;
  const input  = parseInt(document.getElementById('est-input')?.value || '0');
  const output = parseInt(document.getElementById('est-output')?.value || '0');
  if (!model) { showToast('Selecione um modelo', 'warning'); return; }

  try {
    const data = await apiFetch(`/api/costs/estimate?model=${encodeURIComponent(model)}&input_tokens=${input}&output_tokens=${output}`);
    document.getElementById('est-result').innerHTML = `
      <div style="display:flex;gap:20px;flex-wrap:wrap;margin-top:12px">
        <div class="agent-stat" style="flex:1;min-width:130px">
          <div class="agent-stat-label">Custo USD</div>
          <div class="agent-stat-value">$${data.cost_usd.toFixed(6)}</div>
        </div>
        <div class="agent-stat" style="flex:1;min-width:130px">
          <div class="agent-stat-label">Custo BRL</div>
          <div class="agent-stat-value" style="color:var(--alert)">${fmtBRL(data.cost_brl)}</div>
        </div>
        <div class="agent-stat" style="flex:1;min-width:130px">
          <div class="agent-stat-label">Taxa USD/BRL</div>
          <div class="agent-stat-value" style="font-size:14px">R$ ${data.usd_brl_rate}</div>
        </div>
      </div>`;
  } catch (e) {
    showToast('Erro na estimativa: ' + e.message, 'error');
  }
}

async function loadModelOptions() {
  try {
    const data = await apiFetch('/api/models');
    const sel = document.getElementById('est-model');
    if (!sel) return;
    sel.innerHTML = Object.keys(data.models || {}).map(m =>
      `<option value="${m}">${m}</option>`
    ).join('');
  } catch {}
}

document.addEventListener('DOMContentLoaded', () => {
  loadCosts();
  loadModelOptions();
  document.getElementById('btn-estimate')?.addEventListener('click', estimateCost);

  document.querySelectorAll('.period-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.period-btn').forEach(b => b.classList.remove('btn-primary'));
      btn.classList.add('btn-primary');
      loadCosts(btn.dataset.period);
    });
  });
});
