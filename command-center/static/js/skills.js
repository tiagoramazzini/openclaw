// ── Skills ────────────────────────────────────────────────────────────────────

const CATEGORY_COLORS = {
  system:    'badge-primary',
  installed: 'badge-positive',
  available: 'badge-muted',
};

async function loadSkills() {
  const grid = document.getElementById('skills-grid');
  if (!grid) return;

  grid.innerHTML = '<div class="loader" style="grid-column:1/-1"><div class="spinner"></div></div>';

  try {
    const raw = await apiFetch('/api/openclaw/skills');
    const skills = Array.isArray(raw) ? raw : (raw?.skills || raw?.data || []);

    if (!skills.length) {
      grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1"><div class="empty-icon">🛠️</div><p>Nenhuma skill encontrada no Gateway</p></div>`;
      return;
    }

    grid.innerHTML = skills.map(s => {
      const name     = s.name || s.id || 'Skill';
      const desc     = s.description || s.desc || '—';
      const category = s.category || 'installed';
      const enabled  = s.enabled !== false;
      const examples = s.examples || s.usage_examples || [];
      const badgeClass = CATEGORY_COLORS[category] || 'badge-muted';
      const categoryLabel = { system: 'Sistema', installed: 'Instalada', available: 'Disponível' }[category] || category;

      return `
        <div class="skill-card">
          <div class="skill-card-header">
            <div>
              <div class="skill-name">${name}</div>
              <span class="badge ${badgeClass}" style="margin-top:4px">${categoryLabel}</span>
            </div>
            <label class="toggle" title="${enabled ? 'Desativar' : 'Ativar'}">
              <input type="checkbox" ${enabled ? 'checked' : ''} onchange="toggleSkill('${name}', this.checked)">
              <span class="toggle-slider"></span>
            </label>
          </div>
          <div class="skill-desc">${desc}</div>
          ${examples.length ? `
            <div class="skill-examples">
              ${examples.slice(0, 3).map(ex => `
                <div class="skill-example" onclick="showSkillExample('${name}', ${JSON.stringify(ex).replace(/"/g, '&quot;')})">
                  ${ex}
                </div>`).join('')}
            </div>` : ''}
          <div style="display:flex;gap:8px;margin-top:4px">
            <button class="btn btn-ghost btn-sm" onclick="viewSkillMd('${name}')">Ver SKILL.md</button>
          </div>
        </div>`;
    }).join('');
  } catch (e) {
    grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1"><div class="empty-icon">⚠️</div><p>${e.message}</p></div>`;
  }
}

async function toggleSkill(name, enabled) {
  try {
    await apiFetch('/api/openclaw/tools', {
      method: 'POST',
      body: { tool: enabled ? 'enable_skill' : 'disable_skill', params: { skill: name } },
    });
    showToast(`Skill "${name}" ${enabled ? 'ativada' : 'desativada'}`, 'success');
  } catch (e) {
    showToast('Erro: ' + e.message, 'error');
  }
}

function showSkillExample(skillName, example) {
  document.getElementById('modal-example-title').textContent = `Skill: ${skillName}`;
  document.getElementById('modal-example-body').textContent = example;
  openModal('modal-example');
}

async function viewSkillMd(name) {
  const title = document.getElementById('modal-md-title');
  const body  = document.getElementById('modal-md-body');
  if (title) title.textContent = `SKILL.md — ${name}`;
  if (body)  body.innerHTML = '<div class="loader"><div class="spinner"></div></div>';
  openModal('modal-md');

  try {
    const data = await apiFetch('/api/openclaw/tools', {
      method: 'POST',
      body: { tool: 'get_skill_md', params: { skill: name } },
    });
    body.innerHTML = `<pre style="white-space:pre-wrap;font-size:12px;color:var(--text);line-height:1.6">${escapeHtml(data?.content || JSON.stringify(data, null, 2))}</pre>`;
  } catch (e) {
    body.innerHTML = `<p style="color:var(--danger)">Erro ao carregar SKILL.md: ${e.message}</p>`;
  }
}

async function installSkill() {
  const input = document.getElementById('install-input');
  const btn   = document.getElementById('install-btn');
  const val   = input?.value.trim();
  if (!val) { showToast('Insira uma URL ou nome de skill', 'warning'); return; }

  btn.disabled = true;
  btn.textContent = 'Instalando…';
  try {
    await apiFetch('/api/openclaw/tools', {
      method: 'POST',
      body: { tool: 'clawhub_install', params: { source: val } },
    });
    showToast(`Skill "${val}" instalada com sucesso`, 'success');
    input.value = '';
    loadSkills();
  } catch (e) {
    showToast('Erro na instalação: ' + e.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Instalar';
  }
}

function escapeHtml(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

document.addEventListener('DOMContentLoaded', () => {
  loadSkills();
  document.getElementById('install-btn')?.addEventListener('click', installSkill);
});
