// ── Skills ────────────────────────────────────────────────────────────────────

const CATEGORY_COLORS = { system: 'badge-primary', installed: 'badge-positive', available: 'badge-muted' };

let triggerChips;
let skillSteps = [];

async function loadSkills() {
  const grid = document.getElementById('skills-grid');
  if (!grid) return;
  grid.innerHTML = '<div class="loader" style="grid-column:1/-1"><div class="spinner"></div></div>';

  try {
    const raw = await apiFetch('/api/openclaw/skills').catch(() => null);
    const local = await apiFetch('/api/skills/list').catch(() => []);

    const skills = raw
      ? (Array.isArray(raw) ? raw : (raw?.skills || raw?.data || []))
      : local.map(s => ({ name: s.name, description: '', category: 'installed', enabled: true }));

    if (!skills.length && !local.length) {
      grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1"><div class="empty-icon">🛠️</div><p>Nenhuma skill encontrada</p></div>`;
      return;
    }

    const allSkills = [...skills];
    local.forEach(ls => { if (!allSkills.find(s => s.name === ls.name)) allSkills.push({ name: ls.name, category: 'installed', enabled: true }); });

    grid.innerHTML = allSkills.map(s => {
      const name     = s.name || s.id || 'Skill';
      const desc     = s.description || s.desc || '—';
      const category = s.category || 'installed';
      const enabled  = s.enabled !== false;
      const examples = s.examples || s.usage_examples || [];
      const badgeClass    = CATEGORY_COLORS[category] || 'badge-muted';
      const categoryLabel = { system: 'Sistema', installed: 'Instalada', available: 'Disponível' }[category] || category;

      return `
        <div class="skill-card">
          <div class="skill-card-header">
            <div>
              <div class="skill-name">${name}</div>
              <span class="badge ${badgeClass}" style="margin-top:4px">${categoryLabel}</span>
            </div>
            <div style="display:flex;flex-direction:column;align-items:flex-end;gap:6px">
              <label class="toggle">
                <input type="checkbox" ${enabled ? 'checked' : ''} onchange="toggleSkill('${name}', this.checked)">
                <span class="toggle-slider"></span>
              </label>
              <button class="btn btn-ghost btn-sm" style="font-size:10px;color:var(--danger);padding:2px 8px" onclick="deleteSkill('${name}')">🗑️</button>
            </div>
          </div>
          <div class="skill-desc">${desc}</div>
          ${examples.length ? `<div class="skill-examples">${examples.slice(0, 3).map(ex => `<div class="skill-example" onclick="showSkillExample('${name}', ${JSON.stringify(ex).replace(/"/g,'&quot;')})">${ex}</div>`).join('')}</div>` : ''}
          <button class="btn btn-ghost btn-sm" onclick="viewSkillMd('${name}')">Ver SKILL.md</button>
        </div>`;
    }).join('');
  } catch (e) {
    grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1"><div class="empty-icon">⚠️</div><p>${e.message}</p></div>`;
  }
}

async function toggleSkill(name, enabled) {
  try {
    await apiFetch('/api/openclaw/tools', { method: 'POST', body: { tool: enabled ? 'enable_skill' : 'disable_skill', params: { skill: name } } });
    showToast(`Skill "${name}" ${enabled ? 'ativada' : 'desativada'}`, 'success');
  } catch (e) {
    showToast('Erro: ' + e.message, 'error');
  }
}

async function deleteSkill(name) {
  if (!confirm(`Remover a skill "${name}"?`)) return;
  try {
    await apiFetch(`/api/skills/${encodeURIComponent(name)}`, { method: 'DELETE' });
    showToast(`Skill "${name}" removida`, 'success');
    loadSkills();
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
    const data = await apiFetch('/api/openclaw/tools', { method: 'POST', body: { tool: 'get_skill_md', params: { skill: name } } });
    body.innerHTML = `<pre style="white-space:pre-wrap;font-size:12px;color:var(--text);line-height:1.6">${escapeHtml(data?.content || JSON.stringify(data, null, 2))}</pre>`;
  } catch (e) {
    body.innerHTML = `<p style="color:var(--danger)">Erro: ${e.message}</p>`;
  }
}

async function installSkill() {
  const input = document.getElementById('install-input');
  const btn   = document.getElementById('install-btn');
  const val   = input?.value.trim();
  if (!val) { showToast('Insira uma URL ou nome de skill', 'warning'); return; }
  btn.disabled = true; btn.textContent = 'Instalando…';
  try {
    await apiFetch('/api/openclaw/tools', { method: 'POST', body: { tool: 'clawhub_install', params: { source: val } } });
    showToast(`Skill "${val}" instalada`, 'success');
    input.value = ''; loadSkills();
  } catch (e) {
    showToast('Erro: ' + e.message, 'error');
  } finally {
    btn.disabled = false; btn.textContent = 'Instalar';
  }
}

function escapeHtml(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// ── Create Skill ──────────────────────────────────────────────────────────────

function addStep(type = 'shell', content = '') {
  const idx = skillSteps.length;
  skillSteps.push({ type, content });

  const list = document.getElementById('sk-steps-list');
  const row = document.createElement('div');
  row.className = 'step-row';
  row.dataset.idx = idx;
  row.innerHTML = `
    <select class="form-control step-type-select" onchange="skillSteps[${idx}].type=this.value;updateSkillPreview()">
      <option value="shell" ${type==='shell'?'selected':''}>Shell</option>
      <option value="api_call" ${type==='api_call'?'selected':''}>API Call</option>
      <option value="template" ${type==='template'?'selected':''}>Template</option>
    </select>
    <textarea class="form-control step-content" rows="2" placeholder="Conteúdo do step…" oninput="skillSteps[${idx}].content=this.value;updateSkillPreview()">${content}</textarea>
    <button class="btn btn-ghost btn-sm" style="color:var(--danger);padding:6px 8px;height:38px;flex-shrink:0" onclick="removeStep(${idx})">✕</button>`;
  list.appendChild(row);
  updateSkillPreview();
}

function removeStep(idx) {
  skillSteps.splice(idx, 1);
  const list = document.getElementById('sk-steps-list');
  list.innerHTML = '';
  const oldSteps = [...skillSteps];
  skillSteps = [];
  oldSteps.forEach(s => addStep(s.type, s.content));
  updateSkillPreview();
}

function updateSkillPreview() {
  const name = document.getElementById('sk-name')?.value.trim() || 'skill_name';
  const desc = document.getElementById('sk-desc')?.value.trim() || '…';
  const triggers = triggerChips ? triggerChips.getValues() : [];
  const triggersSection = triggers.length ? triggers.map(t => `- ${t}`).join('\n') : '- (nenhum)';
  let stepsSection = '';
  skillSteps.forEach((s, i) => {
    stepsSection += `\n### Step ${i+1} (${s.type})\n\`\`\`\n${s.content || '…'}\n\`\`\`\n`;
  });
  const md = `# ${name}\n\n## Descrição\n${desc}\n\n## Trigger phrases\n${triggersSection}\n\n## Comandos\n${stepsSection}`;
  const preview = document.getElementById('skill-md-preview');
  if (preview) preview.textContent = md;
}

async function saveSkill() {
  const name = document.getElementById('sk-name')?.value.trim();
  const desc = document.getElementById('sk-desc')?.value.trim();
  if (!name) { showToast('Nome da skill é obrigatório', 'warning'); return; }

  const btn = document.getElementById('btn-save-skill');
  btn.disabled = true; btn.textContent = 'Salvando…';
  try {
    await apiFetch('/api/skills/create', {
      method: 'POST',
      body: {
        name, description: desc,
        triggers: triggerChips ? triggerChips.getValues() : [],
        steps: skillSteps,
      },
    });
    showToast(`Skill "${name}" criada com sucesso`, 'success');
    closeModal('modal-create-skill');
    loadSkills();
  } catch (e) {
    showToast('Erro: ' + e.message, 'error');
  } finally {
    btn.disabled = false; btn.textContent = 'Salvar Skill';
  }
}

function openCreateSkill() {
  skillSteps = [];
  if (triggerChips) triggerChips.setValues([]);
  document.getElementById('sk-name').value = '';
  document.getElementById('sk-desc').value = '';
  document.getElementById('sk-steps-list').innerHTML = '';
  updateSkillPreview();
  openModal('modal-create-skill');
}

document.addEventListener('DOMContentLoaded', () => {
  loadSkills();
  triggerChips = initChips('sk-trigger-chips', 'sk-trigger-input', 'sk-trigger-add', updateSkillPreview);
  document.getElementById('install-btn')?.addEventListener('click', installSkill);
  document.getElementById('btn-create-skill')?.addEventListener('click', openCreateSkill);
  document.getElementById('btn-save-skill')?.addEventListener('click', saveSkill);
  document.getElementById('sk-add-step')?.addEventListener('click', () => addStep());
});
