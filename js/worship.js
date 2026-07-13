// worship.js — Phase 2.
// Fard reuses the exact same streak engine and row component as Habits
// (that reuse is the payoff of normalizing prayerLogs instead of using
// 5 boolean columns). Sunnah / adhkar-after / daily adhkar stay 2-state
// checkboxes, same reasoning as Fixed Tasks: no "missed" button exists
// for them — but they still get streak/succeeded/failed stats, using
// computeImplicitStats since "failed" there just means "a day since you
// started that you didn't mark," not an explicit relapse tap.

// ===================== Fard (5 daily prayers) =====================

async function getFardStatus(prayerName, date) {
  const row = await getLog(db.prayerLogs, 'prayerName', prayerName, date);
  return row ? row.status : null;
}
// Completing the fifth prayer of the day should feel like completing the
// fifth prayer of the day. Fires only on the transition INTO complete, so
// re-ticking an already-complete day doesn't re-celebrate.
async function celebrateIfAllPrayersDone(date) {
  if (date !== todayStr()) return; // no fanfare for backfilling last Tuesday
  let done = 0;
  for (const p of PRAYER_NAMES) if (await getFardStatus(p, date) === 'done') done++;
  if (done === PRAYER_NAMES.length) playEventChime('prayers');
}

async function setFardStatus(prayerName, date, status) {
  await upsertLog(db.prayerLogs, 'prayerName', prayerName, date, { status });
  if (status === 'done') await celebrateIfAllPrayersDone(date);
}
async function clearFardStatus(prayerName, date) {
  await deleteLog(db.prayerLogs, 'prayerName', prayerName, date);
}

async function getFardAllDoneDates() {
  const logs = await db.prayerLogs.toArray();
  const doneCountByDate = {};
  logs.forEach(l => {
    if (l.status === 'done') doneCountByDate[l.date] = (doneCountByDate[l.date] || 0) + 1;
  });
  return Object.keys(doneCountByDate).filter(d => doneCountByDate[d] >= PRAYER_NAMES.length);
}

async function getFardPauses() {
  return db.streakPauses.where('streakType').equals('fard').toArray();
}
async function getActiveFardPause() {
  const pauses = await getFardPauses();
  return pauses.find(p => p.endDate === null) || null;
}
async function startFardPause() {
  const active = await getActiveFardPause();
  if (active) return; // already paused — idempotent, safe to call from more than one place
  await db.streakPauses.add({ streakType: 'fard', startDate: todayStr(), endDate: null, createdAt: Date.now() });
}
async function endFardPause() {
  const active = await getActiveFardPause();
  if (!active) return; // nothing to end
  await db.streakPauses.update(active.id, { endDate: addDays(todayStr(), -1) });
}
async function getFardStreak() {
  const doneDates = await getFardAllDoneDates();
  const pauses = await getFardPauses();
  return computeCurrentStreak(doneDates, pauses);
}

async function getFardTodayCount() {
  const today = todayStr();
  let done = 0;
  for (const p of PRAYER_NAMES) {
    if (await getFardStatus(p, today) === 'done') done++;
  }
  return done;
}

// Per-prayer stats (e.g. "how many days in a row have I prayed Fajr
// specifically") — a different, also-useful number from the aggregate
// fard streak shown near the ring (which is "all 5 done that day").
async function getFardPrayerStats(prayerName) {
  const logs = await db.prayerLogs.where('prayerName').equals(prayerName).toArray();
  const done = logs.filter(l => l.status === 'done').map(l => l.date);
  const missed = logs.filter(l => l.status === 'missed').map(l => l.date);
  return computeStreakStats(done, missed, []);
}

function fardRowHtml(prayerName, status, { editable, showStreak, stats }) {
  return threeStateRowHtml({
    rowId: prayerName,
    icon: '🕌',
    name: PRAYER_LABELS[prayerName],
    status, editable, showStreak, stats
  });
}

// showStreak defaults to false (undefined) on purpose — Day Detail
// calls this for arbitrary past dates, and a streak number next to a
// random past day reads as "streak as of that day," which is misleading.
// Only the live Worship page (today) passes showStreak: true.
async function renderFardList(container, dateStr, { editable, showStreak, onChange } = {}) {
  const rows = await Promise.all(PRAYER_NAMES.map(async p => {
    const status = await getFardStatus(p, dateStr);
    const stats = showStreak ? await getFardPrayerStats(p) : null;
    return fardRowHtml(p, status, { editable, showStreak, stats });
  }));
  container.innerHTML = rows.join('');
  wireThreeStateRows(container, async (prayerName, action) => {
    if (action === 'done') await setFardStatus(prayerName, dateStr, 'done');
    else if (action === 'missed') await setFardStatus(prayerName, dateStr, 'missed');
    else if (action === 'undo') await clearFardStatus(prayerName, dateStr);
    await renderFardList(container, dateStr, { editable, showStreak, onChange });
    if (onChange) onChange();
  });
}

// ===================== Sunnah + adhkar-after-prayer =====================

async function isSunnahDone(prayerName, date) { return !!(await getLog(db.sunnahLogs, 'prayerName', prayerName, date)); }
async function toggleSunnah(prayerName, date) {
  const existing = await getLog(db.sunnahLogs, 'prayerName', prayerName, date);
  if (existing) await deleteLog(db.sunnahLogs, 'prayerName', prayerName, date);
  else await upsertLog(db.sunnahLogs, 'prayerName', prayerName, date, {});
}
async function isAdhkarAfterDone(prayerName, date) { return !!(await getLog(db.adhkarAfterLogs, 'prayerName', prayerName, date)); }
async function toggleAdhkarAfter(prayerName, date) {
  const existing = await getLog(db.adhkarAfterLogs, 'prayerName', prayerName, date);
  if (existing) await deleteLog(db.adhkarAfterLogs, 'prayerName', prayerName, date);
  else await upsertLog(db.adhkarAfterLogs, 'prayerName', prayerName, date, {});
}

// Aggregate stats — "day counts" only if ALL 5 prayers had this marked,
// same all-or-nothing logic as the fard aggregate streak. Shown once
// near each section's header on the Worship page, not per-chip (5
// prayers × 2 tiny chips has no room for 3 numbers each).
async function getSunnahStats() {
  const logs = await db.sunnahLogs.toArray();
  const countByDate = {};
  logs.forEach(l => { countByDate[l.date] = (countByDate[l.date] || 0) + 1; });
  const dates = Object.keys(countByDate).filter(d => countByDate[d] >= PRAYER_NAMES.length);
  return computeImplicitStats(dates, []);
}
async function getAdhkarAfterStats() {
  const logs = await db.adhkarAfterLogs.toArray();
  const countByDate = {};
  logs.forEach(l => { countByDate[l.date] = (countByDate[l.date] || 0) + 1; });
  const dates = Object.keys(countByDate).filter(d => countByDate[d] >= PRAYER_NAMES.length);
  return computeImplicitStats(dates, []);
}

async function renderExtrasList(container, dateStr) {
  const rows = await Promise.all(PRAYER_NAMES.map(async p => {
    const sunnah = await isSunnahDone(p, dateStr);
    const adhkar = await isAdhkarAfterDone(p, dateStr);
    return `
      <div class="extras-row" data-prayer="${p}">
        <span class="extras-prayer-label">${PRAYER_LABELS[p]}</span>
        <div class="extras-chips">
          <button class="chip ${sunnah ? 'active' : ''}" data-kind="sunnah">سنة</button>
          <button class="chip ${adhkar ? 'active' : ''}" data-kind="adhkar">ذكر بعد الصلاة</button>
        </div>
      </div>`;
  }));
  container.innerHTML = rows.join('');
  container.querySelectorAll('.extras-row').forEach(row => {
    const prayer = row.dataset.prayer;
    row.querySelectorAll('.chip').forEach(chip => {
      chip.addEventListener('click', async () => {
        if (chip.dataset.kind === 'sunnah') await toggleSunnah(prayer, dateStr);
        else await toggleAdhkarAfter(prayer, dateStr);
        await renderExtrasList(container, dateStr);
      });
    });
  });
}

// ===================== Morning / evening adhkar =====================

async function isDailyAdhkarDone(kind, date) { return !!(await getLog(db.dailyAdhkarLogs, 'kind', kind, date)); }
async function toggleDailyAdhkar(kind, date) {
  const existing = await getLog(db.dailyAdhkarLogs, 'kind', kind, date);
  if (existing) await deleteLog(db.dailyAdhkarLogs, 'kind', kind, date);
  else await upsertLog(db.dailyAdhkarLogs, 'kind', kind, date, {});
  // Both halves of the day's adhkar done — that's a completed practice.
  if (date === todayStr()) {
    const [mDone, eDone] = await Promise.all([
      isDailyAdhkarDone('morning', date),
      isDailyAdhkarDone('evening', date)
    ]);
    if (mDone && eDone) playEventChime('adhkar');
  }
}

// \"Day counts\" if both morning AND evening were marked.
async function getDailyAdhkarStats() {
  const logs = await db.dailyAdhkarLogs.toArray();
  const countByDate = {};
  logs.forEach(l => { countByDate[l.date] = (countByDate[l.date] || 0) + 1; });
  const dates = Object.keys(countByDate).filter(d => countByDate[d] >= 2);
  return computeImplicitStats(dates, []);
}

// ---------- her own list of adhkar texts to read through, per kind ----------

async function addDailyAdhkarItem(kind, text, benefit = '', goalCount = null) {
  const all = await getDailyAdhkarItems(kind);
  await db.dailyAdhkarItems.add({ kind, text, benefit, goalCount, order: all.length, createdAt: Date.now() });
}
async function updateDailyAdhkarItem(id, { text, benefit, goalCount }) {
  await db.dailyAdhkarItems.update(id, { text, benefit: benefit || '', goalCount: goalCount ?? null });
}
async function deleteDailyAdhkarItem(id) {
  await db.dailyAdhkarItems.delete(id);
  // Its counts go with it — leaving orphaned logs behind would quietly
  // inflate any future "how much did I recite" total.
  await db.dailyAdhkarItemLogs.where('itemId').equals(id).delete();
}
async function getDailyAdhkarItems(kind) {
  const all = await db.dailyAdhkarItems.where('kind').equals(kind).toArray();
  return all.sort((a, b) => a.order - b.order);
}

// Per-item, per-day counts (the مسبحة for an individual dhikr).
async function getDailyAdhkarItemCount(itemId, date) {
  const row = await getLog(db.dailyAdhkarItemLogs, 'itemId', itemId, date);
  return row ? row.count : 0;
}
async function setDailyAdhkarItemCount(itemId, date, count) {
  if (count <= 0) await deleteLog(db.dailyAdhkarItemLogs, 'itemId', itemId, date);
  else await upsertLog(db.dailyAdhkarItemLogs, 'itemId', itemId, date, { count });
}

function dailyAdhkarKindLabel(kind) {
  return kind === 'evening' ? 'أذكار المساء' : 'أذكار الصباح';
}

async function renderDailyAdhkar(container, dateStr) {
  const [morning, evening] = await Promise.all([
    isDailyAdhkarDone('morning', dateStr), isDailyAdhkarDone('evening', dateStr)
  ]);
  container.innerHTML = `
    <div class="daily-adhkar-row">
      <button class="chip-lg ${morning ? 'active' : ''}" data-kind="morning">🌅 أذكار الصباح</button>
      <button class="chip-lg ${evening ? 'active' : ''}" data-kind="evening">🌙 أذكار المساء</button>
    </div>`;
  container.querySelectorAll('.chip-lg').forEach(btn => {
    // Opens her actual reading list instead of blindly toggling — she
    // marks done from inside that page, after reading through it.
    btn.addEventListener('click', () => goTo(`/adhkar-detail/${btn.dataset.kind}/${dateStr}`));
  });
}

function openDailyAdhkarItemModal(kind, onSaved, existing = null) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal">
      <h2 class="modal-title">${existing ? 'تعديل الذكر' : 'ذكر جديد'}</h2>
      <label class="field-label">نص الذكر</label>
      <textarea class="mood-note-input" id="adhkar-item-text" placeholder="اكتبي نص الذكر...">${existing ? escapeHtml(existing.text) : ''}</textarea>
      <label class="field-label">فضله (اختياري)</label>
      <textarea class="mood-note-input" id="adhkar-item-benefit" placeholder="مثلاً: من قالها حين يصبح كُفي همّه...">${existing && existing.benefit ? escapeHtml(existing.benefit) : ''}</textarea>
      <label class="field-label">عدد التكرار المستهدف (اختياري)</label>
      <input class="text-input" type="text" inputmode="numeric" id="adhkar-item-goal" placeholder="مثلاً: ٣" value="${existing && existing.goalCount ? toArabicNumeral(existing.goalCount) : ''}">
      <div class="modal-actions">
        <button class="btn btn-text" id="adhkar-item-cancel">إلغاء</button>
        <button class="btn btn-primary" id="adhkar-item-save">${existing ? 'حفظ' : 'إضافة'}</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  document.getElementById('adhkar-item-cancel').addEventListener('click', () => overlay.remove());
  document.getElementById('adhkar-item-save').addEventListener('click', async () => {
    const text = document.getElementById('adhkar-item-text').value.trim();
    if (!text) return;
    const benefit = document.getElementById('adhkar-item-benefit').value.trim();
    const goalCount = readNumericField('adhkar-item-goal', { int: true, min: 1 });
    if (existing) await updateDailyAdhkarItem(existing.id, { text, benefit, goalCount });
    else await addDailyAdhkarItem(kind, text, benefit, goalCount);
    overlay.remove();
    if (onSaved) onSaved();
  });
}

async function renderAdhkarDetailPage(params, view) {
  const kind = params[0] === 'evening' ? 'evening' : 'morning';
  const dateStr = params[1] || todayStr();
  const label = dailyAdhkarKindLabel(kind);

  view.innerHTML = `
    <div class="page-header">
      <button class="icon-btn" aria-label="رجوع" id="adhkar-detail-back">→</button>
      <h1>${label}</h1>
    </div>
    ${dateStr !== todayStr() ? `<p class="settings-note">${formatDateArabic(dateStr, { weekday: true })}</p>` : ''}
    <div class="card">
      <div class="section-header">
        <h2 class="card-title">القائمة</h2>
        <button class="link-btn" id="add-adhkar-item-btn">+ إضافة</button>
      </div>
      <div id="adhkar-items-list"></div>
    </div>
    <div class="card" id="adhkar-done-card"></div>
  `;
  document.getElementById('adhkar-detail-back').addEventListener('click', () => history.back());

  async function refreshItems() {
    const items = await getDailyAdhkarItems(kind);
    const el = document.getElementById('adhkar-items-list');
    if (items.length === 0) {
      el.innerHTML = `<div class="empty-state"><p>أضيفي أذكارك هنا لتقرئيها كل يوم.</p></div>`;
      return;
    }
    el.innerHTML = (await Promise.all(items.map(async i => {
      const count = await getDailyAdhkarItemCount(i.id, dateStr);
      const goalMet = i.goalCount && count >= i.goalCount;
      const countLabel = i.goalCount
        ? `${toArabicNumeral(count)}/${toArabicNumeral(i.goalCount)}`
        : toArabicNumeral(count);
      return `
      <div class="task-row-wrap" data-item-id="${i.id}">
        <button class="adhkar-tap-row" data-action="open">
          <span class="adhkar-tap-main">
            <span class="adhkar-tap-text">${escapeHtml(i.text)}</span>
            ${i.benefit ? `<span class="adhkar-tap-benefit">${escapeHtml(i.benefit)}</span>` : ''}
          </span>
          <span class="adhkar-tap-count ${goalMet ? 'adhkar-goal-met' : ''}">${countLabel}</span>
        </button>
        ${kebabMenuHtml(String(i.id), [
          { key: 'edit', label: 'تعديل' },
          { key: 'delete', label: 'حذف', danger: true }
        ])}
      </div>`;
    }))).join('');

    el.querySelectorAll('[data-item-id]').forEach(row => {
      const id = Number(row.dataset.itemId);
      const item = items.find(i => i.id === id);
      row.querySelector('[data-action="open"]').addEventListener('click', () => {
        openTasbeehModal({
          title: item.text,
          benefit: item.benefit,
          goal: item.goalCount,
          getCount: () => getDailyAdhkarItemCount(id, dateStr),
          setCount: (n) => setDailyAdhkarItemCount(id, dateStr, n),
          onClose: refreshItems
        });
      });
    });

    wireKebabMenus(el, async (rowId, action) => {
      const id = Number(rowId);
      if (action === 'edit') {
        const item = items.find(i => i.id === id);
        openDailyAdhkarItemModal(kind, refreshItems, item);
      } else if (action === 'delete') {
        if (!confirm('حذف هذا الذكر من القائمة؟')) return;
        await deleteDailyAdhkarItem(id);
        await refreshItems();
      }
    });
  }
  await refreshItems();
  document.getElementById('add-adhkar-item-btn').addEventListener('click', () => {
    openDailyAdhkarItemModal(kind, refreshItems);
  });

  async function refreshDoneCard() {
    const done = await isDailyAdhkarDone(kind, dateStr);
    document.getElementById('adhkar-done-card').innerHTML = done
      ? `<button class="btn btn-text btn-block" id="adhkar-toggle-done">↩️ تراجع عن "${label}" ${dateStr === todayStr() ? 'اليوم' : ''}</button>`
      : `<button class="btn btn-primary btn-block" id="adhkar-toggle-done">✅ تم قراءة ${label}</button>`;
    document.getElementById('adhkar-toggle-done').addEventListener('click', async () => {
      await toggleDailyAdhkar(kind, dateStr);
      await refreshDoneCard();
    });
  }
  await refreshDoneCard();
}

// ===================== Standalone sunnah prayers (not tied to a fard) =====================
// Starts with just Duha; the list is structured to make adding Witr,
// Tahajjud, etc. later a one-line change, not a redesign.

const STANDALONE_SUNNAH_PRAYERS = [
  { kind: 'duha', label: '☀️ صلاة الضحى' }
];

async function isStandaloneSunnahDone(kind, date) { return !!(await getLog(db.standaloneSunnahLogs, 'kind', kind, date)); }
async function toggleStandaloneSunnah(kind, date) {
  const existing = await getLog(db.standaloneSunnahLogs, 'kind', kind, date);
  if (existing) await deleteLog(db.standaloneSunnahLogs, 'kind', kind, date);
  else await upsertLog(db.standaloneSunnahLogs, 'kind', kind, date, {});
}
async function getStandaloneSunnahStats(kind) {
  const logs = await db.standaloneSunnahLogs.where('kind').equals(kind).toArray();
  return computeImplicitStats(logs.map(l => l.date), []);
}

async function renderStandaloneSunnah(container, dateStr, { showStreak } = {}) {
  const rows = await Promise.all(STANDALONE_SUNNAH_PRAYERS.map(async p => {
    const done = await isStandaloneSunnahDone(p.kind, dateStr);
    const statsText = showStreak ? statsLine(await getStandaloneSunnahStats(p.kind)) : '';
    return `
      <div class="daily-adhkar-row">
        <button class="chip-lg ${done ? 'active' : ''}" data-kind="${p.kind}">${p.label}</button>
        ${statsText ? `<span class="tsr-streak">${statsText}</span>` : ''}
      </div>`;
  }));
  container.innerHTML = rows.join('');
  container.querySelectorAll('.chip-lg').forEach(btn => {
    btn.addEventListener('click', async () => {
      await toggleStandaloneSunnah(btn.dataset.kind, dateStr);
      await renderStandaloneSunnah(container, dateStr, { showStreak });
    });
  });
}

// ===================== Wird (daily Quran reading plan) =====================
// Standard Mushaf page counts, the same approximations most reading-plan
// apps use — precise enough for "when will I finish," not meant to
// track exact ayah boundaries.
const QURAN_TOTAL_PAGES = 604;
const PAGES_PER_JUZ = 20;
const PAGES_PER_HIZB = 10;

function wirdUnitToPages(amount, unit) {
  if (unit === 'juz') return amount * PAGES_PER_JUZ;
  if (unit === 'hizb') return amount * PAGES_PER_HIZB;
  return amount;
}
function wirdUnitLabel(unit) {
  return { pages: 'صفحة', hizb: 'حزب', juz: 'جزء' }[unit] || 'صفحة';
}

async function getWirdPlan() {
  return db.wirdSettings.get(1);
}
async function saveWirdPlan(dailyAmount, unit) {
  const existing = await getWirdPlan();
  if (existing) await db.wirdSettings.update(1, { dailyAmount, unit });
  else await db.wirdSettings.put({ id: 1, dailyAmount, unit, createdAt: Date.now() });
}
async function deleteWirdPlan() {
  await db.wirdSettings.delete(1);
  await db.wirdLogs.clear();
}
async function isWirdLoggedToday() {
  return !!(await db.wirdLogs.where('date').equals(todayStr()).first());
}

// Progress and khatm count are DERIVED from the log, never stored.
//
// The old design kept progressPages/khatmCount on the plan row and
// mutated them on every log/undo, justified by "you can't rebuild the
// position within a cycle once a khatm wraps it past zero." That's not
// actually true: every log row records BOTH pagesAdded and whether it
// triggeredKhatm, so the whole history replays exactly. Storing it
// bought nothing and allowed the stored numbers to drift out of sync
// with the very history that's supposed to explain them (clear the
// logs and the plan still claimed a khatm had happened). Same rule the
// balance, streaks, and goal progress already follow.
async function getWirdProgress() {
  const logs = await db.wirdLogs.toArray();
  const totalPages = logs.reduce((sum, l) => sum + (l.pagesAdded || 0), 0);
  const khatmCount = logs.filter(l => l.triggeredKhatm).length;
  return {
    progressPages: totalPages - khatmCount * QURAN_TOTAL_PAGES,
    khatmCount
  };
}

async function logWirdToday() {
  const plan = await getWirdPlan();
  if (!plan || await isWirdLoggedToday()) return;
  const pagesToAdd = wirdUnitToPages(plan.dailyAmount, plan.unit);
  const { progressPages } = await getWirdProgress();
  // Whether THIS day completed a khatm is a fact about this day, so it
  // is recorded on the log itself — that's what keeps the replay exact.
  const triggeredKhatm = (progressPages + pagesToAdd) >= QURAN_TOTAL_PAGES;
  await db.wirdLogs.add({ date: todayStr(), pagesAdded: pagesToAdd, triggeredKhatm });
  // A finished khatm deserves more than the daily tick.
  playEventChime(triggeredKhatm ? 'goal' : 'wird', {
    hapticPattern: triggeredKhatm ? [120, 60, 120, 60, 200] : [60, 40, 60]
  });
}
async function undoWirdToday() {
  // Deleting the log IS the undo now — progress recomputes from what's
  // left, so there's no second copy to keep in step.
  const log = await db.wirdLogs.where('date').equals(todayStr()).first();
  if (!log) return;
  await db.wirdLogs.delete(log.id);
}
async function getWirdStreak() {
  const logs = await db.wirdLogs.toArray();
  return computeCurrentStreak(logs.map(l => l.date), []);
}
function estimateWirdDaysToFinish(plan, progressPages) {
  const dailyPages = wirdUnitToPages(plan.dailyAmount, plan.unit);
  if (dailyPages <= 0) return null;
  const remaining = QURAN_TOTAL_PAGES - progressPages;
  return Math.max(0, Math.ceil(remaining / dailyPages));
}

async function renderWirdCard(container) {
  const plan = await getWirdPlan();
  if (!plan) {
    container.innerHTML = `
      <h2 class="card-title">📖 ورد القرآن</h2>
      <p class="empty-state-sub">حدّدي وردك اليومي لتبدأ.</p>
      <button class="btn btn-secondary btn-block" id="wird-setup-btn">+ إعداد الورد</button>`;
    document.getElementById('wird-setup-btn').addEventListener('click', () => openWirdSetupModal(() => renderWirdCard(container)));
    return;
  }
  const loggedToday = await isWirdLoggedToday();
  const streak = await getWirdStreak();
  const { progressPages, khatmCount } = await getWirdProgress();
  const daysLeft = estimateWirdDaysToFinish(plan, progressPages);
  const frac = progressPages / QURAN_TOTAL_PAGES;

  container.innerHTML = `
    <div class="section-header">
      <h2 class="card-title">📖 ورد القرآن</h2>
      ${kebabMenuHtml('wird', [
        { key: 'edit', label: 'تعديل الورد' },
        { key: 'delete', label: 'حذف الورد', danger: true }
      ])}
    </div>
    <p class="settings-note">وردك اليومي: ${plan.dailyAmount} ${wirdUnitLabel(plan.unit)}</p>
    <div class="mini-progress-track"><div class="mini-progress-fill" style="width:${frac * 100}%"></div></div>
    <p class="mini-progress-text">${progressPages} من ${QURAN_TOTAL_PAGES} صفحة</p>
    ${daysLeft != null ? `<p class="settings-note">بهذا المعدل، ستختمين خلال ~${daysLeft} ${daysLeft === 1 ? 'يوم' : 'يوماً'}</p>` : ''}
    <p class="tsr-streak">🌙 عدد الختمات: ${khatmCount} ${streak > 0 ? `· 🔥${streak}` : ''}</p>
    ${loggedToday
      ? `<button class="btn btn-text btn-block" id="wird-undo-btn">↩️ تراجع عن ورد اليوم</button>`
      : `<button class="btn btn-primary btn-block" id="wird-log-btn">✅ أتممت وردي اليوم</button>`}
  `;

  const logBtn = document.getElementById('wird-log-btn');
  if (logBtn) logBtn.addEventListener('click', async () => {
    await logWirdToday();
    await renderWirdCard(container);
  });
  const undoBtn = document.getElementById('wird-undo-btn');
  if (undoBtn) undoBtn.addEventListener('click', async () => {
    await undoWirdToday();
    await renderWirdCard(container);
  });
  wireKebabMenus(container, async (rowId, action) => {
    if (action === 'edit') {
      openWirdSetupModal(() => renderWirdCard(container));
    } else if (action === 'delete') {
      if (!confirm('حذف خطة الورد؟ سيُحذف تقدّمك الحالي وسجل الأيام.')) return;
      await deleteWirdPlan();
      await renderWirdCard(container);
    }
  });
}

function openWirdSetupModal(onSaved) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal">
      <h2 class="modal-title">إعداد ورد القرآن</h2>
      <label class="field-label">الكمية اليومية</label>
      <input class="text-input" type="number" min="1" id="wird-amount-input" placeholder="مثلاً: 5">
      <label class="field-label">الوحدة</label>
      <div class="habit-type-chips" id="wird-unit-chips">
        <button class="chip active" data-unit="pages">صفحات</button>
        <button class="chip" data-unit="hizb">أحزاب</button>
        <button class="chip" data-unit="juz">أجزاء</button>
      </div>
      <div class="modal-actions">
        <button class="btn btn-text" id="wird-setup-cancel">إلغاء</button>
        <button class="btn btn-primary" id="wird-setup-save">حفظ</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  (async () => {
    const existing = await getWirdPlan();
    if (existing) {
      document.getElementById('wird-amount-input').value = existing.dailyAmount;
      overlay.querySelectorAll('#wird-unit-chips .chip').forEach(c => c.classList.toggle('active', c.dataset.unit === existing.unit));
    }
  })();

  overlay.querySelectorAll('#wird-unit-chips .chip').forEach(chip => {
    chip.addEventListener('click', () => {
      overlay.querySelectorAll('#wird-unit-chips .chip').forEach(c => c.classList.toggle('active', c === chip));
    });
  });
  document.getElementById('wird-setup-cancel').addEventListener('click', () => overlay.remove());
  document.getElementById('wird-setup-save').addEventListener('click', async () => {
    const amount = readNumericField('wird-amount-input');
    if (amount === null || amount <= 0) return;
    const unit = overlay.querySelector('#wird-unit-chips .chip.active')?.dataset.unit || 'pages';
    await saveWirdPlan(amount, unit);
    overlay.remove();
    if (onSaved) onSaved();
  });
}

// ---------- Day Detail provider ----------

async function wirdDayProvider(dateStr) {
  const log = await db.wirdLogs.where('date').equals(dateStr).first();
  if (!log) return null;
  const node = document.createElement('div');
  node.innerHTML = `<p class="period-day-note">📖 ${log.pagesAdded} صفحة${log.triggeredKhatm ? ' · 🌙 ختمة!' : ''}</p>`;
  return { title: 'ورد القرآن', node };
}

// ---------- Yearly stats provider ----------

async function wirdYearlyProvider(year) {
  const plan = await getWirdPlan();
  if (!plan) return null;
  const prefix = String(year);
  const logs = await db.wirdLogs.toArray();
  const yearLogs = logs.filter(l => l.date.startsWith(prefix));
  if (yearLogs.length === 0) return null;
  const totalPages = yearLogs.reduce((s, l) => s + l.pagesAdded, 0);
  const khatms = yearLogs.filter(l => l.triggeredKhatm).length;
  const html = `
    <div class="yearly-row"><span>أيام الورد المسجلة</span><span>${yearLogs.length}</span></div>
    <div class="yearly-row"><span>مجموع الصفحات المقروءة</span><span>${totalPages}</span></div>
    ${khatms > 0 ? `<div class="yearly-row"><span>🌙 ختمات هذا العام</span><span>${khatms}</span></div>` : ''}
  `;
  return { title: 'ورد القرآن', html, count: yearLogs.length };
}

// ===================== القضاء (makeup prayers + fasting) =====================
// Standing counters that only ever count DOWN as she catches up — the
// opposite of custom adhkar's count-up. No "logs" table needed since
// there's nothing date-specific here, just a remaining count that
// persists until it hits zero.

async function createQadaPrayer(prayerName, count) {
  await db.qadaPrayers.add({ prayerName, remaining: Math.max(0, count), createdAt: Date.now() });
}
async function updateQadaPrayer(id, { prayerName, remaining }) {
  await db.qadaPrayers.update(id, { prayerName, remaining: Math.max(0, remaining) });
}
async function decrementQadaPrayer(id) {
  const item = await db.qadaPrayers.get(id);
  if (!item || item.remaining <= 0) return;
  await db.qadaPrayers.update(id, { remaining: item.remaining - 1 });
}
async function deleteQadaPrayer(id) {
  await db.qadaPrayers.delete(id);
}
async function getQadaPrayers() {
  const all = await db.qadaPrayers.toArray();
  return all.sort((a, b) => b.createdAt - a.createdAt);
}

async function createQadaFasting(label, count) {
  await db.qadaFasting.add({ label: label || '', remaining: Math.max(0, count), createdAt: Date.now() });
}
async function updateQadaFasting(id, { label, remaining }) {
  await db.qadaFasting.update(id, { label: label || '', remaining: Math.max(0, remaining) });
}
async function decrementQadaFastingDay(id) {
  const item = await db.qadaFasting.get(id);
  if (!item || item.remaining <= 0) return;
  await db.qadaFasting.update(id, { remaining: item.remaining - 1 });
}
async function deleteQadaFasting(id) {
  await db.qadaFasting.delete(id);
}
async function getQadaFasting() {
  const all = await db.qadaFasting.toArray();
  return all.sort((a, b) => b.createdAt - a.createdAt);
}

function qadaPrayerRowHtml(item) {
  const done = item.remaining === 0;
  return `
    <div class="adhkar-counter-row" data-qada-id="${item.id}">
      <div class="adhkar-name-block">
        <span class="adhkar-name">${PRAYER_LABELS[item.prayerName]}</span>
        ${done ? `<span class="tsr-streak">✅ تم القضاء بالكامل</span>` : ''}
      </div>
      <div class="adhkar-counter-controls">
        <button class="adhkar-count-btn" disabled>${item.remaining}</button>
        <button class="adhkar-plus qada-minus-btn" data-action="dec" ${done ? 'disabled' : ''}>−</button>
        ${kebabMenuHtml('qp-' + item.id, [
          { key: 'edit', label: 'تعديل' },
          { key: 'remove', label: 'حذف', danger: true }
        ])}
      </div>
    </div>`;
}

async function renderQadaPrayersList(container) {
  const items = await getQadaPrayers();
  if (items.length === 0) {
    container.innerHTML = `<p class="empty-state-sub">ما في صلوات قضاء مسجّلة.</p>`;
    return;
  }
  container.innerHTML = items.map(qadaPrayerRowHtml).join('');
  container.querySelectorAll('.qada-minus-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const row = btn.closest('[data-qada-id]');
      await decrementQadaPrayer(Number(row.dataset.qadaId));
      await renderQadaPrayersList(container);
    });
  });
  wireKebabMenus(container, async (rowId, action) => {
    const id = Number(rowId.replace('qp-', ''));
    if (action === 'edit') {
      openQadaPrayerModal({ existingId: id, onSaved: () => renderQadaPrayersList(container) });
    } else if (action === 'remove') {
      if (!confirm('حذف هذا القضاء؟')) return;
      await deleteQadaPrayer(id);
      await renderQadaPrayersList(container);
    }
  });
}

function openQadaPrayerModal({ existingId, onSaved } = {}) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal">
      <h2 class="modal-title" id="qada-prayer-modal-title">قضاء صلاة</h2>
      <label class="field-label">الصلاة</label>
      <div class="habit-type-chips" id="qada-prayer-chips">
        ${PRAYER_NAMES.map((p, i) => `<button class="chip ${i === 0 ? 'active' : ''}" data-prayer="${p}">${PRAYER_LABELS[p]}</button>`).join('')}
      </div>
      <label class="field-label">عدد الصلوات المتبقية</label>
      <input class="text-input" type="number" min="0" id="qada-prayer-count-input" placeholder="مثلاً: 10">
      <div class="modal-actions">
        ${existingId ? `<button class="btn btn-danger btn-sm" id="qada-prayer-delete-btn">حذف</button>` : ''}
        <button class="btn btn-text" id="qada-prayer-cancel-btn">إلغاء</button>
        <button class="btn btn-primary" id="qada-prayer-save-btn">حفظ</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  overlay.querySelectorAll('#qada-prayer-chips .chip').forEach(chip => {
    chip.addEventListener('click', () => {
      overlay.querySelectorAll('#qada-prayer-chips .chip').forEach(c => c.classList.toggle('active', c === chip));
    });
  });

  (async () => {
    if (!existingId) return;
    const existing = await db.qadaPrayers.get(existingId);
    if (!existing) return;
    document.getElementById('qada-prayer-modal-title').textContent = 'تعديل قضاء الصلاة';
    document.getElementById('qada-prayer-count-input').value = existing.remaining;
    overlay.querySelectorAll('#qada-prayer-chips .chip').forEach(c => c.classList.toggle('active', c.dataset.prayer === existing.prayerName));
  })();

  document.getElementById('qada-prayer-cancel-btn').addEventListener('click', () => overlay.remove());
  const deleteBtn = document.getElementById('qada-prayer-delete-btn');
  if (deleteBtn) deleteBtn.addEventListener('click', async () => {
    if (!confirm('حذف هذا القضاء؟')) return;
    await deleteQadaPrayer(existingId);
    overlay.remove();
    if (onSaved) onSaved();
  });
  document.getElementById('qada-prayer-save-btn').addEventListener('click', async () => {
    const count = readNumericField('qada-prayer-count-input', { int: true });
    if (count === null || count < 0) return;
    const prayerName = overlay.querySelector('#qada-prayer-chips .chip.active')?.dataset.prayer || PRAYER_NAMES[0];
    if (existingId) await updateQadaPrayer(existingId, { prayerName, remaining: count });
    else await createQadaPrayer(prayerName, count);
    overlay.remove();
    if (onSaved) onSaved();
  });
}

function qadaFastingRowHtml(item) {
  const done = item.remaining === 0;
  return `
    <div class="adhkar-counter-row" data-qada-fast-id="${item.id}">
      <div class="adhkar-name-block">
        <span class="adhkar-name">${item.label ? escapeHtml(item.label) : 'أيام صيام'}</span>
        ${done ? `<span class="tsr-streak">✅ تم القضاء بالكامل</span>` : ''}
      </div>
      <div class="adhkar-counter-controls">
        <button class="adhkar-count-btn" disabled>${item.remaining}</button>
        <button class="adhkar-plus qada-fast-minus-btn" data-action="dec" ${done ? 'disabled' : ''}>−</button>
        ${kebabMenuHtml('qf-' + item.id, [
          { key: 'edit', label: 'تعديل' },
          { key: 'remove', label: 'حذف', danger: true }
        ])}
      </div>
    </div>`;
}

async function renderQadaFastingList(container) {
  const items = await getQadaFasting();
  if (items.length === 0) {
    container.innerHTML = `<p class="empty-state-sub">ما في صيام قضاء مسجّل.</p>`;
    return;
  }
  container.innerHTML = items.map(qadaFastingRowHtml).join('');
  container.querySelectorAll('.qada-fast-minus-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const row = btn.closest('[data-qada-fast-id]');
      await decrementQadaFastingDay(Number(row.dataset.qadaFastId));
      await renderQadaFastingList(container);
    });
  });
  wireKebabMenus(container, async (rowId, action) => {
    const id = Number(rowId.replace('qf-', ''));
    if (action === 'edit') {
      openQadaFastingModal({ existingId: id, onSaved: () => renderQadaFastingList(container) });
    } else if (action === 'remove') {
      if (!confirm('حذف هذا القضاء؟')) return;
      await deleteQadaFasting(id);
      await renderQadaFastingList(container);
    }
  });
}

function openQadaFastingModal({ existingId, onSaved } = {}) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal">
      <h2 class="modal-title" id="qada-fasting-modal-title">قضاء صيام</h2>
      <label class="field-label">وصف (اختياري)</label>
      <input class="text-input" id="qada-fasting-label-input" placeholder="مثلاً: قضاء رمضان">
      <label class="field-label">عدد الأيام المتبقية</label>
      <input class="text-input" type="number" min="0" id="qada-fasting-count-input" placeholder="مثلاً: 5">
      <div class="modal-actions">
        ${existingId ? `<button class="btn btn-danger btn-sm" id="qada-fasting-delete-btn">حذف</button>` : ''}
        <button class="btn btn-text" id="qada-fasting-cancel-btn">إلغاء</button>
        <button class="btn btn-primary" id="qada-fasting-save-btn">حفظ</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  (async () => {
    if (!existingId) return;
    const existing = await db.qadaFasting.get(existingId);
    if (!existing) return;
    document.getElementById('qada-fasting-modal-title').textContent = 'تعديل قضاء الصيام';
    document.getElementById('qada-fasting-label-input').value = existing.label || '';
    document.getElementById('qada-fasting-count-input').value = existing.remaining;
  })();

  document.getElementById('qada-fasting-cancel-btn').addEventListener('click', () => overlay.remove());
  const deleteBtn = document.getElementById('qada-fasting-delete-btn');
  if (deleteBtn) deleteBtn.addEventListener('click', async () => {
    if (!confirm('حذف هذا القضاء؟')) return;
    await deleteQadaFasting(existingId);
    overlay.remove();
    if (onSaved) onSaved();
  });
  document.getElementById('qada-fasting-save-btn').addEventListener('click', async () => {
    const count = readNumericField('qada-fasting-count-input', { int: true });
    if (count === null || count < 0) return;
    const label = document.getElementById('qada-fasting-label-input').value.trim();
    if (existingId) await updateQadaFasting(existingId, { label, remaining: count });
    else await createQadaFasting(label, count);
    overlay.remove();
    if (onSaved) onSaved();
  });
}

async function qadaYearlyProvider() {
  const [prayers, fasting] = await Promise.all([getQadaPrayers(), getQadaFasting()]);
  const outstandingPrayers = prayers.filter(p => p.remaining > 0);
  const outstandingFastingDays = fasting.reduce((s, f) => s + f.remaining, 0);
  if (outstandingPrayers.length === 0 && outstandingFastingDays === 0) return null;
  const html = `
    ${outstandingPrayers.map(p => `<div class="yearly-row"><span>${PRAYER_LABELS[p.prayerName]}</span><span>${p.remaining} متبقّية</span></div>`).join('')}
    ${outstandingFastingDays > 0 ? `<div class="yearly-row"><span>أيام صيام متبقّية</span><span>${outstandingFastingDays}</span></div>` : ''}
  `;
  return { title: 'القضاء (الحالة الحالية)', html, count: null };
}

// ===================== Custom adhkar (name + daily count) =====================

async function createCustomAdhkar(name, benefit = '', goalCount = null) {
  const all = await db.customAdhkar.toArray();
  await db.customAdhkar.add({ name, benefit, goalCount, archived: false, order: all.length, createdAt: Date.now() });
}
async function updateCustomAdhkar(id, { name, benefit, goalCount }) {
  await db.customAdhkar.update(id, { name, benefit: benefit || '', goalCount: goalCount ?? null });
}
async function updateCustomAdhkarName(id, name) {
  await db.customAdhkar.update(id, { name });
}
async function getActiveCustomAdhkar() {
  const all = await db.customAdhkar.toArray();
  return all.filter(a => !a.archived).sort((a, b) => a.order - b.order);
}
async function archiveCustomAdhkar(id) { await db.customAdhkar.update(id, { archived: true }); }

async function getCustomAdhkarCount(adhkarId, date) {
  const row = await getLog(db.customAdhkarLogs, 'adhkarId', adhkarId, date);
  return row ? row.count : 0;
}
async function setCustomAdhkarCount(adhkarId, date, count) {
  if (count <= 0) await deleteLog(db.customAdhkarLogs, 'adhkarId', adhkarId, date);
  else await upsertLog(db.customAdhkarLogs, 'adhkarId', adhkarId, date, { count });
}
async function getCustomAdhkarStats(adhkarId) {
  const logs = await db.customAdhkarLogs.where('adhkarId').equals(adhkarId).toArray();
  const dates = logs.filter(l => l.count > 0).map(l => l.date);
  return computeImplicitStats(dates, []);
}

async function renderCustomAdhkarList(container, dateStr, { editable = true, showStreak = false } = {}) {
  const items = await getActiveCustomAdhkar();
  if (items.length === 0) {
    container.innerHTML = `<div class="empty-state"><p>ما في أذكار مخصصة بعد.</p></div>`;
    return;
  }
  const refresh = () => renderCustomAdhkarList(container, dateStr, { editable, showStreak });

  const rows = await Promise.all(items.map(async a => {
    const count = await getCustomAdhkarCount(a.id, dateStr);
    const statsText = showStreak ? statsLine(await getCustomAdhkarStats(a.id)) : '';
    const goalMet = a.goalCount && count >= a.goalCount;
    const countLabel = a.goalCount
      ? `${toArabicNumeral(count)}/${toArabicNumeral(a.goalCount)}`
      : toArabicNumeral(count);
    return `
      <div class="task-row-wrap" data-adhkar-id="${a.id}">
        <button class="adhkar-tap-row" data-action="open" ${editable ? '' : 'disabled'}>
          <span class="adhkar-tap-main">
            <span class="adhkar-tap-text">${escapeHtml(a.name)}</span>
            ${a.benefit ? `<span class="adhkar-tap-benefit">${escapeHtml(a.benefit)}</span>` : ''}
            ${statsText ? `<span class="tsr-streak">${statsText}</span>` : ''}
          </span>
          <span class="adhkar-tap-count ${goalMet ? 'adhkar-goal-met' : ''}">${countLabel}</span>
        </button>
        ${showStreak ? kebabMenuHtml(String(a.id), [
          { key: 'edit', label: 'تعديل' },
          { key: 'remove', label: 'حذف', danger: true }
        ]) : ''}
      </div>`;
  }));
  container.innerHTML = rows.join('');

  container.querySelectorAll('[data-adhkar-id]').forEach(row => {
    const id = Number(row.dataset.adhkarId);
    const item = items.find(a => a.id === id);
    const openBtn = row.querySelector('[data-action="open"]');
    if (!openBtn || !editable) return;
    openBtn.addEventListener('click', () => {
      openTasbeehModal({
        title: item.name,
        benefit: item.benefit,
        goal: item.goalCount,
        getCount: () => getCustomAdhkarCount(id, dateStr),
        setCount: (n) => setCustomAdhkarCount(id, dateStr, n),
        onClose: refresh
      });
    });
  });

  wireKebabMenus(container, async (rowId, action) => {
    const id = Number(rowId);
    if (action === 'edit') {
      const item = items.find(a => a.id === id);
      openAddCustomAdhkarModal(refresh, item);
    } else if (action === 'remove') {
      const item = items.find(a => a.id === id);
      if (!confirm(`حذف "${item.name}"؟`)) return;
      await archiveCustomAdhkar(id);
      await refresh();
    }
  });
}

function openAddCustomAdhkarModal(onAdded, existing = null) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal">
      <h2 class="modal-title">${existing ? 'تعديل الذكر' : 'ذكر جديد'}</h2>
      <label class="field-label">اسم الذكر</label>
      <input class="text-input" id="new-adhkar-name" placeholder="مثلاً: سبحان الله وبحمده" value="${existing ? escapeHtml(existing.name) : ''}" autofocus>
      <label class="field-label">فضله (اختياري)</label>
      <textarea class="mood-note-input" id="new-adhkar-benefit" placeholder="مثلاً: من قالها مئة مرة حُطّت خطاياه...">${existing && existing.benefit ? escapeHtml(existing.benefit) : ''}</textarea>
      <label class="field-label">عدد التكرار المستهدف (اختياري)</label>
      <input class="text-input" type="text" inputmode="numeric" id="new-adhkar-goal" placeholder="مثلاً: ٣٣" value="${existing && existing.goalCount ? toArabicNumeral(existing.goalCount) : ''}">
      <div class="modal-actions">
        <button class="btn btn-text" id="new-adhkar-cancel">إلغاء</button>
        <button class="btn btn-primary" id="new-adhkar-save">${existing ? 'حفظ' : 'إضافة'}</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  document.getElementById('new-adhkar-cancel').addEventListener('click', () => overlay.remove());
  document.getElementById('new-adhkar-save').addEventListener('click', async () => {
    const name = document.getElementById('new-adhkar-name').value.trim();
    if (!name) return;
    const benefit = document.getElementById('new-adhkar-benefit').value.trim();
    const goalCount = readNumericField('new-adhkar-goal', { int: true, min: 1 });
    if (existing) await updateCustomAdhkar(existing.id, { name, benefit, goalCount });
    else await createCustomAdhkar(name, benefit, goalCount);
    overlay.remove();
    if (onAdded) onAdded();
  });
}

// ===================== Worship overview (Home quick-action stats) =====================

async function getWorshipTodayStats() {
  const done = await getFardTodayCount();
  const streak = await getFardStreak();
  const paused = !!(await getActiveFardPause());
  return { done, total: PRAYER_NAMES.length, streak, paused };
}

// ===================== full Worship page =====================

// A worship panel worth looking at: which prayers are actually done (not
// just how many), how the last week went, and where the wird and adhkar
// stand — so the top of the page answers "where am I today?" without
// scrolling through every section to find out.
async function renderWorshipTopCard(container, today) {
  const stats = await getWorshipTodayStats();
  const ringSvg = renderRing({
    size: 96, strokeWidth: 11,
    segments: [{ frac: stats.total ? stats.done / stats.total : 0, color: stats.done === stats.total ? 'var(--success-strong)' : 'var(--btn-color, var(--pink-deep))' }]
  });

  // Which of the five, individually.
  const prayerPills = await Promise.all(PRAYER_NAMES.map(async name => {
    const status = await getFardStatus(name, today);
    const done = status === 'done';
    const missed = status === 'missed';
    return `<span class="prayer-pill ${done ? 'prayer-pill-done' : missed ? 'prayer-pill-missed' : ''}">${PRAYER_LABELS[name]}</span>`;
  }));

  // Last 7 days of prayer completion — the shape of the week.
  const weekDots = await Promise.all(Array.from({ length: 7 }, async (_, i) => {
    const d = addDays(today, -6 + i);
    let n = 0;
    for (const name of PRAYER_NAMES) if (await getFardStatus(name, d) === 'done') n++;
    const level = n === 0 ? 0 : n <= 2 ? 1 : n <= 4 ? 2 : 3;
    return `<span class="worship-week-dot worship-week-${level}" title="${d}: ${n}/5"></span>`;
  }));

  // Adhkar + wird status, so the card covers the whole page's ground.
  const [morningDone, eveningDone] = await Promise.all([
    isDailyAdhkarDone('morning', today),
    isDailyAdhkarDone('evening', today)
  ]);
  const wirdPlan = await getWirdPlan();
  const wirdDone = wirdPlan ? await isWirdLoggedToday() : false;
  const wirdProgress = wirdPlan ? await getWirdProgress() : null;

  container.innerHTML = `
    <div class="worship-top">
      <div class="ring-wrap">
        ${ringSvg}
        <div class="ring-center-text">${toArabicNumeral(stats.done)}/${toArabicNumeral(stats.total)}</div>
      </div>
      <div class="worship-top-side">
        <p class="ring-label">صلواتك اليوم</p>
        <div class="prayer-pills">${prayerPills.join('')}</div>
        <div class="worship-week">${weekDots.join('')}</div>
      </div>
    </div>

    <div class="worship-chips">
      ${stats.streak > 0 ? `<span class="worship-chip worship-chip-on">🔥 ${toArabicNumeral(stats.streak)} يوم</span>` : ''}
      <span class="worship-chip ${morningDone ? 'worship-chip-on' : ''}">🌅 أذكار الصباح</span>
      <span class="worship-chip ${eveningDone ? 'worship-chip-on' : ''}">🌙 أذكار المساء</span>
      ${wirdPlan ? `<span class="worship-chip ${wirdDone ? 'worship-chip-on' : ''}">📖 الورد</span>` : ''}
    </div>

    ${wirdPlan && wirdProgress ? `
      <div class="worship-wird-line">
        <div class="mini-progress-track"><div class="mini-progress-fill" style="width:${(wirdProgress.progressPages / QURAN_TOTAL_PAGES) * 100}%"></div></div>
        <span class="mini-progress-text">📖 ${toArabicNumeral(wirdProgress.progressPages)} من ${toArabicNumeral(QURAN_TOTAL_PAGES)} صفحة${wirdProgress.khatmCount > 0 ? ` · 🌙 ${toArabicNumeral(wirdProgress.khatmCount)} ختمة` : ''}</span>
      </div>` : ''}

    ${stats.paused ? `<p class="settings-note">🌸 التتبّع متوقّف مؤقتاً (الدورة الشهرية)</p>` : ''}
  `;
}

async function renderWorshipPage(params, view) {
  const today = todayStr();

  view.innerHTML = `
    <div class="page-header">
      <button class="icon-btn" aria-label="رجوع" id="worship-back">→</button>
      <h1>العبادة</h1>
    </div>

    <div class="card" id="worship-ring-card"></div>

    <div class="card">
      <h2 class="card-title">الصلوات الخمس</h2>
      <div id="fard-list"></div>
      <button class="btn btn-secondary btn-block pause-btn" id="fard-pause-btn"></button>
    </div>

    <div class="card">
      <h2 class="card-title">السنن والأذكار بعد الصلاة</h2>
      <div class="worship-section-stats" id="extras-stats"></div>
      <div id="extras-list"></div>
    </div>

    <div class="card">
      <h2 class="card-title">نوافل</h2>
      <div id="standalone-sunnah"></div>
    </div>

    <div class="card">
      <h2 class="card-title">أذكار الصباح والمساء</h2>
      <div id="daily-adhkar"></div>
    </div>

    <div class="card">
      <h2 class="card-title">أذكار مخصصة</h2>
      <div id="custom-adhkar-list"></div>
      <button class="btn btn-secondary btn-block" id="add-adhkar-btn">+ ذكر جديد</button>
    </div>

    <div class="card" id="wird-card"></div>

    <div class="card">
      <h2 class="card-title">🕋 القضاء</h2>
      <div class="section-header">
        <h3 class="material-type-label">صلوات فائتة</h3>
        <button class="link-btn" id="add-qada-prayer-btn">+ إضافة</button>
      </div>
      <div id="qada-prayers-list"></div>
      <div class="section-header" style="margin-top: var(--space-3);">
        <h3 class="material-type-label">صيام فائت</h3>
        <button class="link-btn" id="add-qada-fasting-btn">+ إضافة</button>
      </div>
      <div id="qada-fasting-list"></div>
    </div>
  `;

  document.getElementById('worship-back').addEventListener('click', () => history.back());

  async function refreshRingAndPause() {
    await renderWorshipTopCard(document.getElementById('worship-ring-card'), today);
    const stats = await getWorshipTodayStats();
    const pauseBtn = document.getElementById('fard-pause-btn');
    if (pauseBtn) pauseBtn.textContent = stats.paused ? '🌸 استئناف التتبع بعد الدورة' : '🌸 إيقاف مؤقت (الدورة الشهرية)';
  }

  await refreshRingAndPause();
  await renderFardList(document.getElementById('fard-list'), today, { editable: true, showStreak: true, onChange: refreshRingAndPause });

  document.getElementById('fard-pause-btn').addEventListener('click', async () => {
    const activePause = await getActiveFardPause();
    if (activePause) await endFardPause();
    else await startFardPause();
    await refreshRingAndPause();
  });

  const [sunnahStats, adhkarAfterStats] = await Promise.all([getSunnahStats(), getAdhkarAfterStats()]);
  document.getElementById('extras-stats').innerHTML = `
    <p class="worship-stat-line">سنن: ${statsLine(sunnahStats) || '—'}</p>
    <p class="worship-stat-line">أذكار بعد الصلاة: ${statsLine(adhkarAfterStats) || '—'}</p>
  `;

  await renderExtrasList(document.getElementById('extras-list'), today);
  await renderDailyAdhkar(document.getElementById('daily-adhkar'), today);
  await renderStandaloneSunnah(document.getElementById('standalone-sunnah'), today, { showStreak: true });
  await renderWirdCard(document.getElementById('wird-card'));

  const qadaPrayersEl = document.getElementById('qada-prayers-list');
  await renderQadaPrayersList(qadaPrayersEl);
  document.getElementById('add-qada-prayer-btn').addEventListener('click', () => {
    openQadaPrayerModal({ onSaved: () => renderQadaPrayersList(qadaPrayersEl) });
  });
  const qadaFastingEl = document.getElementById('qada-fasting-list');
  await renderQadaFastingList(qadaFastingEl);
  document.getElementById('add-qada-fasting-btn').addEventListener('click', () => {
    openQadaFastingModal({ onSaved: () => renderQadaFastingList(qadaFastingEl) });
  });

  const adhkarListEl = document.getElementById('custom-adhkar-list');
  await renderCustomAdhkarList(adhkarListEl, today, { editable: true, showStreak: true });
  document.getElementById('add-adhkar-btn').addEventListener('click', () => {
    openAddCustomAdhkarModal(() => renderCustomAdhkarList(adhkarListEl, today, { editable: true, showStreak: true }));
  });
}

// ===================== Day Detail providers =====================

async function fardDayProvider(dateStr) {
  const node = document.createElement('div');
  await renderFardList(node, dateStr, { editable: !isFutureDate(dateStr) });
  return { title: 'الصلوات', node };
}

async function worshipExtrasDayProvider(dateStr) {
  const anySunnah = await Promise.all(PRAYER_NAMES.map(p => isSunnahDone(p, dateStr)));
  const anyAdhkar = await Promise.all(PRAYER_NAMES.map(p => isAdhkarAfterDone(p, dateStr)));
  const morning = await isDailyAdhkarDone('morning', dateStr);
  const evening = await isDailyAdhkarDone('evening', dateStr);
  const duha = await isStandaloneSunnahDone('duha', dateStr);
  if (!anySunnah.some(Boolean) && !anyAdhkar.some(Boolean) && !morning && !evening && !duha) return null;
  const node = document.createElement('div');
  await renderExtrasList(node, dateStr);
  if (duha) {
    const duhaNode = document.createElement('p');
    duhaNode.className = 'period-day-note';
    duhaNode.textContent = '☀️ صلاة الضحى';
    node.appendChild(duhaNode);
  }
  const adhkarNode = document.createElement('div');
  adhkarNode.className = 'day-detail-subsection';
  await renderDailyAdhkar(adhkarNode, dateStr);
  node.appendChild(adhkarNode);
  return { title: 'السنن والأذكار', node };
}

async function customAdhkarDayProvider(dateStr) {
  const items = await getActiveCustomAdhkar();
  const counts = await Promise.all(items.map(a => getCustomAdhkarCount(a.id, dateStr)));
  if (items.length === 0 || counts.every(c => c === 0)) return null;
  const node = document.createElement('div');
  await renderCustomAdhkarList(node, dateStr, { editable: !isFutureDate(dateStr) });
  return { title: 'أذكار مخصصة', node };
}

// ---------- Yearly stats provider ----------

async function worshipYearlyProvider(year) {
  const prefix = String(year);
  const [prayerLogs, sunnahLogs, adhkarAfterLogs, dailyAdhkarLogs, customAdhkar, customAdhkarLogs, standaloneSunnahLogs] = await Promise.all([
    db.prayerLogs.toArray(), db.sunnahLogs.toArray(), db.adhkarAfterLogs.toArray(), db.dailyAdhkarLogs.toArray(),
    getActiveCustomAdhkar(), db.customAdhkarLogs.toArray(), db.standaloneSunnahLogs.toArray()
  ]);
  const fardDone = prayerLogs.filter(l => l.date.startsWith(prefix) && l.status === 'done').length;
  const sunnahDone = sunnahLogs.filter(l => l.date.startsWith(prefix)).length;
  const adhkarAfterDone = adhkarAfterLogs.filter(l => l.date.startsWith(prefix)).length;
  const dailyAdhkarDone = dailyAdhkarLogs.filter(l => l.date.startsWith(prefix)).length;
  const duhaDone = standaloneSunnahLogs.filter(l => l.kind === 'duha' && l.date.startsWith(prefix)).length;
  const yearCustomLogs = customAdhkarLogs.filter(l => l.date.startsWith(prefix));
  const customTotal = yearCustomLogs.reduce((s, l) => s + l.count, 0);

  if (fardDone === 0 && sunnahDone === 0 && adhkarAfterDone === 0 && dailyAdhkarDone === 0 && duhaDone === 0 && customTotal === 0) return null;

  const customRows = customAdhkar.map(a => {
    const sum = yearCustomLogs.filter(l => l.adhkarId === a.id).reduce((s, l) => s + l.count, 0);
    return sum > 0 ? `<div class="yearly-row"><span>${escapeHtml(a.name)}</span><span>${sum}</span></div>` : '';
  }).join('');

  const html = `
    <div class="yearly-row"><span>الفرائض</span><span>${fardDone} صلاة</span></div>
    <div class="yearly-row"><span>السنن</span><span>${sunnahDone}</span></div>
    <div class="yearly-row"><span>أذكار بعد الصلاة</span><span>${adhkarAfterDone}</span></div>
    <div class="yearly-row"><span>أذكار الصباح والمساء</span><span>${dailyAdhkarDone}</span></div>
    ${duhaDone > 0 ? `<div class="yearly-row"><span>☀️ صلاة الضحى</span><span>${duhaDone} يوم</span></div>` : ''}
    ${customRows}
  `;
  return { title: 'العبادة', html, count: fardDone + sunnahDone + adhkarAfterDone + dailyAdhkarDone + duhaDone + customTotal };
}
