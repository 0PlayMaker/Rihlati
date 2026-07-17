// diet.js — وضع الدايت (Diet mode), redesigned.
//
// The whole point: the app separately knows what she ATE (foodLogs:
// calories/macros/meal weight, and now composition TAGS — protein, sugar,
// fiber…) and what her BODY did (weightLogs + body measurements). This
// page joins them and answers the question a diet is for: which foods
// show up when the scale rises, which are absent when it falls.
//
// HONESTY: this is correlation on noisy, irregular home measurements — not
// a controlled trial. Water, timing, and missed logs all add noise. So it
// says "ترافق مع" (accompanied) and "يميل" (tends), never "sabbaba"
// (caused), and it needs a real amount of data before it claims anything.

// ---- plottable numeric metrics (each reads one field off a meal) ----
const DIET_METRICS = [
  { key: 'calories', label: 'السعرات', unit: 'سعرة', field: 'calories', color: 'var(--pink-deep)' },
  { key: 'weight',   label: 'وزن الطعام', unit: 'غ', field: 'mealWeightG', color: 'var(--info-strong)' },
  { key: 'protein',  label: 'بروتين', unit: 'غ', field: 'protein', color: 'var(--mint-deep)' },
  { key: 'carbs',    label: 'كارب', unit: 'غ', field: 'carbs', color: 'var(--yellow-deep)' },
  { key: 'fat',      label: 'دهون', unit: 'غ', field: 'fat', color: 'var(--lavender-deep)' }
];
function dietMetric(key) { return DIET_METRICS.find(m => m.key === key) || DIET_METRICS[0]; }

// A colour per food category, so the chart legend and the tag chips agree.
const DIET_CAT_COLORS = {
  flour: '#D9A441', protein: 'var(--mint-deep)', starch: '#C99A5B',
  sugar: 'var(--pink-deep)', fiber: '#6FB36F', drink: 'var(--info-strong)',
  dietfood: '#7BA05B'
};

// ---- what's plotted: a set of series keys ("metric:calories","cat:sugar") ----
// Weight is always the anchor line and isn't in this set.
async function getDietSeriesPref() {
  const s = await db.settings.get(1);
  if (Array.isArray(s?.dietSeries)) return s.dietSeries;
  return ['metric:calories'];
}
async function saveDietSeriesPref(keys) { await db.settings.update(1, { dietSeries: keys }); }
// First selected metric, for the period summary + Body-page card.
async function getPrimaryDietMetric() {
  const sel = await getDietSeriesPref();
  const m = sel.find(k => k.startsWith('metric:'));
  return m ? m.slice(7) : 'calories';
}
// Back-compat name used by the Body-page summary card.
async function getDietMetricPref() { return getPrimaryDietMetric(); }

// Derived timing series (computed from meal times, not a meal field).
const DIET_TIMING = [
  { key: 'timing:overnight', label: '🌙 صيام الليل', color: '#6C5CE7', unit: 'ساعة' },
  { key: 'timing:gap', label: '⏳ الفجوة بين الوجبات', color: '#00B8A9', unit: 'ساعة' }
];

function allSeriesDefs() {
  const metrics = DIET_METRICS.map(m => ({ key: 'metric:' + m.key, label: m.label, color: m.color, kind: 'metric', metricKey: m.key, unit: m.unit }));
  const cats = FOOD_TAG_CATEGORIES.map(c => ({ key: 'cat:' + c.key, label: `${c.icon} ${c.label}`, color: DIET_CAT_COLORS[c.key] || 'var(--ink-soft)', kind: 'cat', catKey: c.key, unit: 'مرّة' }));
  const timing = DIET_TIMING.map(t => ({ key: t.key, label: t.label, color: t.color, kind: 'timing', unit: t.unit }));
  return [...metrics, ...cats, ...timing];
}
// Full defs including the context-dependent series (BMI needs her height,
// measurement series need her measurement list). Kept separate so the
// static picker groups still work without a context.
function allSeriesDefsCtx(ctx = {}) {
  const defs = allSeriesDefs();
  if (ctx.heightCm) defs.push({ key: 'metric:bmi', label: '📊 BMI', color: '#8E7CC3', kind: 'body', unit: '' });
  (ctx.measurements || []).forEach(m => defs.push({ key: 'meas:' + m.id, label: '📏 ' + m.name, color: '#C77DA0', kind: 'body', unit: 'سم' }));
  return defs;
}
function seriesDef(key, ctx = {}) { return allSeriesDefsCtx(ctx).find(s => s.key === key); }

// What a RISING line means, in plain Arabic — so the legend can tell her
// that a falling "gap" line means shorter gaps, not fewer meals, etc.
function dietSeriesMeaning(key) {
  if (key === 'weight') return 'ينزل = نقص وزنك، يصعد = زاد';
  if (key === 'metric:bmi') return 'يتبع وزنك';
  if (key === 'timing:overnight') return 'أعلى = صيام ليلي أطول';
  if (key === 'timing:gap') return 'أعلى = فجوات أطول بين الوجبات';
  if (key.startsWith('meas:')) return 'أعلى = القياس أكبر';
  if (key.startsWith('cat:')) return 'أعلى = تكرّر أكثر في اليوم';
  if (key === 'metric:calories') return 'أعلى = سعرات أكثر';
  if (key === 'metric:weight') return 'أعلى = وزن طعام أكبر';
  return 'أعلى = كمية أكبر';
}

async function getDietContext() {
  const [settings, measurements] = await Promise.all([db.settings.get(1), getActiveMeasurements()]);
  return { heightCm: settings?.heightCm || null, measurements };
}

// minutes since midnight, or null
function parseTimeToMin(timeStr) {
  if (!timeStr || !/^\d{1,2}:\d{2}/.test(timeStr)) return null;
  const [h, m] = timeStr.split(':').map(Number);
  return h * 60 + m;
}
// Per-day timing from timed meals: the average gap between consecutive
// meals that day, and the overnight fast (last meal today → first meal
// tomorrow). Returns hours (nicer axis than minutes), or null when there
// aren't enough timed meals to say anything.
function computeMealTiming(foodLogs) {
  const byDate = {};
  foodLogs.forEach(l => {
    const t = parseTimeToMin(l.time);
    if (t == null) return;
    (byDate[l.date] = byDate[l.date] || []).push(t);
  });
  Object.values(byDate).forEach(arr => arr.sort((a, b) => a - b));
  const dates = Object.keys(byDate).sort();
  const gap = {}, overnight = {};
  dates.forEach(d => {
    const times = byDate[d];
    if (times.length >= 2) {
      let sum = 0; for (let i = 1; i < times.length; i++) sum += times[i] - times[i - 1];
      gap[d] = (sum / (times.length - 1)) / 60;
    }
    const next = addDays(d, 1);
    if (byDate[next] && byDate[next].length) {
      const lastTonight = times[times.length - 1];
      const firstTomorrow = byDate[next][0];
      overnight[d] = ((24 * 60 - lastTonight) + firstTomorrow) / 60;
    }
  });
  return { gap, overnight };
}

// ---- daily assembly ----
// date -> summed metric across that day's meals (only meals with the field).
function dailyMetricMap(foodLogs, field) {
  const map = {};
  for (const l of foodLogs) { if (l[field] != null) map[l.date] = (map[l.date] || 0) + l[field]; }
  return map;
}
// date -> how many of that day's meals contained a given food category.
function dailyCatCountMap(foodLogs, catKey) {
  const map = {};
  for (const l of foodLogs) {
    if (Array.isArray(l.foodTags) && l.foodTags.some(t => t.cat === catKey)) map[l.date] = (map[l.date] || 0) + 1;
  }
  return map;
}

// One row per day in the window that has weight or any food data. Each row
// carries the weight and a value for every possible series, so the chart
// and the day-detail can read straight from it.
async function getDietDays(rangeDays, ctx = {}) {
  const [weightLogs, foodLogs] = await Promise.all([getAllWeightLogs(), db.foodLogs.toArray()]);
  const weightBy = {}; weightLogs.forEach(w => { weightBy[w.date] = w.value; });

  const metricMaps = {}; DIET_METRICS.forEach(m => { metricMaps[m.key] = dailyMetricMap(foodLogs, m.field); });
  const catMaps = {}; FOOD_TAG_CATEGORIES.forEach(c => { catMaps[c.key] = dailyCatCountMap(foodLogs, c.key); });
  const timing = computeMealTiming(foodLogs);

  // Measurement values per day (for optional overlays).
  const measMaps = {};
  for (const m of (ctx.measurements || [])) {
    const logs = await getMeasurementLogs(m.id);
    const map = {}; logs.forEach(l => { map[l.date] = l.value; });
    measMaps[m.id] = map;
  }
  const h = ctx.heightCm ? ctx.heightCm / 100 : null;

  const start = rangeDays === 'all' ? null : addDays(todayStr(), -Number(rangeDays) + 1);
  const dates = new Set([...Object.keys(weightBy)]);
  Object.values(metricMaps).forEach(mm => Object.keys(mm).forEach(d => dates.add(d)));
  Object.values(catMaps).forEach(cm => Object.keys(cm).forEach(d => dates.add(d)));
  Object.keys(timing.overnight).forEach(d => dates.add(d));
  Object.keys(timing.gap).forEach(d => dates.add(d));
  Object.values(measMaps).forEach(mm => Object.keys(mm).forEach(d => dates.add(d)));

  const rows = [...dates].filter(d => start === null || d >= start).sort().map(date => {
    const row = { date, weight: weightBy[date] ?? null, series: {} };
    DIET_METRICS.forEach(m => { row.series['metric:' + m.key] = metricMaps[m.key][date] ?? 0; });
    FOOD_TAG_CATEGORIES.forEach(c => { row.series['cat:' + c.key] = catMaps[c.key][date] ?? 0; });
    row.series['timing:overnight'] = timing.overnight[date] ?? 0;
    row.series['timing:gap'] = timing.gap[date] ?? 0;
    if (h && row.weight != null) row.series['metric:bmi'] = row.weight / (h * h);
    (ctx.measurements || []).forEach(m => { if (measMaps[m.id][date] != null) row.series['meas:' + m.id] = measMaps[m.id][date]; });
    return row;
  });

  // 7-day trailing average of weight, attached to each row that has a weight.
  const wPoints = rows.filter(r => r.weight != null);
  rows.forEach(r => {
    if (r.weight == null) return;
    const from = addDays(r.date, -6);
    const window = wPoints.filter(p => p.date >= from && p.date <= r.date);
    r.weightAvg = window.reduce((s, p) => s + p.weight, 0) / window.length;
  });
  return rows;
}

// ============================================================
//  correlation engine (generic over any body reading)
// ============================================================
// Unit of analysis is the interval between two consecutive readings: its
// per-day change, and the union of food TAGS eaten inside it. Per-day
// keeps a 10-day gap from dwarfing a 2-day one.
function buildReadingIntervals(readings, foodLogs) {
  const sorted = [...readings].sort((a, b) => a.date.localeCompare(b.date));
  const intervals = [];
  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i], b = sorted[i + 1];
    const spanDays = Math.max(1, daysBetween(a.date, b.date));
    const meals = foodLogs.filter(l => l.date >= a.date && l.date < b.date);
    const keys = new Set();
    meals.forEach(m => foodTagAnalysisKeys(m.foodTags).forEach(k => keys.add(k)));
    intervals.push({ startDate: a.date, endDate: b.date, spanDays, delta: b.value - a.value, perDay: (b.value - a.value) / spanDays, keys, meals });
  }
  return intervals;
}

// For every tag seen in ≥2 intervals: average per-day change when it was
// present, when absent, and how often it shows up on rising vs falling
// stretches. eps is the "meaningful move" floor for that reading's unit.
function tagAssociations(intervals, eps) {
  const allKeys = new Set(); intervals.forEach(iv => iv.keys.forEach(k => allKeys.add(k)));
  const gaining = intervals.filter(iv => iv.perDay > eps);
  const losing = intervals.filter(iv => iv.perDay < -eps);
  const stats = [];
  for (const key of allKeys) {
    const present = intervals.filter(iv => iv.keys.has(key));
    if (present.length < 2) continue;
    const absent = intervals.filter(iv => !iv.keys.has(key));
    const avgPresent = present.reduce((s, iv) => s + iv.perDay, 0) / present.length;
    const avgAbsent = absent.length ? absent.reduce((s, iv) => s + iv.perDay, 0) / absent.length : null;
    stats.push({
      key, label: foodAnalysisKeyLabel(key), count: present.length,
      avgPresent, avgAbsent,
      contrast: avgAbsent != null ? avgPresent - avgAbsent : avgPresent,
      presentRateGain: gaining.length ? gaining.filter(iv => iv.keys.has(key)).length / gaining.length : 0,
      presentRateLoss: losing.length ? losing.filter(iv => iv.keys.has(key)).length / losing.length : 0
    });
  }
  return { stats, gaining: gaining.length, losing: losing.length };
}

// Full weight analysis: overall change, the intake high/low signal, and
// the tag associations. eps for weight ≈ 5 g/day.
async function analyzeDiet(rangeDays, metricKey) {
  const m = dietMetric(metricKey || await getPrimaryDietMetric());
  const [weightLogs, foodLogs] = await Promise.all([getAllWeightLogs(), db.foodLogs.toArray()]);
  const start = rangeDays === 'all' ? '0000-00-00' : addDays(todayStr(), -Number(rangeDays) + 1);
  const weights = weightLogs.filter(w => w.date >= start);
  if (weights.length < 2) return { enough: false, weightPoints: weights.length };

  const intervals = buildReadingIntervals(weights, foodLogs);
  const totalDelta = weights[weights.length - 1].value - weights[0].value;
  const spanDays = Math.max(1, daysBetween(weights[0].date, weights[weights.length - 1].date));

  // intake high vs low halves → does eating more coincide with gaining?
  const intervalIntake = intervals.map(iv => {
    const days = {}; iv.meals.forEach(l => { if (l[m.field] != null) days[l.date] = (days[l.date] || 0) + l[m.field]; });
    const ds = Object.keys(days); const avg = ds.length ? ds.reduce((s, d) => s + days[d], 0) / ds.length : 0;
    return { perDay: iv.perDay, avgIntake: avg };
  }).filter(iv => iv.avgIntake > 0);
  let intakeSignal = null;
  if (intervalIntake.length >= 4) {
    const sorted = [...intervalIntake].sort((a, b) => a.avgIntake - b.avgIntake);
    const half = Math.floor(sorted.length / 2);
    const low = sorted.slice(0, half), high = sorted.slice(-half);
    intakeSignal = {
      lowAvgPerDay: low.reduce((s, x) => s + x.perDay, 0) / low.length,
      highAvgPerDay: high.reduce((s, x) => s + x.perDay, 0) / high.length,
      lowIntakeAvg: low.reduce((s, x) => s + x.avgIntake, 0) / low.length,
      highIntakeAvg: high.reduce((s, x) => s + x.avgIntake, 0) / high.length
    };
  }

  const { stats, gaining, losing } = tagAssociations(intervals, 0.005);
  const raise = stats.filter(s => s.avgPresent > 0.005).sort((a, b) => b.avgPresent - a.avgPresent).slice(0, 6);
  const lower = stats.filter(s => s.avgPresent < -0.005).sort((a, b) => a.avgPresent - b.avgPresent).slice(0, 6);
  const flaggedGain = stats.filter(s => s.presentRateGain - s.presentRateLoss > 0.25).sort((a, b) => (b.presentRateGain - b.presentRateLoss) - (a.presentRateGain - a.presentRateLoss)).slice(0, 3);

  return { enough: true, totalDelta, spanDays, metric: m, intakeSignal, raise, lower, flaggedGain, tagStats: stats, intervals: intervals.length, gaining, losing };
}

// Split a set of {metric, perDay} pairs into the high-metric half and the
// low-metric half, and report each half's average weight change — the
// generic "does more of X coincide with gaining or losing" test.
// minSpread guards against a near-constant metric (e.g. a meal she never
// skips): if the two halves barely differ, there's no contrast to read
// and it returns null instead of inventing a spurious effect.
function splitByMetric(pairs, minSpread = 0) {
  const clean = pairs.filter(p => p.metric != null && isFinite(p.metric));
  if (clean.length < 4) return null;
  const sorted = [...clean].sort((a, b) => a.metric - b.metric);
  const half = Math.floor(sorted.length / 2);
  const low = sorted.slice(0, half), high = sorted.slice(-half);
  const lowMetric = low.reduce((s, x) => s + x.metric, 0) / low.length;
  const highMetric = high.reduce((s, x) => s + x.metric, 0) / high.length;
  if (highMetric - lowMetric < minSpread) return null;
  return {
    lowPerDay: low.reduce((s, x) => s + x.perDay, 0) / low.length,
    highPerDay: high.reduce((s, x) => s + x.perDay, 0) / high.length,
    lowMetric, highMetric, n: clean.length
  };
}

// Overnight-fast and meal-gap vs weight. For each weight interval, average
// the timing over its days, then compare the longer-fast half against the
// shorter — a clean read on whether a bigger eating window rides along
// with the scale moving.
async function analyzeMealTiming(rangeDays) {
  const [weightLogs, foodLogs] = await Promise.all([getAllWeightLogs(), db.foodLogs.toArray()]);
  const start = rangeDays === 'all' ? '0000-00-00' : addDays(todayStr(), -Number(rangeDays) + 1);
  const weights = weightLogs.filter(w => w.date >= start);
  if (weights.length < 2) return { enough: false };
  const timing = computeMealTiming(foodLogs);
  const intervals = buildReadingIntervals(weights, foodLogs);

  const avgOver = (map, a, b) => {
    const vals = Object.keys(map).filter(d => d >= a && d < b).map(d => map[d]);
    return vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : null;
  };
  const overnightPairs = intervals.map(iv => ({ metric: avgOver(timing.overnight, iv.startDate, iv.endDate), perDay: iv.perDay }));
  const gapPairs = intervals.map(iv => ({ metric: avgOver(timing.gap, iv.startDate, iv.endDate), perDay: iv.perDay }));

  const allOver = Object.values(timing.overnight);
  const allGap = Object.values(timing.gap);
  return {
    enough: true,
    overnight: splitByMetric(overnightPairs),
    gap: splitByMetric(gapPairs),
    avgOvernight: allOver.length ? allOver.reduce((s, v) => s + v, 0) / allOver.length : null,
    avgGap: allGap.length ? allGap.reduce((s, v) => s + v, 0) / allGap.length : null
  };
}

// "Which meal, when skipped, tends to accompany weight going down?"
//
// The subtle bug this fixes: a meal she NEVER skips has a skip-rate of 0 in
// every interval. Splitting a constant-0 column still produced two halves
// and a random-looking effect, so the app once claimed skipping breakfast
// lowered her weight when she'd never skipped it. Now a meal type is only
// considered when it was ACTUALLY skipped on enough logging days AND the
// skip-rate genuinely varies between intervals (minSpread). It also
// returns the exact skipped dates so the insight can be opened up.
//
// "Skipped" = a day she logged at least one (non-drink) meal but none of
// this type — a real omission, not just an unlogged day.
async function analyzeMealTypeSkips(rangeDays) {
  const [weightLogs, foodLogsAll] = await Promise.all([getAllWeightLogs(), db.foodLogs.toArray()]);
  const foodLogs = foodLogsAll.filter(l => !l.isDrink);
  const start = rangeDays === 'all' ? '0000-00-00' : addDays(todayStr(), -Number(rangeDays) + 1);
  const weights = weightLogs.filter(w => w.date >= start);
  const inRange = foodLogs.filter(l => l.date >= start);

  // Global skipped-dates per meal type (over all logging days in range).
  const loggingDaysAll = [...new Set(inRange.map(l => l.date))].sort();
  const skippedByType = {};
  for (const mt of MEAL_TYPES) {
    const daysWith = new Set(inRange.filter(l => l.mealType === mt.key).map(l => l.date));
    skippedByType[mt.key] = loggingDaysAll.filter(d => !daysWith.has(d));
  }

  if (weights.length < 2) {
    return { enough: false, rows: [], skippedByType, loggingDays: loggingDaysAll.length };
  }
  const intervals = buildReadingIntervals(weights, foodLogs);

  const rows = [];
  for (const mt of MEAL_TYPES) {
    const totalSkipped = skippedByType[mt.key].length;
    // Never/barely skipped → nothing to say about skipping it.
    if (totalSkipped < 3) continue;
    const pairs = intervals.map(iv => {
      const loggingDays = new Set(iv.meals.map(m => m.date));
      if (loggingDays.size === 0) return null;
      const daysWithType = new Set(iv.meals.filter(m => m.mealType === mt.key).map(m => m.date));
      return { metric: 1 - (daysWithType.size / loggingDays.size), perDay: iv.perDay };
    }).filter(Boolean);
    // Require a real difference in skip-rate between the halves.
    const split = splitByMetric(pairs, 0.15);
    if (!split || split.highMetric < 0.25) continue;
    rows.push({ mealType: mt, skipEffect: split.highPerDay - split.lowPerDay, highSkipPerDay: split.highPerDay, highSkipRate: split.highMetric, totalSkipped, skippedDates: skippedByType[mt.key] });
  }
  rows.sort((a, b) => a.skipEffect - b.skipEffect); // most weight-lowering skip first
  return { enough: true, rows, skippedByType, loggingDays: loggingDaysAll.length };
}

// ============================================================
//  multi-series chart
// ============================================================
// Weight is the bold anchor line (its own left axis). Every other selected
// series is normalised to its OWN range and drawn thin — so the eye
// compares SHAPE (does this rise when weight rises?) rather than raw units
// that don't share a scale. Transparent day-columns make points tappable.
function renderDietChart(days, selectedKeys, ctx = {}) {
  const withWeight = days.filter(p => p.weight != null);
  if (days.length === 0) return '<p class="empty-state-sub">سجّلي وزنك ووجباتك لرؤية الرسم.</p>';

  const width = 340, height = 200, padL = 30, padR = 12, padT = 12, padB = 22;
  const plotW = width - padL - padR, plotH = height - padT - padB;
  const n = days.length;
  const xAt = (i) => padL + (n === 1 ? plotW / 2 : (i / (n - 1)) * plotW);

  // weight axis
  const wv = withWeight.map(p => p.weight);
  let wMin = wv.length ? Math.min(...wv) : 0, wMax = wv.length ? Math.max(...wv) : 1;
  if (wMin === wMax) { wMin -= 1; wMax += 1; }
  const wpad = (wMax - wMin) * 0.2; wMin -= wpad; wMax += wpad;
  const wY = (v) => padT + plotH - ((v - wMin) / (wMax - wMin)) * plotH;

  // each selected series, normalised to its own visible range
  const seriesPaths = selectedKeys.map(key => {
    const def = seriesDef(key, ctx); if (!def) return '';
    const vals = days.map(p => p.series[key] ?? 0);
    const mx = Math.max(...vals, 0), mn = Math.min(...vals, 0);
    const range = (mx - mn) || 1;
    const coords = days.map((p, i) => {
      const v = p.series[key] ?? 0;
      const y = padT + plotH - ((v - mn) / range) * plotH * 0.9 - plotH * 0.05;
      return [xAt(i), y];
    });
    const path = coords.length >= 2 ? smoothPath(coords) : '';
    return path ? `<path d="${path}" fill="none" stroke="${def.color}" stroke-width="1.6" stroke-opacity="0.85" stroke-linejoin="round"/>` : '';
  }).join('');

  // 7-day average trend (dashed) — the calmer signal under the daily noise.
  const avgCoords = days.map((p, i) => p.weightAvg != null ? [xAt(i), wY(p.weightAvg)] : null).filter(Boolean);
  const avgLine = avgCoords.length >= 2 ? `<path d="${smoothPath(avgCoords)}" fill="none" class="diet-weight-avg"/>` : '';

  const weightCoords = days.map((p, i) => p.weight != null ? [xAt(i), wY(p.weight)] : null).filter(Boolean);
  const weightLine = weightCoords.length >= 2 ? `<path d="${smoothPath(weightCoords)}" fill="none" class="diet-weight-line"/>` : '';
  const dots = days.map((p, i) => p.weight != null ? `<circle cx="${xAt(i).toFixed(1)}" cy="${wY(p.weight).toFixed(1)}" r="3" class="diet-weight-dot"/>` : '').join('');

  const wLabels = [wMax - wpad, wMin + wpad].map(v => `<text x="${padL - 4}" y="${(wY(v) + 3).toFixed(1)}" class="chart-axis-label" text-anchor="end">${v.toFixed(1)}</text>`).join('');

  // invisible tap columns (one per day) → day detail
  const bandW = plotW / Math.max(1, n);
  const bands = days.map((p, i) => `<rect x="${(xAt(i) - bandW / 2).toFixed(1)}" y="${padT}" width="${bandW.toFixed(1)}" height="${plotH}" fill="transparent" class="diet-tap-band" data-diet-day="${p.date}"/>`).join('');

  return `
    <svg viewBox="0 0 ${width} ${height}" class="diet-chart-svg">
      ${seriesPaths}
      ${avgLine}
      ${weightLine}
      ${dots}
      ${wLabels}
      ${bands}
    </svg>`;
}

function dietChartLegend(selectedKeys, ctx = {}) {
  const items = [`<span class="diet-leg"><i class="diet-leg-swatch diet-leg-weight"></i> الوزن</span>`, `<span class="diet-leg"><i class="diet-leg-swatch diet-leg-avg"></i> متوسط ٧ أيام</span>`]
    .concat(selectedKeys.map(k => { const d = seriesDef(k, ctx); return d ? `<span class="diet-leg"><i class="diet-leg-swatch" style="background:${d.color}"></i> ${d.label}</span>` : ''; }));
  return `<div class="diet-legend">${items.join('')}</div>`;
}

// A plain-language key: for every line on the chart, what does UP mean?
function dietDirectionKey(selectedKeys, ctx = {}) {
  const rows = [{ key: 'weight', label: 'الوزن', color: 'var(--ink)' }]
    .concat(selectedKeys.map(k => { const d = seriesDef(k, ctx); return d ? { key: k, label: d.label, color: d.color } : null; }).filter(Boolean));
  return `
    <details class="diet-dir-key">
      <summary>❓ ماذا تعني الخطوط؟</summary>
      <div class="diet-dir-list">
        ${rows.map(r => `<div class="diet-dir-row"><i class="diet-dir-dot" style="background:${r.color}"></i><span class="diet-dir-name">${r.label}</span><span class="diet-dir-mean">${dietSeriesMeaning(r.key)}</span></div>`).join('')}
      </div>
    </details>`;
}

// ============================================================
//  clickable day detail
// ============================================================
async function openDietDayDetail(date) {
  const [wRow, foodLogs] = await Promise.all([
    db.weightLogs.where('date').equals(date).first(),
    getFoodLogsForDate(date)
  ]);
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  const totals = { calories: 0, mealWeightG: 0, protein: 0, carbs: 0, fat: 0 };
  foodLogs.forEach(l => DIET_METRICS.forEach(m => { if (l[m.field] != null) totals[m.field] += l[m.field]; }));
  const totalBits = DIET_METRICS.filter(m => totals[m.field] > 0).map(m => `${toArabicNumeral(Math.round(totals[m.field]))} ${m.unit}`).join(' · ');

  overlay.innerHTML = `
    <div class="modal modal-lg">
      <h2 class="modal-title">${formatPrettyDate(date)}</h2>
      <div class="diet-day-weight">⚖️ ${wRow ? `<strong>${toArabicNumeral(wRow.value.toFixed(1))}</strong> كغ` : 'لا وزن مسجّل'}</div>
      ${totalBits ? `<p class="settings-note">${totalBits}</p>` : ''}
      ${foodLogs.length ? `<div class="diet-day-meals">${foodLogs.map(l => `
        <div class="diet-day-meal">
          <span class="diet-day-meal-title">${mealTypeIcon(l.mealType)} ${escapeHtml(l.mealName || mealTypeLabel(l.mealType))}${l.time ? ' · ' + l.time : ''}</span>
          ${(Array.isArray(l.foodTags) && l.foodTags.length) ? `<div class="diet-day-meal-tags">${l.foodTags.map(t => `<span class="food-tag-chip food-tag-chip-${t.cat}">${foodTagLabel(t)}</span>`).join('')}</div>` : ''}
        </div>`).join('')}</div>` : '<p class="empty-state-sub">لا وجبات في هذا اليوم.</p>'}
      <div class="modal-actions"><button class="btn btn-primary" id="diet-day-close">إغلاق</button></div>
    </div>`;
  document.body.appendChild(overlay);
  document.getElementById('diet-day-close').addEventListener('click', () => overlay.remove());
}

function formatPrettyDate(date) {
  const [y, m, d] = date.split('-').map(Number);
  return `${toArabicNumeral(d)} ${ARABIC_MONTHS[m - 1]} ${toArabicNumeral(y)}`;
}

// ============================================================
//  period summary (day / week / month)
// ============================================================
async function dietPeriodSummary(metricKey) {
  const m = dietMetric(metricKey || await getPrimaryDietMetric());
  const [weightLogs, foodLogs] = await Promise.all([getAllWeightLogs(), db.foodLogs.toArray()]);
  const today = todayStr();
  function windowStats(days) {
    const start = addDays(today, -days + 1);
    const by = {}; foodLogs.filter(l => l.date >= start && l[m.field] != null).forEach(l => { by[l.date] = (by[l.date] || 0) + l[m.field]; });
    const ds = Object.keys(by);
    const avgIntake = ds.length ? ds.reduce((s, d) => s + by[d], 0) / ds.length : null;
    const ws = weightLogs.filter(w => w.date >= start);
    const weightDelta = ws.length >= 2 ? ws[ws.length - 1].value - ws[0].value : null;
    return { avgIntake, weightDelta };
  }
  const todayIntake = foodLogs.filter(l => l.date === today && l[m.field] != null).reduce((s, l) => s + l[m.field], 0);
  return { metric: m, todayIntake: todayIntake || null, week: windowStats(7), month: windowStats(30) };
}

function deltaPillHtml(delta, unit = 'كغ') {
  if (delta == null) return '<span class="diet-delta diet-delta-flat">—</span>';
  const flat = Math.abs(delta) < 0.05;
  const arrow = flat ? '→' : (delta > 0 ? '↑' : '↓');
  const tone = flat ? 'flat' : (delta > 0 ? 'up' : 'down');
  return `<span class="diet-delta diet-delta-${tone}">${arrow} ${toArabicNumeral(Math.abs(delta).toFixed(1))} ${unit}</span>`;
}

// ============================================================
//  smarter diet: goal, food-mix, adherence, hidden calories
// ============================================================
async function getWeightGoal() {
  const [settings, weights] = await Promise.all([db.settings.get(1), getAllWeightLogs()]);
  const target = settings?.targetWeightKg ?? null;
  const current = weights.length ? weights[weights.length - 1].value : null;
  const start = weights.length ? weights[0].value : null;
  let goalType = settings?.dietGoalType || null; // 'loss' | 'gain' | 'maintain'
  if (!goalType && target != null && current != null) {
    goalType = Math.abs(target - current) < 0.3 ? 'maintain' : (target < current ? 'loss' : 'gain');
  }
  return { target, goalType, current, start, heightCm: settings?.heightCm || null };
}
async function saveDietGoalType(t) { await db.settings.update(1, { dietGoalType: t }); }

// The hero: current weight + 7-day average + trend + BMI, then goal
// progress that is DIRECTION-AWARE — for a gain goal, moving up is
// progress; for a loss goal, moving down is.
async function renderDietGoalHero(container, ctx) {
  const g = await getWeightGoal();
  const days = await getDietDays('30', ctx);
  const withAvg = days.filter(d => d.weightAvg != null);
  const avg = withAvg.length ? withAvg[withAvg.length - 1].weightAvg : null;
  const prevAvg = withAvg.length > 1 ? withAvg[0].weightAvg : null;
  const trend = (avg != null && prevAvg != null) ? avg - prevAvg : null;

  const goalChips = ['loss', 'maintain', 'gain'].map(t => {
    const lbl = t === 'loss' ? '📉 نزول' : t === 'gain' ? '📈 زيادة' : '⚖️ ثبات';
    return `<button class="chip diet-goal-chip ${g.goalType === t ? 'active' : ''}" data-goal="${t}">${lbl}</button>`;
  }).join('');

  let bmiBit = '';
  if (g.heightCm && g.current != null) {
    const bmi = computeBmi(g.current, g.heightCm);
    bmiBit = `<div class="diet-hero-stat"><span class="diet-hero-stat-num">${toArabicNumeral(bmi.toFixed(1))}</span><span class="diet-hero-stat-lbl">BMI · ${bmiCategory(bmi)}</span></div>`;
  }

  let progressBit = '';
  if (g.target != null && g.current != null && g.start != null && g.goalType !== 'maintain') {
    const totalNeeded = Math.abs(g.target - g.start) || 1;
    const done = g.goalType === 'loss' ? (g.start - g.current) : (g.current - g.start);
    const pct = Math.max(0, Math.min(100, (done / totalNeeded) * 100));
    const remaining = Math.abs(g.target - g.current);
    progressBit = `
      <div class="diet-goal-progress">
        <div class="diet-goal-bar"><div class="diet-goal-fill" style="width:${pct}%"></div></div>
        <span class="diet-goal-text">${toArabicNumeral(Math.abs(done).toFixed(1))} من ${toArabicNumeral(totalNeeded.toFixed(1))} كغ · باقٍ ${toArabicNumeral(remaining.toFixed(1))} كغ نحو ${toArabicNumeral(g.target.toFixed(1))}</span>
      </div>`;
  } else if (g.target != null && g.goalType === 'maintain' && g.current != null) {
    progressBit = `<span class="diet-goal-text">هدفك الثبات قرب ${toArabicNumeral(g.target.toFixed(1))} كغ — الآن ${toArabicNumeral(g.current.toFixed(1))}.</span>`;
  } else {
    progressBit = `<span class="diet-goal-text diet-goal-none">أضيفي وزناً مستهدفاً في صفحة الصحة لعرض تقدّمك.</span>`;
  }

  container.innerHTML = `
    <div class="diet-hero-top">
      <div class="diet-hero-stat diet-hero-main">
        <span class="diet-hero-stat-num">${g.current != null ? toArabicNumeral(g.current.toFixed(1)) : '—'}</span>
        <span class="diet-hero-stat-lbl">كغ الآن</span>
      </div>
      <div class="diet-hero-stat">
        <span class="diet-hero-stat-num">${avg != null ? toArabicNumeral(avg.toFixed(1)) : '—'} ${trend != null ? deltaArrowInline(trend) : ''}</span>
        <span class="diet-hero-stat-lbl">متوسط ٧ أيام</span>
      </div>
      ${bmiBit}
    </div>
    <div class="diet-goal-chips">${goalChips}</div>
    ${progressBit}`;

  container.querySelectorAll('.diet-goal-chip').forEach(chip => {
    chip.addEventListener('click', async () => {
      await saveDietGoalType(chip.dataset.goal);
      await renderDietGoalHero(container, ctx);
    });
  });
}
function deltaArrowInline(d) {
  if (Math.abs(d) < 0.05) return '<span class="diet-delta diet-delta-flat">→</span>';
  return d > 0 ? '<span class="diet-delta diet-delta-up">↑</span>' : '<span class="diet-delta diet-delta-down">↓</span>';
}

// Food-mix quality: what share of tagged food is each category.
async function computeFoodMix(range) {
  const foodLogs = await db.foodLogs.toArray();
  const start = range === 'all' ? '0000-00-00' : addDays(todayStr(), -Number(range) + 1);
  const meals = foodLogs.filter(l => l.date >= start);
  const counts = {}; let total = 0;
  FOOD_TAG_CATEGORIES.forEach(c => { counts[c.key] = 0; });
  meals.forEach(l => (l.foodTags || []).forEach(t => { if (counts[t.cat] !== undefined) { counts[t.cat]++; total++; } }));
  const rows = FOOD_TAG_CATEGORIES.map(c => ({ cat: c, count: counts[c.key], share: total ? counts[c.key] / total : 0 })).filter(r => r.count > 0).sort((a, b) => b.count - a.count);
  return { rows, total };
}
async function renderFoodMixCard(container, range) {
  const mix = await computeFoodMix(range);
  if (mix.total === 0) { container.innerHTML = `<h2 class="card-title">🍽️ مزيج طعامك</h2><p class="settings-note">أضيفي مكوّنات وجباتك لرؤية توزيع أنواع طعامك.</p>`; return; }
  container.innerHTML = `
    <h2 class="card-title">🍽️ مزيج طعامك</h2>
    <p class="settings-note">توزيع أنواع الطعام التي سجّلتِها في هذه الفترة.</p>
    <div class="food-mix-bar">${mix.rows.map(r => `<span class="food-mix-seg" style="width:${(r.share * 100).toFixed(1)}%;background:${DIET_CAT_COLORS[r.cat.key] || 'var(--ink-soft)'}" title="${r.cat.label}"></span>`).join('')}</div>
    <div class="food-mix-legend">${mix.rows.map(r => `<span class="food-mix-leg"><i class="diet-chip-swatch" style="background:${DIET_CAT_COLORS[r.cat.key] || 'var(--ink-soft)'}"></i>${r.cat.icon} ${r.cat.label} ${toArabicNumeral(Math.round(r.share * 100))}٪</span>`).join('')}</div>`;
}

// Logging streak + how much of the window she actually logged.
async function computeAdherence(range) {
  const foodLogs = await db.foodLogs.toArray();
  const logged = new Set(foodLogs.filter(l => !l.isDrink).map(l => l.date));
  const days = Number(range === 'all' ? 90 : range);
  let loggedInRange = 0;
  for (let i = 0; i < days; i++) if (logged.has(addDays(todayStr(), -i))) loggedInRange++;
  let streak = 0, cursor = todayStr();
  if (!logged.has(cursor)) cursor = addDays(cursor, -1); // today not logged yet is OK
  while (logged.has(cursor)) { streak++; cursor = addDays(cursor, -1); }
  return { streak, loggedInRange, totalDays: days, pct: loggedInRange / days };
}
async function renderAdherenceCard(container, range) {
  const [a, skips] = await Promise.all([computeAdherence(range), analyzeMealTypeSkips(range)]);
  const skipRows = (skips.rows || []).filter(r => r.totalSkipped >= 3).slice(0, 3);
  const skipList = skipRows.length
    ? `<div class="adh-skips">${skipRows.map(r => `<button class="adh-skip-chip" data-skip="${r.mealType.key}">${r.mealType.icon} ${r.mealType.label}: تخطّي ${toArabicNumeral(r.totalSkipped)} يوم ←</button>`).join('')}</div>`
    : '<p class="settings-note">لا تخطّي وجبات ملحوظ — انتظام جيّد. 👏</p>';
  container.innerHTML = `
    <h2 class="card-title">📋 الالتزام بالتسجيل</h2>
    <div class="adh-grid">
      <div class="adh-stat"><span class="adh-num">${toArabicNumeral(a.streak)}</span><span class="adh-lbl">${a.streak === 1 ? 'يوم متتالٍ' : 'أيام متتالية'}</span></div>
      <div class="adh-stat"><span class="adh-num">${toArabicNumeral(Math.round(a.pct * 100))}٪</span><span class="adh-lbl">من الأيام سجّلتِ</span></div>
      <div class="adh-stat"><span class="adh-num">${toArabicNumeral(a.loggedInRange)}</span><span class="adh-lbl">من ${toArabicNumeral(a.totalDays)} يوم</span></div>
    </div>
    ${skipList}`;
  container.querySelectorAll('[data-skip]').forEach(btn => btn.addEventListener('click', () => {
    const mt = MEAL_TYPES.find(m => m.key === btn.dataset.skip);
    openSkippedDatesSheet(mt, skips.skippedByType?.[btn.dataset.skip] || []);
  }));
}

// Hidden-calorie alert: share of intake from drinks and snacks.
async function computeHiddenCalories(range) {
  const foodLogs = await db.foodLogs.toArray();
  const start = range === 'all' ? '0000-00-00' : addDays(todayStr(), -Number(range) + 1);
  const inR = foodLogs.filter(l => l.date >= start && l.calories);
  const drinkCal = inR.filter(l => l.isDrink).reduce((s, l) => s + l.calories, 0);
  const snackCal = inR.filter(l => !l.isDrink && (l.mealType === 'snack' || l.mealType === 'dessert')).reduce((s, l) => s + l.calories, 0);
  const total = inR.reduce((s, l) => s + l.calories, 0);
  const days = new Set(inR.map(l => l.date)).size || 1;
  const hidden = drinkCal + snackCal;
  return { drinkCal, snackCal, hidden, total, perDayHidden: hidden / days, share: total ? hidden / total : 0 };
}
async function renderHiddenCalorieCard(container, range) {
  const h = await computeHiddenCalories(range);
  if (h.total === 0) { container.innerHTML = ''; container.style.display = 'none'; return; }
  container.style.display = '';
  const high = h.share > 0.25;
  container.innerHTML = `
    <h2 class="card-title">🥤 السعرات الخفيّة</h2>
    <p class="diet-insight diet-insight-${high ? 'warn' : 'good'}">
      ${high ? '⚠️ ' : ''}المشروبات والسناك تشكّل <strong>${toArabicNumeral(Math.round(h.share * 100))}٪</strong> من سعراتك (~${toArabicNumeral(Math.round(h.perDayHidden))} سعرة/يوم).
    </p>
    <div class="hidden-cal-rows">
      <div class="hidden-cal-row"><span>🥤 مشروبات</span><span>${toArabicNumeral(Math.round(h.drinkCal))} سعرة</span></div>
      <div class="hidden-cal-row"><span>🍿 سناك وتحلية</span><span>${toArabicNumeral(Math.round(h.snackCal))} سعرة</span></div>
    </div>
    ${high ? '<p class="diet-tip">💡 هذه غالباً أسهل ما يُخفَّض دون الشعور بالجوع.</p>' : ''}`;
}

// ============================================================
//  the page
// ============================================================
async function renderDietPage(params, view) {
  view.innerHTML = `
    <div class="page-header">
      <button class="icon-btn" aria-label="رجوع" id="diet-back">→</button>
      <h1>وضع الدايت</h1>
    </div>
    <div class="card diet-hero-card" id="diet-goal-hero"></div>
    <div class="card">
      <div class="section-header">
        <h2 class="card-title">الوجبات مقابل وزنك</h2>
        <div class="chart-range-chips" id="diet-range-chips">
          <button class="chip" data-range="30">شهر</button>
          <button class="chip" data-range="90">٣ أشهر</button>
          <button class="chip active" data-range="180">٦ أشهر</button>
          <button class="chip" data-range="all">الكل</button>
        </div>
      </div>
      <div id="diet-chart"></div>
      <div id="diet-legend"></div>
      <p class="diet-tap-hint">اضغطي أي يوم على الرسم لرؤية تفاصيله</p>
      <div id="diet-dir-key"></div>
      <details class="diet-series-picker">
        <summary>ماذا أرسم فوق منحنى الوزن؟</summary>
        <p class="material-type-label">قيم غذائية</p>
        <div class="diet-series-chips" id="diet-metric-series"></div>
        <p class="material-type-label">أنواع الطعام</p>
        <div class="diet-series-chips" id="diet-cat-series"></div>
        <p class="material-type-label">التوقيت</p>
        <div class="diet-series-chips" id="diet-timing-series"></div>
        <p class="material-type-label">الجسم والقياسات</p>
        <div class="diet-series-chips" id="diet-body-series"></div>
      </details>
    </div>
    <div class="card" id="diet-mix-card"></div>
    <div class="card" id="diet-adherence-card"></div>
    <div class="card" id="diet-hidden-card" style="display:none"></div>
    <div class="card" id="diet-insights-card"></div>
    <div class="card" id="diet-timing-card" style="display:none"></div>
    <div class="card" id="diet-measure-card"></div>
    <div class="card">
      <p class="settings-note">لإضافة مكوّنات الوجبة أو ماكروزها: افتحي أي وجبة في صفحة الطعام.</p>
      <a class="see-all-link" href="#/food">صفحة الطعام ←</a>
    </div>`;
  document.getElementById('diet-back').addEventListener('click', () => history.back());

  let range = '180';
  let selected = await getDietSeriesPref();
  const ctx = await getDietContext();

  function renderSeriesChips() {
    const defs = allSeriesDefsCtx(ctx);
    const fill = (id, kind) => {
      const el = document.getElementById(id); if (!el) return;
      el.innerHTML = defs.filter(d => d.kind === kind).map(d =>
        `<button class="chip diet-series-chip ${selected.includes(d.key) ? 'active' : ''}" data-skey="${d.key}"><i class="diet-chip-swatch" style="background:${d.color}"></i>${d.label}</button>`).join('') || '<span class="settings-note">—</span>';
    };
    fill('diet-metric-series', 'metric');
    fill('diet-cat-series', 'cat');
    fill('diet-timing-series', 'timing');
    fill('diet-body-series', 'body');
    view.querySelectorAll('.diet-series-chip').forEach(chip => {
      chip.addEventListener('click', async () => {
        const k = chip.dataset.skey;
        selected = selected.includes(k) ? selected.filter(x => x !== k) : [...selected, k];
        await saveDietSeriesPref(selected);
        chip.classList.toggle('active');
        await drawChart();
      });
    });
  }

  async function drawChart() {
    const days = await getDietDays(range, ctx);
    document.getElementById('diet-chart').innerHTML = renderDietChart(days, selected, ctx);
    document.getElementById('diet-legend').innerHTML = dietChartLegend(selected, ctx);
    document.getElementById('diet-dir-key').innerHTML = dietDirectionKey(selected, ctx);
    view.querySelectorAll('[data-diet-day]').forEach(band => {
      band.addEventListener('click', () => openDietDayDetail(band.dataset.dietDay));
    });
  }

  async function refresh() {
    await renderDietGoalHero(document.getElementById('diet-goal-hero'), ctx);
    await drawChart();
    await renderFoodMixCard(document.getElementById('diet-mix-card'), range);
    await renderAdherenceCard(document.getElementById('diet-adherence-card'), range);
    await renderHiddenCalorieCard(document.getElementById('diet-hidden-card'), range);
    await renderDietInsights(document.getElementById('diet-insights-card'), range);
    await renderTimingInsights(document.getElementById('diet-timing-card'), range);
    await renderMeasureFoodCard(document.getElementById('diet-measure-card'), range);
  }

  document.getElementById('diet-range-chips').querySelectorAll('.chip').forEach(chip => {
    chip.addEventListener('click', async () => {
      range = chip.dataset.range;
      view.querySelectorAll('#diet-range-chips .chip').forEach(c => c.classList.toggle('active', c === chip));
      await refresh();
    });
  });

  renderSeriesChips();
  await refresh();
}

// ---- the tag insight card ----
async function renderDietInsights(container, range) {
  const a = await analyzeDiet(range);
  if (!a.enough) {
    container.innerHTML = `<h2 class="card-title">🔍 ماذا يحرّك وزنك؟</h2>
      <p class="settings-note">أحتاج تسجيلين للوزن على الأقل في هذه الفترة${a.weightPoints ? ` (لديكِ ${toArabicNumeral(a.weightPoints)})` : ''}. سجّلي وزنك ووجباتك بمكوّناتها، وسيتحسّن التحليل مع الوقت.</p>`;
    return;
  }
  const dir = Math.abs(a.totalDelta) < 0.05 ? 'ثابت' : (a.totalDelta > 0 ? 'صعد' : 'نزل');
  const dirTone = a.totalDelta > 0 ? 'up' : (a.totalDelta < 0 ? 'down' : 'flat');

  let intakeLine = '';
  if (a.intakeSignal) {
    const s = a.intakeSignal; const highGains = s.highAvgPerDay > s.lowAvgPerDay;
    intakeLine = `<p class="diet-insight diet-insight-${highGains ? 'warn' : 'good'}">في الفترات الأعلى بـ${a.metric.label} (~${toArabicNumeral(Math.round(s.highIntakeAvg))} ${a.metric.unit}/يوم)، ${highGains ? 'مال وزنك للصعود' : 'مال وزنك للنزول'} مقارنةً بالأقل (~${toArabicNumeral(Math.round(s.lowIntakeAvg))}).</p>`;
  }

  const effect = (perDay) => `${perDay < 0 ? '↓' : '↑'} ${toArabicNumeral(Math.abs(perDay * 7).toFixed(2))} كغ/أسبوع`;
  const list = (arr, kind) => arr.length ? `<div class="diet-meal-impacts">${arr.map(x => `
      <div class="diet-meal-impact">
        <span class="diet-meal-name">${kind === 'bad' ? '👆' : '👍'} ${x.label}</span>
        <span class="diet-meal-effect diet-meal-effect-${kind === 'bad' ? 'bad' : 'good'}">${effect(x.avgPresent)} · ${toArabicNumeral(x.count)}×</span>
      </div>`).join('')}</div>` : '';

  const flagged = a.flaggedGain.length
    ? `<p class="diet-insight diet-insight-warn">حاضرة غالباً في أيام الزيادة، غائبة في أيام النزول: ${a.flaggedGain.map(f => f.label).join('، ')}.</p>` : '';

  container.innerHTML = `
    <h2 class="card-title">🔍 ماذا يحرّك وزنك؟</h2>
    <p class="diet-headline">وزنك <span class="diet-dir diet-dir-${dirTone}">${dir}</span> ${toArabicNumeral(Math.abs(a.totalDelta).toFixed(1))} كغ خلال ${toArabicNumeral(a.spanDays)} ${a.spanDays <= 10 ? 'أيام' : 'يوماً'}.</p>
    ${intakeLine}
    ${flagged}
    ${a.raise.length ? `<h3 class="diet-sub-title">⚠️ ترافقت مع صعود وزنك — قلّليها</h3>${list(a.raise, 'bad')}` : ''}
    ${a.lower.length ? `<h3 class="diet-sub-title">🌿 ترافقت مع نزول وزنك — زيديها</h3>${list(a.lower, 'good')}` : ''}
    ${(!a.raise.length && !a.lower.length) ? `<p class="settings-note">لم تظهر أنماط واضحة بعد — أضيفي مكوّنات وجباتك (بروتين، سكريات، ألياف…) وكرّري التسجيل ليتّضح التحليل.</p>` : ''}
    <p class="settings-note diet-caveat">⚠️ هذه ارتباطات إحصائية من قياساتك، لا إثبات أن طعاماً بعينه سبّب التغيّر.</p>`;
}

// ---- meal-timing & skip insights ----
async function renderTimingInsights(container, range) {
  const [t, skips] = await Promise.all([analyzeMealTiming(range), analyzeMealTypeSkips(range)]);
  if (!t.enough) { container.innerHTML = ''; container.style.display = 'none'; return; }
  container.style.display = '';

  const hrs = (v) => `${toArabicNumeral(v.toFixed(1))} ساعة`;
  const effect = (perDay) => `${perDay < 0 ? '↓' : '↑'} ${toArabicNumeral(Math.abs(perDay * 7).toFixed(2))} كغ/أسبوع`;

  let overnightLine = '';
  if (t.overnight) {
    const o = t.overnight; const longerHelps = o.highPerDay < o.lowPerDay;
    overnightLine = `<div class="diet-timing-row">
      <span class="diet-timing-icon">🌙</span>
      <div class="diet-timing-body">
        <span class="diet-timing-title">صيام الليل ${t.avgOvernight != null ? '· متوسط ' + hrs(t.avgOvernight) : ''}</span>
        <span class="diet-insight diet-insight-${longerHelps ? 'good' : 'warn'}">حين يطول صيامك الليلي (~${hrs(o.highMetric)}) ${longerHelps ? 'يميل وزنك للنزول' : 'يميل وزنك للصعود'} مقارنةً بالليالي الأقصر (~${hrs(o.lowMetric)}).</span>
        ${longerHelps ? '<span class="diet-tip">💡 جرّبي تقديم العشاء أو تأخير الفطور قليلاً.</span>' : ''}
      </div></div>`;
  }

  let gapLine = '';
  if (t.gap) {
    const g = t.gap; const widerHelps = g.highPerDay < g.lowPerDay;
    gapLine = `<div class="diet-timing-row">
      <span class="diet-timing-icon">⏳</span>
      <div class="diet-timing-body">
        <span class="diet-timing-title">الفجوة بين الوجبات ${t.avgGap != null ? '· متوسط ' + hrs(t.avgGap) : ''}</span>
        <span class="diet-insight diet-insight-${widerHelps ? 'good' : 'warn'}">حين تتباعد وجباتك (~${hrs(g.highMetric)} بينها) ${widerHelps ? 'يميل وزنك للنزول' : 'يميل وزنك للصعود'}.</span>
      </div></div>`;
  }

  let skipLine = '';
  if (skips.enough && skips.rows.length) {
    const best = skips.rows[0];
    if (best.skipEffect < -0.003) {
      skipLine = `<button class="diet-timing-row diet-skip-row" data-skip-meal="${best.mealType.key}">
        <span class="diet-timing-icon">${best.mealType.icon}</span>
        <div class="diet-timing-body">
          <span class="diet-timing-title">تخطّي الوجبات <span class="diet-skip-more">التفاصيل ←</span></span>
          <span class="diet-insight diet-insight-good">في الفترات التي تخطّيتِ فيها <strong>${best.mealType.label}</strong> أكثر (${toArabicNumeral(best.totalSkipped)} يوم)، مال وزنك للنزول (${effect(best.highSkipPerDay)}).</span>
          <span class="diet-tip">💡 ليست دعوةً لتفويت الوجبات — مجرّد ملاحظة من بياناتك. الأهم انتظام غذائك.</span>
        </div></button>`;
    } else {
      skipLine = `<div class="diet-timing-row"><span class="diet-timing-icon">🍽️</span><div class="diet-timing-body"><span class="diet-timing-title">تخطّي الوجبات</span><span class="settings-note">لا يظهر أن تخطّي وجبة معيّنة يرتبط بنزول واضح — انتظامك جيّد.</span></div></div>`;
    }
  }

  if (!overnightLine && !gapLine && !skipLine) {
    container.innerHTML = `<h2 class="card-title">⏱️ التوقيت والوزن</h2><p class="settings-note">أضيفي وقت وجباتك (في نافذة الوجبة) عبر عدّة أيام، وسأربط توقيت أكلك وصيام ليلك بوزنك.</p>`;
    return;
  }
  container.innerHTML = `
    <h2 class="card-title">⏱️ التوقيت والوزن</h2>
    ${overnightLine}${gapLine}${skipLine}
    <p class="settings-note diet-caveat">⚠️ ارتباطات من قياساتك، تتأثّر بالماء والنوم وأمور أخرى.</p>`;

  container.querySelectorAll('[data-skip-meal]').forEach(btn => {
    btn.addEventListener('click', () => {
      const mt = MEAL_TYPES.find(m => m.key === btn.dataset.skipMeal);
      const dates = (skips.skippedByType?.[btn.dataset.skipMeal]) || [];
      openSkippedDatesSheet(mt, dates);
    });
  });
}

// The exact days a meal type was skipped (logged other meals, not this one).
function openSkippedDatesSheet(mealType, dates) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal modal-lg">
      <h2 class="modal-title">${mealType.icon} أيام تخطّي ${mealType.label}</h2>
      <p class="settings-note">${dates.length ? `${toArabicNumeral(dates.length)} يوم سجّلتِ فيها وجبات أخرى دون ${mealType.label}:` : 'لا أيام تخطّي مسجّلة.'}</p>
      ${dates.length ? `<div class="skip-dates-list">${[...dates].reverse().map(d => `<div class="skip-date-row">${formatPrettyDate(d)}</div>`).join('')}</div>` : ''}
      <div class="modal-actions"><button class="btn btn-primary" id="skip-dates-close">إغلاق</button></div>
    </div>`;
  document.body.appendChild(overlay);
  document.getElementById('skip-dates-close').addEventListener('click', () => overlay.remove());
}

// ---- measurements-vs-food card ----
// Same engine, run against each body measurement's own readings, so she
// can see "waist tends to rise on pastry weeks" the same way as weight.
async function renderMeasureFoodCard(container, range) {
  const measurements = await getActiveMeasurements();
  if (!measurements.length) { container.innerHTML = ''; return; }
  const foodLogs = await db.foodLogs.toArray();
  const start = range === 'all' ? '0000-00-00' : addDays(todayStr(), -Number(range) + 1);

  const rows = [];
  for (const meas of measurements) {
    const logs = (await getMeasurementLogs(meas.id)).filter(l => l.date >= start).map(l => ({ date: l.date, value: l.value }));
    if (logs.length < 2) continue;
    const asc = [...logs].sort((a, b) => a.date.localeCompare(b.date));
    const change = asc[asc.length - 1].value - asc[0].value;
    const intervals = buildReadingIntervals(asc, foodLogs);
    const { stats } = tagAssociations(intervals, 0.01);
    const topUp = stats.filter(s => s.avgPresent > 0.01).sort((a, b) => b.avgPresent - a.avgPresent)[0];
    rows.push({ meas, change, topUp });
  }
  if (!rows.length) { container.innerHTML = ''; return; }

  container.innerHTML = `
    <h2 class="card-title">📏 قياساتك وطعامك</h2>
    <p class="settings-note">كيف تحرّكت قياساتك في هذه الفترة، وأكثر نوع طعام ترافق مع زيادتها.</p>
    ${rows.map(r => `
      <div class="diet-measure-row">
        <span class="diet-measure-name">${escapeHtml(r.meas.name)}</span>
        <span class="diet-measure-change">${deltaPillHtml(r.change, r.meas.unit || 'سم')}</span>
        <span class="diet-measure-tag">${r.topUp ? '👆 ' + r.topUp.label : ''}</span>
      </div>`).join('')}`;
}

// ---- Body-page summary card (the "فتح" entry point) ----
async function renderDietSummaryCard(container) {
  if (!container) return;
  const metric = await getPrimaryDietMetric();
  const per = await dietPeriodSummary(metric);
  const mc = per.metric;
  const hasData = per.month.avgIntake != null || per.month.weightDelta != null;
  container.innerHTML = `
    <div class="section-header"><h2 class="card-title">🥗 وضع الدايت</h2><a class="see-all-link" href="#/diet">فتح ←</a></div>
    ${hasData ? `<div class="diet-summary-row">
        <div class="diet-period"><span class="diet-period-label">متوسط ${mc.label} (شهر)</span><span class="diet-period-num">${per.month.avgIntake != null ? toArabicNumeral(Math.round(per.month.avgIntake)) : '—'}</span><span class="diet-period-unit">${mc.unit}/يوم</span></div>
        <div class="diet-period"><span class="diet-period-label">تغيّر الوزن (شهر)</span>${deltaPillHtml(per.month.weightDelta)}</div>
      </div>` : `<p class="settings-note">يربط وجباتك ومكوّناتها بوزنك ويخبرك ما يرفعه أو يخفضه. سجّلي وزنك ووجباتك لتبدأ.</p>`}`;
}

// ---- Day Detail provider (home calendar day view) ----
async function dietDayProvider(dateStr) {
  const metric = await getPrimaryDietMetric();
  const m = dietMetric(metric);
  const logs = (await getFoodLogsForDate(dateStr)).filter(l => l[m.field] != null && l[m.field] > 0);
  if (logs.length === 0) return null;
  const total = logs.reduce((s, l) => s + l[m.field], 0);
  const node = document.createElement('div');
  node.innerHTML = `<div class="yearly-row"><span>مجموع ${m.label}</span><span>${toArabicNumeral(Math.round(total))} ${m.unit}</span></div>
    ${logs.map(l => `<div class="yearly-row"><span>${mealTypeIcon(l.mealType)} ${escapeHtml(l.mealName || mealTypeLabel(l.mealType))}</span><span>${toArabicNumeral(Math.round(l[m.field]))} ${m.unit}</span></div>`).join('')}`;
  return { title: 'الدايت', node };
}
