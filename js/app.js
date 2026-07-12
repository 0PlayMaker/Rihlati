// app.js — boots the app, wires routes, registers Day Detail providers,
// and renders Home. This is the one file that knows about every module;
// every other file only knows about db.js/streaks.js/router.js.
// (renderRing lives in ui-shared.js now — Worship needs it too.)

async function rescheduleHomeReminders() {
  const tasks = await getActiveFixedTasks();
  const doneSet = await getFixedTasksDoneSet(tasks, todayStr());
  const isDoneToday = (id) => doneSet.has(id);
  await scheduleAllTodayReminders();
  return isDoneToday;
}

// Small ring used for the routine circles — same visual language as the
// big ones, just sized down so two fit side by side under them.
// Ring colour comes from a CSS variable per tone, never a literal — so the
// whole grid retunes with the theme (and the custom theme editor reaches
// it) instead of a handful of hardcoded hues quietly opting out.
// Custom-adhkar ring: ONE ring that reports several counters at once, by
// dividing itself into an arc per chosen dhikr (max 6 — past that the arcs
// are too thin to read). Each arc fills with that dhikr's own progress
// toward its own goal, so "٣٣ of سبحان الله" and "١٠٠ of أستغفر الله" can
// share a single circle without either being reduced to a yes/no.
const ADHKAR_RING_MAX = 6;

async function buildCustomAdhkarRingData() {
  const today = todayStr();
  const settings = await db.settings.get(1);
  const chosenIds = settings?.homeAdhkarIds || null;

  let items = await getActiveCustomAdhkar();
  // Only ones with a goal can show meaningful progress; a countless dhikr
  // has no fraction to draw.
  items = items.filter(a => a.goalCount > 0);
  if (chosenIds) items = items.filter(a => chosenIds.includes(a.id));
  items = items.slice(0, ADHKAR_RING_MAX);

  if (items.length === 0) {
    return { segments: [{ frac: 0, color: 'var(--track)' }], center: '—', label: '📿 المسبحة', path: '/worship', empty: true };
  }

  const counts = await Promise.all(items.map(a => getCustomAdhkarCount(a.id, today)));
  const doneCount = counts.filter((c, i) => c >= items[i].goalCount).length;
  const per = 1 / items.length;
  const GAP = items.length > 1 ? 0.012 : 0; // a hair of space so arcs read as separate
  const sliceLen = Math.max(0, per - GAP);

  // Each slice gets a faint track FIRST, then its fill on top. Without the
  // track, a dhikr at zero draws nothing at all — so "one of three done"
  // looked like a single lonely arc instead of one filled slice among
  // three. The ring has to read as a divided whole even when it's empty.
  const tracks = items.map((_, i) => ({
    frac: sliceLen,
    offset: i * per,
    color: 'var(--ring-slice-track)'
  }));
  const fills = items.map((a, i) => {
    const frac = Math.min(1, counts[i] / a.goalCount);
    return {
      frac: sliceLen * frac,
      offset: i * per,
      color: frac >= 1 ? 'var(--success-strong)' : 'var(--ring-worship)'
    };
  });

  return {
    segments: [...tracks, ...fills],
    sliceCount: items.length,
    center: `${toArabicNumeral(doneCount)}/${toArabicNumeral(items.length)}`,
    label: '📿 المسبحة',
    path: '/worship',
    empty: false
  };
}

// ============================================================
//  Home tracker registry
// ============================================================
// Every tracker the home card CAN show, in one place. The card used to
// hardcode its own contents, which meant "let her choose what to see"
// wasn't expressible at all. Now settings just picks keys from this list.
//
// `size` is the tracker's natural form: 'big' rings carry a headline the
// whole day hangs on; 'small' ones are glanceable supporting numbers.
const HOME_TRACKERS = [
  { key: 'habits',   size: 'big',   label: 'العادات',        icon: '🌱', path: '/habits' },
  { key: 'tasks',    size: 'big',   label: 'المهام الثابتة',  icon: '📋', path: '/tasks' },
  { key: 'goals',    size: 'big',   label: 'الأهداف',         icon: '🎯', path: '/goals' },
  { key: 'water',    size: 'big',   label: 'الماء',           icon: '💧', path: '/food' },
  { key: 'calories', size: 'big',   label: 'السعرات',         icon: '🔥', path: '/food' },

  { key: 'morning',  size: 'small', label: 'الروتين الصباحي', icon: '🌅', path: '/dailycare' },
  { key: 'evening',  size: 'small', label: 'الروتين المسائي', icon: '🌙', path: '/dailycare' },
  { key: 'prayers',  size: 'small', label: 'الصلوات',         icon: '🕌', path: '/worship' },
  { key: 'adhkar',   size: 'small', label: 'أذكار الصباح والمساء', icon: '🤲', path: '/worship' },
  { key: 'tasbeeh',  size: 'small', label: 'المسبحة (أذكار مخصصة)', icon: '📿', path: '/worship' },
  { key: 'wird',     size: 'small', label: 'ورد القرآن',      icon: '📖', path: '/worship' },
  { key: 'period',   size: 'small', label: 'الدورة الشهرية',  icon: '🌸', path: '/period' },
  { key: 'health',   size: 'small', label: 'الوزن والهدف',    icon: '⚖️', path: '/body' },
  { key: 'sleep',    size: 'small', label: 'النوم',           icon: '😴', path: '/sleep' },
  { key: 'training', size: 'small', label: 'التمارين',        icon: '💪', path: '/training' },
  { key: 'study',    size: 'small', label: 'وقت التركيز',     icon: '⏳', path: '/study' },
  { key: 'mood',     size: 'small', label: 'المزاج',          icon: '🙂', path: '/mood-history' },
  { key: 'chew',     size: 'small', label: 'وضع المضغ',       icon: '🌿', path: '/food' }
];

const HOME_MAX_BIG = 2;
const HOME_MAX_SMALL = 8;
const HOME_DEFAULT_BIG = ['habits', 'tasks'];
const HOME_DEFAULT_SMALL = ['morning', 'evening', 'prayers', 'adhkar', 'tasbeeh', 'wird', 'period', 'health'];

async function getHomeTrackerPrefs() {
  const s = await db.settings.get(1);
  return {
    big: Array.isArray(s?.homeBigTrackers) ? s.homeBigTrackers.slice(0, HOME_MAX_BIG) : HOME_DEFAULT_BIG,
    small: Array.isArray(s?.homeSmallTrackers) ? s.homeSmallTrackers.slice(0, HOME_MAX_SMALL) : HOME_DEFAULT_SMALL
  };
}
async function saveHomeTrackerPrefs({ big, small }) {
  await db.settings.update(1, {
    homeBigTrackers: big.slice(0, HOME_MAX_BIG),
    homeSmallTrackers: small.slice(0, HOME_MAX_SMALL)
  });
}

const RING_TONE_VARS = {
  care: 'var(--ring-care)',
  worship: 'var(--ring-worship)',
  period: 'var(--ring-period)',
  health: 'var(--ring-health)',
  success: 'var(--success-strong)',
  late: 'var(--warning-strong)',
  muted: 'var(--track)'
};

// Period ring. The fill represents where she is in the cycle — so the
// ring's own shape says "nearly due" before you read a single word.
// The label is what she actually asked for: a countdown, or the day of
// the period she's currently on.
async function buildPeriodRingData() {
  const ongoing = await getOngoingPeriod();
  const status = await getPeriodStatus();

  if (ongoing) {
    const day = daysBetween(ongoing.startDate, todayStr()) + 1;
    return {
      frac: 1,
      center: `${toArabicNumeral(day)}`,
      label: day === 1 ? '🌸 أول يوم' : `🌸 يوم ${toArabicNumeral(day)}`,
      tone: 'period'
    };
  }
  if (status.state === 'unknown' || !status.stats || status.stats.cycleSamples === 0) {
    return { frac: 0, center: '—', label: '🌸 الدورة', tone: 'muted' };
  }
  if (status.state === 'late') {
    return { frac: 1, center: `+${toArabicNumeral(status.daysLate)}`, label: '🌸 متأخرة', tone: 'late' };
  }
  if (status.state === 'due') {
    return { frac: 1, center: '~', label: '🌸 متوقّعة الآن', tone: 'late' };
  }
  // Upcoming: how far through the cycle are we?
  const days = status.daysUntil;
  const cycleLen = Math.round(status.stats.avgCycleLength) || 28;
  const elapsed = Math.max(0, cycleLen - days);
  return {
    frac: Math.min(1, elapsed / cycleLen),
    center: toArabicNumeral(days),
    label: `🌸 ${toArabicNumeral(days)} ${days === 1 ? 'يوم للدورة' : 'يوم للدورة'}`,
    tone: 'period'
  };
}

// Health ring: progress toward the weight target if she set one, else
// just the current weight. Never invents a goal she didn't ask for.
async function buildHealthRingData() {
  const settings = await db.settings.get(1);
  const stats = await getWeightStats();
  if (!stats.latest) {
    return { frac: 0, center: '—', label: '⚖️ الوزن' };
  }
  const current = stats.latest.value;
  const target = settings?.targetWeightKg ?? null;
  if (target == null) {
    return { frac: 0, center: toArabicNumeral(current), label: '⚖️ كغ' };
  }
  // Progress measured from where she STARTED, not from zero — "60% of the
  // way from 70kg to 60kg" is meaningful; "55/60 of a kilogram" is not.
  const logs = await getAllWeightLogs();
  const start = logs.length ? logs[0].value : current;
  const totalGap = Math.abs(start - target);
  const remaining = Math.abs(current - target);
  const frac = totalGap === 0 ? 1 : Math.max(0, Math.min(1, 1 - remaining / totalGap));
  const reached = remaining < 0.5;
  return {
    frac,
    center: toArabicNumeral(current),
    label: reached ? '⚖️ بلغتِ هدفك ✨' : `⚖️ الهدف ${toArabicNumeral(target)}`
  };
}

// Prayers ring — how many of the five are done today.
async function buildPrayersRingData() {
  const stats = await getWorshipTodayStats();
  if (stats.paused) {
    return { frac: 0, center: '🌸', label: '🕌 موقوف', tone: 'muted', path: '/worship' };
  }
  return {
    frac: stats.total ? stats.done / stats.total : 0,
    center: `${toArabicNumeral(stats.done)}/${toArabicNumeral(stats.total)}`,
    label: '🕌 الصلوات',
    tone: stats.done === stats.total ? 'success' : 'worship',
    path: '/worship'
  };
}

// Wird ring — position within the current khatm, not just done/not-done,
// so the ring itself shows how far through the Quran she is.
async function buildWirdRingData() {
  const plan = await getWirdPlan();
  if (!plan) {
    return { frac: 0, center: '—', label: '📖 الورد', tone: 'muted', path: '/worship' };
  }
  const { progressPages, khatmCount } = await getWirdProgress();
  const loggedToday = await isWirdLoggedToday();
  return {
    frac: progressPages / QURAN_TOTAL_PAGES,
    center: loggedToday ? '✓' : toArabicNumeral(Math.round((progressPages / QURAN_TOTAL_PAGES) * 100)) + '٪',
    label: khatmCount > 0 ? `📖 ${toArabicNumeral(khatmCount)} ختمة` : '📖 الورد',
    tone: loggedToday ? 'success' : 'worship',
    path: '/worship'
  };
}

// Adhkar ring — morning + evening as a single 0/1/2 signal, since they're
// two halves of the same daily habit.
async function buildAdhkarRingData() {
  const today = todayStr();
  const [m, e] = await Promise.all([
    isDailyAdhkarDone('morning', today),
    isDailyAdhkarDone('evening', today)
  ]);
  const done = (m ? 1 : 0) + (e ? 1 : 0);
  return {
    frac: done / 2,
    center: `${toArabicNumeral(done)}/٢`,
    label: '🤲 الأذكار',
    tone: done === 2 ? 'success' : 'worship',
    path: '/worship'
  };
}

// "What's actually left today" — the one thing a home screen can do that
// a list of rings can't: tell her what to DO next. Each chip is a live
// count of something still undone and taps straight through to it. Chips
// only appear when there's something outstanding, so a finished day
// collapses the whole strip rather than showing a row of proud zeros.
async function buildRemainingTodayChips() {
  const chips = [];
  const today = todayStr();

  const trackedTasks = await getTrackedFixedTasks();
  const taskDone = await getFixedTasksDoneSet(trackedTasks, today);
  const tasksLeft = trackedTasks.length - taskDone.size;
  if (tasksLeft > 0) chips.push({ icon: '📋', text: `${toArabicNumeral(tasksLeft)} مهام`, path: '/tasks' });

  const worship = await getWorshipTodayStats();
  const prayersLeft = 5 - worship.done;
  if (!worship.paused && prayersLeft > 0) chips.push({ icon: '🕌', text: `${toArabicNumeral(prayersLeft)} صلوات`, path: '/worship' });

  const openTodos = (await db.customTodos.toArray()).filter(t => !t.done).length;
  if (openTodos > 0) chips.push({ icon: '✅', text: `${toArabicNumeral(openTodos)} من قائمتك`, path: '/tasks' });

  const wirdPlan = await getWirdPlan();
  if (wirdPlan && !(await isWirdLoggedToday())) chips.push({ icon: '📖', text: 'وردك', path: '/worship' });

  const moodToday = await getMoodLog(today);
  if (!moodToday) chips.push({ icon: '🙂', text: 'مزاجك', path: '/mood-history' });

  return chips;
}

// ============================================================
//  Tracker data builders — one per registry key
// ============================================================
// Each returns { segments|frac, center, label, path, tone }. Keeping them
// uniform is what lets the home card be assembled from a settings list
// rather than hardcoded.

async function buildTrackerData(key) {
  const today = todayStr();
  switch (key) {
    case 'habits': {
      const r = await getHabitsRingData();
      return {
        segments: [
          { frac: r.total ? r.done / r.total : 0, color: 'var(--success-strong)' },
          { frac: r.total ? r.missed / r.total : 0, color: 'var(--danger-strong)' }
        ],
        center: r.total ? `${toArabicNumeral(r.done)}/${toArabicNumeral(r.total)}` : '—',
        label: 'عاداتك', path: '/habits'
      };
    }
    case 'tasks': {
      const tracked = await getTrackedFixedTasks();
      const done = (await getFixedTasksDoneSet(tracked, today)).size;
      return {
        frac: tracked.length ? done / tracked.length : 0,
        center: tracked.length ? `${toArabicNumeral(done)}/${toArabicNumeral(tracked.length)}` : '—',
        label: 'مهامك', path: '/tasks', tone: 'care'
      };
    }
    case 'goals': {
      const goals = await getActiveGoals();
      if (!goals.length) return { frac: 0, center: '—', label: 'أهدافك', path: '/goals', tone: 'muted' };
      const fracs = goals.map(g => effectiveProgressType(g) === 'checkbox' ? (g.done ? 1 : 0) : (goalProgressFraction(g) ?? 0));
      const avg = fracs.reduce((s, f) => s + f, 0) / fracs.length;
      return { frac: avg, center: `${toArabicNumeral(Math.round(avg * 100))}٪`, label: 'أهدافك', path: '/goals', tone: 'care' };
    }
    case 'water': {
      const [l, t] = await Promise.all([getWaterForDate(today), getWaterTarget()]);
      return {
        frac: t ? Math.min(1, l / t) : 0,
        center: `${toArabicNumeral(l.toFixed(1))}`,
        label: `الماء (${toArabicNumeral(t)} ل)`, path: '/food', tone: 'health'
      };
    }
    case 'calories': {
      const stats = await getFoodTodayStats();
      const { caloriesGoal } = await getFoodGoals();
      if (!caloriesGoal) return { frac: stats.count ? 1 : 0, center: toArabicNumeral(stats.totalCal || 0), label: 'السعرات', path: '/food', tone: 'care' };
      const frac = Math.min(1, (stats.totalCal || 0) / caloriesGoal);
      return { frac, center: toArabicNumeral(stats.totalCal || 0), label: `من ${toArabicNumeral(caloriesGoal)}`, path: '/food', tone: (stats.totalCal || 0) > caloriesGoal ? 'late' : 'care' };
    }
    case 'morning': case 'evening': {
      const kind = key;
      const routines = await getCareRoutines(kind);
      const done = await countCareRoutinesDone(routines, today);
      return {
        frac: routines.length ? done / routines.length : 0,
        center: routines.length ? `${toArabicNumeral(done)}/${toArabicNumeral(routines.length)}` : '—',
        label: kind === 'morning' ? '🌅 صباحي' : '🌙 مسائي',
        path: '/dailycare', tone: 'care'
      };
    }
    case 'prayers': return buildPrayersRingData();
    case 'adhkar': return buildAdhkarRingData();
    case 'tasbeeh': return buildCustomAdhkarRingData();
    case 'wird': return buildWirdRingData();
    case 'period': {
      const p = await buildPeriodRingData();
      return { ...p, path: '/period' };
    }
    case 'health': {
      const h = await buildHealthRingData();
      return { ...h, path: '/body', tone: 'health' };
    }
    case 'sleep': {
      const logs = (await db.sleepLogs.toArray()).filter(l => l.date === today && !l.isNap);
      const mins = logs.reduce((s, l) => s + (l.durationMinutes || 0), 0);
      const target = 8 * 60;
      return {
        frac: Math.min(1, mins / target),
        center: mins ? `${toArabicNumeral(Math.floor(mins / 60))}س` : '—',
        label: '😴 النوم', path: '/sleep', tone: 'health'
      };
    }
    case 'training': {
      const exercises = await getActiveExercises();
      if (!exercises.length) return { frac: 0, center: '—', label: '💪 التمارين', path: '/training', tone: 'muted' };
      let hit = 0;
      for (const ex of exercises) {
        const sets = await getExerciseSets(ex.id, today);
        if (ex.targetSets ? sets >= ex.targetSets : sets > 0) hit++;
      }
      return {
        frac: hit / exercises.length,
        center: `${toArabicNumeral(hit)}/${toArabicNumeral(exercises.length)}`,
        label: '💪 التمارين', path: '/training', tone: 'health'
      };
    }
    case 'study': {
      const mins = await getStudyMinutesForDate(today);
      const target = 120; // a reasonable default focus target
      return {
        frac: Math.min(1, mins / target),
        center: mins ? formatStudyMinutes(mins) : '—',
        label: '⏳ تركيز', path: '/study', tone: 'care'
      };
    }
    case 'mood': {
      const m = await getMoodLog(today);
      return {
        frac: m ? 1 : 0,
        center: m ? m.emoji : '—',
        label: '🙂 المزاج', path: '/mood-history', tone: m ? 'success' : 'muted'
      };
    }
    case 'chew': {
      const sessions = await getChewSessionsForDate(today);
      const completed = sessions.filter(s => s.completed).length;
      return {
        frac: sessions.length ? completed / sessions.length : 0,
        center: sessions.length ? `${toArabicNumeral(completed)}/${toArabicNumeral(sessions.length)}` : '—',
        label: '🌿 المضغ', path: '/food', tone: 'health'
      };
    }
    default: return null;
  }
}

// A big ring (headline) — accepts either a frac or explicit segments.
function bigRingHtml(d) {
  const segments = d.segments || [{ frac: d.frac || 0, color: RING_TONE_VARS[d.tone] || 'var(--btn-color, var(--pink-deep))' }];
  return `
    <button class="ring-item ring-item-tappable" data-path="${d.path}" aria-label="${escapeHtml(d.label)}">
      <div class="ring-wrap">
        ${renderRing({ segments })}
        <div class="ring-center-text">${d.center}</div>
      </div>
      <span class="ring-label">${d.label}</span>
    </button>`;
}

// A small ring — same, at glance size, with divider ticks when it carries
// several fixed slices (the tasbeeh ring).
function smallRingFromData(d) {
  const segments = d.segments || [{ frac: d.frac || 0, color: RING_TONE_VARS[d.tone] || 'var(--btn-color, var(--pink-deep))' }];
  const SIZE = 58, SW = 7;
  const svg = renderRing({ size: SIZE, strokeWidth: SW, segments });
  // sliceCount, not segments.length — the segment list now holds a track
  // AND a fill per slice, so its length is double the number of divisions.
  const dividers = d.sliceCount > 1 ? ringDividersHtml(SIZE, SW, d.sliceCount) : '';
  const withDividers = dividers
    ? svg.replace('</svg>', `${dividers}</svg>`)
    : svg;
  return `
    <button class="small-ring-item small-ring-item-tappable" data-path="${d.path}" aria-label="${escapeHtml(d.label)}">
      <div class="ring-wrap small-ring-wrap">
        ${withDividers}
        <div class="ring-center-text small-ring-text">${d.center}</div>
      </div>
      <span class="small-ring-label">${d.label}</span>
    </button>`;
}

async function renderHomeRingSection(container) {
  if (!container) return; // page was replaced mid-render
  const prefs = await getHomeTrackerPrefs();

  const bigData = (await Promise.all(prefs.big.map(buildTrackerData))).filter(Boolean);
  const smallData = (await Promise.all(prefs.small.map(buildTrackerData))).filter(Boolean);

  const last7DaysMood = await getLast7DaysMood();
  const worshipStats = await getWorshipTodayStats();
  const [goodStreak, badStreak] = await Promise.all([getTopHabitStreak('good'), getTopHabitStreak('bad')]);
  const chips = await buildRemainingTodayChips();

  // She can turn every tracker off — in which case the card shouldn't sit
  // there as an empty box; it just isn't drawn.
  const hasRings = bigData.length > 0 || smallData.length > 0;

  container.innerHTML = `
    ${bigData.length ? `<div class="rings-row">${bigData.map(bigRingHtml).join('')}</div>` : ''}
    ${smallData.length ? `<div class="small-rings-grid ${bigData.length ? '' : 'small-rings-grid-solo'}">${smallData.map(smallRingFromData).join('')}</div>` : ''}

    ${chips.length ? `
      <div class="remaining-today ${hasRings ? '' : 'remaining-today-solo'}">
        <span class="remaining-today-label">متبقّي اليوم</span>
        <div class="remaining-chips">
          ${chips.map(c => `<button class="remaining-chip" data-path="${c.path}">${c.icon} ${c.text}</button>`).join('')}
        </div>
      </div>` : `
      <p class="remaining-done">✨ أنجزتِ كل شيء اليوم — راحة هانئة</p>`}

    <div class="mood-strip-row">
      ${last7DaysMood.map(d => `<span class="mood-strip-emoji" title="${formatDateArabic(d.date, { weekday: false })}">${d.emoji || '·'}</span>`).join('')}
    </div>
    ${(goodStreak || badStreak || worshipStats.streak > 0) ? `
      <div class="streaks-strip-row">
        ${goodStreak ? `<span class="streak-chip">${goodStreak.emoji} ${escapeHtml(goodStreak.name)} 🔥${toArabicNumeral(goodStreak.streak)}</span>` : ''}
        ${badStreak ? `<span class="streak-chip">🚫 ${escapeHtml(badStreak.name)} 🔥${toArabicNumeral(badStreak.streak)}</span>` : ''}
        ${worshipStats.streak > 0 ? `<span class="streak-chip">🕌 صلوات 🔥${toArabicNumeral(worshipStats.streak)}</span>` : ''}
      </div>` : ''}
  `;

  container.querySelectorAll('.remaining-chip, .ring-item-tappable, .small-ring-item-tappable').forEach(el => {
    el.addEventListener('click', () => goTo(el.dataset.path));
  });
}

async function renderHome(params, view, renderToken) {
  const profile = await db.profile.get(1);
  const settings = await db.settings.get(1);
  const today = todayStr();
  const ringData = await getHabitsRingData();
  const fixedTasks = await getActiveFixedTasks();
  const doneSet = await getFixedTasksDoneSet(fixedTasks, today);
  const doneTaskCount = doneSet.size;
  const worshipStats = await getWorshipTodayStats();
  const periodStatus = await getPeriodStatus();
  const foodStats = await getFoodTodayStats();
  const diaryStreak = await getDiaryStreak();
  const weightStats = await getWeightStats();
  const economyBalance = await getEconomyBalance();
  const currency = await getCurrencyLabel();
  const activeGoals = await getActiveGoals();
  const studyCourseCount = (await getActiveCourses()).length;
  const studyOpenTodoCount = (await getAllOpenCourseTodosWithCourse()).length;
  const last7DaysMood = await getLast7DaysMood();
  const [goodStreak, badStreak] = await Promise.all([getTopHabitStreak('good'), getTopHabitStreak('bad')]);

  const habitDoneFrac = ringData.total ? ringData.done / ringData.total : 0;
  const habitMissedFrac = ringData.total ? ringData.missed / ringData.total : 0;
  const ringSvg = renderRing({
    segments: [
      { frac: habitDoneFrac, color: 'var(--mint-deep)' },
      { frac: habitMissedFrac, color: 'var(--rose-deep)' }
    ]
  });

  // Everything above this line was just reading data — nothing has
  // touched the DOM yet, so it's safe to quietly abandon here if she's
  // already navigated elsewhere while all of it was loading.
  if (renderToken != null && !isCurrentRenderToken(renderToken)) return;

  view.innerHTML = `
    <header class="home-header">
      <button class="pfp-preview pfp-small" id="header-pfp" aria-label="الإعدادات">${profile.pictureBlob ? `<img src="${pictureUrl(profile.pictureBlob)}" alt="">` : '🌸'}</button>
      <div class="home-header-text">
        <h1 class="greeting-line">${greetingWord()}، ${escapeHtml(profile.name)} 🌸</h1>
        <p class="greeting-sub">${escapeHtml(pickWelcomePhrase(settings?.welcomePhrases))}</p>
      </div>
      <button class="icon-btn" id="header-settings" aria-label="الإعدادات">⚙️</button>
    </header>

    <section class="card rings-card" id="home-ring-section"></section>

    <section class="quick-actions-row quick-actions-row-3">
      <button class="quick-action-card" id="food-action">
        <span class="quick-action-icon">🍽️</span>
        <span class="quick-action-label">الطعام</span>
        <span class="quick-action-stat">${foodGlanceText(foodStats)}</span>
      </button>
      <button class="quick-action-card" id="worship-action">
        <span class="quick-action-icon">🕌</span>
        <span class="quick-action-label">العبادة</span>
        <span class="quick-action-stat">${worshipStats.done}/${worshipStats.total}${worshipStats.streak > 0 ? ` · 🔥${worshipStats.streak}` : ''}</span>
      </button>
      <button class="quick-action-card" id="diary-action">
        <span class="quick-action-icon">📔</span>
        <span class="quick-action-label">يومياتي</span>
        <span class="quick-action-stat">${diaryStreak > 0 ? `🔥${diaryStreak}` : 'اكتبي'}</span>
      </button>
    </section>

    <section class="card">
      <div id="home-calendar"></div>
    </section>

    <section class="glance-row glance-row-3">
      <button class="glance-card" id="period-action">
        <span class="glance-icon">🌙</span>
        <span class="glance-label">الدورة الشهرية</span>
        <span class="quick-action-stat">${periodGlanceText(periodStatus)}</span>
      </button>
      <button class="glance-card" id="economy-action">
        <span class="glance-icon">💰</span>
        <span class="glance-label">الاقتصاد</span>
        <span class="quick-action-stat">${economyBalance.toFixed(2)} ${currency}</span>
      </button>
      <button class="glance-card" id="body-action">
        <span class="glance-icon">⚖️</span>
        <span class="glance-label">الصحة</span>
        <span class="quick-action-stat">${weightGlanceText(weightStats)}</span>
      </button>
    </section>

    <section class="card">
      <div class="section-header">
        <h2 class="card-title">العادات</h2>
        <a class="see-all-link" href="#/habits">عرض الكل ←</a>
      </div>
      <h4 class="day-detail-subsection-title">🌱 عادات جيدة</h4>
      <div id="home-good-habits"></div>
      <h4 class="day-detail-subsection-title">🚫 عادات أقلع عنها</h4>
      <div id="home-bad-habits"></div>
    </section>

    <section class="card">
      <div class="section-header">
        <h2 class="card-title">المهام</h2>
        <a class="see-all-link" href="#/tasks">عرض الكل ←</a>
      </div>
      <h4 class="day-detail-subsection-title">📋 مهامك اليومية</h4>
      <div id="home-fixed-tasks"></div>
      <h4 class="day-detail-subsection-title">✅ قائمة المهام</h4>
      <div id="home-custom-todos"></div>
    </section>

    <section class="card">
      <div class="section-header">
        <h2 class="card-title">🎯 الأهداف</h2>
        <a class="see-all-link" href="#/goals">عرض الكل ←</a>
      </div>
      <p class="mini-progress-text home-goals-summary">${goalsGlanceText(activeGoals)}</p>
      <div id="home-goals-preview"></div>
    </section>

    <section class="card">
      <div class="section-header">
        <h2 class="card-title">🎓 التعلم</h2>
        <a class="see-all-link" href="#/study">عرض الكل ←</a>
      </div>
      <p class="mini-progress-text">${studyGlanceText(studyCourseCount, studyOpenTodoCount)}</p>
    </section>

    <button class="btn btn-secondary btn-block yearly-overview-btn" id="yearly-overview-btn">📊 نظرة على عامك</button>

    <p class="app-footer">🌸 رحلتي — نسخة محلية بالكامل، بياناتك لا تغادر هذا الجهاز</p>
  `;

  // Wire every listener FIRST, synchronously, while the DOM this function
  // just wrote is guaranteed to still be the DOM on screen. Awaiting the
  // rings mid-wiring (they now read from a dozen tables) left everything
  // after the await exposed to a newer navigation having replaced the view
  // underneath us — those getElementById calls would come back null.
  document.getElementById('header-settings').addEventListener('click', () => goTo('/settings'));
  document.getElementById('header-pfp').addEventListener('click', () => goTo('/settings'));
  document.getElementById('food-action').addEventListener('click', () => goTo('/food'));
  document.getElementById('worship-action').addEventListener('click', () => goTo('/worship'));
  document.getElementById('diary-action').addEventListener('click', () => goTo('/diary'));
  document.getElementById('period-action').addEventListener('click', () => goTo('/period'));
  document.getElementById('economy-action').addEventListener('click', () => goTo('/economy'));
  document.getElementById('body-action').addEventListener('click', () => goTo('/body'));
  document.getElementById('yearly-overview-btn').addEventListener('click', () => goTo('/yearly'));

  await renderHomeRingSection(document.getElementById('home-ring-section'));
  if (renderToken != null && !isCurrentRenderToken(renderToken)) return;

  view.querySelectorAll('[data-soon]').forEach(el => {
    el.addEventListener('click', () => toast('قيد التطوير - قريباً! 🌸'));
  });

  initHomeCalendar(document.getElementById('home-calendar'));

  const goodHabits = (await getActiveHabitsByType('good')).filter(isHabitVisibleOnHome).slice(0, 3);
  const badHabits = (await getActiveHabitsByType('bad')).filter(isHabitVisibleOnHome).slice(0, 3);

  // The guard above only covered the FIRST write. Everything below does
  // more awaiting and then writes into elements that a newer navigation
  // may already have torn out of the DOM — so re-check before touching it
  // again, or those writes land on null.
  if (renderToken != null && !isCurrentRenderToken(renderToken)) return;

  const refreshHomeRing = () => renderHomeRingSection(document.getElementById('home-ring-section'));
  await renderHabitCards(document.getElementById('home-good-habits'), goodHabits, { onChange: refreshHomeRing, emptyText: 'ما في عادات جيدة بعد.' });
  await renderHabitCards(document.getElementById('home-bad-habits'), badHabits, { onChange: refreshHomeRing, emptyText: 'ما في عادات للإقلاع عنها بعد.' });

  if (renderToken != null && !isCurrentRenderToken(renderToken)) return;
  await renderFixedTaskList(document.getElementById('home-fixed-tasks'), today, { editable: true, limit: 3, showManage: true, onChange: rescheduleHomeReminders });
  await renderTodoList(document.getElementById('home-custom-todos'), { limit: 3, onlyOpen: true, showManage: true });

  if (renderToken != null && !isCurrentRenderToken(renderToken)) return;
  await renderGoalsList(document.getElementById('home-goals-preview'), { limit: 2 });

  await rescheduleHomeReminders();
  checkAllMissedReminders();
}

// ---------- boot ----------

function registerAllReminderProviders() {
  // Fixed tasks — each task opts in individually via its own
  // reminderTime, same as before; this is just the same logic
  // expressed as a provider instead of being hard-coded into
  // reminders.js itself.
  registerReminderProvider(async (settings) => {
    if (settings?.remindersEnabled?.tasks === false) return [];
    const tasks = await getActiveFixedTasks();
    const doneSet = await getFixedTasksDoneSet(tasks, todayStr());
    return tasks
      .filter(t => t.reminderTime && !doneSet.has(t.id))
      .map(t => ({ time: t.reminderTime, title: 'رحلتي 🌸', body: `تذكير: ${t.title}` }));
  });

  registerReminderProvider(async (settings) => {
    if (!settings?.remindersEnabled?.water) return [];
    const [liters, target] = await Promise.all([getWaterForDate(todayStr()), getWaterTarget()]);
    if (liters >= target) return [];
    const time = settings.reminderTimes?.water || '15:00';
    return [{ time, title: 'رحلتي 🌸', body: 'حان وقت شرب الماء 💧' }];
  });

  registerReminderProvider(async (settings) => {
    if (!settings?.remindersEnabled) return [];
    const items = [];
    const today = todayStr();
    if (settings.remindersEnabled.adhkarMorning && !(await isDailyAdhkarDone('morning', today))) {
      items.push({ time: settings.reminderTimes?.adhkarMorning || '06:00', title: 'رحلتي 🌸', body: 'حان وقت أذكار الصباح 🌅' });
    }
    if (settings.remindersEnabled.adhkarEvening && !(await isDailyAdhkarDone('evening', today))) {
      items.push({ time: settings.reminderTimes?.adhkarEvening || '18:00', title: 'رحلتي 🌸', body: 'حان وقت أذكار المساء 🌙' });
    }
    return items;
  });

  registerReminderProvider(async (settings) => {
    if (!settings?.remindersEnabled?.wird) return [];
    const plan = await getWirdPlan();
    if (!plan || await isWirdLoggedToday()) return [];
    const time = settings.reminderTimes?.wird || '20:00';
    return [{ time, title: 'رحلتي 🌸', body: 'لا تنسي وردك اليوم 📖' }];
  });

  registerReminderProvider(async (settings) => {
    if (!settings?.remindersEnabled?.sleep) return [];
    const time = settings.reminderTimes?.sleep || '22:30';
    return [{ time, title: 'رحلتي 🌸', body: 'قرّب وقت النوم — جهّزي نفسك 😴' }];
  });
}

function registerAllDayProviders() {
  registerDayProvider(habitsDayProvider);
  registerDayProvider(fixedTasksDayProvider);
  registerDayProvider(todosDayProvider);
  registerDayProvider(fardDayProvider);
  registerDayProvider(worshipExtrasDayProvider);
  registerDayProvider(customAdhkarDayProvider);
  registerDayProvider(periodDayProvider);
  registerDayProvider(moodDayProvider);
  registerDayProvider(foodDayProvider);
  registerDayProvider(waterDayProvider);
  registerDayProvider(weightDayProvider);
  registerDayProvider(diaryDayProvider);
  registerDayProvider(ediblesDayProvider);
  registerDayProvider(thingsDayProvider);
  registerDayProvider(exercisesDayProvider);
  registerDayProvider(transactionsDayProvider);
  registerDayProvider(wirdDayProvider);
  registerDayProvider(courseTodosDayProvider);
  registerDayProvider(sleepDayProvider);
  registerDayProvider(dailyCareDayProvider);
  registerDayProvider(chewDayProvider);
}

function registerAllActivityProviders() {
  registerActivityProvider(async () => (await db.habitLogs.toArray()).map(l => l.date));
  registerActivityProvider(async () => (await db.fixedTaskLogs.toArray()).map(l => l.date));
  registerActivityProvider(async () => (await db.customTodos.toArray()).filter(t => t.dueDate).map(t => t.dueDate));
  registerActivityProvider(async () => (await db.prayerLogs.toArray()).map(l => l.date));
  registerActivityProvider(async () => (await db.sunnahLogs.toArray()).map(l => l.date));
  registerActivityProvider(async () => (await db.adhkarAfterLogs.toArray()).map(l => l.date));
  registerActivityProvider(async () => (await db.dailyAdhkarLogs.toArray()).map(l => l.date));
  registerActivityProvider(async () => (await db.customAdhkarLogs.toArray()).map(l => l.date));
  registerActivityProvider(async () => (await db.standaloneSunnahLogs.toArray()).map(l => l.date));
  registerActivityProvider(async () => (await db.wirdLogs.toArray()).map(l => l.date));
  registerActivityProvider(async () => (await db.courseTodos.toArray()).filter(t => t.dueDate).map(t => t.dueDate));
  registerActivityProvider(async () => (await db.sleepLogs.toArray()).map(l => l.date));
  registerActivityProvider(async () => (await db.dailyCareLogs.toArray()).map(l => l.date));
  registerActivityProvider(async () => (await db.chewSessions.toArray()).map(l => l.date));
  registerActivityProvider(async () => (await db.moodLogs.toArray()).map(l => l.date));
  registerActivityProvider(async () => (await db.foodLogs.toArray()).map(l => l.date));
  registerActivityProvider(async () => (await db.waterLogs.toArray()).filter(w => w.liters > 0).map(w => w.date));
  registerActivityProvider(async () => (await db.weightLogs.toArray()).map(l => l.date));
  registerActivityProvider(async () => (await db.bodyMeasurementLogs.toArray()).map(l => l.date));
  registerActivityProvider(async () => (await db.diaryEntries.toArray()).map(e => e.date));
  registerActivityProvider(async () => (await db.edibles.toArray()).map(e => e.date));
  registerActivityProvider(async () => (await db.things.toArray()).map(t => t.date));
  registerActivityProvider(async () => (await db.exerciseLogs.toArray()).filter(l => l.sets > 0).map(l => l.date));
  registerActivityProvider(async () => (await db.economyTransactions.toArray()).map(t => t.date));
  registerActivityProvider(async () => {
    const periods = await db.periodLogs.toArray();
    const today = todayStr();
    const dates = [];
    periods.forEach(p => {
      let d = p.startDate;
      const end = p.endDate || today;
      while (d <= end) { dates.push(d); d = addDays(d, 1); }
    });
    return dates;
  });
}

function registerAllYearlyStatsProviders() {
  registerYearlyStatsProvider(habitsYearlyProvider);
  registerYearlyStatsProvider(tasksYearlyProvider);
  registerYearlyStatsProvider(todosYearlyProvider);
  registerYearlyStatsProvider(worshipYearlyProvider);
  registerYearlyStatsProvider(moodYearlyProvider);
  registerYearlyStatsProvider(periodYearlyProvider);
  registerYearlyStatsProvider(foodYearlyProvider);
  registerYearlyStatsProvider(bodyYearlyProvider);
  registerYearlyStatsProvider(goalsYearlyProvider);
  registerYearlyStatsProvider(diaryYearlyProvider);
  registerYearlyStatsProvider(economyYearlyProvider);
  registerYearlyStatsProvider(trainingYearlyProvider);
  registerYearlyStatsProvider(wirdYearlyProvider);
  registerYearlyStatsProvider(studyYearlyProvider);
  registerYearlyStatsProvider(sleepYearlyProvider);
  registerYearlyStatsProvider(qadaYearlyProvider);
  registerYearlyStatsProvider(dailyCareYearlyProvider);
  registerYearlyStatsProvider(recipesYearlyProvider);
  registerYearlyStatsProvider(chewYearlyProvider);
}

async function renderBottomBar() {
  const container = document.getElementById('bottom-bar');
  if (!container) return;
  const settings = await db.settings.get(1);
  const view = document.getElementById('view');

  if (settings?.bottomBarEnabled === false) {
    container.innerHTML = '';
    container.classList.add('hidden');
    if (view) view.classList.remove('has-bottom-bar');
    return;
  }
  container.classList.remove('hidden');
  if (view) view.classList.add('has-bottom-bar');

  const enabledKeys = settings?.bottomBarItems || BOTTOM_BAR_ITEMS.map(i => i.key);
  const items = BOTTOM_BAR_ITEMS.filter(i => enabledKeys.includes(i.key));
  const currentBase = '/' + (currentPath().split('/').filter(Boolean)[0] || 'home');

  container.innerHTML = items.map(i => `
    <button class="bottom-bar-item ${currentBase === i.path ? 'active' : ''}" data-path="${i.path}">
      <span class="bottom-bar-icon">${i.icon}</span>
      <span class="bottom-bar-label">${i.label}</span>
    </button>`).join('');
  container.querySelectorAll('.bottom-bar-item').forEach(btn => {
    btn.addEventListener('click', () => goTo(btn.dataset.path));
  });
}

function startApp(profile, settings) {
  registerAllDayProviders();
  registerAllActivityProviders();
  registerAllYearlyStatsProviders();
  registerAllReminderProviders();
  route('/home', renderHome);
  route('/habits', renderHabitsPage);
  route('/tasks', renderTasksPage);
  route('/worship', renderWorshipPage);
  route('/period', renderPeriodPage);
  route('/mood-history', renderMoodHistoryPage);
  route('/food', renderFoodPage);
  route('/body', renderBodyPage);
  route('/goals', renderGoalsPage);
  route('/diary', renderDiaryPage);
  route('/economy', renderEconomyPage);
  route('/shopping-lists', renderShoppingListsPage);
  route('/transactions', renderTransactionsPage);
  route('/edibles', renderEdiblesPage);
  route('/edibles-wishlist', renderEdibleWishlistPage);
  route('/things', renderThingsPage);
  route('/things-wishlist', renderThingsWishlistPage);
  route('/recipes', renderRecipesPage);
  route('/training', renderTrainingPage);
  route('/study', renderStudyPage);
  route('/course', renderCoursePage);
  route('/adhkar-detail', renderAdhkarDetailPage);
  route('/sleep', renderSleepPage);
  route('/dailycare', renderDailyCarePage);
  route('/yearly', renderYearlyOverviewPage);
  route('/settings', renderSettingsPage);
  route('/theme-editor', renderThemeEditorPage);

  document.getElementById('app-root').innerHTML = '<div id="view"></div><nav id="bottom-bar"></nav>';
  renderRoute();
  renderBottomBar();
  window.addEventListener('hashchange', renderBottomBar);

  document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState === 'visible') {
      checkAllMissedReminders();
      if (currentPath() === '/home') renderRoute();
    }
  });

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(err => console.error('Service worker registration failed:', err));
  }
}

async function boot() {
  // Before anything renders: no screen should paint in one numeral system
  // and then flip to the other a frame later.
  const settings = await db.settings.get(1);
  setNumeralMode(settings?.useArabicNumerals !== false);

  await applyStoredTheme();
  const profile = await db.profile.get(1);
  if (!profile) {
    renderSetupWizard();
    return;
  }
  if (settings?.pinEnabled && !sessionStorage.getItem('rahlati_unlocked')) {
    renderLockScreen(profile, () => {
      sessionStorage.setItem('rahlati_unlocked', '1');
      startApp(profile, settings);
    });
    return;
  }
  startApp(profile, settings);
}

document.addEventListener('DOMContentLoaded', boot);
