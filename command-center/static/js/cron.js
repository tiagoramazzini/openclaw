// ── Cron scheduler ────────────────────────────────────────────────────────────

let selectedExpr = 'daily';

async function loadJobs() {
  const tbody = document.getElementById('cron-table-body');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:24px"><div class="spinner" style="margin:auto"></div></td></tr>';

  try {
    const jobs = await apiFetch('/api/cron');
    if (!jobs.length) {
      tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--muted);padding:32px">Nenhuma tarefa agendada. Clique em "+ Nova tarefa" para começar.</td></tr>';
      return;
    }
    tbody.innerHTML = jobs.map(j => {
      const statusBadge = j.last_status
        ? (j.last_status.startsWith('error')
            ? `<span class="badge badge-danger">${j.last_status.slice(0,30)}</span>`
            : `<span class="badge badge-positive">${j.last_status}</span>`)
        : '<span class="badge badge-muted">—</span>';
      return `
        <tr>
          <td><strong>${j.name}</strong></td>
          <td>${j.agent_id || '—'}</td>
          <td style="max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${j.prompt}">${j.prompt}</td>
          <td><code style="font-size:11px;background:var(--bg);padding:2px 6px;border-radius:4px">${j.cron_expr}</code></td>
          <td>${j.next_run ? fmtDate(j.next_run) : '—'}</td>
          <td>
            ${statusBadge}
            <label class="toggle" style="margin-left:8px;vertical-align:middle" title="${j.active ? 'Desativar' : 'Ativar'}">
              <input type="checkbox" ${j.active ? 'checked' : ''} onchange="toggleJob(${j.id}, this.checked)">
              <span class="toggle-slider"></span>
            </label>
          </td>
          <td>
            <div style="display:flex;gap:6px">
              <button class="btn btn-ghost btn-sm" onclick="editJob(${j.id})" title="Editar">✏️</button>
              <button class="btn btn-primary btn-sm" onclick="runNow(${j.id})" title="Executar agora">▶</button>
              <button class="btn btn-ghost btn-sm" style="color:var(--danger)" onclick="deleteJob(${j.id})" title="Remover">🗑️</button>
            </div>
          </td>
        </tr>`;
    }).join('');
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="7" style="color:var(--danger);padding:14px">Erro: ${e.message}</td></tr>`;
  }
}

async function toggleJob(id, active) {
  try {
    await apiFetch(`/api/cron/${id}`, { method: 'PATCH', body: { active } });
    showToast(`Tarefa ${active ? 'ativada' : 'pausada'}`, 'success');
    loadJobs();
  } catch (e) {
    showToast(e.message, 'error');
  }
}

async function runNow(id) {
  showToast('Executando tarefa…', 'info');
  try {
    await apiFetch(`/api/cron/${id}/run`, { method: 'POST' });
    showToast('Tarefa executada com sucesso', 'success');
    loadJobs();
  } catch (e) {
    showToast('Erro: ' + e.message, 'error');
  }
}

async function deleteJob(id) {
  if (!confirm('Remover esta tarefa agendada?')) return;
  try {
    await apiFetch(`/api/cron/${id}`, { method: 'DELETE' });
    showToast('Tarefa removida', 'success');
    loadJobs();
  } catch (e) {
    showToast(e.message, 'error');
  }
}

async function editJob(id) {
  try {
    const jobs = await apiFetch('/api/cron');
    const job = jobs.find(j => j.id === id);
    if (!job) return;
    document.getElementById('job-id').value     = job.id;
    document.getElementById('job-name').value   = job.name;
    document.getElementById('job-agent').value  = job.agent_id || '';
    document.getElementById('job-prompt').value = job.prompt;
    document.getElementById('job-active').checked = job.active;
    document.getElementById('modal-job-title').textContent = `Editar — ${job.name}`;
    selectFreq(job.cron_expr);
    openModal('modal-job');
  } catch (e) {
    showToast(e.message, 'error');
  }
}

function selectFreq(expr) {
  selectedExpr = expr;
  document.querySelectorAll('.freq-btn').forEach(btn => {
    btn.classList.toggle('btn-primary', btn.dataset.expr === expr || (expr !== 'hourly' && expr !== 'daily' && expr !== 'weekly' && expr !== 'monthly' && btn.dataset.expr === 'custom'));
    btn.classList.toggle('btn-ghost', !(btn.classList.contains('btn-primary')));
  });
  const customSection = document.getElementById('custom-cron-section');
  if (customSection) {
    customSection.style.display = (expr === 'custom' || !['hourly','daily','weekly','monthly'].includes(expr)) ? 'block' : 'none';
  }
  document.getElementById('cron-preview').textContent = expr;
}

function buildCustomCron() {
  const hour = document.getElementById('cron-hour')?.value || '9';
  const min  = document.getElementById('cron-min')?.value  || '0';
  const dows = [...document.querySelectorAll('.cron-dow:checked')].map(el => el.value);
  const dow  = dows.length ? dows.join(',') : '*';
  const expr = `${min} ${hour} * * ${dow}`;
  document.getElementById('cron-preview').textContent = expr;
  return expr;
}

async function saveJob() {
  const id    = document.getElementById('job-id')?.value;
  const name  = document.getElementById('job-name')?.value.trim();
  const agent = document.getElementById('job-agent')?.value.trim();
  const prompt = document.getElementById('job-prompt')?.value.trim();
  const active = document.getElementById('job-active')?.checked;

  if (!name || !prompt) { showToast('Nome e prompt são obrigatórios', 'warning'); return; }

  const cronExpr = selectedExpr === 'custom' ? buildCustomCron() : selectedExpr;

  const btn = document.getElementById('btn-save-job');
  btn.disabled = true; btn.textContent = 'Salvando…';

  try {
    if (id) {
      await apiFetch(`/api/cron/${id}`, {
        method: 'PATCH',
        body: { name, agent_id: agent, prompt, cron_expr: cronExpr, active },
      });
    } else {
      await apiFetch('/api/cron', {
        method: 'POST',
        body: { name, agent_id: agent, prompt, cron_expr: cronExpr, active },
      });
    }
    showToast('Tarefa salva com sucesso', 'success');
    closeModal('modal-job');
    loadJobs();
  } catch (e) {
    showToast('Erro: ' + e.message, 'error');
  } finally {
    btn.disabled = false; btn.textContent = 'Salvar tarefa';
  }
}

document.addEventListener('DOMContentLoaded', () => {
  loadJobs();

  document.getElementById('btn-new-job')?.addEventListener('click', () => {
    document.getElementById('job-id').value = '';
    document.getElementById('job-name').value = '';
    document.getElementById('job-agent').value = '';
    document.getElementById('job-prompt').value = '';
    document.getElementById('job-active').checked = true;
    document.getElementById('modal-job-title').textContent = 'Nova tarefa agendada';
    selectFreq('daily');
    openModal('modal-job');
  });

  document.getElementById('btn-save-job')?.addEventListener('click', saveJob);

  document.querySelectorAll('.freq-btn').forEach(btn => {
    btn.addEventListener('click', () => selectFreq(btn.dataset.expr));
  });

  ['cron-hour','cron-min'].forEach(id => {
    document.getElementById(id)?.addEventListener('input', buildCustomCron);
  });
  document.querySelectorAll('.cron-dow').forEach(cb => cb.addEventListener('change', buildCustomCron));

  visiblePolling(loadJobs, 30000);
});
