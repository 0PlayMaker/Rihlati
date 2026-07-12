// goals.js — Phase 5, second half.
// Three progress types: checkbox (done/not), numeric (current/target/
// unit, progress derived — never a stored percentage), and percentage
// (a plain 0-100 slider). Numeric goals store an explicit `direction`
// ('up' or 'down') plus a `startValue`, computed once at creation and
// never silently recomputed — "lose weight to 50 from 67" needs
// current <= target to count as done, and progress needs to be
// measured against where she started, not current/target directly
// (67/50 is meaningless as a fraction). Old goals with no direction
// field default to 'up', matching how they already behaved.

function computeGoalDirection(startValue, targetValue) {
  return startValue > targetValue ? 'down' : 'up';
}

async function createGoal({ title, progressType, targetValue, unit, notes, currentValue, targetDate }) {
  const cv = currentValue ?? 0;
  const isNumeric = progressType === 'numeric' && targetValue != null;
  return db.goals.add({
    title,
    progressType: progressType || 'checkbox',
    currentValue: cv,
    startValue: isNumeric ? cv : null,
    direction: isNumeric ? computeGoalDirection(cv, targetValue) : 'up',
    targetValue: progressType === 'percentage' ? 100 : (targetValue ?? null),
    unit: progressType === 'percentage' ? '%' : (unit || ''),
    notes: notes || '',
    targetDate: targetDate || null,
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
// Ordering mirrors what the shopping list already does (`done` sinks):
// finished goals drop to the bottom instead of squatting at the top just
// because they're old, and among the unfinished the closest-to-done
// surface first — that's the one worth a final push today. Creation date
// is only the tiebreak now, not the whole rule.
async function getActiveGoals() {
  const all = await db.goals.toArray();
  return all.filter(g => !g.archived).sort((a, b) => {
    const aDone = isGoalComplete(a) ? 1 : 0;
    const bDone = isGoalComplete(b) ? 1 : 0;
    if (aDone !== bDone) return aDone - bDone;            // done sinks
    const aFrac = goalProgressFraction(a);
    const bFrac = goalProgressFraction(b);
    // Checkbox goals have no fraction — keep them with the ordinary
    // group rather than inventing a progress number for them.
    if (aFrac != null && bFrac != null && aFrac !== bFrac) return bFrac - aFrac; // closest to done first
    if (aFrac != null && bFrac == null) return -1;
    if (aFrac == null && bFrac != null) return 1;
    return a.createdAt - b.createdAt;                      // stable tiebreak
  });
}

// A goal counts as complete when a checkbox goal is checked, or a
// measurable goal has reached 100%.
function isGoalComplete(goal) {
  if (effectiveProgressType(goal) === 'checkbox') return !!goal.done;
  const frac = goalProgressFraction(goal);
  return frac != null && frac >= 1;
}

function effectiveProgressType(goal) {
  if (goal.progressType) return goal.progressType;
  return goal.targetValue ? 'numeric' : 'checkbox'; // old goals, before percentage existed
}
function goalProgressFraction(goal) {
  const type = effectiveProgressType(goal);
  if (type === 'checkbox') return null;
  if (type === 'percentage') return Math.min(1, Math.max(0, goal.currentValue / 100));
  const target = goal.targetValue;
  if (target == null) return null;
  const direction = goal.direction || 'up';
  if (direction === 'down') {
    const start = goal.startValue ?? goal.currentValue;
    if (start <= target) return goal.currentValue <= target ? 1 : 0; // malformed data guard
    return Math.min(1, Math.max(0, (start - goal.currentValue) / (start - target)));
  }
  if (target <= 0) return null;
  return Math.min(1, Math.max(0, goal.currentValue / target));
}
function isGoalDone(goal) {
  const type = effectiveProgressType(goal);
  if (type === 'checkbox') return !!goal.done;
  const target = type === 'percentage' ? 100 : goal.targetValue;
  if (target == null) return false;
  const direction = type === 'percentage' ? 'up' : (goal.direction || 'up');
  return direction === 'down' ? goal.currentValue <= target : goal.currentValue >= target;
}

function goalRowHtml(goal) {
  const type = effectiveProgressType(goal);
  const done = isGoalDone(goal);
  const frac = type === 'checkbox' ? (goal.done ? 1 : 0) : (goalProgressFraction(goal) ?? 0);
  const pct = Math.round(frac * 100);

  const ring = renderRing({
    size: 48, strokeWidth: 6,
    segments: [{ frac, color: done ? 'var(--success-strong)' : 'var(--btn-color, var(--pink-deep))' }]
  });

  let controlHtml;
  if (type === 'percentage') {
    controlHtml = `
      <input type="range" class="goal-slider" min="0" max="100" value="${goal.currentValue}" data-action="slide">
      <span class="mini-progress-text goal-slider-label">${toArabicNumeral(goal.currentValue)}%</span>`;
  } else if (type === 'numeric' && goal.targetValue != null) {
    // A stepper beats a prompt(): logging progress is something you do
    // repeatedly, and a dialog every time makes you stop bothering.
    controlHtml = `
      <div class="goal-numeric-row">
        <div class="exercise-stepper">
          <button class="exercise-step-btn" data-action="goal-dec" aria-label="أنقص">−</button>
          <span class="exercise-step-val">${toArabicNumeral(goal.currentValue)}</span>
          <button class="exercise-step-btn" data-action="goal-inc" aria-label="زد">+</button>
        </div>
        <button class="link-btn goal-set-btn" data-action="tap-progress">تعيين رقم</button>
        <span class="goal-target-label">من ${toArabicNumeral(goal.targetValue)} ${escapeHtml(goal.unit || '')}</span>
      </div>`;
  } else {
    controlHtml = `<label class="checkbox-row"><input type="checkbox" data-action="toggle-done" ${goal.done ? 'checked' : ''}><span>تم تحقيق الهدف</span></label>`;
  }

  // Deadline: a goal with no date is a wish. If she set one, it should be
  // visible and it should get louder as it approaches.
  let deadlineHtml = '';
  if (goal.targetDate && !done) {
    const daysLeft = daysBetween(todayStr(), goal.targetDate);
    const overdue = daysLeft < 0;
    const tone = overdue ? 'danger' : daysLeft <= 7 ? 'warning' : 'neutral';
    deadlineHtml = `<span class="goal-deadline goal-deadline-${tone}">
      ${overdue ? `⚠️ تأخّر ${toArabicNumeral(Math.abs(daysLeft))} يوم` : `🎯 ${toArabicNumeral(daysLeft)} يوم`}
    </span>`;
  }

  return `
    <div class="goal-row ${done ? 'goal-done' : ''}" data-goal-id="${goal.id}">
      <div class="goal-row-top">
        <div class="goal-ring">
          ${ring}
          <span class="goal-ring-pct">${toArabicNumeral(pct)}</span>
        </div>
        <div class="goal-title-block">
          <span class="goal-title ${done ? 'done' : ''}">${done ? '✅ ' : ''}${escapeHtml(goal.title)}</span>
          ${deadlineHtml}
        </div>
        ${kebabMenuHtml(String(goal.id), [
          { key: 'edit', label: 'تعديل' },
          { key: 'delete', label: 'حذف', danger: true }
        ])}
      </div>
      ${controlHtml}
      ${goal.notes ? `<p class="goal-notes">${escapeHtml(goal.notes)}</p>` : ''}
    </div>`;
}

async function renderGoalsList(container, { limit, onChange } = {}) {
  if (!container) return; // page was replaced mid-render
  let goals = await getActiveGoals();
  if (limit) goals = goals.slice(0, limit);
  if (goals.length === 0) {
    container.innerHTML = `<div class="empty-state"><p>ما في أهداف مضافة بعد.</p></div>`;
    return;
  }
  container.innerHTML = goals.map(goalRowHtml).join('');

  wireKebabMenus(container, async (rowId, action) => {
    const id = Number(rowId);
    if (action === 'edit') {
      openGoalModal({ existingId: id, onSaved: async () => { await renderGoalsList(container, { limit, onChange }); if (onChange) await onChange(); } });
    } else if (action === 'delete') {
      if (!confirm('حذف هذا الهدف؟')) return;
      await archiveGoal(id);
      await renderGoalsList(container, { limit, onChange });
      if (onChange) await onChange();
    }
  });

  container.querySelectorAll('.goal-row').forEach(row => {
    const id = Number(row.dataset.goalId);

    const incBtn = row.querySelector('[data-action="goal-inc"]');
    if (incBtn) incBtn.addEventListener('click', async () => {
      const goal = await db.goals.get(id);
      await updateGoal(id, { currentValue: (goal.currentValue || 0) + 1 });
      await renderGoalsList(container, { limit, onChange });
      if (onChange) await onChange();
    });
    const decBtn = row.querySelector('[data-action="goal-dec"]');
    if (decBtn) decBtn.addEventListener('click', async () => {
      const goal = await db.goals.get(id);
      await updateGoal(id, { currentValue: Math.max(0, (goal.currentValue || 0) - 1) });
      await renderGoalsList(container, { limit, onChange });
      if (onChange) await onChange();
    });

    const progressBar = row.querySelector('[data-action="tap-progress"]');
    if (progressBar) progressBar.addEventListener('click', async () => {
      const goal = (await db.goals.toArray()).find(g => g.id === id);
      const input = prompt(`القيمة الحالية (${goal.unit || ''}):`, String(goal.currentValue));
      if (input === null) return;
      const n = parseNumericInput(input);
      if (n !== null && n >= 0) { await updateGoal(id, { currentValue: n }); await renderGoalsList(container, { limit, onChange });
      if (onChange) await onChange(); }
    });

    const slider = row.querySelector('[data-action="slide"]');
    if (slider) {
      const label = row.querySelector('.goal-slider-label');
      slider.addEventListener('input', () => { label.textContent = `${slider.value}%`; });
      slider.addEventListener('change', async () => {
        await updateGoal(id, { currentValue: Number(slider.value) });
        await renderGoalsList(container, { limit, onChange });
      if (onChange) await onChange();
      });
    }

    const checkbox = row.querySelector('[data-action="toggle-done"]');
    if (checkbox) checkbox.addEventListener('change', async () => {
      await updateGoal(id, { done: checkbox.checked });
      await renderGoalsList(container, { limit, onChange });
      if (onChange) await onChange();
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
        <p class="settings-note">إذا كان هدفك إنقاص رقم (مثل الوزن)، اكتبي رقماً أقل من الحالي — بيفهم تلقائياً إنك تنقصين.</p>
        <label class="field-label">الوحدة (اختياري)</label>
        <input class="text-input" id="goal-unit-input" value="${escapeHtml(existing?.unit || '')}" placeholder="مثلاً: كتاب، صفحة، كغ">
      </div>

      <label class="field-label">ملاحظات (اختياري)</label>
      <label class="field-label">موعد مستهدف (اختياري)</label>
      <input class="text-input" type="date" id="goal-date-input" value="${existing?.targetDate || ''}">
      <label class="field-label">ملاحظات</label>
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
    const targetDate = document.getElementById('goal-date-input').value || null;

    let targetValue = null, currentValue = existing?.currentValue ?? 0, unit = '';
    if (selectedType === 'numeric') {
      const t = readNumericField('goal-target-input');
      const c = readNumericField('goal-current-input');
      if (t === null) { alert('أدخلي هدفاً رقمياً صحيحاً'); return; }
      targetValue = t;
      currentValue = c === null ? 0 : c;
      unit = document.getElementById('goal-unit-input').value.trim();
    } else if (selectedType === 'percentage') {
      targetValue = 100;
      unit = '%';
      currentValue = existing && effectiveProgressType(existing) === 'percentage' ? existing.currentValue : 0;
    }

    if (existing) {
      const fields = { title, notes, targetDate, progressType: selectedType, targetValue, currentValue, unit };
      if (selectedType === 'numeric') {
        const startValue = existing.startValue ?? existing.currentValue ?? currentValue;
        fields.startValue = startValue;
        fields.direction = computeGoalDirection(startValue, targetValue);
      }
      await updateGoal(existing.id, fields);
    } else {
      await createGoal({ title, progressType: selectedType, targetValue, unit, notes, currentValue, targetDate });
    }
    overlay.remove();
    if (onSaved) onSaved();
  });
}

// ---------- full Goals page ----------

// Overall goals summary — the page previously opened straight into a list,
// so with six goals there was no way to see how you were doing overall
// without reading every row.
async function renderGoalsSummary(container) {
  if (!container) return;
  const goals = await getActiveGoals();
  if (goals.length === 0) {
    container.innerHTML = `
      <h2 class="card-title">🎯 أهدافك</h2>
      <p class="mini-progress-text">أضيفي هدفك الأول لتبدأ</p>`;
    return;
  }
  const done = goals.filter(isGoalDone).length;
  const fracs = goals.map(g => effectiveProgressType(g) === 'checkbox'
    ? (g.done ? 1 : 0)
    : (goalProgressFraction(g) ?? 0));
  const avg = fracs.reduce((s, f) => s + f, 0) / fracs.length;

  // Deadlines worth worrying about.
  const today = todayStr();
  const soon = goals.filter(g => !isGoalDone(g) && g.targetDate && daysBetween(today, g.targetDate) >= 0 && daysBetween(today, g.targetDate) <= 7);
  const overdue = goals.filter(g => !isGoalDone(g) && g.targetDate && daysBetween(today, g.targetDate) < 0);

  container.innerHTML = `
    <h2 class="card-title">🎯 أهدافك</h2>
    <div class="goals-summary">
      <div class="ring-wrap">
        ${renderRing({ size: 92, strokeWidth: 10, segments: [{ frac: avg, color: avg >= 1 ? 'var(--success-strong)' : 'var(--btn-color, var(--pink-deep))' }] })}
        <div class="ring-center-text">${toArabicNumeral(Math.round(avg * 100))}٪</div>
      </div>
      <div class="goals-summary-side">
        <div class="diary-stat-row goals-stat-row">
          <div class="diary-stat">
            <span class="diary-stat-num">${toArabicNumeral(done)}/${toArabicNumeral(goals.length)}</span>
            <span class="diary-stat-label">مكتمل</span>
          </div>
          <div class="diary-stat">
            <span class="diary-stat-num">${toArabicNumeral(goals.length - done)}</span>
            <span class="diary-stat-label">قيد العمل</span>
          </div>
        </div>
        ${overdue.length ? `<p class="goals-alert goals-alert-danger">⚠️ ${toArabicNumeral(overdue.length)} ${overdue.length === 1 ? 'هدف تأخّر' : 'أهداف تأخّرت'}</p>` : ''}
        ${soon.length ? `<p class="goals-alert goals-alert-warning">🎯 ${toArabicNumeral(soon.length)} ${soon.length === 1 ? 'هدف' : 'أهداف'} خلال أسبوع</p>` : ''}
      </div>
    </div>`;
}

async function renderGoalsPage(params, view) {
  view.innerHTML = `
    <div class="page-header">
      <button class="icon-btn" aria-label="رجوع" id="goals-back">→</button>
      <h1>الأهداف</h1>
    </div>
    <div class="card" id="goals-summary"></div>
    <div class="card">
      <div id="goals-list"></div>
      <button class="btn btn-secondary btn-block" id="add-goal-btn">+ هدف جديد</button>
    </div>
  `;
  document.getElementById('goals-back').addEventListener('click', () => history.back());
  const listEl = document.getElementById('goals-list');
  const summaryEl = document.getElementById('goals-summary');

  async function refreshAll() {
    await renderGoalsList(listEl, { onChange: () => renderGoalsSummary(summaryEl) });
    await renderGoalsSummary(summaryEl);
  }
  await refreshAll();
  document.getElementById('add-goal-btn').addEventListener('click', () => openGoalModal({ onSaved: refreshAll }));
}

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

  const fracs = active.map(g => effectiveProgressType(g) === 'checkbox'
    ? (g.done ? 1 : 0)
    : (goalProgressFraction(g) ?? 0));
  const avg = fracs.reduce((s, f) => s + f, 0) / fracs.length;
  const today = todayStr();
  const overdue = active.filter(g => !isGoalDone(g) && g.targetDate && daysBetween(today, g.targetDate) < 0).length;

  // Per-goal detail, collapsed — the counts alone don't tell you WHICH
  // goal is stalling, which is the only actionable part.
  const rows = active.map((g, i) => {
    const pct = Math.round(fracs[i] * 100);
    return `<div class="yearly-row"><span>${isGoalDone(g) ? '✅' : '🔄'} ${escapeHtml(g.title)}</span><span>${toArabicNumeral(pct)}٪</span></div>`;
  }).join('');

  const html = `
    <div class="yearly-row"><span>متوسط التقدّم</span><span>${toArabicNumeral(Math.round(avg * 100))}٪</span></div>
    <div class="yearly-row"><span>✅ منجزة</span><span>${toArabicNumeral(done)}</span></div>
    <div class="yearly-row"><span>🔄 قيد التقدم</span><span>${toArabicNumeral(inProgress)}</span></div>
    <div class="yearly-row"><span>⏳ لم تبدأ</span><span>${toArabicNumeral(notStarted)}</span></div>
    ${overdue > 0 ? `<div class="yearly-row"><span>⚠️ تجاوزت موعدها</span><span>${toArabicNumeral(overdue)}</span></div>` : ''}
    <details class="yearly-pain-details">
      <summary>كل هدف على حدة</summary>
      ${rows}
    </details>
  `;
  return { title: 'الأهداف (الحالة الحالية)', html, count: null };
}
