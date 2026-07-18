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

async function createHabit(name, emoji, type, dayGoal = null, dailyTarget = null) {
  const all = await db.habits.toArray();
  const color = HABIT_COLORS[all.length % HABIT_COLORS.length];
  return db.habits.add({
    name, emoji: emoji || '🌟', color, type: type === 'bad' ? 'bad' : 'good',
    dayGoal: dayGoal ?? null,
    dailyTarget: dailyTarget ?? null,
    archived: false, order: all.length, createdAt: Date.now()
  });
}
async function updateHabit(id, { name, emoji, type, dayGoal, dailyTarget }) {
  await db.habits.update(id, {
    name, emoji: emoji || '🌟', type: type === 'bad' ? 'bad' : 'good',
    dayGoal: dayGoal ?? null,
    dailyTarget: dailyTarget ?? null
  });
}

// The three tracking styles, derived from which optional field is set —
// no separate "mode" column to keep in sync. A counter wins if present
// (it's a fundamentally different daily question), then a day-goal, else
// the plain streak habit.
function habitKind(habit) {
  if (habit.dailyTarget && habit.dailyTarget > 0) return 'counter';
  if (habit.dayGoal && habit.dayGoal > 0) return 'daygoal';
  return 'normal';
}
async function getCounterHabits() {
  return (await getActiveHabits()).filter(h => habitKind(h) === 'counter');
}
// Non-counter habits (normal + day-goal) — the ones the main habit ring
// and cards cover.
async function getNonCounterHabits() {
  return (await getActiveHabits()).filter(h => habitKind(h) !== 'counter');
}

// ---- daily counter tallies (habitCounts table) ----
async function getHabitCount(habitId, date) {
  const row = await db.habitCounts.get([habitId, date]);
  return row?.count || 0;
}
async function setHabitCount(habitId, date, count) {
  const c = Math.max(0, Math.round(count));
  await db.habitCounts.put({ habitId, date, count: c });
  return c;
}
async function incrementHabitCount(habitId, date, delta = 1) {
  return setHabitCount(habitId, date, (await getHabitCount(habitId, date)) + delta);
}

async function getActiveHabits() {
  const all = await db.habits.toArray();
  return all.filter(h => !h.archived).sort((a, b) => a.order - b.order);
}
async function getActiveHabitsByType(type) {
  const all = await getActiveHabits();
  return all.filter(h => getHabitType(h) === type);
}

// Home shows only the habits she hasn't marked private — but "private"
// means her NAME for it doesn't appear on a screen someone might read
// over her shoulder. The ring still counts it: the ring is just numbers,
// so it gives nothing away, and a hidden habit should still be tracked
// like any other. Absent field means visible, so existing habits keep
// behaving exactly as before.
function isHabitVisibleOnHome(habit) {
  return !habit.hiddenFromHome;
}
async function getHomeVisibleHabits() {
  return (await getActiveHabits()).filter(isHabitVisibleOnHome);
}
async function setHabitHiddenFromHome(id, hidden) {
  await db.habits.update(id, { hiddenFromHome: !!hidden });
}

async function archiveHabit(id) {
  await db.habits.update(id, { archived: true });
}

async function getHabitStatus(habitId, date) {
  const row = await getLog(db.habitLogs, 'habitId', habitId, date);
  return row ? row.status : null; // 'done' | 'missed' | null (unmarked)
}
// Every habit ticked for the day.
async function celebrateIfAllHabitsDone(date) {
  if (date !== todayStr()) return;
  const r = await getHabitsRingData();
  if (r.total > 0 && r.doneCount === r.total) playEventChime('habits');
}

async function setHabitStatus(habitId, date, status) {
  await upsertLog(db.habitLogs, 'habitId', habitId, date, { status });
  if (status === 'done') await celebrateIfAllHabitsDone(date);
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

// ---------- live events: مشکلة (زلة) vs انتكاسة (relapse) ----------
// Mishaps are tracked but don't touch the clock — only a relapse
// resets it. Both are a real append-only log (not a day-unique flag),
// so multiple mishaps in one day each count toward the yearly total
// rather than collapsing into a single day-level marker.

// "فاتني اليوم" on a GOOD habit is a claim about the whole day — you can't
// miss today twice, so it's once per day. "حدثت زلة" on a BAD habit is a
// claim about a moment, and you genuinely can slip several times in one day
// (three cigarettes is three slips), so those stay append-only. Guarding
// both would have quietly broken the case the event log exists for.
async function logHabitMishap(habitId) {
  const habit = await db.habits.get(habitId);
  if (habit && getHabitType(habit) === 'good' && await hasMishapToday(habitId)) {
    return { alreadyLogged: true };
  }
  await db.habitEvents.add({ habitId, type: 'mishap', timestamp: Date.now(), date: todayStr() });
  return { alreadyLogged: false };
}
async function hasMishapToday(habitId) {
  const today = todayStr();
  const events = await db.habitEvents.where('habitId').equals(habitId).toArray();
  return events.some(e => e.type === 'mishap' && e.date === today);
}
async function logHabitRelapse(habitId) {
  await db.habitEvents.add({ habitId, type: 'relapse', timestamp: Date.now(), date: todayStr() });
}
async function undoLastHabitEvent(habitId) {
  const events = (await db.habitEvents.where('habitId').equals(habitId).toArray()).sort((a, b) => b.timestamp - a.timestamp);
  if (events.length > 0) await db.habitEvents.delete(events[0].id);
}
async function getHabitEvents(habitId) {
  return db.habitEvents.where('habitId').equals(habitId).toArray();
}

// An "attempt" is one clean run: from the habit's start (or the last
// relapse / manual reset) up to the next relapse, or up to now if it's
// the run she's currently on. Slicing the event log this way is what
// lets a relapse ZERO the visible mishap counter without destroying
// anything — the events keep their timestamps, so every past attempt
// can still be replayed with its own mishap count in the yearly view.
async function getHabitAttempts(habit) {
  const events = (await getHabitEvents(habit.id)).sort((a, b) => a.timestamp - b.timestamp);
  const relapses = events.filter(e => e.type === 'relapse');
  const mishaps = events.filter(e => e.type === 'mishap');

  const attempts = [];
  let start = habit.createdAt;
  for (const r of relapses) {
    attempts.push({
      startMs: start,
      endMs: r.timestamp,
      endedByRelapse: true,
      mishaps: mishaps.filter(m => m.timestamp >= start && m.timestamp < r.timestamp).length
    });
    start = r.timestamp;
  }
  // The run she's on right now. manualResetAt can push its start later
  // than the last relapse (the "restart without calling it a relapse"
  // escape hatch), so honour whichever is more recent.
  const liveStart = (habit.manualResetAt && habit.manualResetAt > start) ? habit.manualResetAt : start;
  attempts.push({
    startMs: liveStart,
    endMs: null,
    endedByRelapse: false,
    mishaps: mishaps.filter(m => m.timestamp >= liveStart).length
  });
  return attempts;
}

// Counts shown on the habit itself: mishaps are for the CURRENT attempt
// only (a relapse wipes the slate), relapses stay cumulative.
async function getHabitEventCounts(habitId) {
  const habit = await db.habits.get(habitId);
  const events = await getHabitEvents(habitId);
  const attempts = await getHabitAttempts(habit);
  const current = attempts[attempts.length - 1];
  return {
    mishaps: current.mishaps,
    relapses: events.filter(e => e.type === 'relapse').length
  };
}
// Every day since creation counts as a success automatically — she no
// longer has to tap "done" daily for it to count. Only a relapse
// breaks the streak (a mishap alone does not). Streak is derived from
// the exact same reference the live clock uses, so they can never
// disagree.
async function getHabitStats(habitId) {
  const habit = await db.habits.get(habitId);
  const refMs = await getHabitClockReferenceMs(habit);
  const streak = Math.floor((Date.now() - refMs) / 86400000);
  const counts = await getHabitEventCounts(habitId);
  return { streak, mishaps: counts.mishaps, relapses: counts.relapses };
}

// 💔 for mishaps (logged but doesn't break the streak), ⛔ for
// relapses (the ones that actually reset the clock).
function habitStatsLine(stats) {
  return `🔥 أيام على التوالي: ${stats.streak}&nbsp;&nbsp;·&nbsp;&nbsp;💔${stats.mishaps}&nbsp;&nbsp;·&nbsp;&nbsp;⛔${stats.relapses}`;
}

async function getHabitLongestStreakMs(habit) {
  const relapses = (await getHabitEvents(habit.id)).filter(e => e.type === 'relapse').sort((a, b) => a.timestamp - b.timestamp);
  let maxMs = 0;
  let segmentStart = habit.createdAt;
  for (const r of relapses) {
    const segmentMs = r.timestamp - segmentStart;
    if (segmentMs > maxMs) maxMs = segmentMs;
    segmentStart = r.timestamp;
  }
  const liveRefMs = await getHabitClockReferenceMs(habit);
  const ongoingMs = Date.now() - liveRefMs;
  if (ongoingMs > maxMs) maxMs = ongoingMs;
  return maxMs;
}

// ---------- live clock: time since creation or last relapse ----------
// Only relapse events move this — a plain mishap (زلة / فاتني اليوم) is
// logged and counted but deliberately leaves the clock running.
// manualResetAt is the "restart without it being a relapse" exception
// (the ⋮ menu's "إعادة تعيين العداد").
async function getHabitClockReferenceMs(habit) {
  const relapses = (await getHabitEvents(habit.id)).filter(e => e.type === 'relapse').sort((a, b) => b.timestamp - a.timestamp);
  let ref = relapses.length > 0 ? relapses[0].timestamp : habit.createdAt;
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
  if (days > 0) parts.push(`${toArabicNumeral(days)} ${days === 1 ? 'يوم' : 'أيام'}`);
  parts.push(`${toArabicNumeral(hours)} ${hours === 1 ? 'ساعة' : 'ساعات'}`);
  parts.push(`${toArabicNumeral(minutes)} ${minutes === 1 ? 'دقيقة' : 'دقائق'}`);
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
  // Home-visible only: a habit she chose to hide must not leak back onto
  // Home through the streak chip.
  const habits = (await getActiveHabitsByType(type)).filter(isHabitVisibleOnHome);
  let best = null;
  for (const h of habits) {
    const stats = await getHabitStats(h.id);
    if (stats.streak > 0 && (!best || stats.streak > best.streak)) {
      best = { name: h.name, emoji: h.emoji, streak: stats.streak };
    }
  }
  return best;
}

// The Home ring "عاداتك" — now built exactly like the مسبحة: one slice
// per habit (up to HABIT_RING_MAX), a faint track under each so the ring
// reads as a divided whole even when empty, and a fill on top. What each
// slice's fill MEANS depends on the habit's kind, so a mixed set still
// makes sense at a glance:
//   • day-goal habit → progress toward its N-day goal (shows the "days")
//   • counter habit  → today's count toward its daily target
//   • normal/quit    → full if today is clean (no slip), empty if slipped
// The centre shows how many habits are "good" right now, done/total, the
// same readout as the مسبحة.
//
// Deliberately includes habits hidden from Home: the ring is only ever
// numbers, so it reveals nothing, and a habit she keeps private should
// still count toward her day.
const HABIT_RING_MAX = 6;
async function getHabitsRingData() {
  const habits = (await getActiveHabits()).slice(0, HABIT_RING_MAX);
  const today = todayStr();
  const items = [];
  for (const h of habits) {
    const kind = habitKind(h);
    let frac = 0, done = false, detail = '';
    if (kind === 'counter') {
      const count = await getHabitCount(h.id, today);
      const target = h.dailyTarget || 1;
      frac = Math.min(1, count / target); done = count >= target;
      detail = `${toArabicNumeral(count)}/${toArabicNumeral(target)}`;
    } else if (kind === 'daygoal') {
      const stats = await getHabitStats(h.id);
      frac = Math.min(1, stats.streak / h.dayGoal); done = stats.streak >= h.dayGoal;
      detail = `${toArabicNumeral(stats.streak)}/${toArabicNumeral(h.dayGoal)} يوم`;
    } else {
      const clean = !(await hasMishapToday(h.id));
      frac = clean ? 1 : 0; done = clean;
    }
    items.push({ habit: h, kind, frac, done, detail });
  }
  return { items, doneCount: items.filter(i => i.done).length, total: items.length };
}

// The Home ring "أيام العادات" — only day-goal habits, one slice each,
// filling toward the goal. Same divided شكل as the مسبحة; centre shows
// how many have reached their goal.
async function getHabitDaysRingData() {
  const habits = (await getActiveHabits()).filter(h => habitKind(h) === 'daygoal').slice(0, HABIT_RING_MAX);
  const items = [];
  for (const h of habits) {
    const stats = await getHabitStats(h.id);
    const frac = Math.min(1, stats.streak / h.dayGoal);
    items.push({ habit: h, frac, done: stats.streak >= h.dayGoal, streak: stats.streak, dayGoal: h.dayGoal });
  }
  return { items, doneCount: items.filter(i => i.done).length, total: items.length };
}

// ---------- rendering ----------

// ---------- day-goal progress (e.g. "٩٠ يوم بدون سكّر") ----------
// She sets a target number of clean days; the tracker on the card is
// literally DIVIDED into that many segments, one per day, filling up as
// the days pass. A mishap doesn't touch this (it never touched the
// clock either) — only an انتكاسة resets it, because the day count is
// derived from the very same clock reference the relapse resets. So
// "divided per day, mishap counts but doesn't reset, انتكاسة zeroes it"
// all falls out of the existing clock model for free.
//
// Individual pips are drawn up to a cap (a 90-day goal as 90 pips is
// motivating; a 3000-day goal as 3000 pips is not) — past the cap it
// falls back to a proportional bar so it still reads at a glance.
const HABIT_DAYGOAL_PIP_CAP = 100;

function habitDayGoalHtml(habit, dayCount) {
  const goal = habit.dayGoal;
  if (!goal || goal < 1) return '';
  const done = Math.max(0, Math.min(goal, dayCount)); // completed days
  const reached = dayCount >= goal;
  const pct = Math.round((done / goal) * 100);
  const dayNumber = Math.min(goal, dayCount + 1); // the day she's currently on

  let track;
  if (goal <= HABIT_DAYGOAL_PIP_CAP) {
    const pips = Array.from({ length: goal }, (_, i) =>
      `<span class="habit-daygoal-pip ${i < done ? 'habit-daygoal-pip-on' : ''} ${i === done && !reached ? 'habit-daygoal-pip-today' : ''}"></span>`
    ).join('');
    track = `<div class="habit-daygoal-pips">${pips}</div>`;
  } else {
    track = `<div class="habit-daygoal-bar"><div class="habit-daygoal-fill" style="width:${pct}%"></div></div>`;
  }

  return `
    <div class="habit-daygoal ${reached ? 'habit-daygoal-reached' : ''}">
      <div class="habit-daygoal-head">
        <span class="habit-daygoal-label">${reached ? `🎉 بلغتِ هدفك: ${toArabicNumeral(goal)} يوم` : `اليوم ${toArabicNumeral(dayNumber)} من ${toArabicNumeral(goal)}`}</span>
        <span class="habit-daygoal-pct">${toArabicNumeral(pct)}٪</span>
      </div>
      ${track}
    </div>`;
}

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

function habitCardHtml(habit, stats, refMs, missedToday = false) {
  const isBad = getHabitType(habit) === 'bad';
  // A good habit already marked missed today shows that state instead of
  // inviting the tap again — the button was previously happy to record
  // "I missed today" five times, which is not a thing that can happen.
  const mishapLabel = isBad
    ? '⚠️ حدثت زلة'
    : (missedToday ? '✓ سُجّل: فاتني اليوم' : '❌ فاتني اليوم');
  return `
    <div class="habit-card" data-row-id="${habit.id}">
      <div class="habit-card-top">
        <span class="habit-card-icon">${habit.emoji}</span>
        <span class="habit-card-name">${escapeHtml(habit.name)}${habit.hiddenFromHome ? ' <span class="habit-hidden-badge" title="مخفية من الصفحة الرئيسية">🙈</span>' : ''}</span>
        ${kebabMenuHtml(String(habit.id), [
          { key: 'edit', label: 'تعديل' },
          { key: 'toggle-hidden', label: habit.hiddenFromHome ? '👁️ إظهارها في الرئيسية' : '🙈 إخفاؤها من الرئيسية' },
          { key: 'undo', label: 'التراجع عن آخر حدث' },
          { key: 'reset-clock', label: 'إعادة تعيين العداد' },
          { key: 'delete', label: 'حذف', danger: true }
        ])}
      </div>
      <div class="habit-clock-row">
        <span class="habit-clock-icon">⏱️</span>
        <span class="habit-clock" data-ref-ms="${refMs}">${formatHabitClock(Date.now() - refMs)}</span>
      </div>
      ${habitDayGoalHtml(habit, stats.streak)}
      <p class="habit-card-stats">${habitStatsLine(stats)}</p>
      <div class="habit-card-actions">
        <button class="btn btn-secondary habit-mishap-btn ${(!isBad && missedToday) ? 'habit-mishap-used' : ''}" data-habit-mishap="${habit.id}" ${(!isBad && missedToday) ? 'disabled' : ''}>${mishapLabel}</button>
        <button class="btn btn-danger habit-relapse-btn" data-habit-relapse="${habit.id}">⛔ انتكاسة: تصفير</button>
      </div>
    </div>`;
}

// A daily-counter habit's card: a big tally she nudges up and down through
// the day, with a fill toward the target. No clock or relapse here — a
// counter resets every morning, so "time since" and "انتكاسة" are the
// wrong verbs for it entirely.
function counterHabitCardHtml(habit, count) {
  const target = habit.dailyTarget || 0;
  const pct = target ? Math.min(100, Math.round((count / target) * 100)) : 0;
  const reached = target > 0 && count >= target;
  return `
    <div class="habit-card habit-counter-card ${reached ? 'habit-counter-reached' : ''}" data-row-id="${habit.id}">
      <div class="habit-card-top">
        <span class="habit-card-icon">${habit.emoji}</span>
        <span class="habit-card-name">${escapeHtml(habit.name)}${habit.hiddenFromHome ? ' <span class="habit-hidden-badge" title="مخفية من الصفحة الرئيسية">🙈</span>' : ''}</span>
        ${kebabMenuHtml(String(habit.id), [
          { key: 'edit', label: 'تعديل' },
          { key: 'toggle-hidden', label: habit.hiddenFromHome ? '👁️ إظهارها في الرئيسية' : '🙈 إخفاؤها من الرئيسية' },
          { key: 'delete', label: 'حذف', danger: true }
        ])}
      </div>
      <div class="habit-counter-body">
        <button class="habit-counter-btn habit-counter-minus" data-counter-dec="${habit.id}" aria-label="ناقص">−</button>
        <div class="habit-counter-readout">
          <span class="habit-counter-num">${toArabicNumeral(count)}</span>
          <span class="habit-counter-target">من ${toArabicNumeral(target)}</span>
        </div>
        <button class="habit-counter-btn habit-counter-plus" data-counter-inc="${habit.id}" aria-label="زائد">+</button>
      </div>
      <div class="habit-counter-track"><div class="habit-counter-fill" style="width:${pct}%"></div></div>
      ${reached ? '<p class="habit-counter-done">🎉 أتممتِ هدف اليوم</p>' : ''}
    </div>`;
}

async function renderHabitCards(container, habits, { onChange, emptyText } = {}) {
  if (!container) return; // page was replaced mid-render
  if (habits.length === 0) {
    container.innerHTML = emptyText ? `<p class="empty-state-sub">${emptyText}</p>` : '';
    return;
  }
  const today = todayStr();
  const rows = await Promise.all(habits.map(async h => {
    if (habitKind(h) === 'counter') {
      const count = await getHabitCount(h.id, today);
      return counterHabitCardHtml(h, count);
    }
    const stats = await getHabitStats(h.id);
    const refMs = await getHabitClockReferenceMs(h);
    const missedToday = await hasMishapToday(h.id);
    return habitCardHtml(h, stats, refMs, missedToday);
  }));
  container.innerHTML = rows.join('');

  // Counter +/- buttons. A gentle chime the moment she hits the target.
  container.querySelectorAll('[data-counter-inc]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = Number(btn.dataset.counterInc);
      const h = habits.find(x => x.id === id);
      const before = await getHabitCount(id, today);
      const after = await incrementHabitCount(id, today, +1);
      if (h && h.dailyTarget && before < h.dailyTarget && after >= h.dailyTarget) playEventChime('habits');
      await renderHabitCards(container, habits, { onChange, emptyText });
      if (onChange) onChange();
    });
  });
  container.querySelectorAll('[data-counter-dec]').forEach(btn => {
    btn.addEventListener('click', async () => {
      await incrementHabitCount(Number(btn.dataset.counterDec), today, -1);
      await renderHabitCards(container, habits, { onChange, emptyText });
      if (onChange) onChange();
    });
  });

  async function refresh() {
    await renderHabitCards(container, habits, { onChange, emptyText });
    if (onChange) onChange();
  }

  container.querySelectorAll('[data-habit-mishap]').forEach(btn => {
    btn.addEventListener('click', async () => {
      // Logged and counted, but deliberately does NOT touch the clock.
      const res = await logHabitMishap(Number(btn.dataset.habitMishap));
      if (res.alreadyLogged) { toast('سُجّل مسبقاً اليوم'); return; }
      await refresh();
    });
  });
  container.querySelectorAll('[data-habit-relapse]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const habitId = Number(btn.dataset.habitRelapse);
      if (!confirm('تسجيل انتكاسة؟ سيبدأ العدّاد من جديد.')) return;
      await logHabitRelapse(habitId);
      await refresh(); // re-renders in place — new reference, new clock, no page reload needed
    });
  });
  wireKebabMenus(container, async (rowId, action) => {
    const habitId = Number(rowId);
    if (action === 'edit') {
      openHabitModal({ existingId: habitId, onSaved: refresh });
    } else if (action === 'toggle-hidden') {
      const habit = habits.find(h => h.id === habitId);
      await setHabitHiddenFromHome(habitId, !habit.hiddenFromHome);
      toast(habit.hiddenFromHome ? '👁️ ستظهر في الرئيسية' : '🙈 أُخفيت من الرئيسية (لا تزال تُحتسب)');
      await refresh();
    } else if (action === 'undo') {
      await undoLastHabitEvent(habitId);
      await refresh();
    } else if (action === 'reset-clock') {
      const habit = habits.find(h => h.id === habitId);
      if (!confirm(`إعادة تعيين عداد "${habit.name}"؟ هذا لا يسجّل انتكاسة، فقط يبدأ العدّ من الآن.`)) return;
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

      <label class="field-label">نمط التتبّع</label>
      <div class="habit-mode-chips" id="habit-mode-chips">
        <button class="chip active" data-mode="normal">⏱️ عادية</button>
        <button class="chip" data-mode="daygoal">📅 هدف أيام</button>
        <button class="chip" data-mode="counter">🔢 عدّاد يومي</button>
      </div>

      <div id="habit-type-wrap">
        <label class="field-label">نوعها</label>
        <div class="habit-type-chips" id="habit-type-chips">
          <button class="chip active" data-type="good">🌱 أبنيها</button>
          <button class="chip" data-type="bad">🚫 أقلع عنها</button>
        </div>
      </div>

      <label class="field-label">اسم العادة</label>
      <input class="text-input" id="new-habit-name" placeholder="مثلاً: شرب الماء" autofocus>
      <label class="field-label">إيموجي (اختياري)</label>
      <input class="text-input emoji-input" id="new-habit-emoji" placeholder="🌟" maxlength="2">

      <div id="habit-daygoal-wrap" hidden>
        <label class="field-label">هدف بالأيام</label>
        <input class="text-input" type="text" inputmode="numeric" id="new-habit-daygoal" placeholder="مثلاً: ٩٠ يوم">
        <p class="settings-note">يقسّم المؤشّر إلى خانة لكل يوم. الزلّة تُسجَّل ولا تصفّر العدّاد — الانتكاسة وحدها تبدأ من جديد.</p>
      </div>

      <div id="habit-counter-wrap" hidden>
        <label class="field-label">الهدف اليومي (كم مرة في اليوم)</label>
        <input class="text-input" type="text" inputmode="numeric" id="new-habit-counter" placeholder="مثلاً: ٨ مرّات">
        <p class="settings-note">تعدّين كل مرة خلال اليوم، ويبدأ العدّاد من الصفر كل صباح. تظهر في دائرة «العدّادات».</p>
      </div>
      <label class="checkbox-row">
        <input type="checkbox" id="new-habit-hidden">
        <span>🙈 إخفاؤها من الصفحة الرئيسية</span>
      </label>
      <p class="settings-note">تبقى في صفحة العادات وتُحسب طبيعياً — فقط لا تظهر لمن ينظر إلى شاشتك الرئيسية.</p>
      <div class="modal-actions">
        ${existingId ? `<button class="btn btn-danger btn-sm" id="habit-delete-btn">حذف</button>` : ''}
        <button class="btn btn-text" id="new-habit-cancel">إلغاء</button>
        <button class="btn btn-primary" id="new-habit-save">${existingId ? 'حفظ' : 'إضافة'}</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  let selectedMode = 'normal';
  function applyMode() {
    overlay.querySelectorAll('#habit-mode-chips .chip').forEach(c => c.classList.toggle('active', c.dataset.mode === selectedMode));
    // A counter is inherently something she's doing (building), so the
    // good/bad choice only makes sense for streak & day-goal habits.
    overlay.querySelector('#habit-type-wrap').hidden = (selectedMode === 'counter');
    overlay.querySelector('#habit-daygoal-wrap').hidden = (selectedMode !== 'daygoal');
    overlay.querySelector('#habit-counter-wrap').hidden = (selectedMode !== 'counter');
  }

  async function applyExisting() {
    if (!existingId) return;
    existing = (await db.habits.toArray()).find(h => h.id === existingId);
    if (!existing) return;
    selectedType = getHabitType(existing);
    selectedMode = habitKind(existing);
    document.getElementById('habit-modal-title').textContent = 'تعديل العادة';
    document.getElementById('new-habit-name').value = existing.name;
    document.getElementById('new-habit-emoji').value = existing.emoji;
    document.getElementById('new-habit-daygoal').value = existing.dayGoal ? toArabicNumeral(existing.dayGoal) : '';
    document.getElementById('new-habit-counter').value = existing.dailyTarget ? toArabicNumeral(existing.dailyTarget) : '';
    document.getElementById('new-habit-hidden').checked = !!existing.hiddenFromHome;
    overlay.querySelectorAll('#habit-type-chips .chip').forEach(c => c.classList.toggle('active', c.dataset.type === selectedType));
    applyMode();
  }

  overlay.querySelectorAll('#habit-mode-chips .chip').forEach(chip => {
    chip.addEventListener('click', () => { selectedMode = chip.dataset.mode; applyMode(); });
  });
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
    const hiddenFromHome = document.getElementById('new-habit-hidden').checked;
    // Only the active mode's goal is stored; the others are cleared so a
    // habit can be switched between modes cleanly.
    const dayGoal = selectedMode === 'daygoal' ? readNumericField('new-habit-daygoal', { int: true, min: 1 }) : null;
    const dailyTarget = selectedMode === 'counter' ? readNumericField('new-habit-counter', { int: true, min: 1 }) : null;
    const type = selectedMode === 'counter' ? 'good' : selectedType;
    if (existingId) {
      await updateHabit(existingId, { name, emoji, type, dayGoal, dailyTarget });
      await setHabitHiddenFromHome(existingId, hiddenFromHome);
    } else {
      const id = await createHabit(name, emoji, type, dayGoal, dailyTarget);
      if (hiddenFromHome && id) await setHabitHiddenFromHome(id, true);
    }
    overlay.remove();
    if (onSaved) onSaved();
  });

  applyExisting();
}

// ---------- full Habits page ----------

// Habits summary — the page opened straight into two lists, so with a
// dozen habits you couldn't tell how today was going, or which streak was
// your longest, without scrolling and comparing rows by eye.
async function renderHabitsSummary(container) {
  if (!container) return;
  const habits = await getActiveHabits();
  if (habits.length === 0) {
    container.innerHTML = `
      <h2 class="card-title">🌱 عاداتك</h2>
      <p class="mini-progress-text">أضيفي عادتك الأولى لتبدأ</p>`;
    return;
  }
  const today = todayStr();
  const ring = await getHabitsRingData();
  const weekFrom = addDays(today, -6);

  // Everything, not just the winner. A single "best streak" line is a
  // keyhole view of twelve habits — it tells you nothing about the other
  // eleven, which is where the trouble usually is.
  const rows = await Promise.all(habits.map(async h => {
    const stats = await getHabitStats(h.id);
    const refMs = await getHabitClockReferenceMs(h);
    const events = await getHabitEvents(h.id);
    const weekMishaps = events.filter(e => e.type === 'mishap' && e.date >= weekFrom).length;
    const missedToday = await hasMishapToday(h.id);
    return {
      habit: h,
      type: getHabitType(h),
      streak: stats.streak,
      clockMs: Date.now() - refMs,
      weekMishaps,
      missedToday
    };
  }));

  const good = rows.filter(r => r.type === 'good');
  const bad = rows.filter(r => r.type === 'bad');
  const onStreak = rows.filter(r => r.streak > 0).length;
  const slippedToday = rows.filter(r => r.missedToday).length;
  const weekMishapsTotal = rows.reduce((s, r) => s + r.weekMishaps, 0);
  const bestRow = rows.reduce((b, r) => (!b || r.clockMs > b.clockMs) ? r : b, null);
  const hiddenCount = habits.filter(h => h.hiddenFromHome).length;

  // A compact strip: every habit, its streak, and whether it slipped today.
  const stripHtml = (list, emptyText) => list.length
    ? `<div class="habit-strip">
        ${list.map(r => `
          <div class="habit-strip-item ${r.missedToday ? 'habit-strip-missed' : (r.streak > 0 ? 'habit-strip-on' : '')}">
            <span class="habit-strip-icon">${r.habit.emoji}</span>
            <span class="habit-strip-name">${escapeHtml(r.habit.name)}${r.habit.hiddenFromHome ? ' 🙈' : ''}</span>
            <span class="habit-strip-num">${r.streak > 0 ? '🔥' + toArabicNumeral(r.streak) : (r.missedToday ? '💔' : '·')}</span>
          </div>`).join('')}
      </div>`
    : `<p class="mini-progress-text">${emptyText}</p>`;

  container.innerHTML = `
    <div class="section-header">
      <h2 class="card-title">🌱 عاداتك</h2>
      ${hiddenCount > 0 ? `<span class="habit-hidden-count">🙈 ${toArabicNumeral(hiddenCount)} مخفية</span>` : ''}
    </div>

    <div class="habits-summary">
      <div class="ring-wrap">
        ${renderRing({
          size: 88, strokeWidth: 10,
          segments: (() => {
            // Same مسبحة treatment as Home: one slice per habit, a faint
            // track under each, filled when that habit is done today.
            const n = ring.items.length;
            if (!n) return [];
            const GAP = 0.012, per = 1 / n, sliceLen = per - GAP;
            const tracks = ring.items.map((_, i) => ({ frac: sliceLen, offset: i * per, color: 'var(--ring-slice-track)' }));
            const fills = ring.items.map((it, i) => ({ frac: sliceLen * Math.max(0, Math.min(1, it.frac)), offset: i * per, color: it.done ? 'var(--success-strong)' : 'var(--ring-care)' }));
            return tracks.concat(fills);
          })()
        })}
        <div class="ring-center-text">${ring.total ? `${toArabicNumeral(ring.doneCount)}/${toArabicNumeral(ring.total)}` : '—'}</div>
      </div>
      <div class="habits-summary-side">
        <div class="goals-chip-row">
          <span class="goals-chip ${onStreak > 0 ? 'goals-chip-done' : ''}">🔥 ${toArabicNumeral(onStreak)} في تتابع</span>
          ${slippedToday > 0 ? `<span class="goals-chip goals-chip-slip">💔 ${toArabicNumeral(slippedToday)} اليوم</span>` : ''}
        </div>
        ${bestRow && bestRow.clockMs > 3600000
          ? `<p class="habit-highlight">⏱️ <strong>${escapeHtml(bestRow.habit.name)}</strong> — ${formatHabitClock(bestRow.clockMs)}</p>`
          : ''}
        ${weekMishapsTotal > 0
          ? `<p class="habit-week-note">💔 ${toArabicNumeral(weekMishapsTotal)} ${weekMishapsTotal === 1 ? 'زلة' : 'زلات'} هذا الأسبوع</p>`
          : `<p class="habit-week-note habit-week-clean">✨ أسبوع نظيف</p>`}
      </div>
    </div>

    <details class="habit-summary-details">
      <summary>كل عاداتك (${toArabicNumeral(habits.length)})</summary>
      ${good.length ? `<p class="habit-strip-title">🌱 أبنيها</p>${stripHtml(good, '')}` : ''}
      ${bad.length ? `<p class="habit-strip-title">🚫 أقلع عنها</p>${stripHtml(bad, '')}` : ''}
    </details>`;
}

async function renderHabitsPage(params, view) {
  view.innerHTML = `
    <div class="page-header">
      <button class="icon-btn" aria-label="رجوع" id="habits-back">→</button>
      <h1>العادات</h1>
    </div>
    <div class="card" id="habits-summary"></div>
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

  const summaryEl = document.getElementById('habits-summary');
  async function refreshBoth() {
    const good = await getActiveHabitsByType('good');
    const bad = await getActiveHabitsByType('bad');
    await renderHabitCards(goodEl, good, { onChange: refreshBoth, emptyText: 'ما في عادات جيدة مضافة بعد.' });
    await renderHabitCards(badEl, bad, { onChange: refreshBoth, emptyText: 'ما في عادات مضافة للإقلاع عنها بعد.' });
    await renderHabitsSummary(summaryEl);
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

      const events = (await getHabitEvents(h.id)).filter(e => e.date.startsWith(prefix));
      const mishaps = events.filter(e => e.type === 'mishap').length;
      const relapses = events.filter(e => e.type === 'relapse').length;
      const eventsLine = (mishaps + relapses) > 0 ? ` · 💔${mishaps} · ⛔${relapses}` : '';

      // Per-attempt breakdown. A relapse zeroes the LIVE mishap counter,
      // so this is where those counts go — each try preserved with its own
      // duration and its own mishaps, which is the only way to see whether
      // the attempts are actually getting longer and cleaner over time.
      const attempts = await getHabitAttempts(h);
      const attemptRows = attempts.map((a, i) => {
        const endMs = a.endMs ?? Date.now();
        const durationMs = Math.max(0, endMs - a.startMs);
        const ongoing = a.endMs === null;
        const label = ongoing ? 'المحاولة الحالية' : `المحاولة ${toArabicNumeral(i + 1)}`;
        return `<div class="yearly-row habit-attempt-row">
          <span>${ongoing ? '▶️' : '⛔'} ${label}</span>
          <span>${formatHabitClock(durationMs)}${a.mishaps > 0 ? ` · 💔${toArabicNumeral(a.mishaps)}` : ''}</span>
        </div>`;
      }).join('');
      const attemptsBlock = attempts.length > 1
        ? `<details class="habit-attempts-details">
             <summary>محاولات "${escapeHtml(h.name)}" (${toArabicNumeral(attempts.length)})</summary>
             ${attemptRows}
           </details>`
        : '';

      return done + missed + mishaps + relapses > 0
        ? `<div class="yearly-row"><span>${h.emoji} ${escapeHtml(h.name)}</span><span>${done} ❤️${eventsLine}</span></div>${attemptsBlock}`
        : '';
    }));
    return { html: rows.join(''), total };
  }

  const good = await summarize(await getActiveHabitsByType('good'));
  const bad = await summarize(await getActiveHabitsByType('bad'));
  if (!good.html && !bad.html) return null;

  async function longestStreakLine(list) {
    let maxMs = 0;
    for (const h of list) {
      const ms = await getHabitLongestStreakMs(h);
      if (ms > maxMs) maxMs = ms;
    }
    return maxMs > 0 ? formatHabitClock(maxMs) : null;
  }
  const goodHabitsList = await getActiveHabitsByType('good');
  const badHabitsList = await getActiveHabitsByType('bad');
  const goodLongest = await longestStreakLine(goodHabitsList);
  const badLongest = await longestStreakLine(badHabitsList);

  const html = `
    ${good.html ? `<h4 class="yearly-subsection-title">🌱 عادات جيدة</h4>${good.html}` : ''}
    ${goodLongest ? `<div class="yearly-row"><span>أطول تسلسل (جيدة)</span><span>${goodLongest}</span></div>` : ''}
    ${bad.html ? `<h4 class="yearly-subsection-title">🚫 عادات أقلع عنها</h4>${bad.html}` : ''}
    ${badLongest ? `<div class="yearly-row"><span>أطول تسلسل (أقلع عنها)</span><span>${badLongest}</span></div>` : ''}
  `;
  return { title: 'العادات', html, count: good.total + bad.total };
}
