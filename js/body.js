// body.js — Phase 5, first half.
// BMI is shown as a factual reference range, not a prescribed target —
// it's a population-level screening number with real limits (doesn't
// account for muscle mass, frame, etc.), so it's presented alongside
// that caveat rather than as a verdict. Her own optional target weight
// is kept as a separate number she sets herself, not derived from BMI.

// ---------- weight ----------

async function getAllWeightLogs() {
  const all = await db.weightLogs.toArray();
  return all.sort((a, b) => a.date.localeCompare(b.date)); // chronological
}
async function getLatestWeight() {
  const all = await getAllWeightLogs();
  return all.length ? all[all.length - 1] : null;
}
async function setWeight(date, value) {
  const existing = await db.weightLogs.where('date').equals(date).first();
  if (existing) await db.weightLogs.update(existing.id, { value });
  else await db.weightLogs.add({ date, value, createdAt: Date.now() });
}

// Delta over a real, stated window.
//
// The old version took "the last log at least 30 days old, else just the
// oldest log I have" — and then labelled whatever came back as "the last
// 30 days". With only a few entries that silently compared today against
// a log from two days ago, or two YEARS ago, and announced it as a 30-day
// change. (That's how you get a "-95 kg in 30 days".) Now: pick the entry
// nearest to 30 days back, and report the span actually measured, so the
// number and the label can never disagree.
async function getWeightStats() {
  const logs = await getAllWeightLogs(); // oldest -> newest
  if (logs.length === 0) return { latest: null, deltaKg: null, spanDays: null };
  const latest = logs[logs.length - 1];
  const earlier = logs.slice(0, -1);
  if (earlier.length === 0) return { latest, deltaKg: null, spanDays: null };

  const target = addDays(todayStr(), -30);
  // Closest entry to the 30-day mark, in either direction.
  let reference = earlier[0];
  let bestGap = Math.abs(daysBetween(earlier[0].date, target));
  for (const l of earlier) {
    const gap = Math.abs(daysBetween(l.date, target));
    if (gap < bestGap) { bestGap = gap; reference = l; }
  }
  const spanDays = daysBetween(reference.date, latest.date);
  if (spanDays <= 0) return { latest, deltaKg: null, spanDays: null };
  return { latest, deltaKg: latest.value - reference.value, spanDays, referenceDate: reference.date };
}

// Short form for Home's small pill.
function weightGlanceText(stats) {
  if (!stats.latest) return 'سجلي أول وزن';
  if (stats.deltaKg == null) return `${stats.latest.value} كغ`;
  const sign = stats.deltaKg > 0 ? '+' : ''; // negatives carry their own '-'
  return `${stats.latest.value}كغ · ${sign}${stats.deltaKg.toFixed(1)}`;
}
// Long form for the Weight page's own status card — a visual block, not
// a sentence. Direction is shown with an arrow + a tinted pill rather
// than spelled out, and the span is stated honestly ("over N days"),
// never assumed to be 30.
//
// Deliberately NOT colour-coded green-for-down / red-for-up: gaining or
// losing weight is not inherently good or bad, and an app that cheers
// every drop is an app that quietly rewards under-eating. The pill only
// takes on a "toward goal" tint when she has actually set a target.
function weightStatBlockHtml(stats, targetWeight) {
  if (!stats.latest) {
    return `<p class="empty-state-sub">سجلي وزنك الأول لتبدأ المتابعة</p>`;
  }
  const value = stats.latest.value;
  if (stats.deltaKg == null) {
    return `
      <div class="weight-stat-block">
        <div class="weight-stat-main">
          <span class="weight-stat-value">${toArabicNumeral(value)}</span>
          <span class="weight-stat-unit">كغ</span>
        </div>
        <span class="weight-stat-sub">سجّلي مرّة أخرى لرؤية التغيّر</span>
      </div>`;
  }

  const delta = stats.deltaKg;
  const rising = delta > 0;
  const flat = Math.abs(delta) < 0.05;
  const arrow = flat ? '→' : (rising ? '↑' : '↓');

  // Tint only means something when there's a goal to move toward.
  let tone = 'neutral';
  if (targetWeight != null && !flat) {
    const movingToward = rising ? (value <= targetWeight) : (value >= targetWeight);
    tone = movingToward ? 'toward' : 'away';
  }

  const spanLabel = stats.spanDays === 1
    ? 'منذ أمس'
    : `خلال ${toArabicNumeral(stats.spanDays)} ${stats.spanDays <= 10 ? 'أيام' : 'يوماً'}`;

  return `
    <div class="weight-stat-block">
      <div class="weight-stat-main">
        <span class="weight-stat-value">${toArabicNumeral(value)}</span>
        <span class="weight-stat-unit">كغ</span>
        <span class="weight-delta-pill weight-delta-${tone}">
          <span class="weight-delta-arrow">${arrow}</span>
          ${flat ? 'ثابت' : `${toArabicNumeral(Math.abs(delta).toFixed(1))} كغ`}
        </span>
      </div>
      <span class="weight-stat-sub">${spanLabel}</span>
    </div>`;
}

// ---------- hand-rolled SVG line chart ----------
// Kept LTR internally even inside the RTL page — flipping a numeric
// time-axis to match reading direction is a common source of "wait, is
// this going backwards?" confusion, and chart axes read more like
// universal numeric notation than body text. Each point gets an
// invisible larger tap target (r=10) around the visible dot (r=3.5),
// since a bare 3.5px target is too small to reliably tap on a phone.
//
// NOTE on preserveAspectRatio: this used to be set to "none", which
// stretched the whole SVG to fill the container — including the dots,
// which came out as ovals rather than circles whenever the container's
// aspect ratio differed from the viewBox (it always did: CSS fixes the
// height and lets the width flex). Left at the default so shapes stay
// shapes; the line still spans the full width because the viewBox is
// laid out to.

// Smooth path through the points (Catmull-Rom -> cubic bezier), so the
// weight line reads as a trend rather than a jagged zigzag. Falls back
// to a straight segment when there are only two points.
function smoothPath(coords) {
  if (coords.length < 2) return '';
  if (coords.length === 2) {
    return `M ${coords[0][0].toFixed(1)} ${coords[0][1].toFixed(1)} L ${coords[1][0].toFixed(1)} ${coords[1][1].toFixed(1)}`;
  }
  let d = `M ${coords[0][0].toFixed(1)} ${coords[0][1].toFixed(1)}`;
  for (let i = 0; i < coords.length - 1; i++) {
    const p0 = coords[i - 1] || coords[i];
    const p1 = coords[i];
    const p2 = coords[i + 1];
    const p3 = coords[i + 2] || p2;
    // Tension 6 keeps the curve tight to the data — high enough to look
    // smooth, low enough that it can't invent a peak that isn't there.
    const c1x = p1[0] + (p2[0] - p0[0]) / 6;
    const c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6;
    const c2y = p2[1] - (p3[1] - p1[1]) / 6;
    d += ` C ${c1x.toFixed(1)} ${c1y.toFixed(1)}, ${c2x.toFixed(1)} ${c2y.toFixed(1)}, ${p2[0].toFixed(1)} ${p2[1].toFixed(1)}`;
  }
  return d;
}

function renderWeightChart(points, targetWeight) {
  if (points.length === 0) return '<p class="empty-state-sub">سجلي وزنك لرؤية الرسم البياني</p>';
  const width = 320, height = 150, padding = 24, padRight = 34;
  const values = points.map(p => p.value);
  let min = Math.min(...values), max = Math.max(...values);
  if (targetWeight != null) { min = Math.min(min, targetWeight); max = Math.max(max, targetWeight); }
  if (min === max) { min -= 1; max += 1; }
  const rangePad = (max - min) * 0.15;
  min -= rangePad; max += rangePad;

  const plotW = width - padding - padRight;
  const xStep = points.length > 1 ? plotW / (points.length - 1) : 0;
  const scaleY = (v) => height - padding - ((v - min) / (max - min)) * (height - 2 * padding);
  const coords = points.map((p, i) => [padding + i * xStep, scaleY(p.value)]);

  const linePath = smoothPath(coords);
  // Area fill: the same curve, closed down to the baseline. Gives the
  // chart some visual weight instead of a lone hairline.
  const baseY = height - padding;
  const areaPath = points.length > 1
    ? `${linePath} L ${coords[coords.length - 1][0].toFixed(1)} ${baseY} L ${coords[0][0].toFixed(1)} ${baseY} Z`
    : '';

  // Reference gridlines + value labels, so the numbers mean something
  // without having to tap a dot.
  const gridVals = [max - rangePad, (min + max) / 2, min + rangePad];
  const grid = gridVals.map(v => `
    <line x1="${padding}" y1="${scaleY(v).toFixed(1)}" x2="${width - padRight}" y2="${scaleY(v).toFixed(1)}" class="chart-gridline"/>
    <text x="${width - padRight + 4}" y="${(scaleY(v) + 3).toFixed(1)}" class="chart-axis-label">${v.toFixed(1)}</text>
  `).join('');

  const dots = coords.map(([x, y], i) => `
    <circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="10" fill="transparent" class="chart-point-hit" data-date="${points[i].date}" data-value="${points[i].value}"/>
    <circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3.5" class="chart-dot"/>
  `).join('');
  const targetLine = targetWeight != null
    ? `<line x1="${padding}" y1="${scaleY(targetWeight).toFixed(1)}" x2="${width - padRight}" y2="${scaleY(targetWeight).toFixed(1)}" class="chart-target-line"/>`
    : '';

  return `<svg viewBox="0 0 ${width} ${height}" class="weight-chart-svg">
    <defs>
      <linearGradient id="weight-area-grad" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="var(--pink-deep)" stop-opacity="0.28"/>
        <stop offset="100%" stop-color="var(--pink-deep)" stop-opacity="0"/>
      </linearGradient>
    </defs>
    ${grid}
    ${areaPath ? `<path d="${areaPath}" fill="url(#weight-area-grad)" stroke="none"/>` : ''}
    ${targetLine}
    <path d="${linePath}" fill="none" class="chart-line"/>
    ${dots}
  </svg>`;
}

function openWeightModal(onSaved) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal">
      <h2 class="modal-title">تسجيل الوزن</h2>
      <label class="field-label">الوزن (كغ)</label>
      <input class="text-input" type="number" step="0.1" min="0" id="weight-input" placeholder="مثلاً: 68.5" autofocus>
      <div class="modal-actions">
        <button class="btn btn-text" id="weight-cancel">إلغاء</button>
        <button class="btn btn-primary" id="weight-save">حفظ</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  document.getElementById('weight-cancel').addEventListener('click', () => overlay.remove());
  document.getElementById('weight-save').addEventListener('click', async () => {
    const v = readNumericField('weight-input');
    if (v === null || v <= 0) return;
    await setWeight(todayStr(), v);
    overlay.remove();
    if (onSaved) onSaved();
  });
}

async function deleteWeight(dateStr) {
  const existing = await db.weightLogs.where('date').equals(dateStr).first();
  if (existing) await db.weightLogs.delete(existing.id);
}

async function openWeightModalForDate(dateStr, onSaved) {
  const existing = await db.weightLogs.where('date').equals(dateStr).first();
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal">
      <h2 class="modal-title">الوزن — ${formatDateArabic(dateStr, { weekday: false })}</h2>
      <label class="field-label">الوزن (كغ)</label>
      <input class="text-input" type="number" step="0.1" min="0" id="weight-input-d" value="${existing ? existing.value : ''}" autofocus>
      <div class="modal-actions">
        ${existing ? `<button class="btn btn-danger btn-sm" id="weight-delete-d">حذف</button>` : ''}
        <button class="btn btn-text" id="weight-cancel-d">إلغاء</button>
        <button class="btn btn-primary" id="weight-save-d">حفظ</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  document.getElementById('weight-cancel-d').addEventListener('click', () => overlay.remove());
  const deleteBtn = document.getElementById('weight-delete-d');
  if (deleteBtn) deleteBtn.addEventListener('click', async () => {
    if (!confirm('حذف تسجيل الوزن لهذا اليوم؟')) return;
    await deleteWeight(dateStr);
    overlay.remove();
    if (onSaved) onSaved();
  });
  document.getElementById('weight-save-d').addEventListener('click', async () => {
    const v = readNumericField('weight-input-d');
    if (v === null || v <= 0) return;
    await setWeight(dateStr, v);
    overlay.remove();
    if (onSaved) onSaved();
  });
}

// ---------- BMI + waist-to-height (factual reference, not a directive) ----------
//
// Two deliberate departures from the naive version:
//
// 1. CORRECTED BMI. The classic formula (kg/m²) squares height, but human
//    mass doesn't scale as height² — it lands nearer height^2.5. The
//    consequence is well documented: the standard formula UNDERSTATES BMI
//    for short people and OVERSTATES it for tall ones. That's precisely
//    why the "healthy range" it produces for a short person looks absurdly
//    low at the bottom end. So the corrected form (Trefethen's, scaled by
//    1.3 so it agrees with the classic at average height ~1.69 m) is shown
//    alongside it rather than instead of it — the standard number is what
//    a doctor will quote, so hiding it would be unhelpful.
//
// 2. WAIST-TO-HEIGHT RATIO. BMI can't tell muscle from fat and can't see
//    WHERE fat sits, which is the part that actually matters. Waist-to-
//    height ratio can, it needs no age/sex/ethnicity-specific cutoffs, and
//    NICE adopted it in 2022 with the memorable rule: keep your waist under
//    half your height (< 0.5). This app already tracks a waist measurement,
//    so it can compute the better metric for free.
function computeBmi(weightKg, heightCm) {
  const h = heightCm / 100;
  return weightKg / (h * h);
}
// Trefethen's corrected index: 1.3 × kg / m^2.5.
function computeCorrectedBmi(weightKg, heightCm) {
  const h = heightCm / 100;
  return 1.3 * weightKg / Math.pow(h, 2.5);
}
function bmiCategory(bmi) {
  if (bmi < 18.5) return 'أقل من المعتاد';
  if (bmi < 25) return 'ضمن المعتاد';
  if (bmi < 30) return 'أعلى من المعتاد';
  return 'مرتفع';
}
// Weight range for a "within the usual" corrected BMI at this height.
function healthyWeightRange(heightCm) {
  const h = heightCm / 100;
  const p = Math.pow(h, 2.5);
  return { min: 18.5 * p / 1.3, max: 24.9 * p / 1.3 };
}

function whtrCategory(ratio) {
  if (ratio < 0.4) return { label: 'أقل من المعتاد', tone: 'warning' };
  if (ratio < 0.5) return { label: 'ضمن المعتاد', tone: 'success' };
  if (ratio < 0.6) return { label: 'أعلى من المعتاد', tone: 'warning' };
  return { label: 'مرتفع', tone: 'danger' };
}

// A themed horizontal gauge: coloured bands + a marker where she sits.
// Shows the shape of the scale instead of pronouncing a verdict.
function gaugeHtml(value, min, max, bands, label) {
  const clamped = Math.max(min, Math.min(max, value));
  const pct = ((clamped - min) / (max - min)) * 100;
  const segments = bands.map(b => {
    const from = ((Math.max(min, b.from) - min) / (max - min)) * 100;
    const to = ((Math.min(max, b.to) - min) / (max - min)) * 100;
    return `<div class="gauge-band gauge-band-${b.tone}" style="inset-inline-start:${from}%; width:${to - from}%"></div>`;
  }).join('');
  return `
    <div class="gauge">
      <div class="gauge-track">${segments}</div>
      <div class="gauge-marker" style="inset-inline-start:${pct}%">
        <span class="gauge-marker-dot"></span>
      </div>
    </div>
    ${label ? `<div class="gauge-caption">${label}</div>` : ''}`;
}

async function renderBmiCard(container) {
  const settings = await db.settings.get(1);
  const latest = await getLatestWeight();

  if (!settings?.heightCm) {
    container.innerHTML = `
      <p class="ring-label">مؤشرات الجسم</p>
      <p class="empty-state-sub">أضيفي طولك من الإعدادات لعرض المؤشرات</p>
      <button class="link-btn" id="go-to-health-settings">فتح الإعدادات ←</button>
    `;
    document.getElementById('go-to-health-settings').addEventListener('click', () => goTo('/settings'));
    return;
  }
  if (!latest) {
    container.innerHTML = `
      <p class="ring-label">مؤشرات الجسم</p>
      <p class="empty-state-sub">سجّلي وزنك لعرض المؤشرات</p>`;
    return;
  }

  const h = settings.heightCm;
  const bmi = computeBmi(latest.value, h);
  const cBmi = computeCorrectedBmi(latest.value, h);
  const range = healthyWeightRange(h);
  const cat = bmiCategory(cBmi);

  const bmiBands = [
    { from: 15, to: 18.5, tone: 'warning' },
    { from: 18.5, to: 25, tone: 'success' },
    { from: 25, to: 30, tone: 'warning' },
    { from: 30, to: 40, tone: 'danger' }
  ];

  // Waist-to-height, if she tracks a waist measurement.
  const waist = await getLatestWaistCm();
  let whtrBlock = '';
  if (waist) {
    const ratio = waist / h;
    const wc = whtrCategory(ratio);
    const halfHeight = h / 2;
    whtrBlock = `
      <div class="metric-block">
        <div class="metric-head">
          <span class="metric-name">نسبة الخصر إلى الطول</span>
          <span class="metric-chip metric-chip-${wc.tone}">${wc.label}</span>
        </div>
        <div class="metric-value-row">
          <span class="metric-value">${toArabicNumeral(ratio.toFixed(2))}</span>
          <span class="metric-hint">القاعدة: خصرك أقل من نصف طولك (أقل من ${toArabicNumeral(halfHeight.toFixed(0))} سم)</span>
        </div>
        ${gaugeHtml(ratio, 0.35, 0.65, [
          { from: 0.35, to: 0.4, tone: 'warning' },
          { from: 0.4, to: 0.5, tone: 'success' },
          { from: 0.5, to: 0.6, tone: 'warning' },
          { from: 0.6, to: 0.65, tone: 'danger' }
        ], '')}
        <p class="metric-note">مؤشر أدقّ من كتلة الجسم لأنه يرى أين تتوزّع الدهون، لا الوزن وحده.</p>
      </div>`;
  } else {
    whtrBlock = `
      <div class="metric-block">
        <div class="metric-head">
          <span class="metric-name">نسبة الخصر إلى الطول</span>
        </div>
        <p class="metric-note">أضيفي قياس «الخصر» في قياسات الجسم لعرض هذا المؤشر — وهو أدقّ من مؤشر كتلة الجسم.</p>
      </div>`;
  }

  container.innerHTML = `
    <p class="ring-label">مؤشرات الجسم</p>

    <div class="metric-block">
      <div class="metric-head">
        <span class="metric-name">مؤشر كتلة الجسم</span>
        <span class="metric-chip metric-chip-${cBmi < 18.5 ? 'warning' : cBmi < 25 ? 'success' : cBmi < 30 ? 'warning' : 'danger'}">${cat}</span>
      </div>
      <div class="metric-value-row">
        <span class="metric-value">${toArabicNumeral(cBmi.toFixed(1))}</span>
        <span class="metric-hint">المعادلة التقليدية: ${toArabicNumeral(bmi.toFixed(1))}</span>
      </div>
      ${gaugeHtml(cBmi, 15, 40, bmiBands, '')}
      <p class="metric-note">
        الرقم الأول مصحَّح للطول (يقسم على الطول^٢٫٥ بدل ٢)، لأن المعادلة التقليدية تُظهر القصيرات أنحف والطويلات أثقل مما هنّ عليه.
        المدى المعتاد لطولك: ${toArabicNumeral(range.min.toFixed(0))}–${toArabicNumeral(range.max.toFixed(0))} كغ.
      </p>
    </div>

    ${whtrBlock}

    <button class="link-btn" id="go-to-health-settings">تعديل الطول ←</button>
  `;
  document.getElementById('go-to-health-settings').addEventListener('click', () => goTo('/settings'));
}

// ---------- body measurements (optional, flexible — she names her own) ----------

async function createMeasurement(name) {
  const all = await db.bodyMeasurements.toArray();
  await db.bodyMeasurements.add({ name, archived: false, order: all.length, createdAt: Date.now() });
}
async function updateMeasurementName(id, name) {
  await db.bodyMeasurements.update(id, { name });
}
async function deleteMeasurement(id) {
  await db.bodyMeasurements.update(id, { archived: true });
}
async function getActiveMeasurements() {
  const all = await db.bodyMeasurements.toArray();
  return all.filter(m => !m.archived).sort((a, b) => a.order - b.order);
}
async function getMeasurementLatest(measurementId) {
  const logs = await db.bodyMeasurementLogs.where('measurementId').equals(measurementId).toArray();
  if (logs.length === 0) return null;
  return logs.sort((a, b) => b.date.localeCompare(a.date))[0];
}
// Full history, newest first.
async function getMeasurementLogs(measurementId) {
  const logs = await db.bodyMeasurementLogs.where('measurementId').equals(measurementId).toArray();
  return logs.sort((a, b) => b.date.localeCompare(a.date));
}
// Change since the previous entry — what she actually wants to know at a
// glance ("am I moving?"), rather than just today's absolute number.
async function getMeasurementDelta(measurementId) {
  const logs = await getMeasurementLogs(measurementId);
  if (logs.length < 2) return null;
  return {
    delta: logs[0].value - logs[1].value,
    spanDays: daysBetween(logs[1].date, logs[0].date),
    from: logs[1].value
  };
}
async function setMeasurementValue(measurementId, date, value) {
  await upsertLog(db.bodyMeasurementLogs, 'measurementId', measurementId, date, { value });
}
async function deleteMeasurementLog(logId) {
  await db.bodyMeasurementLogs.delete(logId);
}

// The waist measurement, whatever she happened to call it — needed for
// waist-to-height ratio. Matches the common Arabic spellings rather than
// forcing a fixed name.
async function getLatestWaistCm() {
  const items = await getActiveMeasurements();
  const waist = items.find(m => /خصر|وسط|waist/i.test(m.name));
  if (!waist) return null;
  const latest = await getMeasurementLatest(waist.id);
  return latest ? latest.value : null;
}

function measurementDeltaPill(d) {
  if (!d || Math.abs(d.delta) < 0.05) return '';
  const rising = d.delta > 0;
  return `<span class="measure-delta measure-delta-${rising ? 'up' : 'down'}">
    ${rising ? '↑' : '↓'} ${toArabicNumeral(Math.abs(d.delta).toFixed(1))}
  </span>`;
}

// Map a free-text measurement name to a body zone by keyword, so "خصر"
// and "محيط البطن" both land on the waist of the diagram. First match
// wins; anything unmatched is listed under the figure instead.
const BODY_ZONES = [
  { key: 'neck',     y: 66,  x1: 108, x2: 132, side: 'right', kws: ['رقبة', 'عنق'] },
  { key: 'chest',    y: 108, x1: 80,  x2: 160, side: 'left',  kws: ['صدر', 'بست', 'bust', 'أكتاف', 'كتف'] },
  { key: 'arm',      y: 138, x1: 162, x2: 188, side: 'right', kws: ['ذراع', 'عضد', 'ساعد', 'باي'] },
  { key: 'waist',    y: 150, x1: 90,  x2: 150, side: 'right', kws: ['خصر', 'بطن', 'وسط', 'كرش'] },
  { key: 'hips',     y: 192, x1: 78,  x2: 162, side: 'left',  kws: ['ورك', 'أرداف', 'حوض', 'ردف', 'مؤخرة'] },
  { key: 'thigh',    y: 250, x1: 88,  x2: 152, side: 'right', kws: ['فخذ', 'فخد'] },
  { key: 'calf',     y: 358, x1: 90,  x2: 150, side: 'left',  kws: ['ساق', 'سمانة', 'بطة', 'ربلة'] }
];
function matchBodyZone(name) {
  const n = (name || '').toLowerCase();
  for (const z of BODY_ZONES) if (z.kws.some(k => n.includes(k))) return z.key;
  return null;
}

// A stylized figure with each tracked measurement drawn as a band across
// the body at its zone, its latest value called out to the side. Gives
// her the "see it on a body" view; measurements that don't map to a zone
// (or share one) are listed below so nothing is hidden.
async function renderBodyDiagram(container) {
  if (!container) return;
  const items = await getActiveMeasurements();
  if (items.length === 0) { container.innerHTML = ''; container.style.display = 'none'; return; }
  container.style.display = '';

  const placed = {}; const unplaced = [];
  for (const m of items) {
    const latest = await getMeasurementLatest(m.id);
    const zone = matchBodyZone(m.name);
    if (zone && !placed[zone]) placed[zone] = { m, latest };
    else unplaced.push({ m, latest });
  }

  const skin = 'var(--lavender-deep)';
  const bands = BODY_ZONES.filter(z => placed[z.key]).map(z => {
    const { m, latest } = placed[z.key];
    const val = latest ? `${toArabicNumeral(latest.value)}` : '—';
    const labelX = z.side === 'right' ? 210 : 30;
    const anchorX = z.side === 'right' ? z.x2 : z.x1;
    const textAnchor = z.side === 'right' ? 'start' : 'end';
    return `
      <line x1="${z.x1}" y1="${z.y}" x2="${z.x2}" y2="${z.y}" class="bd-band"/>
      <line x1="${anchorX}" y1="${z.y}" x2="${labelX}" y2="${z.y}" class="bd-lead"/>
      <text x="${labelX}" y="${z.y - 4}" text-anchor="${textAnchor}" class="bd-label">${escapeHtml(m.name)}</text>
      <text x="${labelX}" y="${z.y + 12}" text-anchor="${textAnchor}" class="bd-value">${val} سم</text>`;
  }).join('');

  container.innerHTML = `
    <div class="body-diagram">
      <svg viewBox="0 0 240 460" class="body-diagram-svg">
        <g fill="${skin}" opacity="0.9">
          <circle cx="120" cy="42" r="22"/>
          <rect x="111" y="60" width="18" height="15" rx="7"/>
          <rect x="74" y="72" width="92" height="30" rx="15"/>
          <rect x="57" y="80" width="18" height="122" rx="9"/>
          <rect x="165" y="80" width="18" height="122" rx="9"/>
          <rect x="88" y="96" width="64" height="94" rx="22"/>
          <rect x="79" y="168" width="82" height="52" rx="24"/>
          <rect x="91" y="205" width="25" height="212" rx="12"/>
          <rect x="124" y="205" width="25" height="212" rx="12"/>
        </g>
        ${bands}
      </svg>
    </div>
    ${unplaced.length ? `<div class="bd-extra">${unplaced.map(u => `<span class="bd-extra-chip">${escapeHtml(u.m.name)}: <strong>${u.latest ? toArabicNumeral(u.latest.value) + ' سم' : '—'}</strong></span>`).join('')}</div>` : ''}`;
}

// One measurement over time as the bold line, with weight overlaid (thin,
// normalised to its own range) so she can see them move together.
async function renderMeasurementChart(container, measurementId, rangeDays) {
  if (!container) return;
  const start = rangeDays === 'all' ? '0000-00-00' : addDays(todayStr(), -Number(rangeDays) + 1);
  const [mLogsRaw, wLogsRaw] = await Promise.all([getMeasurementLogs(measurementId), getAllWeightLogs()]);
  const mLogs = mLogsRaw.filter(l => l.date >= start).sort((a, b) => a.date.localeCompare(b.date));
  if (mLogs.length < 2) { container.innerHTML = '<p class="empty-state-sub">سجّلي قياسين على الأقل لرؤية الرسم.</p>'; return; }
  const wLogs = wLogsRaw.filter(l => l.date >= start).sort((a, b) => a.date.localeCompare(b.date));

  const width = 320, height = 160, padL = 30, padR = 12, padT = 12, padB = 20;
  const plotW = width - padL - padR, plotH = height - padT - padB;
  const allDates = [...new Set([...mLogs.map(l => l.date), ...wLogs.map(l => l.date)])].sort();
  const xOf = (date) => padL + (allDates.length === 1 ? plotW / 2 : (allDates.indexOf(date) / (allDates.length - 1)) * plotW);

  const mv = mLogs.map(l => l.value);
  let mMin = Math.min(...mv), mMax = Math.max(...mv); if (mMin === mMax) { mMin -= 1; mMax += 1; }
  const mpad = (mMax - mMin) * 0.2; mMin -= mpad; mMax += mpad;
  const mY = (v) => padT + plotH - ((v - mMin) / (mMax - mMin)) * plotH;
  const mCoords = mLogs.map(l => [xOf(l.date), mY(l.value)]);
  const mPath = smoothPath(mCoords);
  const mDots = mLogs.map(l => `<circle cx="${xOf(l.date).toFixed(1)}" cy="${mY(l.value).toFixed(1)}" r="3" fill="var(--pink-deep)"/>`).join('');

  let weightPath = '';
  if (wLogs.length >= 2) {
    const wv = wLogs.map(l => l.value);
    let wMin = Math.min(...wv), wMax = Math.max(...wv); if (wMin === wMax) { wMin -= 1; wMax += 1; }
    const wY = (v) => padT + plotH - ((v - wMin) / (wMax - wMin)) * plotH * 0.9 - plotH * 0.05;
    const wCoords = wLogs.map(l => [xOf(l.date), wY(l.value)]);
    weightPath = `<path d="${smoothPath(wCoords)}" fill="none" stroke="var(--info-strong)" stroke-width="1.6" stroke-opacity="0.8"/>`;
  }
  const yLabels = [mMax - mpad, mMin + mpad].map(v => `<text x="${padL - 4}" y="${(mY(v) + 3).toFixed(1)}" class="chart-axis-label" text-anchor="end">${toArabicNumeral(v.toFixed(0))}</text>`).join('');

  container.innerHTML = `
    <svg viewBox="0 0 ${width} ${height}" class="measure-chart-svg">
      ${weightPath}
      <path d="${mPath}" fill="none" stroke="var(--pink-deep)" stroke-width="2.4"/>
      ${mDots}${yLabels}
    </svg>
    <div class="diet-legend"><span class="diet-leg"><i class="diet-leg-swatch" style="background:var(--pink-deep)"></i> القياس</span>${wLogs.length >= 2 ? '<span class="diet-leg"><i class="diet-leg-swatch" style="background:var(--info-strong)"></i> الوزن</span>' : ''}</div>`;
}

async function renderMeasurementsList(container) {
  const items = await getActiveMeasurements();
  if (items.length === 0) {
    container.innerHTML = `<div class="empty-state"><p>ما في قياسات مضافة (اختياري).</p></div>`;
    return;
  }
  const rows = await Promise.all(items.map(async m => {
    const latest = await getMeasurementLatest(m.id);
    const d = await getMeasurementDelta(m.id);
    return `
      <div class="task-row-wrap measure-row" data-measurement-id="${m.id}">
        <button class="measure-main" data-action="open">
          <span class="measure-name">${escapeHtml(m.name)}</span>
          <span class="measure-value-block">
            <span class="measure-value">${latest ? `${toArabicNumeral(latest.value)} <span class="measure-unit">سم</span>` : '—'}</span>
            ${measurementDeltaPill(d)}
          </span>
        </button>
        ${kebabMenuHtml(String(m.id), [
          { key: 'rename', label: 'تعديل الاسم' },
          { key: 'delete', label: 'حذف', danger: true }
        ])}
      </div>`;
  }));
  container.innerHTML = rows.join('');
  const refresh = () => renderMeasurementsList(container);

  container.querySelectorAll('.measure-row').forEach(row => {
    const id = Number(row.dataset.measurementId);
    const item = items.find(m => m.id === id);
    row.querySelector('[data-action="open"]').addEventListener('click', () => {
      openMeasurementDetailModal(item, refresh);
    });
  });
  wireKebabMenus(container, async (rowId, action) => {
    const id = Number(rowId);
    if (action === 'rename') {
      const item = items.find(m => m.id === id);
      const name = prompt('اسم القياس:', item.name);
      if (!name || !name.trim()) return;
      await updateMeasurementName(id, name.trim());
      await refresh();
    } else if (action === 'delete') {
      if (!confirm('حذف هذا القياس؟ سجل القياسات السابقة يبقى محفوظاً.')) return;
      await deleteMeasurement(id);
      await refresh();
    }
  });
}

// Tap a measurement to log a new value AND to see/edit/delete its history.
// The old version was a bare prompt() that could only overwrite today —
// there was no way to fix a typo from last week.
function openMeasurementDetailModal(measurement, onDone) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal modal-lg">
      <h2 class="modal-title">${escapeHtml(measurement.name)}</h2>
      <div id="measure-summary"></div>
      <div id="measure-chart"></div>

      <label class="field-label">قياس جديد (سم)</label>
      <div class="theme-accent-row">
        <input class="text-input" type="text" inputmode="decimal" id="measure-new-value" placeholder="مثلاً: ٧٤٫٥">
        <input class="text-input" type="date" id="measure-new-date" value="${todayStr()}">
      </div>
      <button class="btn btn-primary btn-block" id="measure-add-btn">حفظ القياس</button>

      <h3 class="material-type-label" style="margin-top: var(--space-4);">السجل</h3>
      <div id="measure-history"></div>

      <div class="modal-actions">
        <button class="btn btn-text" id="measure-close">إغلاق</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  async function refreshInner() {
    const logs = await getMeasurementLogs(measurement.id);
    const d = await getMeasurementDelta(measurement.id);

    document.getElementById('measure-summary').innerHTML = logs.length ? `
      <div class="weight-stat-block">
        <div class="weight-stat-main">
          <span class="weight-stat-value">${toArabicNumeral(logs[0].value)}</span>
          <span class="weight-stat-unit">سم</span>
          ${d ? `<span class="weight-delta-pill weight-delta-neutral">
            <span class="weight-delta-arrow">${d.delta > 0 ? '↑' : d.delta < 0 ? '↓' : '→'}</span>
            ${toArabicNumeral(Math.abs(d.delta).toFixed(1))} سم
          </span>` : ''}
        </div>
        ${d ? `<span class="weight-stat-sub">منذ آخر قياس (${toArabicNumeral(d.spanDays)} ${d.spanDays <= 10 ? 'أيام' : 'يوماً'})</span>` : ''}
      </div>` : `<p class="empty-state-sub">لا قياسات بعد.</p>`;

    document.getElementById('measure-history').innerHTML = logs.length
      ? logs.map(l => `
        <div class="reading-row" data-log-id="${l.id}">
          <span class="reading-time">${formatDateArabic(l.date, { weekday: false })}</span>
          <span class="reading-vals">${toArabicNumeral(l.value)} سم</span>
          <button class="reading-delete" data-log-id="${l.id}" aria-label="حذف">✕</button>
        </div>`).join('')
      : '';

    await renderMeasurementChart(document.getElementById('measure-chart'), measurement.id, 'all');

    document.querySelectorAll('#measure-history .reading-delete').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm('حذف هذا القياس؟')) return;
        await deleteMeasurementLog(Number(btn.dataset.logId));
        await refreshInner();
      });
    });
  }
  refreshInner();

  document.getElementById('measure-add-btn').addEventListener('click', async () => {
    const v = readNumericField('measure-new-value');
    const date = document.getElementById('measure-new-date').value || todayStr();
    if (v === null || v <= 0) return;
    await setMeasurementValue(measurement.id, date, v);
    document.getElementById('measure-new-value').value = '';
    await refreshInner();
    toast('تم حفظ القياس');
  });
  document.getElementById('measure-close').addEventListener('click', () => {
    overlay.remove();
    if (onDone) onDone();
  });
}

function openAddMeasurementModal(onAdded) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal">
      <h2 class="modal-title">قياس جديد</h2>
      <label class="field-label">اسم القياس</label>
      <input class="text-input" id="new-measurement-name" placeholder="مثلاً: الخصر" autofocus>
      <div class="modal-actions">
        <button class="btn btn-text" id="new-measurement-cancel">إلغاء</button>
        <button class="btn btn-primary" id="new-measurement-save">إضافة</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  document.getElementById('new-measurement-cancel').addEventListener('click', () => overlay.remove());
  document.getElementById('new-measurement-save').addEventListener('click', async () => {
    const name = document.getElementById('new-measurement-name').value.trim();
    if (!name) return;
    await createMeasurement(name);
    overlay.remove();
    if (onAdded) onAdded();
  });
}

// ---------- full Body + Mood page ----------

async function renderBodyPage(params, view) {
  view.innerHTML = `
    <div class="page-header">
      <button class="icon-btn" aria-label="رجوع" id="body-back">→</button>
      <h1>الصحة</h1>
    </div>
    <div class="card" id="body-sleep-summary"></div>
    <div class="card">
      <div class="section-header">
        <h2 class="card-title">💪 التمارين</h2>
        <a class="see-all-link" href="#/training">فتح ←</a>
      </div>
      <p class="settings-note">تمارينك اليومية، بعداد مجموعات، تكرار، ومؤقّت.</p>
    </div>
    <div class="card" id="diet-summary-card"></div>
    <div class="card" id="daily-care-card"></div>
    <div class="card" id="weight-glance-card"></div>
    <div class="card">
      <h2 class="card-title">الرسم البياني</h2>
      <div class="chart-range-chips" id="chart-range-chips">
        <button class="chip" data-range="30">شهر</button>
        <button class="chip" data-range="60">شهرين</button>
        <button class="chip" data-range="90">٣ أشهر</button>
        <button class="chip" data-range="150">٥ أشهر</button>
        <button class="chip" data-range="365">سنة</button>
        <button class="chip active" data-range="all">الكل</button>
      </div>
      <div class="weight-chart-wrap" id="weight-chart"></div>
      <p class="chart-point-info" id="chart-point-info"></p>
      <label class="field-label">الوزن المستهدف (اختياري)</label>
      <input class="text-input" type="number" step="0.1" id="target-weight-input">
      <button class="link-btn" id="save-target-btn">حفظ الهدف</button>
    </div>
    <div class="card">
      <button class="btn btn-primary btn-block" id="weight-add-btn">+ تسجيل وزن اليوم</button>
      <details class="weight-history-details">
        <summary>كل التسجيلات</summary>
        <div id="weight-history-list"></div>
      </details>
    </div>
    <div class="card" id="bmi-card"></div>
    <div class="card">
      <h2 class="card-title">قياسات الجسم (اختياري)</h2>
      <div id="body-diagram-card" style="display:none"></div>
      <div id="measurements-list"></div>
      <button class="btn btn-secondary btn-block" id="add-measurement-btn">+ قياس جديد</button>
    </div>
    <div class="card">
      <h2 class="card-title">مزاج اليوم</h2>
      <div id="body-mood-widget"></div>
      <a class="see-all-link" href="#/mood-history">سجل المزاج ←</a>
    </div>
  `;
  document.getElementById('body-back').addEventListener('click', () => history.back());

  let selectedRange = 'all';

  async function refreshWeight() {
    const stats = await getWeightStats();
    const settings = await db.settings.get(1);
    document.getElementById('weight-glance-card').innerHTML = `
      <p class="ring-label">وزنك</p>
      ${weightStatBlockHtml(stats, settings?.targetWeightKg ?? null)}
    `;
    const allPoints = await getAllWeightLogs();
    const points = selectedRange === 'all'
      ? allPoints
      : allPoints.filter(p => p.date >= addDays(todayStr(), -Number(selectedRange)));
    document.getElementById('weight-chart').innerHTML = renderWeightChart(points, settings?.targetWeightKg ?? null);
    document.getElementById('chart-point-info').textContent = points.length ? 'اضغطي على أي نقطة لرؤية تاريخها ووزنها' : '';
    document.getElementById('target-weight-input').value = settings?.targetWeightKg ?? '';
    await renderBmiCard(document.getElementById('bmi-card'));

    document.querySelectorAll('.chart-point-hit').forEach(circle => {
      circle.addEventListener('click', () => {
        document.getElementById('chart-point-info').textContent =
          `${formatDateArabic(circle.dataset.date, { weekday: false })} · ${circle.dataset.value} كغ`;
      });
    });

    const historyEl = document.getElementById('weight-history-list');
    if (allPoints.length === 0) {
      historyEl.innerHTML = `<p class="empty-state-sub">ما في تسجيلات بعد.</p>`;
    } else {
      const rows = [...allPoints].reverse().map(p => `
        <div class="txn-row" data-weight-date="${p.date}">
          <div class="txn-info">
            <span class="txn-note">${p.value} كغ</span>
            <span class="txn-date">${formatDateArabic(p.date, { weekday: false })}</span>
          </div>
          ${kebabMenuHtml(p.date, [
            { key: 'edit', label: 'تعديل' },
            { key: 'delete', label: 'حذف', danger: true }
          ])}
        </div>`).join('');
      historyEl.innerHTML = rows;
      wireKebabMenus(historyEl, async (rowId, action) => {
        if (action === 'edit') {
          openWeightModalForDate(rowId, refreshWeight);
        } else if (action === 'delete') {
          if (!confirm('حذف هذا التسجيل؟')) return;
          await deleteWeight(rowId);
          await refreshWeight();
        }
      });
    }
  }

  document.getElementById('chart-range-chips').querySelectorAll('.chip').forEach(chip => {
    chip.addEventListener('click', () => {
      selectedRange = chip.dataset.range;
      document.querySelectorAll('#chart-range-chips .chip').forEach(c => c.classList.toggle('active', c === chip));
      refreshWeight();
    });
  });

  document.getElementById('weight-add-btn').addEventListener('click', () => openWeightModal(refreshWeight));
  await renderSleepSummaryCard(document.getElementById('body-sleep-summary'));
  await renderDietSummaryCard(document.getElementById('diet-summary-card'));
  await renderDailyCareSummaryCard(document.getElementById('daily-care-card'));
  document.getElementById('save-target-btn').addEventListener('click', async () => {
    const raw = document.getElementById('target-weight-input').value;
    const v = parseNumericInput(raw);
    await db.settings.update(1, { targetWeightKg: v });
    toast('تم حفظ الهدف');
    refreshWeight();
  });

  await refreshWeight();

  const measurementsListEl = document.getElementById('measurements-list');
  const diagramEl = document.getElementById('body-diagram-card');
  const refreshMeasures = async () => { await renderMeasurementsList(measurementsListEl); await renderBodyDiagram(diagramEl); };
  await refreshMeasures();
  document.getElementById('add-measurement-btn').addEventListener('click', () => {
    openAddMeasurementModal(refreshMeasures);
  });

  await renderMoodWidget(document.getElementById('body-mood-widget'), todayStr());
}

// ---------- Day Detail provider (weight only) ----------

async function weightDayProvider(dateStr) {
  const log = await db.weightLogs.where('date').equals(dateStr).first();
  const editable = !isFutureDate(dateStr);
  if (!log && !editable) return null;

  const node = document.createElement('div');
  function render(currentLog) {
    node.innerHTML = `
      ${currentLog ? `<p class="period-day-note">⚖️ ${currentLog.value} كغ</p>` : `<p class="empty-state-sub">ما في وزن مسجل بهذا اليوم.</p>`}
      ${editable ? `<button class="btn btn-secondary btn-block" id="day-weight-btn">${currentLog ? 'تعديل' : '+ تسجيل الوزن'}</button>` : ''}
    `;
    const btn = node.querySelector('#day-weight-btn');
    if (btn) btn.addEventListener('click', () => {
      openWeightModalForDate(dateStr, async () => {
        const fresh = await db.weightLogs.where('date').equals(dateStr).first();
        render(fresh);
      });
    });
  }
  render(log);
  return { title: 'الوزن', node };
}

// ---------- Yearly stats provider ----------

async function bodyYearlyProvider(year) {
  const all = await getAllWeightLogs();
  const prefix = String(year);
  const yearLogs = all.filter(w => w.date.startsWith(prefix));
  if (yearLogs.length === 0) return null;
  const first = yearLogs[0], last = yearLogs[yearLogs.length - 1];
  const change = last.value - first.value;
  const arrow = change > 0 ? '▲' : change < 0 ? '▼' : '';
  const html = `
    <div class="yearly-row"><span>عدد التسجيلات</span><span>${yearLogs.length}</span></div>
    <div class="yearly-row"><span>${formatDateArabic(first.date, { weekday: false })} ← ${formatDateArabic(last.date, { weekday: false })}</span><span>${first.value} ← ${last.value} كغ</span></div>
    <div class="yearly-row"><span>التغيّر</span><span>${arrow} ${Math.abs(change).toFixed(1)} كغ</span></div>
  `;
  return { title: 'الوزن', html, count: yearLogs.length };
}
