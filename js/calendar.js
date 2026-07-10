// calendar.js — the thing every phase plugs into, two ways:
//   1. dayProviders — Day Detail sections for a specific date
//   2. activityProviders — "does this date have anything logged at all",
//      used for the small dot under a day in the month grid
// Neither one needs calendar.js to know what a habit, a prayer, or a
// mood entry is. Each phase registers its own function; this file just
// calls all of them and renders the result.

const dayProviders = [];
function registerDayProvider(fn) { dayProviders.push(fn); }

// fn: () => Promise<string[]> — every date (in any month) this feature
// has something logged on. Small tables get fetched in full and mapped;
// that's fine at personal-tracker scale.
const activityProviders = [];
function registerActivityProvider(fn) { activityProviders.push(fn); }

// fn: (year) => Promise<{title, html, count}|null>. `count` feeds the
// grand total on the overview page — return null for it (not 0) when a
// section is a status snapshot rather than a count of things that
// happened in that year (Goals does this; see goals.js).
const yearlyStatsProviders = [];
function registerYearlyStatsProvider(fn) { yearlyStatsProviders.push(fn); }

// Runs every provider and returns only the ones that succeeded, logging
// (not throwing) on any that fail. One broken provider — a bad table
// reference, bad data — used to be able to take down Home's calendar,
// Day Detail, AND the Yearly Overview at once via a single rejected
// Promise.all(). Never again: a failure here just means that one
// section quietly contributes nothing, instead of blanking the page.
async function settleProviders(providers, ...args) {
  const results = await Promise.allSettled(providers.map(fn => fn(...args)));
  const values = [];
  results.forEach((r, i) => {
    if (r.status === 'fulfilled') values.push(r.value);
    else console.error(`Provider #${i} failed:`, r.reason);
  });
  return values;
}

async function getMonthActivityDates(year, month) {
  const prefix = `${year}-${String(month + 1).padStart(2, '0')}`;
  const results = await settleProviders(activityProviders);
  const dates = new Set();
  results.forEach(arr => (arr || []).forEach(d => { if (d && d.startsWith(prefix)) dates.add(d); }));
  return dates;
}

// ---------- month grid (embedded in Home) ----------

function initHomeCalendar(container) {
  const today = todayStr();
  const [ty, tm] = today.split('-').map(Number);
  let viewYear = ty, viewMonth = tm - 1; // 0-indexed month

  async function render() {
    const cellDates = monthGridDates(viewYear, viewMonth);
    const activity = await getMonthActivityDates(viewYear, viewMonth);

    const cells = cellDates.map(dateStr => {
      if (!dateStr) return `<div class="cal-cell cal-cell-empty"></div>`;
      const day = Number(dateStr.split('-')[2]);
      const isToday = dateStr === today;
      const isFuture = dateStr > today;
      const hasActivity = activity.has(dateStr);
      return `<button class="cal-cell ${isToday ? 'cal-today' : ''} ${isFuture ? 'cal-future' : ''}" data-date="${dateStr}">
        <span class="cal-day-num">${day}</span>
        ${hasActivity ? '<span class="cal-dot"></span>' : ''}
      </button>`;
    }).join('');

    container.innerHTML = `
      <div class="cal-header">
        <button class="icon-btn" id="cal-prev" aria-label="الشهر السابق">›</button>
        <span class="cal-month-label">${ARABIC_MONTHS[viewMonth]} ${viewYear}</span>
        <button class="icon-btn" id="cal-next" aria-label="الشهر التالي">‹</button>
      </div>
      <div class="cal-weekdays">${ARABIC_WEEKDAYS_SHORT.map(w => `<span>${w}</span>`).join('')}</div>
      <div class="cal-grid">${cells}</div>
    `;

    document.getElementById('cal-prev').addEventListener('click', () => {
      viewMonth -= 1; if (viewMonth < 0) { viewMonth = 11; viewYear -= 1; }
      render();
    });
    document.getElementById('cal-next').addEventListener('click', () => {
      viewMonth += 1; if (viewMonth > 11) { viewMonth = 0; viewYear += 1; }
      render();
    });
    container.querySelectorAll('.cal-cell[data-date]').forEach(cell => {
      cell.addEventListener('click', () => openDayDetail(cell.dataset.date));
    });
  }

  render();
}

// ---------- Day Detail bottom sheet ----------

async function openDayDetail(dateStr) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay sheet-overlay';
  overlay.innerHTML = `
    <div class="sheet">
      <div class="sheet-handle"></div>
      <h2 class="sheet-title">${formatDateArabic(dateStr)}</h2>
      <div class="sheet-body" id="day-detail-body"></div>
      <button class="btn btn-text sheet-close" id="day-detail-close">إغلاق</button>
    </div>`;
  document.body.appendChild(overlay);
  document.getElementById('day-detail-close').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

  const body = document.getElementById('day-detail-body');
  const results = await settleProviders(dayProviders, dateStr);
  const sections = results.filter(Boolean);

  if (sections.length === 0) {
    body.innerHTML = `<div class="empty-state"><p>ما في شي مسجل بهذا اليوم.</p></div>`;
    return;
  }
  sections.forEach(({ title, node }) => {
    const wrap = document.createElement('div');
    wrap.className = 'day-detail-section';
    wrap.innerHTML = `<h3 class="day-detail-section-title">${title}</h3>`;
    wrap.appendChild(node);
    body.appendChild(wrap);
  });
}

// ---------- Yearly Overview ----------

async function renderYearlyOverviewPage(params, view) {
  const year = params[0] ? Number(params[0]) : new Date().getFullYear();
  view.innerHTML = `
    <div class="page-header">
      <button class="icon-btn" id="yearly-back">→</button>
      <h1>نظرة على عامك</h1>
    </div>
    <div class="year-nav">
      <button class="icon-btn" id="year-prev" aria-label="السنة السابقة">›</button>
      <span class="cal-month-label">${year}</span>
      <button class="icon-btn" id="year-next" aria-label="السنة التالية">‹</button>
    </div>
    <div class="card" id="yearly-total-card"></div>
    <div id="yearly-sections"></div>
  `;
  document.getElementById('yearly-back').addEventListener('click', () => history.back());
  document.getElementById('year-prev').addEventListener('click', () => goTo(`/yearly/${year - 1}`));
  document.getElementById('year-next').addEventListener('click', () => goTo(`/yearly/${year + 1}`));

  const results = await settleProviders(yearlyStatsProviders, year);
  const sections = results.filter(Boolean);

  let grandTotal = 0;
  sections.forEach(s => { if (typeof s.count === 'number') grandTotal += s.count; });
  document.getElementById('yearly-total-card').innerHTML = `
    <p class="ring-label">إجمالي الأنشطة المسجلة هذا العام</p>
    <p class="period-status-text">${grandTotal} نشاط 🌸</p>
  `;

  const sectionsEl = document.getElementById('yearly-sections');
  if (sections.length === 0) {
    sectionsEl.innerHTML = `<div class="empty-state"><p>ما في بيانات مسجلة لهذه السنة.</p></div>`;
    return;
  }
  // Grouped by category so related sections land next to each other,
  // rather than in whatever order their providers happened to register.
  const YEARLY_CATEGORY_ORDER = [
    'الوزن', 'النوم', 'العناية اليومية', 'التمارين', 'الطعام والماء', 'المزاج', 'الدورة الشهرية',
    'العبادة', 'ورد القرآن', 'القضاء (الحالة الحالية)',
    'العادات', 'المهام اليومية', 'قائمة المهام', 'الأهداف (الحالة الحالية)', 'التعلم',
    'يومياتي', 'الاقتصاد'
  ];
  sections.sort((a, b) => {
    const rankA = YEARLY_CATEGORY_ORDER.indexOf(a.title);
    const rankB = YEARLY_CATEGORY_ORDER.indexOf(b.title);
    return (rankA === -1 ? YEARLY_CATEGORY_ORDER.length : rankA) - (rankB === -1 ? YEARLY_CATEGORY_ORDER.length : rankB);
  });

  sectionsEl.innerHTML = '';
  sections.forEach(({ title, html }) => {
    const card = document.createElement('div');
    card.className = 'card yearly-section-card';
    card.innerHTML = `<h2 class="card-title">${title}</h2>${html}`;
    sectionsEl.appendChild(card);
  });
}
