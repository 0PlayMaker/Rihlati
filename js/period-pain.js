// period-pain.js — Phase 18 pain/cramp model.
//
// DESIGN DECISIONS (deliberately narrower than a naive "throw every
// signal into a regression" approach):
//
//  - The ONLY real predictor is the person's OWN cycle-day pain
//    profile: "on day N of past periods, how much pain did I feel?"
//    Dysmenorrhea follows a personally-stable pattern (cramps cluster
//    at the day before / first days of menses), so this genuinely
//    predicts. With only a handful of noisy self-reported cycles you
//    CANNOT honestly fit "low sleep → +1.3 pain" as a coefficient —
//    that would manufacture false precision. So sleep/mood/exercise
//    are NOT model inputs; they appear in the reason line only as
//    OBSERVED same-day context ("may add to it"), never as weights.
//  - Recent cycles are weighted more than old ones (patterns drift).
//  - Weighted MEDIAN, not mean — one agonizing outlier cycle
//    shouldn't drag every future prediction up.
//  - Output is always a RANGE plus a point, widened when the history
//    is inconsistent, with an explicit low/medium/high confidence.
//  - NOTHING here is stored. Everything recomputes from readings.
//  - Fully separate from getPeriodStats / getFertilityPrediction.

// ---- small stats helpers (weighted variants of the period.js ones) ----

function weightedMedian(pairs) {
  // pairs: [{ value, weight }]. Returns the value at the point where
  // cumulative weight crosses half the total.
  const valid = pairs.filter(p => typeof p.value === 'number' && p.weight > 0);
  if (!valid.length) return null;
  const sorted = [...valid].sort((a, b) => a.value - b.value);
  const total = sorted.reduce((s, p) => s + p.weight, 0);
  let cum = 0;
  for (const p of sorted) {
    cum += p.weight;
    if (cum >= total / 2) return p.value;
  }
  return sorted[sorted.length - 1].value;
}

function weightedSpread(pairs, centre) {
  // Weighted median absolute deviation around a given centre — used
  // for the RANGE width of a point prediction.
  const valid = pairs.filter(p => typeof p.value === 'number' && p.weight > 0);
  if (!valid.length) return 0;
  return weightedMedian(valid.map(p => ({ value: Math.abs(p.value - centre), weight: p.weight }))) ?? 0;
}

// Raw (unweighted) scatter of the values, for the CONFIDENCE signal.
// Weighted MAD is unsuitable here: it collapses to 0 whenever the
// weighted-median value already holds >= half the weight, which would
// hide genuinely inconsistent history behind recency weighting. How
// CONSISTENT a person's cycles are is a property of the raw values,
// independent of how we weight them for the point estimate.
function rawScatter(pairs) {
  const vals = pairs.filter(p => typeof p.value === 'number').map(p => p.value);
  if (vals.length < 2) return 0;
  const sorted = [...vals].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const med = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  const devs = vals.map(v => Math.abs(v - med)).sort((a, b) => a - b);
  const dmid = Math.floor(devs.length / 2);
  return devs.length % 2 ? devs[dmid] : (devs[dmid - 1] + devs[dmid]) / 2;
}

// The day-offset of a date from a period's start (0 = first day).
function cycleDayOffset(periodStartDate, dateStr) {
  return daysBetween(periodStartDate, dateStr);
}

// ---- reading access + daily aggregation (all computed, never stored) ----

async function getReadingsForPeriod(periodId) {
  if (periodId == null) return [];
  return db.periodReadings.where('periodId').equals(periodId).toArray();
}
async function getReadingsForDate(dateStr) {
  return (await db.periodReadings.where('dateStr').equals(dateStr).toArray())
    .sort((a, b) => a.timestamp - b.timestamp);
}
async function addPeriodReading({ dateStr, periodId, blood, pain, cramp, timestamp }) {
  return db.periodReadings.add({
    dateStr, periodId: periodId ?? null,
    blood: clamp010(blood), pain: clamp010(pain), cramp: clamp010(cramp),
    timestamp: timestamp || Date.now()
  });
}
async function deletePeriodReading(id) {
  return db.periodReadings.delete(id);
}
function clamp010(n) {
  if (typeof n !== 'number' || Number.isNaN(n)) return null;
  return Math.max(0, Math.min(10, Math.round(n)));
}

// Average of a metric across a set of readings (ignoring nulls).
function avgMetric(readings, key) {
  const vals = readings.map(r => r[key]).filter(v => typeof v === 'number');
  if (!vals.length) return null;
  return vals.reduce((s, v) => s + v, 0) / vals.length;
}

// Per-day averages for one period: [{ dayOffset, blood, pain, cramp, count }]
async function getDailyAveragesForPeriod(period) {
  const readings = await getReadingsForPeriod(period.id);
  const byDay = new Map();
  for (const r of readings) {
    const off = cycleDayOffset(period.startDate, r.dateStr);
    if (!byDay.has(off)) byDay.set(off, []);
    byDay.get(off).push(r);
  }
  return [...byDay.entries()]
    .map(([dayOffset, rs]) => ({
      dayOffset,
      blood: avgMetric(rs, 'blood'),
      pain: avgMetric(rs, 'pain'),
      cramp: avgMetric(rs, 'cramp'),
      count: rs.length
    }))
    .sort((a, b) => a.dayOffset - b.dayOffset);
}

// Whole-period score 0-100 for a metric: the mean of that metric's
// daily averages, rescaled from 0-10 to 0-100. Represents "how heavy /
// how painful was this period overall," not a peak.
async function getPeriodScore(period, key = 'pain') {
  const days = await getDailyAveragesForPeriod(period);
  const vals = days.map(d => d[key]).filter(v => typeof v === 'number');
  if (!vals.length) return null;
  const mean = vals.reduce((s, v) => s + v, 0) / vals.length;
  return Math.round(mean * 10); // 0-10 -> 0-100
}

// ---- the pain model ----

// Build the person's cycle-day PROFILE for a metric: for each day
// offset, a recency-weighted set of that day's averages across past
// periods. Recent periods get a higher weight (linear ramp: the most
// recent completed period weighted N, the oldest weighted 1).
async function buildCycleDayProfile(key = 'pain', { excludePeriodId } = {}) {
  const periods = (await getAllPeriods()) // newest first
    .filter(p => p.id !== excludePeriodId);
  // Only periods that actually have readings contribute.
  const withData = [];
  for (const p of periods) {
    const days = await getDailyAveragesForPeriod(p);
    if (days.some(d => typeof d[key] === 'number')) withData.push({ period: p, days });
  }
  // withData is newest-first; weight newest highest. LINEAR ramp:
  // recent cycles count more than old ones, but a single recent cycle
  // deliberately can't erase an established consistent pattern — that
  // would be chasing noise. Most recent of N gets weight N, oldest 1.
  const n = withData.length;
  const profile = new Map(); // dayOffset -> [{ value, weight }]
  withData.forEach(({ days }, idx) => {
    const weight = n - idx; // idx 0 (newest) -> n, oldest -> 1
    for (const d of days) {
      if (typeof d[key] !== 'number') continue;
      if (!profile.has(d.dayOffset)) profile.set(d.dayOffset, []);
      profile.get(d.dayOffset).push({ value: d[key], weight });
    }
  });
  return { profile, cyclesWithData: n };
}

function confidenceFromProfile(cyclesWithData, spread) {
  if (cyclesWithData === 0) return 'none';
  if (cyclesWithData >= 3 && spread <= 1.5) return 'high';
  if (cyclesWithData >= 2 && spread <= 3) return 'medium';
  return 'low';
}

// Predicted value + range for a specific cycle day offset.
function predictForDayOffset(profile, dayOffset) {
  const pairs = profile.get(dayOffset) || [];
  if (!pairs.length) return null;
  const centre = weightedMedian(pairs);
  const spread = weightedSpread(pairs, centre);
  const scatter = rawScatter(pairs); // raw consistency, for confidence
  // Range widens with inconsistency; use the LARGER of weighted spread
  // and raw scatter so a recency-dominated point still shows an honest
  // band when the underlying cycles disagreed. Always at least ±1.
  const half = Math.max(1, Math.round(Math.max(spread, scatter)));
  return {
    value: Math.round(centre),
    low: Math.max(0, Math.round(centre) - half),
    high: Math.min(10, Math.round(centre) + half),
    spread,
    scatter,
    samples: pairs.length
  };
}

// The full prediction object for the current situation. `cycleDay` is
// today's offset from the (predicted or actual) period start; pass
// null if not currently in / near a period.
async function getPainPrediction({ key = 'pain', cycleDay = null } = {}) {
  const { profile, cyclesWithData } = await buildCycleDayProfile(key);
  if (cyclesWithData === 0) {
    return { available: false, confidence: 'none', cyclesWithData: 0 };
  }

  // Peak day: whichever day offset has the highest predicted value.
  let peakDay = null, peakVal = -1;
  for (const [off] of profile) {
    const p = predictForDayOffset(profile, off);
    if (p && p.value > peakVal) { peakVal = p.value; peakDay = off; }
  }

  // Days 0-3 range (the classic dysmenorrhea window) as a compact band.
  const early = [0, 1, 2, 3].map(off => predictForDayOffset(profile, off)).filter(Boolean);
  const earlyLow = early.length ? Math.min(...early.map(p => p.low)) : null;
  const earlyHigh = early.length ? Math.max(...early.map(p => p.high)) : null;

  // Overall consistency across the profile, for the confidence tier —
  // uses raw scatter (not the recency-weighted spread) so genuinely
  // inconsistent history can't be masked into false "high" confidence.
  const allScatters = [];
  for (const [off] of profile) {
    const p = predictForDayOffset(profile, off);
    if (p) allScatters.push(p.scatter);
  }
  const medScatter = allScatters.length ? allScatters.sort((a, b) => a - b)[Math.floor(allScatters.length / 2)] : 0;
  const confidence = confidenceFromProfile(cyclesWithData, medScatter);

  const today = cycleDay != null ? predictForDayOffset(profile, cycleDay) : null;

  return {
    available: true,
    confidence,
    cyclesWithData,
    today,               // {value, low, high} for today's cycle day, or null
    peakDay,             // day offset with highest predicted pain
    peakValue: peakVal >= 0 ? peakVal : null,
    earlyRange: (earlyLow != null) ? { low: earlyLow, high: earlyHigh } : null,
    profile              // Map(dayOffset -> pairs), for the curve
  };
}

// Build a point-per-day predicted curve for plotting (day offsets
// 0..maxDay). Each point is the predicted median for that offset.
function buildPredictedCurve(prediction, maxDay = 7) {
  if (!prediction.available) return [];
  const pts = [];
  for (let off = 0; off <= maxDay; off++) {
    const p = predictForDayOffset(prediction.profile, off);
    if (p) pts.push({ dayOffset: off, value: p.value, low: p.low, high: p.high });
  }
  return pts;
}

// Honest reason line. Leads with the ACTUAL driver (the person's own
// history for this cycle day). Adds observed same-day context only if
// it's really present today — phrased as "may add to it," never as a
// fitted coefficient. `contextFlags` is gathered separately so this
// stays pure/testable.
function buildPainReason(prediction, contextFlags = {}) {
  if (!prediction.available) {
    return 'لا توجد بيانات ألم كافية بعد — سجّلي قراءات خلال دورتك لبناء توقّع خاص بك.';
  }
  const parts = [];
  if (prediction.today) {
    const t = prediction.today;
    if (t.value >= 6) parts.push('نمطك السابق يشير إلى ألم مرتفع في هذا اليوم من الدورة');
    else if (t.value >= 3) parts.push('نمطك السابق يشير إلى ألم متوسط في هذا اليوم');
    else parts.push('نمطك السابق يشير إلى ألم خفيف في هذا اليوم');
  } else if (prediction.peakDay != null) {
    parts.push(`عادةً يكون الألم أشدّ حوالي اليوم ${toArabicNumeral(prediction.peakDay + 1)} من الدورة`);
  }
  // Observed context — only what's actually true today.
  const ctx = [];
  if (contextFlags.lowSleep) ctx.push('قلة النوم');
  if (contextFlags.lowMood) ctx.push('التوتر أو المزاج المنخفض');
  if (ctx.length) parts.push(`قد يزيد منه اليوم: ${ctx.join(' و')}`);
  else if (contextFlags.goodSleep) parts.push('نومك الجيد قد يخفّف منه');

  let line = parts.join(' · ');
  if (prediction.confidence === 'low') line += ' (توقّع أوّلي — يتحسّن مع كل دورة تسجّلينها)';
  return line;
}

// Gather same-day context flags from sleep + mood, for the reason line
// only. These are OBSERVATIONS, not predictors.
async function getPainContextFlags(dateStr) {
  const flags = {};
  try {
    const sleep = (await db.sleepLogs.where('date').equals(dateStr).toArray())
      .filter(s => !s.isNap)
      .sort((a, b) => b.durationMinutes - a.durationMinutes)[0];
    if (sleep) {
      if (sleep.durationMinutes < 360) flags.lowSleep = true;      // < 6h
      else if (sleep.durationMinutes >= 420) flags.goodSleep = true; // >= 7h
    }
  } catch (e) { /* sleep data optional */ }
  try {
    const mood = await db.moodLogs.where('date').equals(dateStr).first();
    if (mood && (mood.emoji === '😢' || mood.emoji === '😠' || mood.emoji === '😰')) flags.lowMood = true;
  } catch (e) { /* mood data optional */ }
  return flags;
}

// toArabicNumeral now lives in ui-shared.js (single definition).

// ============================ UI ============================

// A single 0-10 slider row with a live value bubble.
function painSliderRow(id, label, emoji, value = 0) {
  return `
    <div class="pain-slider-row">
      <label for="${id}">${emoji} ${label}: <span class="pain-slider-val" id="${id}-val">${toArabicNumeral(value)}</span></label>
      <input type="range" min="0" max="10" value="${value}" id="${id}" class="pain-slider">
    </div>`;
}

function wirePainSlider(id) {
  const input = document.getElementById(id);
  const val = document.getElementById(id + '-val');
  input.addEventListener('input', () => { val.textContent = toArabicNumeral(input.value); });
  ['click', 'pointerdown', 'touchstart', 'mousedown'].forEach(evt =>
    input.addEventListener(evt, e => e.stopPropagation()));
}

// The "add a reading now" modal. periodId may be null (e.g. cramps
// before the period officially starts).
function openAddReadingModal(periodId, onDone) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal">
      <h2 class="modal-title">تسجيل قراءة الآن</h2>
      <p class="settings-note">يمكنك تسجيل قراءة جديدة كل ساعة أو وقت ما تشعرين بتغيّر. المتوسط اليومي يُحسب تلقائياً.</p>
      ${painSliderRow('reading-blood', 'كمية الدم', '🩸', 0)}
      ${painSliderRow('reading-pain', 'الألم العام', '😣', 0)}
      ${painSliderRow('reading-cramp', 'التقلصات', '🔥', 0)}
      <div class="modal-actions">
        <button class="btn btn-text" id="reading-cancel">إلغاء</button>
        <button class="btn btn-primary" id="reading-save">تسجيل</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  ['reading-blood', 'reading-pain', 'reading-cramp'].forEach(wirePainSlider);
  document.getElementById('reading-cancel').addEventListener('click', () => overlay.remove());
  document.getElementById('reading-save').addEventListener('click', async () => {
    await addPeriodReading({
      dateStr: todayStr(),
      periodId,
      blood: Number(document.getElementById('reading-blood').value),
      pain: Number(document.getElementById('reading-pain').value),
      cramp: Number(document.getElementById('reading-cramp').value)
    });
    overlay.remove();
    toast('📝 تم تسجيل القراءة');
    if (onDone) onDone();
  });
}

function readingTimeLabel(timestamp) {
  const d = new Date(timestamp);
  let h = d.getHours();
  const m = String(d.getMinutes()).padStart(2, '0');
  const ampm = h < 12 ? 'ص' : 'م';
  h = h % 12 || 12;
  return `${toArabicNumeral(h)}:${toArabicNumeral(m)} ${ampm}`;
}

function fmtAvg(v) {
  if (typeof v !== 'number') return '—';
  return toArabicNumeral(Math.round(v * 10) / 10);
}

// Card: today's readings + per-metric daily average + add button.
async function renderReadingLoggerCard(container, periodId, onChange) {
  const today = todayStr();
  const readings = await getReadingsForDate(today);
  const avgBlood = avgMetric(readings, 'blood');
  const avgPain = avgMetric(readings, 'pain');
  const avgCramp = avgMetric(readings, 'cramp');

  const avgLine = readings.length
    ? `<div class="pain-avg-row">
         <span class="pain-avg-chip">🩸 ${fmtAvg(avgBlood)}</span>
         <span class="pain-avg-chip">😣 ${fmtAvg(avgPain)}</span>
         <span class="pain-avg-chip">🔥 ${fmtAvg(avgCramp)}</span>
       </div>
       <p class="settings-note">متوسط اليوم من ${toArabicNumeral(readings.length)} ${readings.length === 1 ? 'قراءة' : 'قراءات'}</p>`
    : `<p class="settings-note">لا توجد قراءات اليوم بعد.</p>`;

  const list = readings.map(r => `
    <div class="reading-row" data-reading-id="${r.id}">
      <span class="reading-time">${readingTimeLabel(r.timestamp)}</span>
      <span class="reading-vals">🩸${toArabicNumeral(r.blood ?? 0)} · 😣${toArabicNumeral(r.pain ?? 0)} · 🔥${toArabicNumeral(r.cramp ?? 0)}</span>
      <button class="reading-delete" data-reading-id="${r.id}" aria-label="حذف">✕</button>
    </div>`).join('');

  container.innerHTML = `
    <div class="section-header">
      <h2 class="card-title">🩸 قراءات اليوم</h2>
      <button class="capsule-btn" id="add-reading-btn">＋ قراءة</button>
    </div>
    ${avgLine}
    <div class="readings-list">${list}</div>`;

  document.getElementById('add-reading-btn').addEventListener('click', () => openAddReadingModal(periodId, onChange));
  container.querySelectorAll('.reading-delete').forEach(btn => {
    btn.addEventListener('click', async () => {
      await deletePeriodReading(Number(btn.dataset.readingId));
      if (onChange) onChange();
    });
  });
}

// ---- prediction card (shown only when relevant) ----
// Confidence phrases in Arabic.
function painConfidenceLabel(level) {
  return { high: 'ثقة عالية', medium: 'ثقة متوسطة', low: 'ثقة أولية', none: '' }[level] || '';
}

// Decide whether to show the pain prediction at all, and render it.
// Rule (per the spec): show when a period is ONGOING, or is predicted
// to start within 2 days. Hidden otherwise. Returns '' when nothing to
// show so the caller can omit the card entirely.
async function renderPainPredictionInto(container, { status, ongoing }) {
  // Determine today's cycle-day offset if we're in / about to be in one.
  let cycleDay = null;
  let show = false;
  if (ongoing) {
    cycleDay = cycleDayOffset(ongoing.startDate, todayStr());
    show = true;
  } else if (status && (status.state === 'due' || (status.state === 'upcoming' && status.daysUntil <= 2))) {
    // About to start — predict day 0 as the immediate concern.
    cycleDay = 0;
    show = true;
  }
  if (!show) { container.innerHTML = ''; return false; }

  const pred = await getPainPrediction({ key: 'pain', cycleDay });
  if (!pred.available) {
    container.innerHTML = `
      <h2 class="card-title">توقّع الألم</h2>
      <p class="settings-note">${buildPainReason(pred)}</p>`;
    return true;
  }

  const flags = await getPainContextFlags(todayStr());
  const reason = buildPainReason(pred, flags);
  const todayBlock = pred.today
    ? `<div class="pain-predict-today">
         <span class="pain-predict-big">${toArabicNumeral(pred.today.value)}<span class="pain-predict-max">/١٠</span></span>
         <span class="pain-predict-range">النطاق المتوقّع اليوم: ${toArabicNumeral(pred.today.low)}–${toArabicNumeral(pred.today.high)}</span>
       </div>`
    : '';
  const peakBlock = (pred.peakDay != null)
    ? `<p class="pain-predict-peak">🔺 الألم غالباً أشدّ حوالي اليوم ${toArabicNumeral(pred.peakDay + 1)} من الدورة (~${toArabicNumeral(pred.peakValue)}/١٠)</p>`
    : '';
  const earlyBlock = pred.earlyRange
    ? `<p class="pain-predict-early">الأيام ١–٤: نطاق ${toArabicNumeral(pred.earlyRange.low)}–${toArabicNumeral(pred.earlyRange.high)}</p>`
    : '';

  container.innerHTML = `
    <div class="section-header">
      <h2 class="card-title">توقّع الألم</h2>
      ${pred.confidence ? `<span class="pain-conf-chip pain-conf-${pred.confidence}">${painConfidenceLabel(pred.confidence)}</span>` : ''}
    </div>
    ${todayBlock}
    ${peakBlock}
    ${earlyBlock}
    <p class="pain-predict-reason">${reason}</p>
    <div id="pain-curve-holder"></div>`;

  // Predicted curve (point per cycle day).
  const curve = buildPredictedCurve(pred, 7);
  if (curve.length >= 2) {
    const holder = container.querySelector('#pain-curve-holder');
    if (holder) holder.innerHTML =
      `<p class="pain-curve-label">منحنى الألم المتوقّع عبر أيام الدورة</p>` +
      painCurveSvg(curve, cycleDay);
  }
  return true;
}

// A compact SVG line for the predicted pain curve (0-10 y-axis,
// day offsets on x). Marks "today" if within range. Shaded band shows
// the low-high uncertainty envelope.
function painCurveSvg(curve, todayOffset) {
  const width = 300, height = 120, padX = 24, padY = 12;
  const maxDay = Math.max(...curve.map(p => p.dayOffset));
  const xFor = (off) => padX + (maxDay === 0 ? 0 : (off / maxDay) * (width - 2 * padX));
  const yFor = (val) => padY + (1 - val / 10) * (height - 2 * padY);

  const linePts = curve.map(p => `${xFor(p.dayOffset).toFixed(1)},${yFor(p.value).toFixed(1)}`).join(' ');
  // Uncertainty band as a filled polygon (highs forward, lows back).
  const bandTop = curve.map(p => `${xFor(p.dayOffset).toFixed(1)},${yFor(p.high).toFixed(1)}`);
  const bandBot = curve.slice().reverse().map(p => `${xFor(p.dayOffset).toFixed(1)},${yFor(p.low).toFixed(1)}`);
  const bandPts = [...bandTop, ...bandBot].join(' ');

  const dots = curve.map(p => {
    const isToday = todayOffset != null && p.dayOffset === todayOffset;
    return `<circle cx="${xFor(p.dayOffset).toFixed(1)}" cy="${yFor(p.value).toFixed(1)}" r="${isToday ? 5 : 3}" class="${isToday ? 'pain-dot-today' : 'pain-dot'}"/>`;
  }).join('');
  const xLabels = curve.map(p =>
    `<text x="${xFor(p.dayOffset).toFixed(1)}" y="${height - 1}" class="pain-axis-label" text-anchor="middle">${toArabicNumeral(p.dayOffset + 1)}</text>`
  ).join('');

  return `<svg viewBox="0 0 ${width} ${height}" class="pain-curve-svg">
    <polygon points="${bandPts}" class="pain-band"/>
    <polyline points="${linePts}" class="pain-line" fill="none"/>
    ${dots}
    ${xLabels}
  </svg>`;
}

// ---- intra-day scatter: pain points across hours of a day ----
// This is the "paint a picture of WHEN in the day pain happens" view.
async function renderIntradayScatter(container, dateStr) {
  const readings = await getReadingsForDate(dateStr);
  if (readings.length < 2) { container.innerHTML = ''; return; }
  container.innerHTML = `
    <p class="pain-curve-label">ألمك عبر ساعات اليوم</p>
    ${intradayScatterSvg(readings)}`;
}

function intradayScatterSvg(readings) {
  const width = 300, height = 130, padX = 28, padY = 14;
  // x = hour of day 0-24, y = value 0-10
  const xFor = (ts) => { const d = new Date(ts); const hr = d.getHours() + d.getMinutes() / 60; return padX + (hr / 24) * (width - 2 * padX); };
  const yFor = (val) => padY + (1 - val / 10) * (height - 2 * padY);

  const painDots = readings.filter(r => typeof r.pain === 'number')
    .map(r => `<circle cx="${xFor(r.timestamp).toFixed(1)}" cy="${yFor(r.pain).toFixed(1)}" r="4" class="scatter-pain"/>`).join('');
  const crampDots = readings.filter(r => typeof r.cramp === 'number')
    .map(r => `<circle cx="${xFor(r.timestamp).toFixed(1)}" cy="${yFor(r.cramp).toFixed(1)}" r="3" class="scatter-cramp"/>`).join('');
  // x-axis hour markers at 6/12/18
  const hourMarks = [0, 6, 12, 18, 24].map(h =>
    `<text x="${(padX + (h / 24) * (width - 2 * padX)).toFixed(1)}" y="${height - 2}" class="pain-axis-label" text-anchor="middle">${toArabicNumeral(h)}</text>`
  ).join('');

  return `<svg viewBox="0 0 ${width} ${height}" class="pain-curve-svg">
    ${hourMarks}
    ${painDots}
    ${crampDots}
    <text x="${width - 4}" y="10" class="pain-axis-label" text-anchor="end">😣 ألم · 🔥 تقلص</text>
  </svg>`;
}
