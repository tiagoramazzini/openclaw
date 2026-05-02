// ── Channels ──────────────────────────────────────────────────────────────────

let whatsappAllowFrom = [];
let telegramChatIds  = [];

async function loadConfig() {
  try {
    const cfg = await apiFetch('/api/config');

    // WhatsApp
    const wa = cfg?.channels?.whatsapp || cfg?.whatsapp || {};
    document.getElementById('wa-phone').value    = wa.phone || wa.number || '';
    document.getElementById('wa-mention').checked = !!wa.requireMention;
    document.getElementById('wa-mention-pattern').value = wa.mentionPattern || '';
    if (wa.allowFrom) whatsappChips.setValues(wa.allowFrom);

    // Telegram
    const tg = cfg?.channels?.telegram || cfg?.telegram || {};
    document.getElementById('tg-token').value    = tg.token ? '***masked***' : '';
    document.getElementById('tg-username').value = tg.username || '';
    const dm = tg.dmMode || 'open';
    const radio = document.querySelector(`input[name="tg-dm"][value="${dm}"]`);
    if (radio) radio.checked = true;
    if (tg.chatIds) telegramChips.setValues(tg.chatIds);

    // Status badges (mocked — real status would come from sessions)
    updateChannelStatus('wa-status', wa.enabled !== false ? 'connected' : 'disconnected');
    updateChannelStatus('tg-status', tg.enabled !== false ? 'connected' : 'disconnected');
    updateToggle('wa-toggle', wa.enabled !== false);
    updateToggle('tg-toggle', tg.enabled !== false);
  } catch (e) {
    showToast('Erro ao carregar configuração: ' + e.message, 'error');
  }
}

function updateChannelStatus(id, status) {
  const el = document.getElementById(id);
  if (!el) return;
  const map = {
    connected:    { badge: 'badge-positive', text: 'Conectado' },
    disconnected: { badge: 'badge-muted',    text: 'Desconectado' },
    error:        { badge: 'badge-danger',   text: 'Erro' },
  };
  const s = map[status] || map.disconnected;
  el.className = `badge ${s.badge}`;
  el.textContent = s.text;
}

function updateToggle(id, checked) {
  const el = document.getElementById(id);
  if (el) el.checked = checked;
}

async function saveWhatsApp() {
  const btn = document.getElementById('wa-save-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Salvando…'; }
  try {
    await apiFetch('/api/config', {
      method: 'PATCH',
      body: {
        channels: {
          whatsapp: {
            enabled:        document.getElementById('wa-toggle').checked,
            phone:          document.getElementById('wa-phone').value.trim(),
            allowFrom:      whatsappChips.getValues(),
            requireMention: document.getElementById('wa-mention').checked,
            mentionPattern: document.getElementById('wa-mention-pattern').value.trim(),
          }
        }
      }
    });
    showToast('WhatsApp salvo com sucesso', 'success');
  } catch (e) {
    showToast('Erro ao salvar: ' + e.message, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Salvar WhatsApp'; }
  }
}

async function saveTelegram() {
  const btn = document.getElementById('tg-save-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Salvando…'; }
  try {
    const tokenVal = document.getElementById('tg-token').value.trim();
    const patch = {
      channels: {
        telegram: {
          enabled:  document.getElementById('tg-toggle').checked,
          username: document.getElementById('tg-username').value.trim(),
          chatIds:  telegramChips.getValues(),
          dmMode:   document.querySelector('input[name="tg-dm"]:checked')?.value || 'open',
        }
      }
    };
    if (tokenVal && tokenVal !== '***masked***') {
      patch.channels.telegram.token = tokenVal;
    }
    await apiFetch('/api/config', { method: 'PATCH', body: patch });
    showToast('Telegram salvo com sucesso', 'success');
  } catch (e) {
    showToast('Erro ao salvar: ' + e.message, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Salvar Telegram'; }
  }
}

async function testConnection(channel) {
  showToast(`Testando conexão ${channel}…`, 'info');
  try {
    await apiFetch('/api/openclaw/tools', {
      method: 'POST',
      body: { tool: `test_${channel}_connection`, params: {} },
    });
    showToast(`${channel} conectado com sucesso`, 'success');
  } catch (e) {
    showToast(`Falha na conexão ${channel}: ${e.message}`, 'error');
  }
}

let whatsappChips, telegramChips;

document.addEventListener('DOMContentLoaded', () => {
  whatsappChips = initChips('wa-chips', 'wa-chip-input', 'wa-chip-add');
  telegramChips = initChips('tg-chips', 'tg-chip-input', 'tg-chip-add');

  initReveal('tg-token', 'tg-reveal-btn');

  document.getElementById('wa-save-btn')?.addEventListener('click', saveWhatsApp);
  document.getElementById('tg-save-btn')?.addEventListener('click', saveTelegram);
  document.getElementById('wa-test-btn')?.addEventListener('click', () => testConnection('whatsapp'));
  document.getElementById('tg-test-btn')?.addEventListener('click', () => testConnection('telegram'));

  loadConfig();
});
