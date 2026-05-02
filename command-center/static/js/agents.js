// ── Agents ────────────────────────────────────────────────────────────────────

const STATUS_LABELS = { active: 'Online', idle: 'Idle', offline: 'Offline' };
const STATUS_BADGES = { active: 'badge-positive', idle: 'badge-alert', offline: 'badge-muted' };

async function loadAgents() {
  const grid = document.getElementById('agents-grid');
  if (!grid) return;

  grid.innerHTML = '<div class="loader"><div class="spinner"></div></div>';

  try {
    const [sessionsRaw, costsData] = await Promise.all([
      apiFetch('/api/openclaw/sessions').catch(() => []),
      apiFetch('/api/costs?period=today').catch(() => ({ by_agent: {} })),
    ]);

    const sessions = Array.isArray(sessionsRaw)
      ? sessionsRaw
      : (sessionsRaw?.sessions || sessionsRaw?.data || []);

    if (!sessions.length) {
      grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1"><div class="empty-icon">🤖</div><p>Nenhuma sessão encontrada no Gateway</p></div>`;
      return;
    }

    grid.innerHTML = sessions.map(s => {
      const agentId = s.id || s.agent_id || s.session_id || 'unknown';
      const model = s.model || s.llm_model || '—';
      const channel = s.channel || '—';
      const status = s.status || 'offline';
      const lastActivity = s.last_activity || s.updated_at || s.created_at;
      const msgCount = s.message_count || s.messages_today || 0;
      const costBRL = costsData.by_agent?.[agentId] ?? 0;
      const badgeClass = STATUS_BADGES[status] || 'badge-muted';
      const statusLabel = STATUS_LABELS[status] || status;

      return `
        <div class="agent-card">
          <div class="agent-header">
            <div>
              <div class="agent-name">${agentId}</div>
              <div class="agent-model">${model}</div>
            </div>
            <span class="badge ${badgeClass}">${statusLabel}</span>
          </div>
          <div class="agent-stats">
            <div class="agent-stat">
              <div class="agent-stat-label">Canal</div>
              <div class="agent-stat-value" style="font-size:13px">${channel}</div>
            </div>
            <div class="agent-stat">
              <div class="agent-stat-label">Última atividade</div>
              <div class="agent-stat-value" style="font-size:12px">${relativeTime(lastActivity)}</div>
            </div>
            <div class="agent-stat">
              <div class="agent-stat-label">Mensagens hoje</div>
              <div class="agent-stat-value">${msgCount}</div>
            </div>
            <div class="agent-stat">
              <div class="agent-stat-label">Custo hoje</div>
              <div class="agent-stat-value" style="font-size:12px;color:var(--alert)">${fmtBRL(costBRL)}</div>
            </div>
          </div>
          <div class="agent-actions">
            <button class="btn btn-ghost btn-sm" onclick="openLogs('${agentId}')">Ver Logs</button>
            <button class="btn btn-ghost btn-sm" style="color:var(--alert)">Pausar</button>
            <button class="btn btn-ghost btn-sm" style="color:var(--primary)">Reiniciar</button>
          </div>
        </div>`;
    }).join('');
  } catch (e) {
    grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1"><div class="empty-icon">⚠️</div><p>${e.message}</p></div>`;
  }
}

async function openLogs(agentId) {
  const modal = document.getElementById('modal-logs');
  const title = document.getElementById('modal-logs-title');
  const body  = document.getElementById('modal-logs-body');
  if (!modal) return;

  if (title) title.textContent = `Logs — ${agentId}`;
  if (body)  body.innerHTML = '<div class="loader"><div class="spinner"></div></div>';
  openModal('modal-logs');

  try {
    const data = await apiFetch(`/api/activity?per_page=30`);
    const items = (data.items || []).filter(i => i.agent_id === agentId);

    if (!items.length) {
      body.innerHTML = '<p style="color:var(--muted);text-align:center;padding:24px">Sem logs para este agente</p>';
      return;
    }

    body.innerHTML = `<div class="activity-list">` + items.map(item => `
      <div class="activity-item">
        <div class="activity-icon">${{ message_received:'📨', tool_invoked:'🔍', response_sent:'✅', error:'❌' }[item.event_type] || '📌'}</div>
        <div class="activity-info">
          <div class="activity-summary">${item.summary || item.event_type}</div>
          <div class="activity-meta">${fmtDate(item.timestamp)} · ${item.channel || '—'}</div>
        </div>
      </div>`).join('') + `</div>`;
  } catch (e) {
    body.innerHTML = `<p style="color:var(--danger)">Erro: ${e.message}</p>`;
  }
}

document.addEventListener('DOMContentLoaded', () => {
  loadAgents();
  visiblePolling(loadAgents, 10000);
});
