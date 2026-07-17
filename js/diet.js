// diet.js — وضع الدايت (Diet mode).
//
// WHY THIS EXISTS: the app already knows two things separately — what she
// ate (foodLogs: calories / macros / meal weight) and what she weighs
// (weightLogs). On their own each is a list of numbers. Together they can
// answer the question a diet is actually FOR: "what am I eating on the
// days my weight goes down, versus up?" This module joins the two and
// says something honest about the pattern.
//
// HONESTY ABOUT THE METHOD: this is correlation on a handful of noisy,
// irregular home measurements — not a controlled study. Water weight,
// timing, and missed logs all add noise. So it's framed as "tended to"
// and "associated with," never "this food made you gain," and it says so
// on the page. It needs a real amount of data before it claims anything.

// The things she can plot against her weight. Each reads a different
// field off a meal; a meal with that field missing simply doesn't
// contribute to that metric's daily total.
const DIET_METRICS = [
  { key: 'calories', label: 'السعرات', unit: 'سعرة', field: 'calories', color: 'var(--btn-color, var(--pink-deep))' },
  { key: 'weight',   label: 'وزن الطعام', unit: 'غ', field: 'mealWeightG', color: 'var(--blue-deep)' },
  { key: 'protein',  label: 'البروتين', unit: 'غ', field: 'protein', color: 'var(--mint-deep)' },
  { key: 'carbs',    label: 'الكارب', unit: 'غ', field: 'carbs', color: 'var(--yellow-deep, #E0B450)' },
  { key: 'fat',      label: 'الدهون', unit: 'غ', field: 'fat', color: 'var(--lavender-deep, #B9A5E0)' }
];
function dietMetric(key) { return DIET_METRICS.find(m => m.key === key) || DIET_METRICS[0]; }

async function getDietMetricPref() {
  const s = await db.settings.get(1);
  return s?.dietMetric || 'calories';
}
async function saveDietMetricPref(key) {
  await db.settings.update(1, { dietMetric: key });
}

// Which metrics actually have data logged against them — so the picker
// doesn't offer "protein" when she's only ever entered calories.
async function getAvailableDietMetrics() {
  const logs = await db.foodLogs.toArray();
  return DIET_METRICS.filter(m => logs.some(l => l[m.field] != null && l[m.field] > 0));
}

// date -> summed value of one metric across that day's meals. Only meals
// carrying the field contribute; a day with none is absent from the map.
async function computeDailyIntake(metricKey) {
  const m = dietMetric(metricKey);
  const logs = await db.foodLogs.toArray();
  const map = {};
  for (const l of logs) {
    const v = l[m.field];
    if (v == null) continue;
    map[l.date] = (map[l.date] || 0) + v;
  }
  return map;
}

// The joined series over a date range: one row per day in the window that
// has EITHER a weight reading or an intake value, so the chart can line
// them up on a shared date axis.
async function getDietSeries(rangeDays, metricKey) {
  const [weightLogs, intake] = await Promise.all([getAllWeightLogs(), computeDailyIntake(metricKey)]);
  const weightByDate = {};
  weightLogs.forEach(w => { weightByDate[w.date] = w.value; });

  const start = rangeDays === 'all' ? null : addDays(todayStr(), -Number(rangeDays) + 1);
  const dateSet = new Set([...Object.keys(weightByDate), ...Object.keys(intake)]);
  let dates = [...dateSet].filter(d => (start === null || d >= start)).sort();

  return dates.map(date => ({
    date,
    weight: weightByDate[date] ?? null,
    metric: intake[date] ?? 0,
    hasMetric: intake[date] != null
  }));
}

// ---------- the analytics engine ----------
// Weight is measured irregularly, so the unit of analysis is the INTERVAL
// between two consecutive weigh-ins: its weight delta, its length in days,
// and every meal eaten inside it. A meal's "impact" is the average
// per-day weight change of the intervals it appeared in — negative means
// her weight tended to fall across the days she ate it, positive means it
// tended to rise. Per-day (delta / spanDays) keeps a 10-day interval from
// dwarfing a 2-day one.
async function analyzeDiet(rangeDays, metricKey) {
  const m = dietMetric(metricKey);
  const [weightLogs, foodLogs] = await Promise.all([getAllWeightLogs(), db.foodLogs.toArray()]);

  const start = rangeDays === 'all' ? '0000-00-00' : addDays(todayStr(), -Number(rangeDays) + 1);
  const weights = weightLogs.filter(w => w.date >= start);
  if (weights.length < 2) return { enough: false, weightPoints: weights.length };

  // Intervals between consecutive weigh-ins.
  const intervals = [];
  for (let i = 0; i < weights.length - 1; i++) {
    const a = weights[i], b = weights[i + 1];
    const spanDays = Math.max(1, daysBetween(a.date, b.date));
    intervals.push({
      startDate: a.date, endDate: b.date, spanDays,
      delta: b.value - a.value,
      perDay: (b.value - a.value) / spanDays,
      meals: foodLogs.filter(l => l.date >= a.date && l.date < b.date)
    });
  }

  // Overall weight change across the whole window.
  const totalDelta = weights[weights.length - 1].value - weights[0].value;
  const spanDays = Math.max(1, daysBetween(weights[0].date, weights[weights.length - 1].date));

  // Average daily intake over the window (for the metric ↔ weight signal).
  const intakeByDate = {};
  foodLogs.forEach(l => { if (l[m.field] != null) intakeByDate[l.date] = (intakeByDate[l.date] || 0) + l[m.field]; });
  const intakeDays = Object.keys(intakeByDate).filter(d => d >= start);
  const avgIntake = intakeDays.length ? intakeDays.reduce((s, d) => s + intakeByDate[d], 0) / intakeDays.length : 0;

  // Split intervals into "higher intake" vs "lower intake" halves and see
  // which way weight moved in each — the core "eating more ⇒ gaining?"
  // check, done on her own data rather than assumed.
  const intervalIntake = intervals.map(iv => {
    const days = {};
    iv.meals.forEach(l => { if (l[m.field] != null) days[l.date] = (days[l.date] || 0) + l[m.field]; });
    const ds = Object.keys(days);
    const avg = ds.length ? ds.reduce((s, d) => s + days[d], 0) / ds.length : 0;
    return { ...iv, avgIntake: avg };
  }).filter(iv => iv.avgIntake > 0);

  let intakeSignal = null;
  if (intervalIntake.length >= 4) {
    const sorted = [...intervalIntake].sort((a, b) => a.avgIntake - b.avgIntake);
    const half = Math.floor(sorted.length / 2);
    const low = sorted.slice(0, half);
    const high = sorted.slice(-half);
    const lowAvgPerDay = low.reduce((s, x) => s + x.perDay, 0) / low.length;
    const highAvgPerDay = high.reduce((s, x) => s + x.perDay, 0) / high.length;
    const lowIntakeAvg = low.reduce((s, x) => s + x.avgIntake, 0) / low.length;
    const highIntakeAvg = high.reduce((s, x) => s + x.avgIntake, 0) / high.length;
    intakeSignal = { lowAvgPerDay, highAvgPerDay, lowIntakeAvg, highIntakeAvg };
  }

  // Per-meal-name impact. A meal has to appear at least twice to say
  // anything — a single appearance is an anecdote, not a pattern.
  const byName = {};
  intervals.forEach(iv => {
    const namesInInterval = new Set();
    iv.meals.forEach(l => {
      const name = (l.mealName || l.notes || mealTypeLabel(l.mealType)).trim();
      if (name) namesInInterval.add(name);
    });
    namesInInterval.forEach(name => {
      if (!byName[name]) byName[name] = { deltas: [], count: 0 };
      byName[name].deltas.push(iv.perDay);
      byName[name].count += 1;
    });
  });
  const mealImpacts = Object.entries(byName)
    .filter(([, v]) => v.count >= 2)
    .map(([name, v]) => ({ name, count: v.count, avgPerDay: v.deltas.reduce((s, x) => s + x, 0) / v.deltas.length }))
    .sort((a, b) => a.avgPerDay - b.avgPerDay);

  // Same idea grouped by meal TYPE (breakfast/lunch/…), which is coarser
  // but always has enough data to say something.
  const byType = {};
  intervals.forEach(iv => {
    const typesInInterval = new Set(iv.meals.map(l => l.mealType));
    typesInInterval.forEach(t => {
      if (!byType[t]) byType[t] = { deltas: [], count: 0 };
      byType[t].deltas.push(iv.perDay);
      byType[t].count += 1;
    });
  });

  return {
    enough: true,
    totalDelta, spanDays,
    avgIntake, metric: m,
    intakeSignal,
    mealImpacts,
    helped: mealImpacts.filter(x => x.avgPerDay < -0.005).slice(0, 5),
    hurt: mealImpacts.filter(x => x.avgPerDay > 0.005).slice(-5).reverse(),
    intervalCount: intervals.length
  };
}

// ---------- dual-axis chart: weight line + intake bars ----------
// Weight (left axis) as a smooth line so the trend reads at a glance;
// intake (right axis) as bars underneath so a heavy day and a light day
// are visibly different. Kept LTR internally like the weight chart, for
// the same reason (a numeric time axis reads as notation, not body text).
function renderDietChart(series, metricCfg) {
  const withWeight = series.filter(p => p.weight != null);
  const withMetric = series.filter(p => p.metric > 0);
  if (series.length === 0 || (withWeight.length === 0 && withMetric.length === 0)) {
    return '<p class="empty-state-sub">سجّلي وزنك ووجباتك لرؤية الرسم.</p>';
  }

  const width = 340, height = 190, padL = 30, padR = 40, padT = 14, padB = 26;
  const plotW = width - padL - padR;
  const plotH = height - padT - padB;
  const n = series.length;
  const xAt = (i) => padL + (n === 1 ? plotW / 2 : (i / (n - 1)) * plotW);

  // Weight axis.
  const wVals = withWeight.map(p => p.weight);
  let wMin = wVals.length ? Math.min(...wVals) : 0;
  let wMax = wVals.length ? Math.max(...wVals) : 1;
  if (wMin === wMax) { wMin -= 1; wMax += 1; }
  const wPad = (wMax - wMin) * 0.2;
  wMin -= wPad; wMax += wPad;
  const wY = (v) => padT + plotH - ((v - wMin) / (wMax - wMin)) * plotH;

  // Metric axis (bars) — always based at zero.
  const mMax = Math.max(1, ...series.map(p => p.metric));
  const barY = (v) => padT + plotH - (v / mMax) * plotH;
  const barW = Math.max(3, Math.min(20, (plotW / Math.max(1, n)) * 0.6));

  const bars = series.map((p, i) => {
    if (p.metric <= 0) return '';
    const x = xAt(i);
    const y = barY(p.metric);
    return `<rect x="${(x - barW / 2).toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${(padT + plotH - y).toFixed(1)}" rx="2" class="diet-bar"/>`;
  }).join('');

  // Weight line only across points that HAVE a weight (skip gaps).
  const weightCoords = series.map((p, i) => p.weight != null ? [xAt(i), wY(p.weight)] : null).filter(Boolean);
  const linePath = weightCoords.length >= 2 ? smoothPath(weightCoords) : '';
  const dots = series.map((p, i) => p.weight != null
    ? `<circle cx="${xAt(i).toFixed(1)}" cy="${wY(p.weight).toFixed(1)}" r="3" class="diet-weight-dot"/>` : '').join('');

  // Axis labels: weight left, metric right.
  const wLabels = [wMax - wPad, wMin + wPad].map(v =>
    `<text x="${padL - 4}" y="${(wY(v) + 3).toFixed(1)}" class="chart-axis-label" text-anchor="end">${v.toFixed(1)}</text>`).join('');
  const mLabel = `<text x="${width - padR + 4}" y="${(padT + 8).toFixed(1)}" class="chart-axis-label diet-axis-metric">${toArabicNumeral(Math.round(mMax))}</text>`;

  return `
    <svg viewBox="0 0 ${width} ${height}" class="diet-chart-svg">
      ${bars}
      ${linePath ? `<path d="${linePath}" fill="none" class="diet-weight-line"/>` : ''}
      ${dots}
      ${wLabels}
      ${mLabel}
    </svg>
    <div class="diet-chart-legend">
      <span><i class="diet-legend-line"></i> الوزن (كغ)</span>
      <span><i class="diet-legend-bar"></i> ${metricCfg.label} (${metricCfg.unit})</span>
    </div>`;
}

// ---------- period summaries (day / week / month) ----------
async function dietPeriodSummary(metricKey) {
  const m = dietMetric(metricKey);
  const [weightLogs, foodLogs] = await Promise.all([getAllWeightLogs(), db.foodLogs.toArray()]);
  const today = todayStr();

  function windowStats(days) {
    const start = addDays(today, -days + 1);
    const intakeByDate = {};
    foodLogs.filter(l => l.date >= start && l[m.field] != null)
      .forEach(l => { intakeByDate[l.date] = (intakeByDate[l.date] || 0) + l[m.field]; });
    const intakeDays = Object.keys(intakeByDate);
    const avgIntake = intakeDays.length ? intakeDays.reduce((s, d) => s + intakeByDate[d], 0) / intakeDays.length : null;

    const ws = weightLogs.filter(w => w.date >= start);
    const weightDelta = ws.length >= 2 ? ws[ws.length - 1].value - ws[0].value : null;
    return { avgIntake, weightDelta, intakeDays: intakeDays.length };
  }

  const todayIntake = foodLogs.filter(l => l.date === today && l[m.field] != null).reduce((s, l) => s + l[m.field], 0);
  return {
    metric: m,
    todayIntake: todayIntake || null,
    week: windowStats(7),
    month: windowStats(30)
  };
}

function deltaPillHtml(delta) {
  if (delta == null) return '<span class="diet-delta diet-delta-flat">—</span>';
  const flat = Math.abs(delta) < 0.05;
  const arrow = flat ? '→' : (delta > 0 ? '↑' : '↓');
  const tone = flat ? 'flat' : (delta > 0 ? 'up' : 'down');
  return `<span class="diet-delta diet-delta-${tone}">${arrow} ${toArabicNumeral(Math.abs(delta).toFixed(1))} كغ</span>`;
}

// ---------- the page ----------
async function renderDietPage(params, view) {
  view.innerHTML = `
    <div class="page-header">
      <button class="icon-btn" aria-label="رجوع" id="diet-back">→</button>
      <h1>وضع الدايت</h1>
    </div>
    <div class="card">
      <p class="settings-note">يربط وجباتك بوزنك ليخبرك ما الذي يميل وزنك للنزول أو الصعود معه. الأرقام إشارات من قياساتك، لا أحكام مؤكّدة — الوزن يتأثّر بالماء والوقت وأشياء كثيرة.</p>
      <label class="field-label">ماذا نرسم مقابل وزنك؟</label>
      <div class="econ-chip-row" id="diet-metric-chips"></div>
    </div>
    <div class="card" id="diet-periods-card"></div>
    <div class="card">
      <div class="section-header">
        <h2 class="card-title">الوجبات مقابل الوزن</h2>
        <div class="chart-range-chips" id="diet-range-chips">
          <button class="chip" data-range="30">شهر</button>
          <button class="chip" data-range="90">٣ أشهر</button>
          <button class="chip active" data-range="180">٦ أشهر</button>
          <button class="chip" data-range="all">الكل</button>
        </div>
      </div>
      <div id="diet-chart"></div>
    </div>
    <div class="card" id="diet-analysis-card"></div>
    <div class="card">
      <p class="settings-note">لإضافة وزن الوجبة أو الماكروز: افتحي أي وجبة في صفحة الطعام ثم «وزن الوجبة والماكروز».</p>
      <a class="see-all-link" href="#/food">صفحة الطعام ←</a>
    </div>
  `;
  document.getElementById('diet-back').addEventListener('click', () => history.back());

  let metric = await getDietMetricPref();
  let range = '180';

  async function renderMetricChips() {
    const available = await getAvailableDietMetrics();
    // Always offer everything, but mark which have data — so a metric she
    // hasn't logged yet is still selectable (it'll just show an empty chart
    // until she adds it), rather than mysteriously missing.
    const chipsEl = document.getElementById('diet-metric-chips');
    const availableKeys = new Set(available.map(a => a.key));
    if (!availableKeys.has(metric) && available.length) metric = available[0].key;
    chipsEl.innerHTML = DIET_METRICS.map(mm =>
      `<button class="chip ${mm.key === metric ? 'active' : ''}" data-metric="${mm.key}">${mm.label}${availableKeys.has(mm.key) ? '' : ' ·'}</button>`).join('');
    chipsEl.querySelectorAll('.chip').forEach(chip => {
      chip.addEventListener('click', async () => {
        metric = chip.dataset.metric;
        await saveDietMetricPref(metric);
        chipsEl.querySelectorAll('.chip').forEach(c => c.classList.toggle('active', c === chip));
        await refresh();
      });
    });
  }

  async function refresh() {
    const metricCfg = dietMetric(metric);

    // Periods
    const per = await dietPeriodSummary(metric);
    document.getElementById('diet-periods-card').innerHTML = `
      <h2 class="card-title">لمحة سريعة</h2>
      <div class="diet-period-grid">
        <div class="diet-period">
          <span class="diet-period-label">اليوم</span>
          <span class="diet-period-num">${per.todayIntake != null ? toArabicNumeral(Math.round(per.todayIntake)) : '—'}</span>
          <span class="diet-period-unit">${metricCfg.unit}</span>
        </div>
        <div class="diet-period">
          <span class="diet-period-label">متوسط الأسبوع</span>
          <span class="diet-period-num">${per.week.avgIntake != null ? toArabicNumeral(Math.round(per.week.avgIntake)) : '—'}</span>
          <span class="diet-period-unit">${metricCfg.unit}/يوم</span>
          ${deltaPillHtml(per.week.weightDelta)}
        </div>
        <div class="diet-period">
          <span class="diet-period-label">متوسط الشهر</span>
          <span class="diet-period-num">${per.month.avgIntake != null ? toArabicNumeral(Math.round(per.month.avgIntake)) : '—'}</span>
          <span class="diet-period-unit">${metricCfg.unit}/يوم</span>
          ${deltaPillHtml(per.month.weightDelta)}
        </div>
      </div>`;

    // Chart
    const series = await getDietSeries(range, metric);
    document.getElementById('diet-chart').innerHTML = renderDietChart(series, metricCfg);

    // Analysis
    await renderDietAnalysis(document.getElementById('diet-analysis-card'), range, metric);
  }

  document.getElementById('diet-range-chips').querySelectorAll('.chip').forEach(chip => {
    chip.addEventListener('click', async () => {
      range = chip.dataset.range;
      document.querySelectorAll('#diet-range-chips .chip').forEach(c => c.classList.toggle('active', c === chip));
      await refresh();
    });
  });

  await renderMetricChips();
  await refresh();
}

async function renderDietAnalysis(container, range, metricKey) {
  const a = await analyzeDiet(range, metricKey);
  if (!a.enough) {
    container.innerHTML = `
      <h2 class="card-title">🔍 تحليل ذكي</h2>
      <p class="settings-note">أحتاج تسجيلين للوزن على الأقل ضمن هذه الفترة لأبدأ التحليل${a.weightPoints ? ` (لديكِ ${toArabicNumeral(a.weightPoints)})` : ''}. سجّلي وزنك بانتظام ووجباتك، وسيصبح التحليل أدقّ مع الوقت.</p>`;
    return;
  }

  const dir = Math.abs(a.totalDelta) < 0.05 ? 'ثابت' : (a.totalDelta > 0 ? 'صعد' : 'نزل');
  const dirTone = a.totalDelta > 0 ? 'up' : (a.totalDelta < 0 ? 'down' : 'flat');

  let intakeLine = '';
  if (a.intakeSignal) {
    const s = a.intakeSignal;
    const highGains = s.highAvgPerDay > s.lowAvgPerDay;
    intakeLine = `
      <p class="diet-insight diet-insight-${highGains ? 'warn' : 'good'}">
        في الفترات التي زاد فيها ${a.metric.label} (~${toArabicNumeral(Math.round(s.highIntakeAvg))} ${a.metric.unit}/يوم)،
        ${highGains ? 'مال وزنك للصعود' : 'مال وزنك للنزول'} مقارنةً بالفترات الأقل (~${toArabicNumeral(Math.round(s.lowIntakeAvg))} ${a.metric.unit}/يوم).
      </p>`;
  }

  const mealList = (list, kind) => list.length
    ? `<div class="diet-meal-impacts">
        ${list.map(x => `
          <div class="diet-meal-impact">
            <span class="diet-meal-name">${kind === 'good' ? '👍' : '👆'} ${escapeHtml(x.name)}</span>
            <span class="diet-meal-effect diet-meal-effect-${kind}">${x.avgPerDay < 0 ? '↓' : '↑'} ${toArabicNumeral(Math.abs(x.avgPerDay * 7).toFixed(2))} كغ/أسبوع · ${toArabicNumeral(x.count)}×</span>
          </div>`).join('')}
      </div>`
    : `<p class="mini-progress-text">لا يوجد ما يكفي من التكرار بعد.</p>`;

  container.innerHTML = `
    <h2 class="card-title">🔍 تحليل ذكي</h2>
    <p class="diet-headline">وزنك <span class="diet-dir diet-dir-${dirTone}">${dir}</span> ${toArabicNumeral(Math.abs(a.totalDelta).toFixed(1))} كغ خلال ${toArabicNumeral(a.spanDays)} ${a.spanDays <= 10 ? 'أيام' : 'يوماً'}.</p>
    ${intakeLine}
    ${a.helped.length ? `<h3 class="diet-sub-title">🌿 وجبات ترافقت مع نزول وزنك</h3>${mealList(a.helped, 'good')}` : ''}
    ${a.hurt.length ? `<h3 class="diet-sub-title">⚠️ وجبات ترافقت مع صعود وزنك</h3>${mealList(a.hurt, 'bad')}` : ''}
    ${(!a.helped.length && !a.hurt.length) ? `<p class="settings-note">لم تظهر أنماط واضحة لوجبات بعينها بعد — سمّي وجباتك (اسم الوجبة) وكرّري التسجيل ليتحسّن التحليل.</p>` : ''}
    <p class="settings-note diet-caveat">⚠️ هذه ارتباطات إحصائية من قياساتك، وليست إثباتاً أن طعاماً معيّناً سبّب التغيّر.</p>
  `;
}

// A compact card for the Body page — the "فتح" entry point.
async function renderDietSummaryCard(container) {
  if (!container) return;
  const metric = await getDietMetricPref();
  const per = await dietPeriodSummary(metric);
  const metricCfg = dietMetric(metric);
  const hasData = per.month.avgIntake != null || per.month.weightDelta != null;

  container.innerHTML = `
    <div class="section-header">
      <h2 class="card-title">🥗 وضع الدايت</h2>
      <a class="see-all-link" href="#/diet">فتح ←</a>
    </div>
    ${hasData ? `
      <div class="diet-summary-row">
        <div class="diet-period">
          <span class="diet-period-label">متوسط ${metricCfg.label} (شهر)</span>
          <span class="diet-period-num">${per.month.avgIntake != null ? toArabicNumeral(Math.round(per.month.avgIntake)) : '—'}</span>
          <span class="diet-period-unit">${metricCfg.unit}/يوم</span>
        </div>
        <div class="diet-period">
          <span class="diet-period-label">تغيّر الوزن (شهر)</span>
          ${deltaPillHtml(per.month.weightDelta)}
        </div>
      </div>` : `
      <p class="settings-note">يربط وجباتك بوزنك ويخبرك ما الذي يرفع وزنك أو يخفضه. سجّلي وزنك ووجباتك لتبدأ.</p>`}
  `;
}

// ---------- Day Detail provider ----------
async function dietDayProvider(dateStr) {
  const metric = await getDietMetricPref();
  const m = dietMetric(metric);
  const logs = (await getFoodLogsForDate(dateStr)).filter(l => l[m.field] != null && l[m.field] > 0);
  if (logs.length === 0) return null;
  const total = logs.reduce((s, l) => s + l[m.field], 0);
  const node = document.createElement('div');
  node.innerHTML = `
    <div class="yearly-row"><span>مجموع ${m.label}</span><span>${toArabicNumeral(Math.round(total))} ${m.unit}</span></div>
    ${logs.map(l => `<div class="yearly-row"><span>${mealTypeIcon(l.mealType)} ${escapeHtml(l.mealName || l.notes || mealTypeLabel(l.mealType))}</span><span>${toArabicNumeral(Math.round(l[m.field]))} ${m.unit}</span></div>`).join('')}`;
  return { title: 'الدايت', node };
}
