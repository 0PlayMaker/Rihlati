// habits.js — long-term tracked behaviors with streaks + relapse.
// Two kinds, same underlying engine:
//   'good' — a habit she's building. ❤️ = did it, 💔 = missed it.
//   'bad'  — a habit she's quitting. ❤️ = abstained, 💔 = slipped.
// The streak engine doesn't need to know which is which — a 'done' day
// is just a 'done' day either way, so streaks.js is untouched. Only the
// button labels and which section a row appears under change.
// `habit.type` is undefined on habits created before this existed;
// getHabitType() treats that as 'good', matching how they behaved.

const HABIT_COLORS = ['pink', 'blue', 'mint', 'yellow', 'lavender'];

function getHabitType(habit) {
  return habit.type === 'bad' ? 'bad' : 'good';
}

async function createHabit(name, emoji, type) {
  const all = await db.habits.toArray();
  const color = HABIT_COLORS[all.length % HABIT_COLORS.length];
  await db.habits.add({
    name, emoji: emoji || '🌟', color, type: type === 'bad' ? 'bad' : 'good',
    archived: false, order: all.length, createdAt: Date.now()
  });
}
async function updateHabit(id, { name, emoji, type }) {
  await db.habits.update(id, { name, emoji: emoji || '🌟', type: type === 'bad' ? 'bad' : 'good' });
}

async function getActiveHabits() {
  const all = await db.habits.toArray();
  return all.filter(h => !h.archived).sort((a, b) => a.order - b.order);
}
async function getActiveHabitsByType(type) {
  const all = await getActiveHabits();
  return all.filter(h => getHabitType(h) === type);
}

async function archiveHabit(id) {
  await db.habits.update(id, { archived: true });
}

async function getHabitStatus(habitId, date) {
  const row = await getLog(db.habitLogs, 'habitId', habitId, date);
  return row ? row.status : null; // 'done' | 'missed' | null (unmarked)
}
async function setHabitStatus(habitId, date, status) {
  await upsertLog(db.habitLogs, 'habitId', habitId, date, { status });
}
async function clearHabitStatus(habitId, date) {
  await deleteLog(db.habitLogs, 'habitId', habitId, date);
}
async function getHabitDoneDates(habitId) {
  const logs = await db.habitLogs.where('habitId').equals(habitId).toArray();
  return logs.filter(l => l.status === 'done').map(l => l.date);
}
async function getHabitMissedDates(habitId) {
  const logs = await db.habitLogs.where('habitId').equals(habitId).toArray();
  return logs.filter(l => l.status === 'missed').map(l => l.date);
}
async function getHabitStats(habitId) {
  const [doneDates, missedDates] = await Promise.all([getHabitDoneDates(habitId), getHabitMissedDates(habitId)]);
  return computeStreakStats(doneDates, missedDates, []); // Habits don't use pauses
}

// Best current streak within one type — used for Home's "top streaks"
// summary. Returns null if there are no habits of that type, or if
// none currently has a streak going.
async function getTopHabitStreak(type) {
  const habits = await getActiveHabitsByType(type);
  let best = null;
  for (const h of habits) {
    const stats = await getHabitStats(h.id);
    if (stats.streak > 0 && (!best || stats.streak > best.streak)) {
      best = { name: h.name, emoji: h.emoji, streak: stats.streak };
    }
  }
  return best;
}

async function getHabitsRingData() {
  // Combined across both types on purpose — the Home ring is a single
  // "how am I doing today" signal; the full Habits page is where the
  // good/bad breakdown actually matters.
  const habits = await getActiveHabits();
  const today = todayStr();
  let done = 0, missed = 0;
  for (const h of habits) {
    const status = await getHabitStatus(h.id, today);
    if (status === 'done') done++;
    else if (status === 'missed') missed++;
  }
  return { total: habits.length, done, missed, pending: habits.length - done - missed };
}

// ---------- rendering ----------

function habitRowHtml(habit, dateStr, status, { editable, showStreak, stats }) {
  const isBad = getHabitType(habit) === 'bad';
  const extra = showStreak ? `
    <div class="row-actions">
      <button class="icon-btn" data-habit-action="edit">✏️</button>
      <button class="icon-btn icon-btn-danger" data-habit-action="delete">🗑️</button>
    </div>` : '';
  return threeStateRowHtml({
    rowId: String(habit.id),
    colorClass: `habit-color-${habit.color}`,
    icon: habit.emoji,
    name: habit.name,
    status, editable, showStreak, stats, extra,
    doneLabel: isBad ? 'امتنعت' : 'تم',
    missedLabel: isBad ? 'زلة' : 'لم يتم'
  });
}

// Renders an already-filtered list of habits into `container`. Both the
// good and bad sections call this with their own subset, so there's one
// code path for "mark done/missed/undo" regardless of type.
async function renderHabitRowsInto(container, habits, dateStr, { editable, showStreak, onChange, emptyText } = {}) {
  if (habits.length === 0) {
    container.innerHTML = emptyText ? `<p class="empty-state-sub">${emptyText}</p>` : '';
    return;
  }
  const rows = await Promise.all(habits.map(async h => {
    const status = await getHabitStatus(h.id, dateStr);
    const stats = showStreak ? await getHabitStats(h.id) : null;
    return habitRowHtml(h, dateStr, status, { editable, showStreak, stats });
  }));
  container.innerHTML = rows.join('');

  async function refresh() {
    await renderHabitRowsInto(container, habits, dateStr, { editable, showStreak, onChange, emptyText });
    if (onChange) onChange();
  }

  wireThreeStateRows(container, async (rowId, action) => {
    const habitId = Number(rowId);
    if (action === 'done') await setHabitStatus(habitId, dateStr, 'done');
    else if (action === 'missed') await setHabitStatus(habitId, dateStr, 'missed');
    else if (action === 'undo') await clearHabitStatus(habitId, dateStr);
    await refresh();
  });

  container.querySelectorAll('[data-habit-action="edit"]').forEach(btn => {
    const habitId = Number(btn.closest('.tsr-row').dataset.rowId);
    btn.addEventListener('click', () => openHabitModal({ existingId: habitId, onSaved: refresh }));
  });
  container.querySelectorAll('[data-habit-action="delete"]').forEach(btn => {
    const habitId = Number(btn.closest('.tsr-row').dataset.rowId);
    btn.addEventListener('click', async () => {
      const habit = habits.find(h => h.id === habitId);
      if (!confirm(`حذف "${habit.name}"؟ سجل السجلات السابقة يبقى محفوظاً.`)) return;
      await archiveHabit(habitId);
      await refresh();
    });
  });
}

// Home preview — flat, mixed, limited. Full breakdown lives on the
// dedicated page; this is just a taste.
async function renderHabitList(container, dateStr, { editable, showStreak, limit, onChange } = {}) {
  const habits = await getActiveHabits();
  const shown = limit ? habits.slice(0, limit) : habits;
  if (shown.length === 0) {
    container.innerHTML = `<div class="empty-state"><p>ما في عادات مضافة بعد.</p><p class="empty-state-sub">ابدئي بعادة صغيرة، مثل شرب الماء أو المشي.</p></div>`;
    return;
  }
  await renderHabitRowsInto(container, shown, dateStr, { editable, showStreak, onChange });
}

function openHabitModal({ existingId, onSaved } = {}) {
  let existing = null;
  let selectedType = 'good';
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal">
      <h2 class="modal-title" id="habit-modal-title">عادة جديدة</h2>
      <label class="field-label">نوع العادة</label>
      <div class="habit-type-chips" id="habit-type-chips">
        <button class="chip active" data-type="good">🌱 أبنيها</button>
        <button class="chip" data-type="bad">🚫 أقلع عنها</button>
      </div>
      <label class="field-label">اسم العادة</label>
      <input class="text-input" id="new-habit-name" placeholder="مثلاً: شرب الماء" autofocus>
      <label class="field-label">إيموجي (اختياري)</label>
      <input class="text-input emoji-input" id="new-habit-emoji" placeholder="🌟" maxlength="2">
      <div class="modal-actions">
        ${existingId ? `<button class="btn btn-danger btn-sm" id="habit-delete-btn">حذف</button>` : ''}
        <button class="btn btn-text" id="new-habit-cancel">إلغاء</button>
        <button class="btn btn-primary" id="new-habit-save">${existingId ? 'حفظ' : 'إضافة'}</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  async function applyExisting() {
    if (!existingId) return;
    existing = (await db.habits.toArray()).find(h => h.id === existingId);
    if (!existing) return;
    selectedType = getHabitType(existing);
    document.getElementById('habit-modal-title').textContent = 'تعديل العادة';
    document.getElementById('new-habit-name').value = existing.name;
    document.getElementById('new-habit-emoji').value = existing.emoji;
    overlay.querySelectorAll('#habit-type-chips .chip').forEach(c => c.classList.toggle('active', c.dataset.type === selectedType));
  }

  overlay.querySelectorAll('#habit-type-chips .chip').forEach(chip => {
    chip.addEventListener('click', () => {
      selectedType = chip.dataset.type;
      overlay.querySelectorAll('#habit-type-chips .chip').forEach(c => c.classList.toggle('active', c.dataset.type === selectedType));
    });
  });

  document.getElementById('new-habit-cancel').addEventListener('click', () => overlay.remove());
  const deleteBtn = document.getElementById('habit-delete-btn');
  if (deleteBtn) deleteBtn.addEventListener('click', async () => {
    if (!confirm('حذف هذه العادة؟ سجل السجلات السابقة يبقى محفوظاً.')) return;
    await archiveHabit(existingId);
    overlay.remove();
    if (onSaved) onSaved();
  });
  document.getElementById('new-habit-save').addEventListener('click', async () => {
    const name = document.getElementById('new-habit-name').value.trim();
    if (!name) return;
    const emoji = document.getElementById('new-habit-emoji').value.trim();
    if (existingId) await updateHabit(existingId, { name, emoji, type: selectedType });
    else await createHabit(name, emoji, selectedType);
    overlay.remove();
    if (onSaved) onSaved();
  });

  applyExisting();
}

// ---------- full Habits page ----------

async function renderHabitsPage(params, view) {
  view.innerHTML = `
    <div class="page-header">
      <button class="icon-btn" id="habits-back">→</button>
      <h1>العادات</h1>
    </div>
    <div class="card">
      <h2 class="card-title">🌱 عادات جيدة</h2>
      <div id="good-habits-list"></div>
    </div>
    <div class="card">
      <h2 class="card-title">🚫 عادات أقلع عنها</h2>
      <div id="bad-habits-list"></div>
    </div>
    <div class="card">
      <button class="btn btn-secondary btn-block" id="add-habit-btn">+ عادة جديدة</button>
    </div>
    <p class="motivation-line">${escapeHtml(pickHabitMotivation())}</p>
  `;
  document.getElementById('habits-back').addEventListener('click', () => history.back());

  const goodEl = document.getElementById('good-habits-list');
  const badEl = document.getElementById('bad-habits-list');
  const today = todayStr();

  async function refreshBoth() {
    const good = await getActiveHabitsByType('good');
    const bad = await getActiveHabitsByType('bad');
    await renderHabitRowsInto(goodEl, good, today, { editable: true, showStreak: true, onChange: refreshBoth, emptyText: 'ما في عادات جيدة مضافة بعد.' });
    await renderHabitRowsInto(badEl, bad, today, { editable: true, showStreak: true, onChange: refreshBoth, emptyText: 'ما في عادات مضافة للإقلاع عنها بعد.' });
  }
  await refreshBoth();

  document.getElementById('add-habit-btn').addEventListener('click', () => {
    openHabitModal({ onSaved: refreshBoth });
  });
}

// ---------- Day Detail provider ----------

async function habitsDayProvider(dateStr) {
  const good = await getActiveHabitsByType('good');
  const bad = await getActiveHabitsByType('bad');
  if (good.length === 0 && bad.length === 0) return null;
  const editable = !isFutureDate(dateStr);

  const node = document.createElement('div');
  const goodWrap = document.createElement('div');
  const badWrap = document.createElement('div');

  if (good.length > 0) {
    const goodHeader = document.createElement('h4');
    goodHeader.className = 'day-detail-subsection-title';
    goodHeader.textContent = '🌱 عادات جيدة';
    node.appendChild(goodHeader);
    node.appendChild(goodWrap);
  }
  if (bad.length > 0) {
    const badHeader = document.createElement('h4');
    badHeader.className = 'day-detail-subsection-title';
    badHeader.textContent = '🚫 عادات أقلع عنها';
    node.appendChild(badHeader);
    node.appendChild(badWrap);
  }

  async function refresh() {
    if (good.length > 0) await renderHabitRowsInto(goodWrap, good, dateStr, { editable, onChange: refresh });
    if (bad.length > 0) await renderHabitRowsInto(badWrap, bad, dateStr, { editable, onChange: refresh });
  }
  await refresh();

  return { title: 'العادات', node };
}

// ---------- Yearly stats provider ----------

async function habitsYearlyProvider(year) {
  const habits = await getActiveHabits();
  if (habits.length === 0) return null;
  const prefix = String(year);

  async function summarize(list) {
    let total = 0;
    const rows = await Promise.all(list.map(async h => {
      const logs = await db.habitLogs.where('habitId').equals(h.id).toArray();
      const yearLogs = logs.filter(l => l.date.startsWith(prefix));
      const done = yearLogs.filter(l => l.status === 'done').length;
      const missed = yearLogs.filter(l => l.status === 'missed').length;
      total += done;
      return done + missed > 0 ? `<div class="yearly-row"><span>${h.emoji} ${escapeHtml(h.name)}</span><span>${done} ❤️ · ${missed} 💔</span></div>` : '';
    }));
    return { html: rows.join(''), total };
  }

  const good = await summarize(await getActiveHabitsByType('good'));
  const bad = await summarize(await getActiveHabitsByType('bad'));
  if (!good.html && !bad.html) return null;

  const html = `
    ${good.html ? `<h4 class="yearly-subsection-title">🌱 عادات جيدة</h4>${good.html}` : ''}
    ${bad.html ? `<h4 class="yearly-subsection-title">🚫 عادات أقلع عنها</h4>${bad.html}` : ''}
  `;
  return { title: 'العادات', html, count: good.total + bad.total };
}
