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
async function setFardStatus(prayerName, date, status) {
  await upsertLog(db.prayerLogs, 'prayerName', prayerName, date, { status });
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
}

// "Day counts" if both morning AND evening were marked.
async function getDailyAdhkarStats() {
  const logs = await db.dailyAdhkarLogs.toArray();
  const countByDate = {};
  logs.forEach(l => { countByDate[l.date] = (countByDate[l.date] || 0) + 1; });
  const dates = Object.keys(countByDate).filter(d => countByDate[d] >= 2);
  return computeImplicitStats(dates, []);
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
    btn.addEventListener('click', async () => {
      await toggleDailyAdhkar(btn.dataset.kind, dateStr);
      await renderDailyAdhkar(container, dateStr);
    });
  });
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
  else await db.wirdSettings.put({ id: 1, dailyAmount, unit, progressPages: 0, khatmCount: 0, createdAt: Date.now() });
}
async function deleteWirdPlan() {
  await db.wirdSettings.delete(1);
  await db.wirdLogs.clear();
}
async function isWirdLoggedToday() {
  return !!(await db.wirdLogs.where('date').equals(todayStr()).first());
}
async function logWirdToday() {
  const plan = await getWirdPlan();
  if (!plan || await isWirdLoggedToday()) return;
  const pagesToAdd = wirdUnitToPages(plan.dailyAmount, plan.unit);
  let newProgress = plan.progressPages + pagesToAdd;
  let triggeredKhatm = false;
  if (newProgress >= QURAN_TOTAL_PAGES) {
    triggeredKhatm = true;
    newProgress -= QURAN_TOTAL_PAGES;
  }
  await db.wirdSettings.update(1, { progressPages: newProgress, khatmCount: plan.khatmCount + (triggeredKhatm ? 1 : 0) });
  await db.wirdLogs.add({ date: todayStr(), pagesAdded: pagesToAdd, triggeredKhatm });
}
async function undoWirdToday() {
  const log = await db.wirdLogs.where('date').equals(todayStr()).first();
  if (!log) return;
  const plan = await getWirdPlan();
  let restoredProgress = plan.progressPages - log.pagesAdded;
  let khatmCount = plan.khatmCount;
  if (log.triggeredKhatm) {
    khatmCount -= 1;
    restoredProgress += QURAN_TOTAL_PAGES;
  }
  await db.wirdSettings.update(1, { progressPages: restoredProgress, khatmCount });
  await db.wirdLogs.delete(log.id);
}
async function getWirdStreak() {
  const logs = await db.wirdLogs.toArray();
  return computeCurrentStreak(logs.map(l => l.date), []);
}
function estimateWirdDaysToFinish(plan) {
  const dailyPages = wirdUnitToPages(plan.dailyAmount, plan.unit);
  if (dailyPages <= 0) return null;
  const remaining = QURAN_TOTAL_PAGES - plan.progressPages;
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
  const daysLeft = estimateWirdDaysToFinish(plan);
  const frac = plan.progressPages / QURAN_TOTAL_PAGES;

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
    <p class="mini-progress-text">${plan.progressPages} من ${QURAN_TOTAL_PAGES} صفحة</p>
    ${daysLeft != null ? `<p class="settings-note">بهذا المعدل، ستختمين خلال ~${daysLeft} ${daysLeft === 1 ? 'يوم' : 'يوماً'}</p>` : ''}
    <p class="tsr-streak">🌙 عدد الختمات: ${plan.khatmCount} ${streak > 0 ? `· 🔥${streak}` : ''}</p>
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
    const amount = parseFloat(document.getElementById('wird-amount-input').value);
    if (Number.isNaN(amount) || amount <= 0) return;
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

// ===================== Custom adhkar (name + daily count) =====================

async function createCustomAdhkar(name) {
  const all = await db.customAdhkar.toArray();
  await db.customAdhkar.add({ name, archived: false, order: all.length, createdAt: Date.now() });
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
async function incrementCustomAdhkarCount(adhkarId, date) {
  const current = await getCustomAdhkarCount(adhkarId, date);
  await setCustomAdhkarCount(adhkarId, date, current + 1);
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
  const rows = await Promise.all(items.map(async a => {
    const count = await getCustomAdhkarCount(a.id, dateStr);
    const statsText = showStreak ? statsLine(await getCustomAdhkarStats(a.id)) : '';
    return `
      <div class="adhkar-counter-row" data-adhkar-id="${a.id}">
        <div class="adhkar-name-block">
          <span class="adhkar-name">${escapeHtml(a.name)}</span>
          ${statsText ? `<span class="tsr-streak">${statsText}</span>` : ''}
        </div>
        <div class="adhkar-counter-controls">
          <button class="adhkar-count-btn" data-action="edit" ${editable ? '' : 'disabled'}>${count}</button>
          ${editable ? `<button class="adhkar-plus" data-action="inc">+</button>` : ''}
          ${showStreak ? kebabMenuHtml(String(a.id), [
            { key: 'rename', label: 'تعديل الاسم' },
            { key: 'remove', label: 'حذف', danger: true }
          ]) : ''}
        </div>
      </div>`;
  }));
  container.innerHTML = rows.join('');
  container.querySelectorAll('.adhkar-counter-row').forEach(row => {
    const id = Number(row.dataset.adhkarId);
    const incBtn = row.querySelector('[data-action="inc"]');
    if (incBtn) incBtn.addEventListener('click', async () => {
      await incrementCustomAdhkarCount(id, dateStr);
      await renderCustomAdhkarList(container, dateStr, { editable, showStreak });
    });
    row.querySelector('[data-action="edit"]').addEventListener('click', async () => {
      if (!editable) return;
      const current = await getCustomAdhkarCount(id, dateStr);
      const input = prompt('عدد مرات التكرار:', String(current));
      if (input === null) return;
      const n = parseInt(input, 10);
      if (!Number.isNaN(n) && n >= 0) {
        await setCustomAdhkarCount(id, dateStr, n);
        await renderCustomAdhkarList(container, dateStr, { editable, showStreak });
      }
    });
  });
  wireKebabMenus(container, async (rowId, action) => {
    const id = Number(rowId);
    if (action === 'rename') {
      const item = items.find(a => a.id === id);
      const input = prompt('اسم الذكر:', item.name);
      if (input === null || !input.trim()) return;
      await updateCustomAdhkarName(id, input.trim());
      await renderCustomAdhkarList(container, dateStr, { editable, showStreak });
    } else if (action === 'remove') {
      const item = items.find(a => a.id === id);
      if (!confirm(`حذف "${item.name}"؟`)) return;
      await archiveCustomAdhkar(id);
      await renderCustomAdhkarList(container, dateStr, { editable, showStreak });
    }
  });
}

function openAddCustomAdhkarModal(onAdded) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal">
      <h2 class="modal-title">ذكر جديد</h2>
      <label class="field-label">اسم الذكر</label>
      <input class="text-input" id="new-adhkar-name" placeholder="مثلاً: سبحان الله" autofocus>
      <div class="modal-actions">
        <button class="btn btn-text" id="new-adhkar-cancel">إلغاء</button>
        <button class="btn btn-primary" id="new-adhkar-save">إضافة</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  document.getElementById('new-adhkar-cancel').addEventListener('click', () => overlay.remove());
  document.getElementById('new-adhkar-save').addEventListener('click', async () => {
    const name = document.getElementById('new-adhkar-name').value.trim();
    if (!name) return;
    await createCustomAdhkar(name);
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

async function renderWorshipPage(params, view) {
  const today = todayStr();

  view.innerHTML = `
    <div class="page-header">
      <button class="icon-btn" id="worship-back">→</button>
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

    <div class="card" id="wird-card"></div>

    <div class="card">
      <h2 class="card-title">أذكار الصباح والمساء</h2>
      <div class="worship-section-stats" id="daily-adhkar-stats"></div>
      <div id="daily-adhkar"></div>
    </div>

    <div class="card">
      <h2 class="card-title">أذكار مخصصة</h2>
      <div id="custom-adhkar-list"></div>
      <button class="btn btn-secondary btn-block" id="add-adhkar-btn">+ ذكر جديد</button>
    </div>
  `;

  document.getElementById('worship-back').addEventListener('click', () => history.back());

  async function refreshRingAndPause() {
    const stats = await getWorshipTodayStats();
    const ringSvg = renderRing({
      size: 100, strokeWidth: 12,
      segments: [{ frac: stats.done / stats.total, color: 'var(--mint-deep)' }]
    });
    document.getElementById('worship-ring-card').innerHTML = `
      <div class="rings-row">
        <div class="ring-wrap">${ringSvg}<div class="ring-center-text">${stats.done}/${stats.total}</div></div>
        <div class="ring-label-block">
          <p class="ring-label">صلواتك اليوم</p>
          <span class="mini-progress-text">${stats.streak > 0 ? `🔥 ${stats.streak} يوم متتالي` : 'ابدئي اليوم 🌸'}${stats.paused ? ' — متوقف مؤقتاً 🌸' : ''}</span>
        </div>
      </div>`;
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

  const [sunnahStats, adhkarAfterStats, dailyStats] = await Promise.all([getSunnahStats(), getAdhkarAfterStats(), getDailyAdhkarStats()]);
  document.getElementById('extras-stats').innerHTML = `
    <p class="worship-stat-line">سنن: ${statsLine(sunnahStats) || '—'}</p>
    <p class="worship-stat-line">أذكار بعد الصلاة: ${statsLine(adhkarAfterStats) || '—'}</p>
  `;
  document.getElementById('daily-adhkar-stats').innerHTML = `<p class="worship-stat-line">${statsLine(dailyStats) || '—'}</p>`;

  await renderExtrasList(document.getElementById('extras-list'), today);
  await renderDailyAdhkar(document.getElementById('daily-adhkar'), today);
  await renderStandaloneSunnah(document.getElementById('standalone-sunnah'), today, { showStreak: true });
  await renderWirdCard(document.getElementById('wird-card'));

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
