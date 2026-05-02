// ── Dashboard ─────────────────────────────────────────────────────────────────

const EVENT_ICONS = {
  message_received: '📨',
  tool_invoked:     '🔍',
  response_sent:    '✅',
  error:            '❌',
};

async function loadDashboard() {
  try {
    const data = await apiFetch('/api/dashboard');

    // KPIs
    const statusEl = document.getElementById('kpi-gateway');
    if (statusEl) {
      statusEl.innerHTML = data.gateway_online
        ? '<span class="badge badge-positive">Online</span>'
        : '<span class="badge badge-danger">Offline</span>';
    }
    setText('kpi-messages', data.messages_today ?? 0);
    setText('kpi-cost', fmtBRL(data.cost_today_brl));
    setText('kpi-agents', data.active_agents ?? 0);

    // Activity feed
    renderActivityFeed(data.activities || []);
  } catch (e) {
    console.error(e);
  }
}

function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

function renderActivityFeed(items) {
  const list = document.getElementById('activity-feed');
  if (!list) return;

  if (!items.length) {
    list.innerHTML = `<div class="empty-state"><div class="empty-icon">📭</div><p>Nenhuma atividade registrada ainda</p></div>`;
    return;
  }

  list.innerHTML = items.map(item => {
    const icon = EVENT_ICONS[item.event_type] || '📌';
    const time = relativeTime(item.timestamp);
    return `
      <div class="activity-item">
        <div class="activity-icon">${icon}</div>
        <div class="activity-info">
          <div class="activity-summary">${item.summary || item.event_type || '—'}</div>
          <div class="activity-meta">${item.agent_id || '—'} · ${item.channel || '—'} · ${time}</div>
        </div>
        <div class="activity-right">
          <span class="badge badge-muted" style="font-size:10px;">${item.event_type || '—'}</span>
        </div>
      </div>`;
  }).join('');
}

async function loadHourlyChart() {
  try {
    const data = await apiFetch('/api/costs?period=today');
    const daily = data.daily || {};
    const labels = Object.keys(daily);
    const values = Object.values(daily);

    const ctx = document.getElementById('chart-hourly');
    if (!ctx || !window.Chart) return;

    if (window._dashChart) window._dashChart.destroy();

    window._dashChart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: labels.length ? labels : ['Hoje'],
        datasets: [{
          label: 'Custo (R$)',
          data: values.length ? values : [0],
          backgroundColor: 'rgba(0,180,216,0.5)',
          borderColor: '#00b4d8',
          borderWidth: 1,
          borderRadius: 4,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { grid: { color: '#2a2f45' }, ticks: { color: '#7c8498' } },
          y: { grid: { color: '#2a2f45' }, ticks: { color: '#7c8498' } },
        },
      },
    });
  } catch (e) {
    console.error('Chart error:', e);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  loadDashboard();
  loadHourlyChart();
  visiblePolling(() => {
    loadDashboard();
    loadHourlyChart();
  }, 5000);
});
