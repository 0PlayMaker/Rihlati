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
// Every day since creation counts as a success automatically — she no
// longer has to tap "done" daily for it to count. Only an explicit
// mishap breaks the streak. Kept as the SAME function name/shape as
// before (still {streak, succeeded, failed}) so every existing caller
// (yearly overview, Home's top-streak) picks up the new model with no
// changes needed on their end.
async function getHabitStats(habitId) {
  const habit = await db.habits.get(habitId);
  const missedDates = await getHabitMissedDates(habitId);
  const today = todayStr();
  const created = new Date(habit.createdAt).toISOString().slice(0, 10);
  const totalDays = daysBetween(created, today) + 1;
  const failed = missedDates.length;
  const succeeded = Math.max(0, totalDays - failed);
  let streak;
  if (missedDates.length === 0) {
    streak = totalDays;
  } else {
    const mostRecent = [...missedDates].sort().reverse()[0];
    streak = mostRecent < today ? daysBetween(mostRecent, today) : 0;
  }
  return { streak, succeeded, failed };
}

// ---------- live clock: time since creation or last mishap ----------
// Derived from the SAME habitLogs data the streak system already
// reads — no separate precise-timestamp field to drift out of sync.
// A slip logged for a past day counts clean time from the start of the
// day after it; a slip logged for TODAY counts from the start of today
// itself (not "tomorrow," which would show a nonsensical negative
// countup) — so right after logging a same-day slip the clock reads a
// small number of hours rather than exactly zero. `manualResetAt` is a
// deliberate small exception: "restart my counter" without it being a
// logged failure, for when she just wants a fresh start.
async function getHabitClockReferenceMs(habit) {
  const missedDates = await getHabitMissedDates(habit.id);
  let ref = habit.createdAt;
  if (missedDates.length > 0) {
    const mostRecent = [...missedDates].sort().reverse()[0];
    const missedDayStart = new Date(mostRecent + 'T00:00:00').getTime();
    ref = mostRecent < todayStr() ? missedDayStart + 24 * 60 * 60 * 1000 : missedDayStart;
  }
  if (habit.manualResetAt && habit.manualResetAt > ref) ref = habit.manualResetAt;
  return ref;
}
async function resetHabitClock(habitId) {
  await db.habits.update(habitId, { manualResetAt: Date.now() });
}

function formatHabitClock(elapsedMs) {
  if (elapsedMs < 0) elapsedMs = 0;
  const totalMinutes = Math.floor(elapsedMs / 60000);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  const parts = [];
  if (days > 0) parts.push(`${days} ${days === 1 ? 'يوم' : 'أيام'}`);
  parts.push(`${hours} ${hours === 1 ? 'ساعة' : 'ساعات'}`);
  parts.push(`${minutes} ${minutes === 1 ? 'دقيقة' : 'دقائق'}`);
  return parts.join(' ، ');
}

// A single interval updates every visible clock element in place, by
// reading its own data-ref-ms — no page re-render, so it can't disrupt
// anything she's mid-interacting with. Started once; safe to call
// again (the guard prevents stacking up duplicate intervals).
function startHabitClockTicker() {
  if (window._habitClockIntervalStarted) return;
  window._habitClockIntervalStarted = true;
  setInterval(() => {
    document.querySelectorAll('.habit-clock[data-ref-ms]').forEach(el => {
      const ref = Number(el.dataset.refMs);
      el.textContent = formatHabitClock(Date.now() - ref);
    });
  }, 30000); // every 30s is plenty for a minute-granularity display, and much lighter than every second
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
    // Auto-registered success by default (see getHabitStats) — only an
    // explicit mishap counts against today, there's no "pending" state
    // to wait on anymore.
    if (status === 'missed') missed++;
    else done++;
  }
  return { total: habits.length, done, missed, pending: 0 };
}

// ---------- rendering ----------

function habitRowHtml(habit, dateStr, status, { editable }) {
  const isBad = getHabitType(habit) === 'bad';
  return threeStateRowHtml({
    rowId: String(habit.id),
    colorClass: `habit-color-${habit.color}`,
    icon: habit.emoji,
    name: habit.name,
    status, editable,
    doneLabel: isBad ? 'امتنعت' : 'تم',
    missedLabel: isBad ? 'زلة' : 'لم يتم'
  });
}

// Day Detail only — a specific past day's record, with the full
// done/missed/undo toggle for correcting history if needed. No card, no
// live clock (a "time since" reading doesn't mean anything out of
// today's context), no kebab (editing a habit's definition isn't a
// per-date action).
async function renderHabitRowsInto(container, habits, dateStr, { editable, onChange, emptyText } = {}) {
  if (habits.length === 0) {
    container.innerHTML = emptyText ? `<p class="empty-state-sub">${emptyText}</p>` : '';
    return;
  }
  const rows = await Promise.all(habits.map(async h => {
    const status = await getHabitStatus(h.id, dateStr);
    return habitRowHtml(h, dateStr, status, { editable });
  }));
  container.innerHTML = rows.join('');

  wireThreeStateRows(container, async (rowId, action) => {
    const habitId = Number(rowId);
    if (action === 'done') await setHabitStatus(habitId, dateStr, 'done');
    else if (action === 'missed') await setHabitStatus(habitId, dateStr, 'missed');
    else if (action === 'undo') await clearHabitStatus(habitId, dateStr);
    await renderHabitRowsInto(container, habits, dateStr, { editable, onChange, emptyText });
    if (onChange) onChange();
  });
}

// ---------- habit cards (Home + full Habits page) ----------
// "Register a heart automatically": every day since creation counts as
// a success on its own (see getHabitStats) — she only needs to act when
// something goes wrong. So the card has exactly one action button:
// log today as a slip, or undo it if she tapped by mistake. No daily
// done-tap anywhere in this flow.

function habitCardHtml(habit, todayStatus, stats, refMs) {
  const isBad = getHabitType(habit) === 'bad';
  const missedToday = todayStatus === 'missed';
  const mishapLabel = isBad ? '⚠️ حدثت زلة' : '❌ فاتني اليوم';
  return `
    <div class="habit-card" data-row-id="${habit.id}">
      <div class="habit-card-top">
        <span class="habit-card-icon">${habit.emoji}</span>
        <span class="habit-card-name">${escapeHtml(habit.name)}</span>
        ${kebabMenuHtml(String(habit.id), [
          { key: 'edit', label: 'تعديل' },
          { key: 'reset-clock', label: 'إعادة تعيين العداد' },
          { key: 'delete', label: 'حذف', danger: true }
        ])}
      </div>
      <div class="habit-clock-row">
        <span class="habit-clock-icon">⏱️</span>
        <span class="habit-clock" data-ref-ms="${refMs}">${formatHabitClock(Date.now() - refMs)}</span>
      </div>
      <p class="habit-card-stats">${statsLine(stats)}</p>
      ${missedToday
        ? `<button class="btn btn-text btn-block" data-habit-undo="${habit.id}">↩️ تراجع عن زلة اليوم</button>`
        : `<button class="btn btn-secondary btn-block habit-mishap-btn" data-habit-mishap="${habit.id}">${mishapLabel}</button>`}
    </div>`;
}

async function renderHabitCards(container, habits, { onChange, emptyText } = {}) {
  if (habits.length === 0) {
    container.innerHTML = emptyText ? `<p class="empty-state-sub">${emptyText}</p>` : '';
    return;
  }
  const today = todayStr();
  const rows = await Promise.all(habits.map(async h => {
    const status = await getHabitStatus(h.id, today);
    const stats = await getHabitStats(h.id);
    const refMs = await getHabitClockReferenceMs(h);
    return habitCardHtml(h, status, stats, refMs);
  }));
  container.innerHTML = rows.join('');

  async function refresh() {
    await renderHabitCards(container, habits, { onChange, emptyText });
    if (onChange) onChange();
  }

  container.querySelectorAll('[data-habit-mishap]').forEach(btn => {
    btn.addEventListener('click', async () => {
      await setHabitStatus(Number(btn.dataset.habitMishap), today, 'missed');
      await refresh();
    });
  });
  container.querySelectorAll('[data-habit-undo]').forEach(btn => {
    btn.addEventListener('click', async () => {
      await clearHabitStatus(Number(btn.dataset.habitUndo), today);
      await refresh();
    });
  });
  wireKebabMenus(container, async (rowId, action) => {
    const habitId = Number(rowId);
    if (action === 'edit') {
      openHabitModal({ existingId: habitId, onSaved: refresh });
    } else if (action === 'reset-clock') {
      const habit = habits.find(h => h.id === habitId);
      if (!confirm(`إعادة تعيين عداد "${habit.name}"؟ هذا لا يسجّل زلة، فقط يبدأ العدّ من الآن.`)) return;
      await resetHabitClock(habitId);
      await refresh();
    } else if (action === 'delete') {
      const habit = habits.find(h => h.id === habitId);
      if (!confirm(`حذف "${habit.name}"؟ سجل السجلات السابقة يبقى محفوظاً.`)) return;
      await archiveHabit(habitId);
      await refresh();
    }
  });
  startHabitClockTicker();
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
    await renderHabitCards(goodEl, good, { onChange: refreshBoth, emptyText: 'ما في عادات جيدة مضافة بعد.' });
    await renderHabitCards(badEl, bad, { onChange: refreshBoth, emptyText: 'ما في عادات مضافة للإقلاع عنها بعد.' });
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
    const today = todayStr();
    const rows = await Promise.all(list.map(async h => {
      const logs = await db.habitLogs.where('habitId').equals(h.id).toArray();
      const missed = logs.filter(l => l.status === 'missed' && l.date.startsWith(prefix)).length;
      // Auto-success days within this year specifically: the days this
      // habit actually existed during that year, minus explicit misses —
      // matching getHabitStats' model instead of counting explicit
      // "done" taps, which aren't expected under the auto-register model.
      const yearStart = `${year}-01-01`, yearEnd = `${year}-12-31`;
      const created = new Date(h.createdAt).toISOString().slice(0, 10);
      const rangeStart = created > yearStart ? created : yearStart;
      const rangeEnd = today < yearEnd ? today : yearEnd;
      if (rangeStart > rangeEnd) return '';
      const daysInRange = daysBetween(rangeStart, rangeEnd) + 1;
      const done = Math.max(0, daysInRange - missed);
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
