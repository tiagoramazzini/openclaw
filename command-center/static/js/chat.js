// ── Chat ─────────────────────────────────────────────────────────────────────

let currentSessionId = null;
let messageHistory = [];

async function loadModels() {
  try {
    const data = await fetch('/api/models').then(r => r.json());
    const sel = document.getElementById('chat-model');
    if (!sel) return;
    sel.innerHTML = Object.keys(data.models || {}).map(m =>
      `<option value="${m}">${m}</option>`
    ).join('');
  } catch {}
}

async function loadSessions() {
  const list = document.getElementById('session-list');
  if (!list) return;
  try {
    const sessions = await apiFetch('/api/chat/sessions');
    if (!sessions.length) {
      list.innerHTML = '<div style="padding:20px;text-align:center;color:var(--muted);font-size:12px">Nenhuma sessão anterior</div>';
      return;
    }
    list.innerHTML = sessions.map(s => `
      <div class="session-item ${s.id === currentSessionId ? 'active' : ''}" data-id="${s.id}" onclick="loadSession(${s.id})">
        <div class="session-item-title">${s.preview || 'Sessão #' + s.id}</div>
        <div class="session-item-meta">${relativeTime(s.started_at)} · ${s.message_count} msgs · ${fmtBRL(s.total_cost_usd * 5.7)}</div>
      </div>`).join('');
  } catch (e) {
    list.innerHTML = `<div style="padding:14px;color:var(--danger);font-size:12px">${e.message}</div>`;
  }
}

async function loadSession(id) {
  currentSessionId = id;
  messageHistory = [];
  const messagesEl = document.getElementById('chat-messages');
  const emptyEl    = document.getElementById('chat-empty');
  if (messagesEl) messagesEl.innerHTML = '<div class="loader"><div class="spinner"></div></div>';
  if (emptyEl)    emptyEl.style.display = 'none';

  try {
    const msgs = await apiFetch(`/api/chat/sessions/${id}`);
    messageHistory = msgs.map(m => ({ role: m.role, content: m.content }));
    if (messagesEl) {
      messagesEl.innerHTML = '';
      msgs.forEach(m => renderBubble(m.role, m.content, m.cost_usd, m.input_tokens + m.output_tokens, m.timestamp));
    }
    scrollToBottom();
    loadSessions();
  } catch (e) {
    if (messagesEl) messagesEl.innerHTML = `<p style="color:var(--danger);padding:16px">${e.message}</p>`;
  }
}

function renderBubble(role, content, cost_usd = 0, tokens = 0, timestamp = null) {
  const messagesEl = document.getElementById('chat-messages');
  const emptyEl    = document.getElementById('chat-empty');
  if (emptyEl) emptyEl.style.display = 'none';

  const div = document.createElement('div');
  div.className = `bubble-row ${role}`;

  const costBRL = cost_usd * 5.7;
  const costBadge = (role === 'assistant' && cost_usd > 0)
    ? `<span class="bubble-cost">💰 ${fmtBRL(costBRL)} · ${tokens} tok</span>`
    : '';
  const time = timestamp ? `<span style="font-size:10px;color:var(--muted)">${fmtDate(timestamp)}</span>` : '';

  div.innerHTML = `
    <div style="max-width:72%">
      <div class="bubble">${escapeHtml(content)}</div>
      <div class="bubble-meta">${time}${costBadge}</div>
    </div>`;

  messagesEl.appendChild(div);
  scrollToBottom();
  return div;
}

function renderTyping() {
  const messagesEl = document.getElementById('chat-messages');
  const div = document.createElement('div');
  div.className = 'bubble-row assistant';
  div.id = 'typing-indicator';
  div.innerHTML = `<div class="bubble typing-indicator">
    <div class="typing-dot"></div><div class="typing-dot"></div><div class="typing-dot"></div>
  </div>`;
  messagesEl.appendChild(div);
  scrollToBottom();
}

function removeTyping() {
  document.getElementById('typing-indicator')?.remove();
}

function scrollToBottom() {
  const el = document.getElementById('chat-messages');
  if (el) el.scrollTop = el.scrollHeight;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/\n/g,'<br>');
}

async function sendMessage() {
  const input = document.getElementById('chat-input');
  const btn   = document.getElementById('btn-send');
  const model = document.getElementById('chat-model')?.value;
  const agent = document.getElementById('chat-agent')?.value.trim() || 'default';
  const text  = input?.value.trim();
  if (!text) return;

  input.value = '';
  input.style.height = 'auto';
  btn.disabled = true;

  renderBubble('user', text, 0, 0, new Date().toISOString());
  messageHistory.push({ role: 'user', content: text });

  renderTyping();

  try {
    const resp = await apiFetch('/api/chat/send', {
      method: 'POST',
      body: {
        session_id: currentSessionId,
        model,
        agent_id: agent,
        messages: messageHistory,
      },
    });

    removeTyping();
    currentSessionId = resp.session_id;

    renderBubble('assistant', resp.content, resp.cost_usd || 0, (resp.input_tokens || 0) + (resp.output_tokens || 0), new Date().toISOString());
    messageHistory.push({ role: 'assistant', content: resp.content });
    loadSessions();
  } catch (e) {
    removeTyping();
    renderBubble('assistant', `[Erro: ${e.message}]`, 0, 0, new Date().toISOString());
    showToast(e.message, 'error');
  } finally {
    btn.disabled = false;
    input.focus();
  }
}

function newChat() {
  currentSessionId = null;
  messageHistory = [];
  const messagesEl = document.getElementById('chat-messages');
  const emptyEl    = document.getElementById('chat-empty');
  if (messagesEl) messagesEl.innerHTML = '';
  if (emptyEl) { emptyEl.style.display = ''; messagesEl.appendChild(emptyEl); }
  document.querySelectorAll('.session-item').forEach(el => el.classList.remove('active'));
}

document.addEventListener('DOMContentLoaded', () => {
  loadModels();
  loadSessions();

  document.getElementById('btn-new-chat')?.addEventListener('click', newChat);
  document.getElementById('btn-send')?.addEventListener('click', sendMessage);

  const input = document.getElementById('chat-input');
  if (input) {
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter' && e.ctrlKey) { e.preventDefault(); sendMessage(); }
    });
    input.addEventListener('input', () => {
      input.style.height = 'auto';
      input.style.height = Math.min(input.scrollHeight, 120) + 'px';
    });
  }
});
