// period.js — Phase 3.
// Periods are episodes (start/end), not per-day logs, so this table
// stays small and just gets read in full. Prediction uses the median of
// past cycle/period lengths, not the mean — a single 45-day outlier
// shouldn't drag a normally-28-day cycle's estimate around.
//
// Starting/ending a period also starts/ends Worship's fard pause
// automatically (both call the same idempotent functions the manual 🌸
// button uses) — she shouldn't have to tell the app the same thing
// twice. The manual button in Worship still works independently for
// edge cases.

function median(nums) {
  if (!nums.length) return null;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
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
  await startFardPause();
  return db.periodLogs.get(id);
}
async function endPeriod(periodId, endDate) {
  await db.periodLogs.update(periodId, { endDate });
  await endFardPause();
}
async function editPeriod(periodId, startDate, endDate) {
  await db.periodLogs.update(periodId, { startDate, endDate: endDate || null });
}
async function deletePeriod(periodId) {
  await db.periodLogs.delete(periodId);
}

async function getPeriodStats() {
  const periods = await getAllPeriods();
  const chronological = [...periods].sort((a, b) => a.startDate.localeCompare(b.startDate));
  const cycleLengths = [];
  for (let i = 1; i < chronological.length; i++) {
    const gap = daysBetween(chronological[i - 1].startDate, chronological[i].startDate);
    if (gap > 10 && gap < 90) cycleLengths.push(gap); // sanity bounds — drop obvious data-entry mistakes
  }
  const periodLengths = periods
    .filter(p => p.endDate !== null)
    .map(p => daysBetween(p.startDate, p.endDate) + 1)
    .filter(n => n > 0 && n < 20);

  return {
    avgCycleLength: median(cycleLengths) ?? 28,
    avgPeriodLength: median(periodLengths) ?? 5,
    cycleSamples: cycleLengths.length,
    periodSamples: periodLengths.length
  };
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

  const predictedNext = addDays(periods[0].startDate, Math.round(stats.avgCycleLength));
  const daysUntil = daysBetween(today, predictedNext);

  if (daysUntil > 0) return { state: 'upcoming', daysUntil, predictedNext, stats };
  return { state: 'late', daysLate: -daysUntil, predictedNext, stats };
}

function periodStatusText(status) {
  switch (status.state) {
    case 'ongoing':
      if (status.remaining > 0) return `اليوم ${status.dayNum} من الدورة 🌸 — يُتوقع الانتهاء بعد ${status.remaining} ${status.remaining === 1 ? 'يوم' : 'أيام'}`;
      if (status.remaining === 0) return `اليوم ${status.dayNum} من الدورة 🌸 — من المتوقع تنتهي اليوم`;
      return `اليوم ${status.dayNum} من الدورة 🌸 — تجاوزت المعتاد بـ ${-status.remaining} ${(-status.remaining) === 1 ? 'يوم' : 'أيام'}`;
    case 'upcoming':
      return status.daysUntil === 1 ? 'الدورة القادمة بعد يوم واحد تقريباً 🌸' : `الدورة القادمة بعد ${status.daysUntil} يوم تقريباً 🌸`;
    case 'late':
      return status.daysLate === 1 ? 'الدورة متأخرة يوم واحد ⏳' : `الدورة متأخرة ${status.daysLate} أيام ⏳`;
    default:
      return 'سجلي أول دورة لتبدأ التوقعات 🌸';
  }
}

function periodGlanceText(status) {
  switch (status.state) {
    case 'ongoing': return `يوم ${status.dayNum}${status.remaining > 0 ? ` · ${status.remaining}` : ''}`;
    case 'upcoming': return `بعد ${status.daysUntil} يوم`;
    case 'late': return `متأخرة ${status.daysLate}`;
    default: return 'سجلي أول دورة';
  }
}

// ---------- modals ----------

function openStartPeriodModal(onDone) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal">
      <h2 class="modal-title">بدء دورة جديدة</h2>
      <label class="field-label">تاريخ البداية</label>
      <input class="text-input" type="date" id="period-start-input" value="${todayStr()}">
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
    await startPeriod(date);
    overlay.remove();
    toast('🌸 تم تسجيل بداية الدورة — تم إيقاف تتبع الصلوات تلقائياً');
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
    await endPeriod(period.id, date);
    overlay.remove();
    toast('🌸 تم تسجيل انتهاء الدورة — تم استئناف تتبع الصلوات');
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

    const cells = cellDates.map(dateStr => {
      if (!dateStr) return `<div class="cal-cell cal-cell-empty"></div>`;
      const day = Number(dateStr.split('-')[2]);
      const isToday = dateStr === today;
      const inPeriod = !!periodForDate(dateStr);
      return `<button class="cal-cell ${isToday ? 'cal-today' : ''} ${inPeriod ? 'cal-period-day' : ''}" data-date="${dateStr}">
        <span class="cal-day-num">${day}</span>
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
  container.innerHTML = periods.map(p => `
    <button class="period-history-row" data-period-id="${p.id}">
      <span class="period-history-range">${formatDateArabic(p.startDate, { weekday: false })}${p.endDate ? ' → ' + formatDateArabic(p.endDate, { weekday: false }) : ' (مستمرة)'}</span>
      ${p.endDate ? `<span class="period-history-length">${daysBetween(p.startDate, p.endDate) + 1} أيام</span>` : ''}
    </button>`).join('');
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
    <div class="card" id="period-action-card"></div>
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
    `;

    const ongoing = await getOngoingPeriod();
    const actionCard = document.getElementById('period-action-card');
    if (ongoing) {
      actionCard.innerHTML = `<button class="btn btn-primary btn-block" id="period-primary-btn">إنهاء الدورة</button>`;
      document.getElementById('period-primary-btn').addEventListener('click', () => openEndPeriodModal(ongoing, refreshAll));
    } else {
      actionCard.innerHTML = `<button class="btn btn-primary btn-block" id="period-primary-btn">🌸 بدء دورة جديدة</button>`;
      document.getElementById('period-primary-btn').addEventListener('click', () => openStartPeriodModal(refreshAll));
    }

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
  const html = `
    <div class="yearly-row"><span>عدد الدورات</span><span>${yearPeriods.length}</span></div>
    <div class="yearly-row"><span>إجمالي أيام الدورة</span><span>${totalDays} يوم</span></div>
    <div class="yearly-row"><span>متوسط طول الدورة نفسها</span><span>${stats.periodSamples > 0 ? Math.round(stats.avgPeriodLength) + ' يوم' : 'غير كافٍ بعد'}</span></div>
    <div class="yearly-row"><span>متوسط الفترة بين الدورات</span><span>${stats.cycleSamples > 0 ? Math.round(stats.avgCycleLength) + ' يوم' : 'غير كافٍ بعد (تحتاج دورتين على الأقل)'}</span></div>
  `;
  return { title: 'الدورة الشهرية', html, count: yearPeriods.length };
}
