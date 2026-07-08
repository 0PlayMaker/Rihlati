// goals.js — Phase 5, second half.
// Three progress types: checkbox (done/not), numeric (current/target/
// unit, progress derived — never a stored percentage), and percentage
// (a plain 0-100 slider when there's no clean unit to attach a number
// to, just a felt sense of "how far along"). Old goals created before
// percentage existed have no progressType field — effectiveProgressType
// derives it from what they already have, so nothing breaks.

async function createGoal({ title, progressType, targetValue, unit, notes }) {
  return db.goals.add({
    title,
    progressType: progressType || 'checkbox',
    currentValue: 0,
    targetValue: progressType === 'percentage' ? 100 : (targetValue ?? null),
    unit: progressType === 'percentage' ? '%' : (unit || ''),
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

function effectiveProgressType(goal) {
  if (goal.progressType) return goal.progressType;
  return goal.targetValue ? 'numeric' : 'checkbox'; // old goals, before percentage existed
}
function goalProgressFraction(goal) {
  const type = effectiveProgressType(goal);
  if (type === 'checkbox') return null;
  const target = type === 'percentage' ? 100 : goal.targetValue;
  if (!target || target <= 0) return null;
  return Math.min(1, Math.max(0, goal.currentValue / target));
}
function isGoalDone(goal) {
  const type = effectiveProgressType(goal);
  if (type === 'checkbox') return !!goal.done;
  const target = type === 'percentage' ? 100 : goal.targetValue;
  return target ? goal.currentValue >= target : false;
}

function goalRowHtml(goal) {
  const type = effectiveProgressType(goal);
  const done = isGoalDone(goal);
  let progressHtml;
  if (type === 'percentage') {
    progressHtml = `
      <input type="range" class="goal-slider" min="0" max="100" value="${goal.currentValue}" data-action="slide">
      <span class="mini-progress-text goal-slider-label">${goal.currentValue}%</span>`;
  } else if (type === 'numeric') {
    const frac = goalProgressFraction(goal) || 0;
    progressHtml = `
      <div class="mini-progress-track" data-action="tap-progress"><div class="mini-progress-fill" style="width:${frac * 100}%"></div></div>
      <span class="mini-progress-text">${goal.currentValue}/${goal.targetValue} ${escapeHtml(goal.unit || '')}</span>`;
  } else {
    progressHtml = `<label class="checkbox-row"><input type="checkbox" data-action="toggle-done" ${goal.done ? 'checked' : ''}><span>تم تحقيق الهدف</span></label>`;
  }
  return `
    <div class="goal-row" data-goal-id="${goal.id}">
      <div class="goal-row-top">
        <span class="goal-title ${done ? 'done' : ''}">${done ? '✅ ' : ''}${escapeHtml(goal.title)}</span>
        <button class="icon-btn goal-edit-btn" data-action="edit">✏️</button>
      </div>
      ${progressHtml}
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

    const progressBar = row.querySelector('[data-action="tap-progress"]');
    if (progressBar) progressBar.addEventListener('click', async () => {
      const goal = (await db.goals.toArray()).find(g => g.id === id);
      const input = prompt(`القيمة الحالية (${goal.unit || ''}):`, String(goal.currentValue));
      if (input === null) return;
      const n = parseFloat(input);
      if (!Number.isNaN(n) && n >= 0) { await updateGoal(id, { currentValue: n }); await renderGoalsList(container); }
    });

    const slider = row.querySelector('[data-action="slide"]');
    if (slider) {
      const label = row.querySelector('.goal-slider-label');
      slider.addEventListener('input', () => { label.textContent = `${slider.value}%`; });
      slider.addEventListener('change', async () => {
        await updateGoal(id, { currentValue: Number(slider.value) });
        await renderGoalsList(container); // refresh so ✅/done styling updates if it just hit 100
      });
    }

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
  let selectedType = existing ? effectiveProgressType(existing) : 'checkbox';

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal modal-lg">
      <h2 class="modal-title">${existing ? 'تعديل الهدف' : 'هدف جديد'}</h2>
      <label class="field-label">العنوان</label>
      <input class="text-input" id="goal-title-input" value="${escapeHtml(existing?.title || '')}" placeholder="مثلاً: قراءة القرآن كاملاً" autofocus>

      <label class="field-label">نوع التتبع</label>
      <div class="habit-type-chips" id="goal-type-chips">
        <button class="chip ${selectedType === 'checkbox' ? 'active' : ''}" data-type="checkbox">✅ بسيط</button>
        <button class="chip ${selectedType === 'numeric' ? 'active' : ''}" data-type="numeric">🔢 رقمي</button>
        <button class="chip ${selectedType === 'percentage' ? 'active' : ''}" data-type="percentage">🎚️ نسبة</button>
      </div>

      <div id="goal-numeric-fields" class="${selectedType === 'numeric' ? '' : 'hidden'}">
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

  overlay.querySelectorAll('#goal-type-chips .chip').forEach(chip => {
    chip.addEventListener('click', () => {
      selectedType = chip.dataset.type;
      overlay.querySelectorAll('#goal-type-chips .chip').forEach(c => c.classList.toggle('active', c.dataset.type === selectedType));
      document.getElementById('goal-numeric-fields').classList.toggle('hidden', selectedType !== 'numeric');
    });
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
    if (selectedType === 'numeric') {
      const t = parseFloat(document.getElementById('goal-target-input').value);
      const c = parseFloat(document.getElementById('goal-current-input').value);
      targetValue = Number.isNaN(t) ? null : t;
      currentValue = Number.isNaN(c) ? 0 : c;
      unit = document.getElementById('goal-unit-input').value.trim();
    } else if (selectedType === 'percentage') {
      targetValue = 100;
      unit = '%';
      currentValue = existing && effectiveProgressType(existing) === 'percentage' ? existing.currentValue : 0;
    }

    if (existing) {
      await updateGoal(existing.id, { title, notes, progressType: selectedType, targetValue, currentValue, unit });
    } else {
      const newId = await createGoal({ title, progressType: selectedType, targetValue, unit, notes });
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

// Status breakdown by type (numeric/percentage: done at 100%, in
// progress if >0, not started at 0; checkbox: done or in-progress —
// same categorization goalsYearlyProvider already uses) — shown as a
// compact breakdown rather than a bare count, since a flat "3 goals"
// doesn't say anything about how they're actually going.
function goalsGlanceText(goals) {
  if (goals.length === 0) return 'أضيفي هدفك الأول';
  let done = 0, inProgress = 0, notStarted = 0;
  goals.forEach(g => {
    if (isGoalDone(g)) done++;
    else if (effectiveProgressType(g) !== 'checkbox' && g.currentValue > 0) inProgress++;
    else if (effectiveProgressType(g) === 'checkbox') inProgress++;
    else notStarted++;
  });
  const parts = [];
  if (done > 0) parts.push(`✅${done}`);
  if (inProgress > 0) parts.push(`🔄${inProgress}`);
  if (notStarted > 0) parts.push(`⏳${notStarted}`);
  return `${goals.length} ${goals.length === 1 ? 'هدف' : 'أهداف'} · ${parts.join(' ')}`;
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
    if (isGoalDone(g)) done++;
    else if (effectiveProgressType(g) !== 'checkbox' && g.currentValue > 0) inProgress++;
    else if (effectiveProgressType(g) === 'checkbox') inProgress++;
    else notStarted++;
  });
  const html = `
    <div class="yearly-row"><span>✅ منجزة</span><span>${done}</span></div>
    <div class="yearly-row"><span>🔄 قيد التقدم</span><span>${inProgress}</span></div>
    <div class="yearly-row"><span>⏳ لم تبدأ</span><span>${notStarted}</span></div>
  `;
  return { title: 'الأهداف (الحالة الحالية)', html, count: null };
}
