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

async function getWeightStats() {
  const logs = await getAllWeightLogs();
  if (logs.length === 0) return { latest: null, deltaKg: null };
  const latest = logs[logs.length - 1];
  const thirtyDaysAgo = addDays(todayStr(), -30);
  const candidates = logs.filter(l => l.date <= thirtyDaysAgo);
  const reference = candidates.length ? candidates[candidates.length - 1] : logs[0];
  const deltaKg = reference.date === latest.date ? null : latest.value - reference.value;
  return { latest, deltaKg };
}

function weightGlanceText(stats) {
  if (!stats.latest) return 'سجلي وزنك الأول';
  if (stats.deltaKg == null) return `${stats.latest.value} كغ`;
  const arrow = stats.deltaKg > 0 ? '▲' : stats.deltaKg < 0 ? '▼' : '';
  const sign = stats.deltaKg > 0 ? '+' : '';
  return `${stats.latest.value} كغ · ${arrow}${sign}${stats.deltaKg.toFixed(1)}/30ي`;
}

// ---------- hand-rolled SVG line chart ----------
// Kept LTR internally even inside the RTL page — flipping a numeric
// time-axis to match reading direction is a common source of "wait, is
// this going backwards?" confusion, and chart axes read more like
// universal numeric notation than body text.

function renderWeightChart(points, targetWeight) {
  if (points.length === 0) return '<p class="empty-state-sub">سجلي وزنك لرؤية الرسم البياني</p>';
  const width = 320, height = 140, padding = 22;
  const values = points.map(p => p.value);
  let min = Math.min(...values), max = Math.max(...values);
  if (targetWeight != null) { min = Math.min(min, targetWeight); max = Math.max(max, targetWeight); }
  if (min === max) { min -= 1; max += 1; }
  const rangePad = (max - min) * 0.15;
  min -= rangePad; max += rangePad;

  const xStep = points.length > 1 ? (width - 2 * padding) / (points.length - 1) : 0;
  const scaleY = (v) => height - padding - ((v - min) / (max - min)) * (height - 2 * padding);
  const coords = points.map((p, i) => [padding + i * xStep, scaleY(p.value)]);

  const pathD = coords.map(([x, y], i) => `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`).join(' ');
  const dots = coords.map(([x, y]) => `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3.5" fill="var(--pink-deep)"/>`).join('');
  const targetLine = targetWeight != null
    ? `<line x1="${padding}" y1="${scaleY(targetWeight).toFixed(1)}" x2="${width - padding}" y2="${scaleY(targetWeight).toFixed(1)}" stroke="var(--blue-deep)" stroke-width="1.5" stroke-dasharray="4 4"/>`
    : '';

  return `<svg viewBox="0 0 ${width} ${height}" class="weight-chart-svg" preserveAspectRatio="none">
    ${targetLine}
    <path d="${pathD}" fill="none" stroke="var(--pink-deep)" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>
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
    const v = parseFloat(document.getElementById('weight-input').value);
    if (Number.isNaN(v) || v <= 0) return;
    await setWeight(todayStr(), v);
    overlay.remove();
    if (onSaved) onSaved();
  });
}

function openWeightModalForDate(dateStr, onSaved) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal">
      <h2 class="modal-title">الوزن — ${formatDateArabic(dateStr, { weekday: false })}</h2>
      <label class="field-label">الوزن (كغ)</label>
      <input class="text-input" type="number" step="0.1" min="0" id="weight-input-d" autofocus>
      <div class="modal-actions">
        <button class="btn btn-text" id="weight-cancel-d">إلغاء</button>
        <button class="btn btn-primary" id="weight-save-d">حفظ</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  document.getElementById('weight-cancel-d').addEventListener('click', () => overlay.remove());
  document.getElementById('weight-save-d').addEventListener('click', async () => {
    const v = parseFloat(document.getElementById('weight-input-d').value);
    if (Number.isNaN(v) || v <= 0) return;
    await setWeight(dateStr, v);
    overlay.remove();
    if (onSaved) onSaved();
  });
}

// ---------- BMI (factual reference, not a directive) ----------

function computeBmi(weightKg, heightCm) {
  const h = heightCm / 100;
  return weightKg / (h * h);
}
function bmiCategory(bmi) {
  if (bmi < 18.5) return 'أقل من المعتاد';
  if (bmi < 25) return 'ضمن المعتاد';
  if (bmi < 30) return 'أعلى من المعتاد';
  return 'مرتفع';
}
function healthyWeightRange(heightCm) {
  const h = heightCm / 100;
  return { min: 18.5 * h * h, max: 24.9 * h * h };
}

async function renderBmiCard(container) {
  const settings = await db.settings.get(1);
  const latest = await getLatestWeight();

  if (!settings?.heightCm) {
    container.innerHTML = `
      <p class="ring-label">مؤشر كتلة الجسم</p>
      <p class="empty-state-sub">أضيفي طولك من الإعدادات لعرض المدى المرجعي للوزن</p>
      <button class="link-btn" id="go-to-health-settings">فتح الإعدادات ←</button>
    `;
    document.getElementById('go-to-health-settings').addEventListener('click', () => goTo('/settings'));
    return;
  }

  const range = healthyWeightRange(settings.heightCm);
  const bmiLine = latest
    ? `<p class="period-status-text">مؤشر كتلة الجسم: ${computeBmi(latest.value, settings.heightCm).toFixed(1)} (${bmiCategory(computeBmi(latest.value, settings.heightCm))})</p>`
    : '';
  container.innerHTML = `
    <p class="ring-label">مؤشر كتلة الجسم</p>
    ${bmiLine}
    <p class="period-status-sub">المدى المرجعي لطولك: ${range.min.toFixed(0)}–${range.max.toFixed(0)} كغ</p>
    <p class="settings-note">هذا مقياس عام وله حدوده (لا يأخذ الكتلة العضلية بالحسبان مثلاً)، وليس تشخيصاً طبياً.</p>
    <button class="link-btn" id="go-to-health-settings">تعديل من الإعدادات ←</button>
  `;
  document.getElementById('go-to-health-settings').addEventListener('click', () => goTo('/settings'));
}

// ---------- body measurements (optional, flexible — she names her own) ----------

async function createMeasurement(name) {
  const all = await db.bodyMeasurements.toArray();
  await db.bodyMeasurements.add({ name, archived: false, order: all.length, createdAt: Date.now() });
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
async function setMeasurementValue(measurementId, date, value) {
  await upsertLog(db.bodyMeasurementLogs, 'measurementId', measurementId, date, { value });
}

async function renderMeasurementsList(container) {
  const items = await getActiveMeasurements();
  if (items.length === 0) {
    container.innerHTML = `<div class="empty-state"><p>ما في قياسات مضافة (اختياري).</p></div>`;
    return;
  }
  const rows = await Promise.all(items.map(async m => {
    const latest = await getMeasurementLatest(m.id);
    return `
      <div class="adhkar-counter-row" data-measurement-id="${m.id}">
        <span class="adhkar-name">${escapeHtml(m.name)}</span>
        <div class="adhkar-counter-controls">
          <button class="adhkar-count-btn" data-action="edit">${latest ? latest.value + ' سم' : '—'}</button>
        </div>
      </div>`;
  }));
  container.innerHTML = rows.join('');
  container.querySelectorAll('.adhkar-counter-row').forEach(row => {
    const id = Number(row.dataset.measurementId);
    row.querySelector('[data-action="edit"]').addEventListener('click', async () => {
      const latest = await getMeasurementLatest(id);
      const input = prompt('القيمة بالسنتيمتر:', latest ? String(latest.value) : '');
      if (input === null || input === '') return;
      const n = parseFloat(input);
      if (!Number.isNaN(n) && n > 0) {
        await setMeasurementValue(id, todayStr(), n);
        await renderMeasurementsList(container);
      }
    });
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
      <button class="icon-btn" id="body-back">→</button>
      <h1>الوزن والمزاج</h1>
    </div>
    <div class="card" id="weight-glance-card"></div>
    <div class="card">
      <h2 class="card-title">الرسم البياني</h2>
      <div class="weight-chart-wrap" id="weight-chart"></div>
      <label class="field-label">الوزن المستهدف (اختياري)</label>
      <input class="text-input" type="number" step="0.1" id="target-weight-input">
      <button class="link-btn" id="save-target-btn">حفظ الهدف</button>
    </div>
    <div class="card">
      <button class="btn btn-primary btn-block" id="weight-add-btn">+ تسجيل وزن اليوم</button>
    </div>
    <div class="card" id="bmi-card"></div>
    <div class="card">
      <h2 class="card-title">قياسات الجسم (اختياري)</h2>
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

  async function refreshWeight() {
    const stats = await getWeightStats();
    document.getElementById('weight-glance-card').innerHTML = `
      <p class="ring-label">وزنك</p>
      <p class="period-status-text">${weightGlanceText(stats)}</p>
    `;
    const settings = await db.settings.get(1);
    const points = await getAllWeightLogs();
    document.getElementById('weight-chart').innerHTML = renderWeightChart(points, settings?.targetWeightKg ?? null);
    document.getElementById('target-weight-input').value = settings?.targetWeightKg ?? '';
    await renderBmiCard(document.getElementById('bmi-card'));
  }

  document.getElementById('weight-add-btn').addEventListener('click', () => openWeightModal(refreshWeight));
  document.getElementById('save-target-btn').addEventListener('click', async () => {
    const raw = document.getElementById('target-weight-input').value;
    const v = raw === '' ? null : parseFloat(raw);
    await db.settings.update(1, { targetWeightKg: (v != null && !Number.isNaN(v)) ? v : null });
    toast('تم حفظ الهدف');
    refreshWeight();
  });

  await refreshWeight();

  const measurementsListEl = document.getElementById('measurements-list');
  await renderMeasurementsList(measurementsListEl);
  document.getElementById('add-measurement-btn').addEventListener('click', () => {
    openAddMeasurementModal(() => renderMeasurementsList(measurementsListEl));
  });

  await renderMoodWidget(document.getElementById('body-mood-widget'), todayStr());
}

// ---------- Day Detail provider (weight only — see note in yearly provider) ----------

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
// Measurements and Goals are intentionally not here: measurements aren't
// a daily/yearly-volume thing the way weight is, and Goals get their own
// provider in goals.js since they're a current-status snapshot, not a
// count of things that happened in a given year.

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
