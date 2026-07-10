// period.js — Phase 3.
// Periods are episodes (start/end), not per-day logs, so this table
// stays small and just gets read in full. Predictions are NEVER stored
// — only real start/end dates ever go in periodLogs, and every
// prediction is fully recomputed from those logs on every read, so an
// edited or deleted period can never leave a stale prediction behind.
//
// Prediction model:
//   - median (not mean) of a ROLLING WINDOW of the last 8 cycle gaps
//     and period lengths — recent cycles predict the next one better
//     than ones from a year ago, and a single 45-day outlier shouldn't
//     drag a normally-28-day estimate around either way.
//   - shown as a DATE RANGE, not one falsely-precise date — width of
//     the range comes from how much recent cycles actually vary
//     (median absolute deviation), not a fixed number.
//   - a confidence level (low/medium/high) from sample count + that
//     same variability, and a plain "not enough data yet" state below
//     2 samples rather than a confident-looking guess from one cycle.
//
// Starting/ending a period asks (via a checkbox in the modal, checked
// by default) whether to pause/resume Worship's fard tracking — it
// used to do this silently and automatically, which meant she couldn't
// opt out. The manual 🌸 button in Worship still works independently.

function median(nums) {
  if (!nums.length) return null;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

// How much the recent cycles actually vary — the basis for both the
// confidence level and how wide the predicted range needs to be. A
// cycle history that's consistently ~28 days needs a narrow range; one
// that swings between 24 and 35 needs a wide one and lower confidence,
// rather than reporting a falsely-precise single date either way.
function medianAbsoluteDeviation(nums) {
  const med = median(nums);
  if (med === null) return 0;
  return median(nums.map(n => Math.abs(n - med))) ?? 0;
}

async function getAllPeriods() {
  const all = await db.periodLogs.toArray();
  return all.sort((a, b) => b.startDate.localeCompare(a.startDate)); // newest first
}
async function getOngoingPeriod() {
  const all = await db.periodLogs.toArray();
  return all.find(p => p.endDate === null) || null;
}

async function startPeriod(startDate) {
  const ongoing = await getOngoingPeriod();
  if (ongoing) return ongoing; // one ongoing at a time — no duplicates
  const id = await db.periodLogs.add({ startDate, endDate: null, createdAt: Date.now() });
  return db.periodLogs.get(id);
}
async function endPeriod(periodId, endDate) {
  await db.periodLogs.update(periodId, { endDate });
}
async function editPeriod(periodId, startDate, endDate) {
  await db.periodLogs.update(periodId, { startDate, endDate: endDate || null });
}
async function deletePeriod(periodId) {
  await db.periodLogs.delete(periodId);
}

async function getPeriodStats() {
  const periods = await getAllPeriods(); // newest first
  const chronological = [...periods].sort((a, b) => a.startDate.localeCompare(b.startDate));

  const allCycleLengths = [];
  for (let i = 1; i < chronological.length; i++) {
    const gap = daysBetween(chronological[i - 1].startDate, chronological[i].startDate);
    if (gap > 10 && gap < 90) allCycleLengths.push(gap); // sanity bounds — drop obvious data-entry mistakes
  }
  const recentCycleLengths = allCycleLengths.slice(-8); // oldest→newest order, so the last 8 = most recent 8

  const allPeriodLengths = periods
    .filter(p => p.endDate !== null)
    .map(p => daysBetween(p.startDate, p.endDate) + 1)
    .filter(n => n > 0 && n < 20);
  const recentPeriodLengths = allPeriodLengths.slice(0, 8); // periods is newest-first already

  const cycleSpread = medianAbsoluteDeviation(recentCycleLengths);

  let confidence = 'none';
  if (recentCycleLengths.length >= 1) {
    if (recentCycleLengths.length >= 5 && cycleSpread <= 2) confidence = 'high';
    else if (recentCycleLengths.length >= 3 && cycleSpread <= 5) confidence = 'medium';
    else if (recentCycleLengths.length >= 2) confidence = 'low';
    else confidence = 'very_low';
  }

  return {
    avgCycleLength: median(recentCycleLengths) ?? 28,
    avgPeriodLength: median(recentPeriodLengths) ?? 5,
    cycleSamples: recentCycleLengths.length,
    periodSamples: recentPeriodLengths.length,
    cycleSpread,
    confidence
  };
}

function confidenceLabel(level) {
  return { high: 'ثقة عالية', medium: 'ثقة متوسطة', low: 'ثقة منخفضة', very_low: 'ثقة منخفضة جداً — دورة واحدة فقط', none: '' }[level] || '';
}

// Ovulation is predicted by counting BACKWARD from the next period,
// not forward from the last one — the luteal phase (post-ovulation to
// next period) is hormonally regulated and stays close to 14 days for
// most people, while the follicular phase (period to ovulation) is the
// part that actually varies cycle to cycle. Counting forward with a
// fixed "day 14" assumption is a common mistake; only ~14% of women
// with a 28-day cycle actually ovulate on day 14 specifically.
// Fertile window = the 5 days before ovulation + ovulation day itself
// (6 days total) — sperm can survive ~5 days, the egg is viable only
// ~12-24h after release, so this is the biological window where
// intercourse could result in pregnancy.
const LUTEAL_PHASE_DAYS = 14;
function getFertilityPrediction(predictedNextPeriodStart) {
  const ovulationDate = addDays(predictedNextPeriodStart, -LUTEAL_PHASE_DAYS);
  const fertileStart = addDays(ovulationDate, -5);
  const fertileEnd = ovulationDate;
  return { ovulationDate, fertileStart, fertileEnd };
}
// Levels reflect the corrected Wilcox/Dunson day-specific data: the
// single highest conception probability is the 1-2 days BEFORE
// ovulation (not ovulation day itself, which is meaningfully lower),
// and probability drops to near-zero the day AFTER ovulation because
// the egg only survives ~12-24h. So: peak = 1-2 days pre-ovulation,
// high = ovulation day + day 3-before, medium = the window's outer
// edge (4-5 days before).
function fertilityLevelForDate(dateStr, fertility) {
  if (!fertility) return null;
  const { ovulationDate, fertileStart, fertileEnd } = fertility;
  if (dateStr < fertileStart || dateStr > fertileEnd) return null;
  const daysBeforeOvulation = daysBetween(dateStr, ovulationDate); // 0 on ovulation day, positive before it
  if (daysBeforeOvulation === 1 || daysBeforeOvulation === 2) return 'peak';
  if (daysBeforeOvulation === 0 || daysBeforeOvulation === 3) return 'high';
  return 'medium';
}

async function getPeriodStatus() {
  const ongoing = await getOngoingPeriod();
  const stats = await getPeriodStats();
  const today = todayStr();

  if (ongoing) {
    const dayNum = daysBetween(ongoing.startDate, today) + 1;
    const remaining = Math.round(stats.avgPeriodLength) - dayNum;
    return { state: 'ongoing', dayNum, remaining, period: ongoing, stats };
  }

  const periods = await getAllPeriods();
  if (periods.length === 0) return { state: 'no-data', stats };
  if (stats.confidence === 'none') return { state: 'unknown', stats };

  // Predicted window: center ± spread (at least ±1 day so the range
  // is never a single degenerate point pretending to be a range).
  const halfWidth = Math.max(1, Math.round(stats.cycleSpread));
  const center = addDays(periods[0].startDate, Math.round(stats.avgCycleLength));
  const rangeStart = addDays(center, -halfWidth);
  const rangeEnd = addDays(center, halfWidth);
  const fertility = getFertilityPrediction(center);

  if (today < rangeStart) {
    return { state: 'upcoming', daysUntil: daysBetween(today, rangeStart), rangeStart, rangeEnd, stats, fertility };
  }
  if (today <= rangeEnd) {
    return { state: 'due', rangeStart, rangeEnd, stats, fertility };
  }
  return { state: 'late', daysLate: daysBetween(rangeEnd, today), rangeStart, rangeEnd, stats, fertility };
}

function periodStatusText(status) {
  const conf = status.stats?.confidence && status.stats.confidence !== 'none' ? ` (${confidenceLabel(status.stats.confidence)})` : '';
  switch (status.state) {
    case 'ongoing':
      if (status.remaining > 0) return `اليوم ${status.dayNum} من الدورة 🌸 — يُتوقع الانتهاء بعد ${status.remaining} ${status.remaining === 1 ? 'يوم' : 'أيام'}`;
      if (status.remaining === 0) return `اليوم ${status.dayNum} من الدورة 🌸 — من المتوقع تنتهي اليوم`;
      return `اليوم ${status.dayNum} من الدورة 🌸 — تجاوزت المعتاد بـ ${-status.remaining} ${(-status.remaining) === 1 ? 'يوم' : 'أيام'}`;
    case 'upcoming':
      return `الدورة القادمة متوقعة بين ${formatDateArabic(status.rangeStart, { weekday: false })} و${formatDateArabic(status.rangeEnd, { weekday: false })}${conf} 🌸`;
    case 'due':
      return `الدورة متوقعة خلال هذه الأيام (حتى ${formatDateArabic(status.rangeEnd, { weekday: false })})${conf} 🌸`;
    case 'late':
      return status.daysLate === 1 ? `الدورة متأخرة يوم واحد عن نافذة التوقع ⏳${conf}` : `الدورة متأخرة ${status.daysLate} أيام عن نافذة التوقع ⏳${conf}`;
    case 'unknown':
      return 'سجلي دورة أخرى ليصبح التوقع ممكناً (تقديري في البداية) 🌸';
    default:
      return 'سجلي أول دورة لتبدأ التوقعات 🌸';
  }
}

function periodGlanceText(status) {
  switch (status.state) {
    case 'ongoing': return `يوم ${status.dayNum}${status.remaining > 0 ? ` · ${status.remaining}` : ''}`;
    case 'upcoming': return `بعد ${status.daysUntil}+ يوم`;
    case 'due': return 'متوقعة الآن';
    case 'late': return `متأخرة ${status.daysLate}+`;
    case 'unknown': return 'دورة أخرى للتوقع';
    default: return 'سجلي أول دورة';
  }
}

function fertilityStatusText(status) {
  if (!status.fertility) return '';
  const { ovulationDate, fertileStart, fertileEnd } = status.fertility;
  const today = todayStr();
  if (today >= fertileStart && today <= fertileEnd) {
    const level = fertilityLevelForDate(today, status.fertility);
    const label = level === 'peak' ? 'ذروة الخصوبة 🌟' : level === 'high' ? 'خصوبة عالية' : 'خصوبة متوسطة';
    return `اليوم ضمن نافذة الخصوبة المتوقعة — ${label}`;
  }
  if (today < fertileStart) {
    return `الإباضة المتوقعة: ${formatDateArabic(ovulationDate, { weekday: false })} · نافذة الخصوبة: ${formatDateArabic(fertileStart, { weekday: false })} – ${formatDateArabic(fertileEnd, { weekday: false })}`;
  }
  return '';
}

// ---------- modals ----------

function openAddPastPeriodModal(onDone) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal">
      <h2 class="modal-title">إضافة دورة سابقة</h2>
      <p class="settings-note">لتحسين دقّة التوقعات، أضيفي أكبر عدد ممكن من الدورات السابقة إن تذكّرتِ تواريخها.</p>
      <label class="field-label">تاريخ البداية</label>
      <input class="text-input" type="date" id="past-period-start-input" value="${todayStr()}">
      <label class="field-label">تاريخ النهاية (اختياري)</label>
      <input class="text-input" type="date" id="past-period-end-input">
      <div class="modal-actions">
        <button class="btn btn-text" id="past-period-cancel">إلغاء</button>
        <button class="btn btn-primary" id="past-period-save">إضافة</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  document.getElementById('past-period-cancel').addEventListener('click', () => overlay.remove());
  document.getElementById('past-period-save').addEventListener('click', async () => {
    const start = document.getElementById('past-period-start-input').value;
    const end = document.getElementById('past-period-end-input').value || null;
    if (!start) return;
    if (end && end < start) { alert('تاريخ النهاية قبل البداية'); return; }
    await db.periodLogs.add({ startDate: start, endDate: end, createdAt: Date.now() });
    overlay.remove();
    toast('🌸 تمت إضافة الدورة');
    if (onDone) onDone();
  });
}

function openStartPeriodModal(onDone) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal">
      <h2 class="modal-title">بدء دورة جديدة</h2>
      <label class="field-label">تاريخ البداية</label>
      <input class="text-input" type="date" id="period-start-input" value="${todayStr()}">
      <label class="checkbox-row"><input type="checkbox" id="period-start-pause-input" checked><span>إيقاف تتبع الصلوات مؤقتاً خلال الدورة</span></label>
      <div class="modal-actions">
        <button class="btn btn-text" id="period-start-cancel">إلغاء</button>
        <button class="btn btn-primary" id="period-start-save">بدء</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  document.getElementById('period-start-cancel').addEventListener('click', () => overlay.remove());
  document.getElementById('period-start-save').addEventListener('click', async () => {
    const date = document.getElementById('period-start-input').value;
    if (!date) return;
    const pausePrayers = document.getElementById('period-start-pause-input').checked;
    await startPeriod(date);
    if (pausePrayers) await startFardPause();
    overlay.remove();
    toast(pausePrayers ? '🌸 تم تسجيل بداية الدورة — تم إيقاف تتبع الصلوات' : '🌸 تم تسجيل بداية الدورة');
    if (onDone) onDone();
  });
}

function openEndPeriodModal(period, onDone) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal">
      <h2 class="modal-title">إنهاء الدورة</h2>
      <label class="field-label">تاريخ الانتهاء</label>
      <input class="text-input" type="date" id="period-end-input" value="${todayStr()}" min="${period.startDate}">
      <label class="checkbox-row"><input type="checkbox" id="period-end-unpause-input" checked><span>استئناف تتبع الصلوات</span></label>
      <div class="modal-actions">
        <button class="btn btn-text" id="period-end-cancel">إلغاء</button>
        <button class="btn btn-primary" id="period-end-save">إنهاء</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  document.getElementById('period-end-cancel').addEventListener('click', () => overlay.remove());
  document.getElementById('period-end-save').addEventListener('click', async () => {
    const date = document.getElementById('period-end-input').value;
    if (!date || date < period.startDate) return;
    const unpausePrayers = document.getElementById('period-end-unpause-input').checked;
    await endPeriod(period.id, date);
    if (unpausePrayers) await endFardPause();
    overlay.remove();
    toast(unpausePrayers ? '🌸 تم تسجيل انتهاء الدورة — تم استئناف تتبع الصلوات' : '🌸 تم تسجيل انتهاء الدورة');
    if (onDone) onDone();
  });
}

function openEditPeriodModal(period, onDone) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal">
      <h2 class="modal-title">تعديل الدورة</h2>
      <label class="field-label">تاريخ البداية</label>
      <input class="text-input" type="date" id="period-edit-start" value="${period.startDate}">
      <label class="field-label">تاريخ الانتهاء (اتركيه فاضي إذا مستمرة)</label>
      <input class="text-input" type="date" id="period-edit-end" value="${period.endDate || ''}">
      <div class="modal-actions">
        <button class="btn btn-danger btn-sm" id="period-edit-delete">حذف</button>
        <button class="btn btn-text" id="period-edit-cancel">إلغاء</button>
        <button class="btn btn-primary" id="period-edit-save">حفظ</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  document.getElementById('period-edit-cancel').addEventListener('click', () => overlay.remove());
  document.getElementById('period-edit-delete').addEventListener('click', async () => {
    if (!confirm('حذف هذه الدورة نهائياً؟')) return;
    await deletePeriod(period.id);
    overlay.remove();
    if (onDone) onDone();
  });
  document.getElementById('period-edit-save').addEventListener('click', async () => {
    const start = document.getElementById('period-edit-start').value;
    const endRaw = document.getElementById('period-edit-end').value;
    if (!start) return;
    if (endRaw && endRaw < start) { alert('تاريخ الانتهاء لا يمكن أن يكون قبل تاريخ البداية.'); return; }
    await editPeriod(period.id, start, endRaw);
    overlay.remove();
    if (onDone) onDone();
  });
}

// ---------- range-shaded calendar ----------
// Tapping a shaded (period) day opens edit; tapping an empty day just
// points at the primary button — period start/end has real start↔end
// structure a single-day toggle can't cleanly represent, unlike the
// independent per-day booleans everywhere else in the app.

function initPeriodCalendar(container, onChange) {
  const today = todayStr();
  const [ty, tm] = today.split('-').map(Number);
  let viewYear = ty, viewMonth = tm - 1;

  async function render() {
    const cellDates = monthGridDates(viewYear, viewMonth);
    const periods = await getAllPeriods();
    const periodForDate = (d) => periods.find(p => d >= p.startDate && (p.endDate === null ? d <= today : d <= p.endDate));
    const status = await getPeriodStatus();
    const predictedRange = (status.state === 'upcoming' || status.state === 'due' || status.state === 'late') ? status : null;

    const cells = cellDates.map(dateStr => {
      if (!dateStr) return `<div class="cal-cell cal-cell-empty"></div>`;
      const day = Number(dateStr.split('-')[2]);
      const isToday = dateStr === today;
      const inPeriod = !!periodForDate(dateStr);
      const inPredictedRange = predictedRange && dateStr >= predictedRange.rangeStart && dateStr <= predictedRange.rangeEnd && !inPeriod;
      const isOvulation = status.fertility && dateStr === status.fertility.ovulationDate;
      const fertilityLevel = status.fertility ? fertilityLevelForDate(dateStr, status.fertility) : null;
      const classes = [
        isToday ? 'cal-today' : '',
        inPeriod ? 'cal-period-day' : '',
        inPredictedRange ? 'cal-predicted-period-day' : '',
        isOvulation ? 'cal-ovulation-day' : '',
        (fertilityLevel && !isOvulation) ? 'cal-fertile-day' : ''
      ].filter(Boolean).join(' ');
      const marker = isOvulation ? '🥚' : (fertilityLevel ? '🌼' : '');
      return `<button class="cal-cell ${classes}" data-date="${dateStr}">
        <span class="cal-day-num">${day}</span>${marker ? `<span class="cal-day-marker">${marker}</span>` : ''}
      </button>`;
    }).join('');

    container.innerHTML = `
      <div class="cal-header">
        <button class="icon-btn" id="pcal-prev" aria-label="الشهر السابق">›</button>
        <span class="cal-month-label">${ARABIC_MONTHS[viewMonth]} ${viewYear}</span>
        <button class="icon-btn" id="pcal-next" aria-label="الشهر التالي">‹</button>
      </div>
      <div class="cal-weekdays">${ARABIC_WEEKDAYS_SHORT.map(w => `<span>${w}</span>`).join('')}</div>
      <div class="cal-grid">${cells}</div>
      <div class="cal-legend">
        <span><i class="cal-legend-dot cal-period-day"></i> دورة مسجّلة</span>
        <span><i class="cal-legend-dot cal-predicted-period-day"></i> دورة متوقعة</span>
        <span><i class="cal-legend-dot cal-fertile-day"></i> نافذة خصوبة</span>
        <span><i class="cal-legend-dot cal-ovulation-day"></i> إباضة متوقعة</span>
      </div>
    `;

    document.getElementById('pcal-prev').addEventListener('click', () => { viewMonth -= 1; if (viewMonth < 0) { viewMonth = 11; viewYear -= 1; } render(); });
    document.getElementById('pcal-next').addEventListener('click', () => { viewMonth += 1; if (viewMonth > 11) { viewMonth = 0; viewYear += 1; } render(); });
    container.querySelectorAll('.cal-cell[data-date]').forEach(cell => {
      cell.addEventListener('click', () => {
        const dateStr = cell.dataset.date;
        const match = periodForDate(dateStr);
        if (match) openEditPeriodModal(match, onChange);
        else toast('استخدمي زر "بدء دورة جديدة" لتسجيل دورة');
      });
    });
  }

  return { refresh: render };
}

async function renderPeriodHistoryList(container, onChange) {
  const periods = await getAllPeriods();
  if (periods.length === 0) {
    container.innerHTML = `<div class="empty-state"><p>ما في دورات مسجلة بعد.</p></div>`;
    return;
  }
  const rows = await Promise.all(periods.map(async p => {
    const painScore = await getPeriodScore(p, 'pain');
    return `
    <button class="period-history-row" data-period-id="${p.id}">
      <span class="period-history-range">${formatDateArabic(p.startDate, { weekday: false })}${p.endDate ? ' → ' + formatDateArabic(p.endDate, { weekday: false }) : ' (مستمرة)'}</span>
      <span class="period-history-meta">
        ${p.endDate ? `<span class="period-history-length">${daysBetween(p.startDate, p.endDate) + 1} أيام</span>` : ''}
        ${painScore != null ? `<span class="period-pain-score">😣 ${toArabicNumeral(painScore)}/١٠٠</span>` : ''}
      </span>
    </button>`;
  }));
  container.innerHTML = rows.join('');
  container.querySelectorAll('.period-history-row').forEach(row => {
    row.addEventListener('click', () => {
      const period = periods.find(p => p.id === Number(row.dataset.periodId));
      openEditPeriodModal(period, onChange);
    });
  });
}

// ---------- full Period page ----------

async function renderPeriodPage(params, view) {
  view.innerHTML = `
    <div class="page-header">
      <button class="icon-btn" id="period-back">→</button>
      <h1>الدورة الشهرية</h1>
    </div>
    <div class="card" id="period-status-card"></div>
    <div class="card" id="period-pain-predict-card" style="display:none;"></div>
    <div class="card" id="period-action-card"></div>
    <div class="card" id="period-reading-card"></div>
    <div class="card" id="period-scatter-card" style="display:none;"></div>
    <div class="card"><div id="period-calendar"></div></div>
    <div class="card">
      <h2 class="card-title">سجل الدورات</h2>
      <div id="period-history-list"></div>
    </div>
    <div class="card">
      <h2 class="card-title">مزاج اليوم</h2>
      <div id="period-mood-widget"></div>
      <a class="see-all-link" href="#/mood-history">سجل المزاج ←</a>
    </div>
  `;
  document.getElementById('period-back').addEventListener('click', () => history.back());

  const calendarHandle = initPeriodCalendar(document.getElementById('period-calendar'), refreshAll);

  async function refreshAll() {
    const status = await getPeriodStatus();
    document.getElementById('period-status-card').innerHTML = `
      <p class="period-status-text">${periodStatusText(status)}</p>
      ${status.stats.cycleSamples > 0 ? `<p class="period-status-sub">استناداً إلى ${status.stats.cycleSamples} ${status.stats.cycleSamples === 1 ? 'دورة سابقة' : 'دورات سابقة'}</p>` : ''}
      ${fertilityStatusText(status) ? `<p class="period-status-sub period-fertility-text">🌼 ${fertilityStatusText(status)}</p>` : ''}
    `;

    const ongoing = await getOngoingPeriod();

    // Pain prediction — only rendered when a period is ongoing or due
    // within 2 days; the helper hides the card otherwise.
    const predictCard = document.getElementById('period-pain-predict-card');
    const shown = await renderPainPredictionInto(predictCard, { status, ongoing });
    predictCard.style.display = shown ? '' : 'none';

    const actionCard = document.getElementById('period-action-card');
    if (ongoing) {
      actionCard.innerHTML = `<button class="btn btn-primary btn-block" id="period-primary-btn">إنهاء الدورة</button>`;
      document.getElementById('period-primary-btn').addEventListener('click', () => openEndPeriodModal(ongoing, refreshAll));
    } else {
      actionCard.innerHTML = `
        <button class="btn btn-primary btn-block" id="period-primary-btn">🌸 بدء دورة جديدة</button>
        <button class="btn btn-secondary btn-block" id="period-add-past-btn" style="margin-top: var(--space-2);">📅 إضافة دورة سابقة</button>`;
      document.getElementById('period-primary-btn').addEventListener('click', () => openStartPeriodModal(refreshAll));
      document.getElementById('period-add-past-btn').addEventListener('click', () => openAddPastPeriodModal(refreshAll));
    }

    // Reading logger — always available (cramps can precede the period);
    // links readings to the ongoing period when there is one.
    await renderReadingLoggerCard(document.getElementById('period-reading-card'), ongoing ? ongoing.id : null, refreshAll);

    // Intra-day scatter for today.
    const scatterCard = document.getElementById('period-scatter-card');
    await renderIntradayScatter(scatterCard, todayStr());
    scatterCard.style.display = scatterCard.innerHTML.trim() ? '' : 'none';

    await calendarHandle.refresh();
    await renderPeriodHistoryList(document.getElementById('period-history-list'), refreshAll);
  }

  await refreshAll();
  await renderMoodWidget(document.getElementById('period-mood-widget'), todayStr());
}

// ---------- Day Detail provider ----------
// Read-only here on purpose — see the comment above initPeriodCalendar.

async function periodDayProvider(dateStr) {
  const periods = await getAllPeriods();
  const today = todayStr();
  const match = periods.find(p => dateStr >= p.startDate && (p.endDate === null ? dateStr <= today : dateStr <= p.endDate));
  if (!match) return null;
  const dayNum = daysBetween(match.startDate, dateStr) + 1;
  const node = document.createElement('div');
  node.innerHTML = `<p class="period-day-note">🌸 اليوم ${dayNum} من الدورة. للتعديل، افتحي صفحة الدورة الشهرية.</p>`;
  return { title: 'الدورة الشهرية', node };
}

// ---------- Yearly stats provider ----------

async function periodYearlyProvider(year) {
  const all = await getAllPeriods();
  const prefix = String(year);
  const yearPeriods = all.filter(p => p.startDate.startsWith(prefix));
  if (yearPeriods.length === 0) return null;
  const stats = await getPeriodStats(); // overall, not year-scoped — useful context regardless of year viewed
  const today = todayStr();
  const totalDays = yearPeriods.reduce((s, p) => s + (daysBetween(p.startDate, p.endDate || today) + 1), 0);

  // Whole-period pain/blood scores (computed, never stored). Only
  // periods with readings contribute. The detailed list is collapsed
  // behind a native <details> so the yearly view stays compact — the
  // person taps to reveal, taps again to hide.
  const scored = [];
  for (const p of yearPeriods) {
    const painScore = await getPeriodScore(p, 'pain');
    const bloodScore = await getPeriodScore(p, 'blood');
    const crampScore = await getPeriodScore(p, 'cramp');
    if (painScore != null || bloodScore != null || crampScore != null) {
      scored.push({ p, painScore, bloodScore, crampScore });
    }
  }
  let painBlock = '';
  if (scored.length) {
    const avgPain = Math.round(scored.filter(s => s.painScore != null).reduce((s, x) => s + x.painScore, 0) / scored.filter(s => s.painScore != null).length);
    const detailRows = scored.map(s => `
      <div class="yearly-row">
        <span>${formatDateArabic(s.p.startDate, { weekday: false })}</span>
        <span>${s.painScore != null ? '😣' + toArabicNumeral(s.painScore) : ''} ${s.bloodScore != null ? '🩸' + toArabicNumeral(s.bloodScore) : ''} ${s.crampScore != null ? '🔥' + toArabicNumeral(s.crampScore) : ''}</span>
      </div>`).join('');
    painBlock = `
      <div class="yearly-row"><span>متوسط شدّة الألم (٠–١٠٠)</span><span>😣 ${toArabicNumeral(avgPain)}</span></div>
      <details class="yearly-pain-details">
        <summary>عرض كل قراءات الألم (${toArabicNumeral(scored.length)})</summary>
        ${detailRows}
      </details>`;
  }

  const html = `
    <div class="yearly-row"><span>عدد الدورات</span><span>${yearPeriods.length}</span></div>
    <div class="yearly-row"><span>إجمالي أيام الدورة</span><span>${totalDays} يوم</span></div>
    <div class="yearly-row"><span>متوسط طول الدورة نفسها</span><span>${stats.periodSamples > 0 ? Math.round(stats.avgPeriodLength) + ' يوم' : 'غير كافٍ بعد'}</span></div>
    <div class="yearly-row"><span>متوسط الفترة بين الدورات</span><span>${stats.cycleSamples > 0 ? Math.round(stats.avgCycleLength) + ' يوم' : 'غير كافٍ بعد (تحتاج دورتين مسجّلتين على الأقل)'}</span></div>
    ${stats.confidence !== 'none' ? `<div class="yearly-row"><span>موثوقية التوقع</span><span>${confidenceLabel(stats.confidence)}</span></div>` : ''}
    ${painBlock}
  `;
  return { title: 'الدورة الشهرية', html, count: yearPeriods.length };
}
