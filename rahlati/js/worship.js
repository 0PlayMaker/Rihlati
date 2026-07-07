// worship.js — Phase 2.
// Fard reuses the exact same streak engine and row component as Habits
// (that reuse is the payoff of normalizing prayerLogs instead of using
// 5 boolean columns). Sunnah / adhkar-after / daily adhkar stay 2-state
// checkboxes, same reasoning as Fixed Tasks: no "missed" button exists
// for them, so there's no real 3rd state to model.

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

function fardRowHtml(prayerName, status, { editable, showStreak, streak }) {
  return threeStateRowHtml({
    rowId: prayerName,
    icon: '🕌',
    name: PRAYER_LABELS[prayerName],
    status, editable, showStreak, streak
  });
}

async function renderFardList(container, dateStr, { editable, onChange } = {}) {
  const rows = await Promise.all(PRAYER_NAMES.map(async p => {
    const status = await getFardStatus(p, dateStr);
    return fardRowHtml(p, status, { editable, showStreak: false, streak: 0 });
  }));
  container.innerHTML = rows.join('');
  wireThreeStateRows(container, async (prayerName, action) => {
    if (action === 'done') await setFardStatus(prayerName, dateStr, 'done');
    else if (action === 'missed') await setFardStatus(prayerName, dateStr, 'missed');
    else if (action === 'undo') await clearFardStatus(prayerName, dateStr);
    await renderFardList(container, dateStr, { editable, onChange });
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

// ===================== Custom adhkar (name + daily count) =====================

async function createCustomAdhkar(name) {
  const all = await db.customAdhkar.toArray();
  await db.customAdhkar.add({ name, archived: false, order: all.length, createdAt: Date.now() });
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

async function renderCustomAdhkarList(container, dateStr, { editable = true } = {}) {
  const items = await getActiveCustomAdhkar();
  if (items.length === 0) {
    container.innerHTML = `<div class="empty-state"><p>ما في أذكار مخصصة بعد.</p></div>`;
    return;
  }
  const rows = await Promise.all(items.map(async a => {
    const count = await getCustomAdhkarCount(a.id, dateStr);
    return `
      <div class="adhkar-counter-row" data-adhkar-id="${a.id}">
        <span class="adhkar-name">${escapeHtml(a.name)}</span>
        <div class="adhkar-counter-controls">
          <button class="adhkar-count-btn" data-action="edit" ${editable ? '' : 'disabled'}>${count}</button>
          ${editable ? `<button class="adhkar-plus" data-action="inc">+</button>` : ''}
        </div>
      </div>`;
  }));
  container.innerHTML = rows.join('');
  container.querySelectorAll('.adhkar-counter-row').forEach(row => {
    const id = Number(row.dataset.adhkarId);
    const incBtn = row.querySelector('[data-action="inc"]');
    if (incBtn) incBtn.addEventListener('click', async () => {
      await incrementCustomAdhkarCount(id, dateStr);
      await renderCustomAdhkarList(container, dateStr, { editable });
    });
    row.querySelector('[data-action="edit"]').addEventListener('click', async () => {
      if (!editable) return;
      const current = await getCustomAdhkarCount(id, dateStr);
      const input = prompt('عدد مرات التكرار:', String(current));
      if (input === null) return;
      const n = parseInt(input, 10);
      if (!Number.isNaN(n) && n >= 0) {
        await setCustomAdhkarCount(id, dateStr, n);
        await renderCustomAdhkarList(container, dateStr, { editable });
      }
    });
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
      <div id="extras-list"></div>
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
  await renderFardList(document.getElementById('fard-list'), today, { editable: true, onChange: refreshRingAndPause });

  document.getElementById('fard-pause-btn').addEventListener('click', async () => {
    const activePause = await getActiveFardPause();
    if (activePause) await endFardPause();
    else await startFardPause();
    await refreshRingAndPause();
  });

  await renderExtrasList(document.getElementById('extras-list'), today);
  await renderDailyAdhkar(document.getElementById('daily-adhkar'), today);

  const adhkarListEl = document.getElementById('custom-adhkar-list');
  await renderCustomAdhkarList(adhkarListEl, today, { editable: true });
  document.getElementById('add-adhkar-btn').addEventListener('click', () => {
    openAddCustomAdhkarModal(() => renderCustomAdhkarList(adhkarListEl, today, { editable: true }));
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
  if (!anySunnah.some(Boolean) && !anyAdhkar.some(Boolean) && !morning && !evening) return null;
  const node = document.createElement('div');
  await renderExtrasList(node, dateStr);
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
  const [prayerLogs, sunnahLogs, adhkarAfterLogs, dailyAdhkarLogs, customAdhkar, customAdhkarLogs] = await Promise.all([
    db.prayerLogs.toArray(), db.sunnahLogs.toArray(), db.adhkarAfterLogs.toArray(), db.dailyAdhkarLogs.toArray(),
    getActiveCustomAdhkar(), db.customAdhkarLogs.toArray()
  ]);
  const fardDone = prayerLogs.filter(l => l.date.startsWith(prefix) && l.status === 'done').length;
  const sunnahDone = sunnahLogs.filter(l => l.date.startsWith(prefix)).length;
  const adhkarAfterDone = adhkarAfterLogs.filter(l => l.date.startsWith(prefix)).length;
  const dailyAdhkarDone = dailyAdhkarLogs.filter(l => l.date.startsWith(prefix)).length;
  const yearCustomLogs = customAdhkarLogs.filter(l => l.date.startsWith(prefix));
  const customTotal = yearCustomLogs.reduce((s, l) => s + l.count, 0);

  if (fardDone === 0 && sunnahDone === 0 && adhkarAfterDone === 0 && dailyAdhkarDone === 0 && customTotal === 0) return null;

  const customRows = customAdhkar.map(a => {
    const sum = yearCustomLogs.filter(l => l.adhkarId === a.id).reduce((s, l) => s + l.count, 0);
    return sum > 0 ? `<div class="yearly-row"><span>${escapeHtml(a.name)}</span><span>${sum}</span></div>` : '';
  }).join('');

  const html = `
    <div class="yearly-row"><span>الفرائض</span><span>${fardDone} صلاة</span></div>
    <div class="yearly-row"><span>السنن</span><span>${sunnahDone}</span></div>
    <div class="yearly-row"><span>أذكار بعد الصلاة</span><span>${adhkarAfterDone}</span></div>
    <div class="yearly-row"><span>أذكار الصباح والمساء</span><span>${dailyAdhkarDone}</span></div>
    ${customRows}
  `;
  return { title: 'العبادة', html, count: fardDone + sunnahDone + adhkarAfterDone + dailyAdhkarDone + customTotal };
}
