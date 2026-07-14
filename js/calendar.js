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
      return `<button class="cal-cell ${isToday ? 'cal-today' : ''} ${isFuture ? 'cal-future' : ''}" data-date="${dateStr}" aria-label="${formatDateArabic(dateStr, { weekday: true })}">
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

// Day Detail. Everything logged on a date, grouped by area, with the
// quick-adds that make sense FOR THAT DATE.
//
// On editing the past: the six editable providers here (tasks, todos,
// food, water, weight, diary) are all things you SHOULD be able to fix
// retroactively — forgetting to tick yesterday's task is exactly the case
// this screen exists for, and streaks recompute from the logs, so a
// correction correctly repairs the streak rather than corrupting it.
// Anything whose meaning is anchored to "now" — the habit clocks (driven
// by relapse timestamps), the wird's khatm position — is deliberately
// read-only here, because retro-editing those would rewrite a history
// that other numbers are derived from.
const DAY_SECTION_ORDER = [
  'المزاج', 'يومياتي',
  'الصلوات', 'السنن والأذكار', 'الأذكار المخصصة', 'ورد القرآن',
  'العادات', 'المهام اليومية', 'قائمة المهام', 'مهام الدورات',
  'الطعام', 'الماء', 'وضع المضغ', 'المأكولات', 'الوصفات',
  'الوزن', 'النوم', 'العناية اليومية', 'التمارين', 'الدورة الشهرية',
  'الاقتصاد', 'المشتريات'
];

async function openDayDetail(dateStr) {
  const today = todayStr();
  const isToday = dateStr === today;
  const isFuture = dateStr > today;
  const dayDiff = daysBetween(dateStr, today);

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay sheet-overlay';
  overlay.innerHTML = `
    <div class="sheet">
      <div class="sheet-handle"></div>

      <div class="day-nav">
        <button class="icon-btn" id="day-prev" aria-label="اليوم السابق">›</button>
        <div class="day-nav-title">
          <h2 class="sheet-title">${formatDateArabic(dateStr)}</h2>
          <span class="day-nav-sub" id="day-nav-sub"></span>
        </div>
        <button class="icon-btn" id="day-next" aria-label="اليوم التالي" ${isToday || isFuture ? 'disabled' : ''}>‹</button>
      </div>

      <div class="day-summary" id="day-summary"></div>
      <div class="sheet-body" id="day-detail-body"></div>

      ${!isFuture ? `
        <div class="day-quick">
          <span class="day-quick-label">إضافة سريعة</span>
          <div class="day-quick-row">
            <button class="day-quick-btn" data-add="mood">🙂 مزاج</button>
            <button class="day-quick-btn" data-add="diary">📔 يومية</button>
            <button class="day-quick-btn" data-add="food">🍽️ وجبة</button>
            <button class="day-quick-btn" data-add="weight">⚖️ وزن</button>
          </div>
        </div>` : `
        <p class="day-future-note">📅 يوم قادم — لا يمكن التسجيل فيه بعد.</p>`}

      <button class="btn btn-text sheet-close" id="day-detail-close">إغلاق</button>
    </div>`;
  document.body.appendChild(overlay);
  document.getElementById('day-detail-close').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

  // Walking between days without closing and reopening the sheet.
  document.getElementById('day-prev').addEventListener('click', () => {
    overlay.remove();
    openDayDetail(addDays(dateStr, -1));
  });
  const nextBtn = document.getElementById('day-next');
  if (!isToday && !isFuture) {
    nextBtn.addEventListener('click', () => {
      overlay.remove();
      openDayDetail(addDays(dateStr, 1));
    });
  }

  // "قبل ٣ أيام" is more legible than making her subtract dates herself.
  const subEl = document.getElementById('day-nav-sub');
  subEl.textContent = isToday ? 'اليوم'
    : isFuture ? 'يوم قادم'
    : dayDiff === 1 ? 'أمس'
    : `قبل ${toArabicNumeral(dayDiff)} ${dayDiff <= 10 ? 'أيام' : 'يوماً'}`;
  subEl.className = `day-nav-sub ${isToday ? 'day-nav-today' : ''}`;

  const body = document.getElementById('day-detail-body');

  async function refreshBody() {
    body.innerHTML = '';
    const results = await settleProviders(dayProviders, dateStr);
    const sections = results.filter(Boolean);

    // Day summary: mood + how much was logged, before the detail.
    const mood = await getMoodLog(dateStr);
    const summaryEl = document.getElementById('day-summary');
    summaryEl.innerHTML = (sections.length === 0 && !mood) ? '' : `
      <div class="day-summary-row">
        ${mood ? `<span class="day-summary-mood">${mood.emoji}</span>` : ''}
        <span class="day-summary-count">${toArabicNumeral(sections.length)} ${sections.length === 1 ? 'قسم مسجّل' : 'أقسام مسجّلة'}</span>
        ${mood?.tags?.length ? `<span class="day-summary-tags">${mood.tags.map(k => {
          const t = MOOD_TAGS.find(x => x.key === k);
          return t ? t.emoji : '';
        }).join(' ')}</span>` : ''}
      </div>`;

    if (sections.length === 0) {
      body.innerHTML = `<div class="empty-state"><p>${isFuture ? 'يوم لم يأتِ بعد.' : 'ما في شي مسجل بهذا اليوم.'}</p></div>`;
      return;
    }

    // Grouped by area, in a fixed order — providers register in whatever
    // order the app happens to load them, which is not an order anyone
    // would choose to read in.
    sections.sort((a, b) => {
      const ra = DAY_SECTION_ORDER.indexOf(a.title);
      const rb = DAY_SECTION_ORDER.indexOf(b.title);
      return (ra === -1 ? 999 : ra) - (rb === -1 ? 999 : rb);
    });

    sections.forEach(({ title, node }) => {
      const wrap = document.createElement('div');
      wrap.className = 'day-detail-section';
      wrap.innerHTML = `<h3 class="day-detail-section-title">${title}</h3>`;
      wrap.appendChild(node);
      body.appendChild(wrap);
    });
  }
  await refreshBody();

  // Quick-adds are date-aware: they log to THIS day, not to today.
  overlay.querySelectorAll('.day-quick-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const what = btn.dataset.add;
      if (what === 'mood') {
        openDayMoodModal(dateStr, refreshBody);
      } else if (what === 'diary') {
        openDiaryModal({ date: dateStr, onSaved: refreshBody });
      } else if (what === 'food') {
        openFoodModal({ date: dateStr, onSaved: refreshBody });
      } else if (what === 'weight') {
        const input = prompt(`الوزن في ${formatDateArabic(dateStr, { weekday: false })} (كغ):`);
        if (input === null) return;
        const v = parseNumericInput(input);
        if (v === null || v <= 0) return;
        await setWeight(dateStr, v);
        await refreshBody();
        toast('تم حفظ الوزن');
      }
    });
  });
}

// A small sheet for logging mood on a specific (possibly past) date.
function openDayMoodModal(dateStr, onSaved) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal modal-lg">
      <h2 class="modal-title">مزاج ${formatDateArabic(dateStr, { weekday: false })}</h2>
      <div id="day-mood-widget"></div>
      <div class="modal-actions">
        <button class="btn btn-primary" id="day-mood-done">تم</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  renderMoodWidget(document.getElementById('day-mood-widget'), dateStr, { editable: true });
  document.getElementById('day-mood-done').addEventListener('click', () => {
    overlay.remove();
    if (onSaved) onSaved();
  });
}

// ---------- Yearly Overview ----------

// The activity providers, but named — so the heatmap can be filtered to a
// single area. One combined shape answers "did I use the app"; it cannot
// answer "how was my prayer year", which is the question worth asking.
const HEATMAP_FILTERS = [
  { key: 'all',      label: '🗓️ الكل' },
  { key: 'worship',  label: '🕌 العبادة' },
  { key: 'adhkar',   label: '🤲 الأذكار' },
  { key: 'wird',     label: '📖 الورد' },
  { key: 'habits',   label: '🌱 العادات' },
  { key: 'tasks',    label: '📋 المهام' },
  { key: 'food',     label: '🍽️ الطعام' },
  { key: 'water',    label: '💧 الماء' },
  { key: 'sleep',    label: '😴 النوم' },
  { key: 'training', label: '💪 التمارين' },
  { key: 'mood',     label: '🙂 المزاج' },
  { key: 'diary',    label: '📔 اليوميات' },
  { key: 'period',   label: '🌸 الدورة' },
  { key: 'study',    label: '⏳ الدراسة' },
  { key: 'care',     label: '🧴 العناية' },
  { key: 'chew',     label: '🌿 المضغ' },
  { key: 'economy',  label: '💰 الاقتصاد' }
];

async function getHeatmapDates(filter, year) {
  const prefix = String(year);
  const only = (arr) => arr.filter(d => typeof d === 'string' && d.startsWith(prefix));

  switch (filter) {
    case 'worship':
      return only((await db.prayerLogs.toArray()).filter(l => l.status === 'done').map(l => l.date));
    case 'adhkar':
      return only((await db.dailyAdhkarLogs.toArray()).map(l => l.date));
    case 'wird':
      return only((await db.wirdLogs.toArray()).map(l => l.date));
    case 'habits':
      return only((await db.habitLogs.toArray()).filter(l => l.status === 'done').map(l => l.date));
    case 'tasks':
      return only((await db.fixedTaskLogs.toArray()).map(l => l.date));
    case 'food':
      return only((await db.foodLogs.toArray()).map(l => l.date));
    case 'water':
      return only((await db.waterLogs.toArray()).filter(l => l.liters > 0).map(l => l.date));
    case 'sleep':
      return only((await db.sleepLogs.toArray()).map(l => l.date));
    case 'training':
      return only((await db.exerciseLogs.toArray()).filter(l => l.sets > 0).map(l => l.date));
    case 'mood':
      return only((await db.moodLogs.toArray()).map(l => l.date));
    case 'diary':
      return only((await db.diaryEntries.toArray()).map(l => l.date));
    case 'period':
      return only((await db.periodReadings.toArray()).map(l => l.dateStr));
    case 'study':
      return only((await db.studySessions.toArray()).map(l => l.date));
    case 'care':
      return only((await db.dailyCareLogs.toArray()).map(l => l.date));
    case 'chew':
      return only((await db.chewSessions.toArray()).map(l => l.date));
    case 'economy':
      return only((await db.economyTransactions.toArray()).map(l => l.date));
    default: {
      const results = await settleProviders(activityProviders);
      return only(results.flat());
    }
  }
}

// A year heatmap built from the activity providers the calendar already
// registers — 12 rows of days, tinted by how much was logged. It answers
// "what did my year actually look like?" in a way a list of totals can't.
function yearHeatmapHtml(year, activeDates) {
  const counts = new Map();
  activeDates.forEach(d => counts.set(d, (counts.get(d) || 0) + 1));
  const max = Math.max(1, ...counts.values());

  const months = ARABIC_MONTHS;
  const rows = [];
  for (let m = 0; m < 12; m++) {
    const daysInMonth = new Date(year, m + 1, 0).getDate();
    const cells = [];
    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = `${year}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const n = counts.get(dateStr) || 0;
      // 5 levels: empty + four intensities. Quantised rather than a raw
      // gradient so a single quiet day still reads as "something happened".
      const level = n === 0 ? 0 : Math.min(4, Math.ceil((n / max) * 4));
      cells.push(`<span class="heat-cell heat-${level}" title="${dateStr}: ${n}"></span>`);
    }
    rows.push(`
      <div class="heat-row">
        <span class="heat-month">${months[m]}</span>
        <div class="heat-cells">${cells.join('')}</div>
      </div>`);
  }
  return `<div class="year-heatmap">${rows.join('')}</div>`;
}

async function renderYearlyOverviewPage(params, view) {
  const thisYear = new Date().getFullYear();
  const year = params[0] ? Number(params[0]) : thisYear;
  view.innerHTML = `
    <div class="page-header">
      <button class="icon-btn" aria-label="رجوع" id="yearly-back">→</button>
      <h1>نظرة على عامك</h1>
    </div>
    <div class="year-nav">
      <button class="icon-btn" id="year-prev" aria-label="السنة السابقة">›</button>
      <span class="cal-month-label">${year}</span>
      <button class="icon-btn" id="year-next" aria-label="السنة التالية" ${year >= thisYear ? 'disabled' : ''}>‹</button>
    </div>
    <div class="card" id="yearly-total-card"></div>
    <div class="card" id="yearly-heatmap-card"></div>
    <div id="yearly-jump"></div>
    <div id="yearly-sections"></div>
  `;
  document.getElementById('yearly-back').addEventListener('click', () => history.back());
  document.getElementById('year-prev').addEventListener('click', () => goTo(`/yearly/${year - 1}`));
  const nextBtn = document.getElementById('year-next');
  // Walking into next year shows an empty page and looks broken.
  if (year < thisYear) nextBtn.addEventListener('click', () => goTo(`/yearly/${year + 1}`));

  const results = await settleProviders(yearlyStatsProviders, year);
  const sections = results.filter(Boolean);

  // ---- Hero: things that actually mean something ----
  // (The old version summed habit-logs + meals + transactions into a single
  //  "activity count" — arithmetic across incompatible units that told her
  //  nothing. These three numbers each answer a real question.)
  const activityResults = await settleProviders(activityProviders);
  const allDates = activityResults.flat().filter(d => typeof d === 'string' && d.startsWith(String(year)));
  const uniqueDays = [...new Set(allDates)].sort();

  const daysTracked = uniqueDays.length;
  const longestRun = (() => {
    let best = 0, run = 0, prev = null;
    for (const d of uniqueDays) {
      if (prev && daysBetween(prev, d) === 1) run += 1; else run = 1;
      if (run > best) best = run;
      prev = d;
    }
    return best;
  })();
  const byMonth = new Array(12).fill(0);
  uniqueDays.forEach(d => { byMonth[Number(d.slice(5, 7)) - 1] += 1; });
  const bestMonthIdx = byMonth.indexOf(Math.max(...byMonth));
  const hasAny = daysTracked > 0;

  document.getElementById('yearly-total-card').innerHTML = hasAny ? `
    <p class="ring-label">عامك في أرقام</p>
    <div class="diary-stat-row">
      <div class="diary-stat">
        <span class="diary-stat-num">${toArabicNumeral(daysTracked)}</span>
        <span class="diary-stat-label">يوم سجّلتِ فيه</span>
      </div>
      <div class="diary-stat">
        <span class="diary-stat-num">${toArabicNumeral(longestRun)}</span>
        <span class="diary-stat-label">أطول تتابع</span>
      </div>
      <div class="diary-stat">
        <span class="diary-stat-num">${byMonth[bestMonthIdx] > 0 ? ARABIC_MONTHS[bestMonthIdx] : '—'}</span>
        <span class="diary-stat-label">أنشط شهر</span>
      </div>
    </div>` : `
    <p class="ring-label">عامك في أرقام</p>
    <p class="empty-state-sub">ما في بيانات مسجلة لهذه السنة بعد.</p>`;

  const heatCard = document.getElementById('yearly-heatmap-card');
  if (hasAny) {
    let heatFilter = 'all';

    async function paintHeatmap() {
      const dates = await getHeatmapDates(heatFilter, year);
      const daysWith = new Set(dates).size;
      document.getElementById('heat-body').innerHTML = dates.length
        ? `${yearHeatmapHtml(year, dates)}
           <div class="heat-legend">
             <span>أقل</span>
             <span class="heat-cell heat-0"></span>
             <span class="heat-cell heat-1"></span>
             <span class="heat-cell heat-2"></span>
             <span class="heat-cell heat-3"></span>
             <span class="heat-cell heat-4"></span>
             <span>أكثر</span>
           </div>
           <p class="heat-count">${toArabicNumeral(daysWith)} يوم</p>`
        : `<p class="empty-state-sub">لا شيء مسجّل في هذا القسم لهذه السنة.</p>`;
    }

    heatCard.innerHTML = `
      <p class="ring-label">شكل عامك</p>
      <div class="heat-filter-row" id="heat-filters">
        ${HEATMAP_FILTERS.map(f => `<button class="heat-filter-chip ${f.key === 'all' ? 'active' : ''}" data-filter="${f.key}">${f.label}</button>`).join('')}
      </div>
      <div id="heat-body"></div>`;

    document.querySelectorAll('.heat-filter-chip').forEach(chip => {
      chip.addEventListener('click', async () => {
        heatFilter = chip.dataset.filter;
        document.querySelectorAll('.heat-filter-chip').forEach(c => c.classList.toggle('active', c === chip));
        await paintHeatmap();
      });
    });
    await paintHeatmap();
  } else {
    heatCard.style.display = 'none';
  }

  const sectionsEl = document.getElementById('yearly-sections');
  if (sections.length === 0) {
    sectionsEl.innerHTML = `<div class="empty-state"><p>ما في بيانات مسجلة لهذه السنة.</p></div>`;
    return;
  }
  // Grouped by category so related sections land next to each other,
  // rather than in whatever order their providers happened to register.
  const YEARLY_CATEGORY_ORDER = [
    'الوزن', 'النوم', 'العناية اليومية', 'التمارين', 'الطعام والماء', 'وضع المضغ', 'الوصفات', 'المزاج', 'الدورة الشهرية',
    'العبادة', 'ورد القرآن', 'القضاء (الحالة الحالية)',
    'العادات', 'المهام اليومية', 'قائمة المهام', 'الأهداف (الحالة الحالية)', 'التعلم',
    'يومياتي', 'الاقتصاد'
  ];
  sections.sort((a, b) => {
    const rankA = YEARLY_CATEGORY_ORDER.indexOf(a.title);
    const rankB = YEARLY_CATEGORY_ORDER.indexOf(b.title);
    return (rankA === -1 ? YEARLY_CATEGORY_ORDER.length : rankA) - (rankB === -1 ? YEARLY_CATEGORY_ORDER.length : rankB);
  });

  // Jump chips — with a dozen sections this page is a long scroll, and
  // scrolling past nine of them to reach the one you wanted is not a
  // review, it's a chore.
  document.getElementById('yearly-jump').innerHTML = `
    <div class="yearly-jump-row">
      ${sections.map((s, i) => `<button class="yearly-jump-chip" data-idx="${i}">${s.title}</button>`).join('')}
    </div>`;

  sectionsEl.innerHTML = '';
  sections.forEach(({ title, html }, i) => {
    const card = document.createElement('div');
    card.className = 'card yearly-section-card';
    card.id = `yearly-sec-${i}`;
    card.innerHTML = `<h2 class="card-title">${title}</h2>${html}`;
    sectionsEl.appendChild(card);
  });
  document.querySelectorAll('.yearly-jump-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      const target = document.getElementById(`yearly-sec-${chip.dataset.idx}`);
      safeScrollIntoView(target);
    });
  });
}
