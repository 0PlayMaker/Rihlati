// goals.js — Phase 5, second half.
// Numeric goals store current_value/target_value/unit and derive
// progress = current/target, never a stored percentage. Not every goal
// has a clean number though ("تعلم الخط العربي" doesn't), so a goal
// without a target just gets a done/not-done checkbox instead of a bar.

async function createGoal({ title, targetValue, unit, notes }) {
  return db.goals.add({
    title,
    currentValue: 0,
    targetValue: targetValue ?? null,
    unit: unit || '',
    notes: notes || '',
    done: false,
    archived: false,
    createdAt: Date.now()
  });
}
async function updateGoal(id, fields) {
  await db.goals.update(id, fields);
}
async function archiveGoal(id) {
  await db.goals.update(id, { archived: true });
}
async function getActiveGoals() {
  const all = await db.goals.toArray();
  return all.filter(g => !g.archived).sort((a, b) => a.createdAt - b.createdAt);
}

function goalProgressFraction(goal) {
  if (!goal.targetValue || goal.targetValue <= 0) return null;
  return Math.min(1, Math.max(0, goal.currentValue / goal.targetValue));
}
function isGoalDone(goal) {
  return goal.targetValue ? goal.currentValue >= goal.targetValue : !!goal.done;
}

function goalRowHtml(goal) {
  const frac = goalProgressFraction(goal);
  const done = isGoalDone(goal);
  return `
    <div class="goal-row" data-goal-id="${goal.id}">
      <div class="goal-row-top">
        <span class="goal-title ${done ? 'done' : ''}">${done ? '✅ ' : ''}${escapeHtml(goal.title)}</span>
        <button class="icon-btn goal-edit-btn" data-action="edit">✏️</button>
      </div>
      ${frac != null
        ? `<div class="mini-progress-track"><div class="mini-progress-fill" style="width:${frac * 100}%"></div></div>
           <span class="mini-progress-text">${goal.currentValue}/${goal.targetValue} ${escapeHtml(goal.unit || '')}</span>`
        : `<label class="checkbox-row"><input type="checkbox" data-action="toggle-done" ${goal.done ? 'checked' : ''}><span>تم تحقيق الهدف</span></label>`
      }
      ${goal.notes ? `<p class="goal-notes">${escapeHtml(goal.notes)}</p>` : ''}
    </div>`;
}

async function renderGoalsList(container) {
  const goals = await getActiveGoals();
  if (goals.length === 0) {
    container.innerHTML = `<div class="empty-state"><p>ما في أهداف مضافة بعد.</p></div>`;
    return;
  }
  container.innerHTML = goals.map(goalRowHtml).join('');

  container.querySelectorAll('.goal-row').forEach(row => {
    const id = Number(row.dataset.goalId);
    const editBtn = row.querySelector('[data-action="edit"]');
    if (editBtn) editBtn.addEventListener('click', () => openGoalModal({ existingId: id, onSaved: () => renderGoalsList(container) }));

    const progressBar = row.querySelector('.mini-progress-track');
    if (progressBar) progressBar.addEventListener('click', async () => {
      const goal = (await db.goals.toArray()).find(g => g.id === id);
      const input = prompt(`القيمة الحالية (${goal.unit || ''}):`, String(goal.currentValue));
      if (input === null) return;
      const n = parseFloat(input);
      if (!Number.isNaN(n) && n >= 0) { await updateGoal(id, { currentValue: n }); await renderGoalsList(container); }
    });

    const checkbox = row.querySelector('[data-action="toggle-done"]');
    if (checkbox) checkbox.addEventListener('change', async () => {
      await updateGoal(id, { done: checkbox.checked });
      await renderGoalsList(container);
    });
  });
}

async function openGoalModal({ existingId, onSaved }) {
  let existing = null;
  if (existingId) existing = (await db.goals.toArray()).find(g => g.id === existingId);
  let hasTarget = !!existing?.targetValue;

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal modal-lg">
      <h2 class="modal-title">${existing ? 'تعديل الهدف' : 'هدف جديد'}</h2>
      <label class="field-label">العنوان</label>
      <input class="text-input" id="goal-title-input" value="${escapeHtml(existing?.title || '')}" placeholder="مثلاً: قراءة القرآن كاملاً" autofocus>

      <label class="checkbox-row"><input type="checkbox" id="goal-has-target" ${hasTarget ? 'checked' : ''}><span>له هدف رقمي محدد</span></label>

      <div id="goal-target-fields" class="${hasTarget ? '' : 'hidden'}">
        <label class="field-label">الحالي</label>
        <input class="text-input" type="number" id="goal-current-input" value="${existing?.currentValue ?? 0}">
        <label class="field-label">الهدف</label>
        <input class="text-input" type="number" id="goal-target-input" value="${existing?.targetValue ?? ''}">
        <label class="field-label">الوحدة (اختياري)</label>
        <input class="text-input" id="goal-unit-input" value="${escapeHtml(existing?.unit || '')}" placeholder="مثلاً: كتاب، صفحة، كغ">
      </div>

      <label class="field-label">ملاحظات (اختياري)</label>
      <textarea class="mood-note-input" id="goal-notes-input" placeholder="تفاصيل، خطوات، تحديثات...">${escapeHtml(existing?.notes || '')}</textarea>

      <div class="modal-actions">
        ${existing ? `<button class="btn btn-danger btn-sm" id="goal-delete-btn">حذف</button>` : ''}
        <button class="btn btn-text" id="goal-cancel-btn">إلغاء</button>
        <button class="btn btn-primary" id="goal-save-btn">حفظ</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  document.getElementById('goal-has-target').addEventListener('change', (e) => {
    hasTarget = e.target.checked;
    document.getElementById('goal-target-fields').classList.toggle('hidden', !hasTarget);
  });

  document.getElementById('goal-cancel-btn').addEventListener('click', () => overlay.remove());
  const deleteBtn = document.getElementById('goal-delete-btn');
  if (deleteBtn) deleteBtn.addEventListener('click', async () => {
    if (!confirm('حذف هذا الهدف؟')) return;
    await archiveGoal(existing.id);
    overlay.remove();
    if (onSaved) onSaved();
  });

  document.getElementById('goal-save-btn').addEventListener('click', async () => {
    const title = document.getElementById('goal-title-input').value.trim();
    if (!title) return;
    const notes = document.getElementById('goal-notes-input').value.trim();
    let targetValue = null, currentValue = existing?.currentValue ?? 0, unit = '';
    if (hasTarget) {
      const t = parseFloat(document.getElementById('goal-target-input').value);
      const c = parseFloat(document.getElementById('goal-current-input').value);
      targetValue = Number.isNaN(t) ? null : t;
      currentValue = Number.isNaN(c) ? 0 : c;
      unit = document.getElementById('goal-unit-input').value.trim();
    }
    if (existing) {
      await updateGoal(existing.id, { title, notes, targetValue, currentValue, unit });
    } else {
      const newId = await createGoal({ title, targetValue, unit, notes });
      if (currentValue) await updateGoal(newId, { currentValue });
    }
    overlay.remove();
    if (onSaved) onSaved();
  });
}

// ---------- full Goals page ----------

async function renderGoalsPage(params, view) {
  view.innerHTML = `
    <div class="page-header">
      <button class="icon-btn" id="goals-back">→</button>
      <h1>الأهداف</h1>
    </div>
    <div class="card">
      <div id="goals-list"></div>
      <button class="btn btn-secondary btn-block" id="add-goal-btn">+ هدف جديد</button>
    </div>
  `;
  document.getElementById('goals-back').addEventListener('click', () => history.back());
  const listEl = document.getElementById('goals-list');
  await renderGoalsList(listEl);
  document.getElementById('add-goal-btn').addEventListener('click', () => {
    openGoalModal({ onSaved: () => renderGoalsList(listEl) });
  });
}

function goalsGlanceText(goals) {
  if (goals.length === 0) return 'أضيفي هدفك الأول';
  const doneCount = goals.filter(isGoalDone).length;
  return `${goals.length} ${goals.length === 1 ? 'هدف' : 'أهداف'}${doneCount > 0 ? ` · ✅${doneCount}` : ''}`;
}

// ---------- Yearly stats provider ----------
// A current-status snapshot, not a per-year event count (a goal from
// last year that's still in progress is still worth seeing) — so this
// ignores the `year` argument on purpose and contributes no count to
// the yearly grand total, which represents things that happened in
// that specific year.

async function goalsYearlyProvider(year) {
  const active = await getActiveGoals();
  if (active.length === 0) return null;
  let done = 0, inProgress = 0, notStarted = 0;
  active.forEach(g => {
    if (g.targetValue) {
      if (g.currentValue >= g.targetValue) done++;
      else if (g.currentValue > 0) inProgress++;
      else notStarted++;
    } else if (g.done) done++;
    else inProgress++;
  });
  const html = `
    <div class="yearly-row"><span>✅ منجزة</span><span>${done}</span></div>
    <div class="yearly-row"><span>🔄 قيد التقدم</span><span>${inProgress}</span></div>
    <div class="yearly-row"><span>⏳ لم تبدأ</span><span>${notStarted}</span></div>
  `;
  return { title: 'الأهداف (الحالة الحالية)', html, count: null };
}
