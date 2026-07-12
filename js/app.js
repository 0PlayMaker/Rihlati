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
function smallRingHtml(frac, label, centerText, path, tone) {
  const color = tone === 'period' ? 'var(--pink-deep)'
    : tone === 'late' ? 'var(--warning-strong)'
    : 'var(--btn-color, var(--pink-deep))';
  const svg = renderRing({ size: 62, strokeWidth: 8, segments: [{ frac, color }] });
  return `
    <button class="small-ring-item small-ring-item-tappable" data-path="${path}" aria-label="${label}">
      <div class="ring-wrap small-ring-wrap">
        ${svg}
        <div class="ring-center-text small-ring-text">${centerText}</div>
      </div>
      <span class="small-ring-label">${label}</span>
    </button>`;
}

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
    return { frac: 0, center: '—', label: '🌸 الدورة', tone: 'neutral' };
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
    tone: 'neutral'
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

async function renderHomeSmallRings() {
  const today = todayStr();
  const [morningRoutines, eveningRoutines] = await Promise.all([
    getCareRoutines('morning'), getCareRoutines('evening')
  ]);
  const [morningDone, eveningDone] = await Promise.all([
    countCareRoutinesDone(morningRoutines, today),
    countCareRoutinesDone(eveningRoutines, today)
  ]);
  const period = await buildPeriodRingData();
  const health = await buildHealthRingData();

  return `
    <div class="small-rings-row">
      ${smallRingHtml(
        morningRoutines.length ? morningDone / morningRoutines.length : 0,
        '🌅 صباحي',
        morningRoutines.length ? `${toArabicNumeral(morningDone)}/${toArabicNumeral(morningRoutines.length)}` : '—',
        '/dailycare'
      )}
      ${smallRingHtml(
        eveningRoutines.length ? eveningDone / eveningRoutines.length : 0,
        '🌙 مسائي',
        eveningRoutines.length ? `${toArabicNumeral(eveningDone)}/${toArabicNumeral(eveningRoutines.length)}` : '—',
        '/dailycare'
      )}
    </div>
    <div class="small-rings-row">
      ${smallRingHtml(period.frac, period.label, period.center, '/period', period.tone)}
      ${smallRingHtml(health.frac, health.label, health.center, '/body')}
    </div>`;
}
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

async function renderHomeRingSection(container) {
  if (!container) return; // page was replaced mid-render
  const today = todayStr();
  const ringData = await getHabitsRingData();
  // Only the tasks she asked to be counted feed this ring.
  const trackedTasks = await getTrackedFixedTasks();
  const taskDoneSet = await getFixedTasksDoneSet(trackedTasks, today);
  const doneTaskCount = taskDoneSet.size;

  const worshipStats = await getWorshipTodayStats();
  const last7DaysMood = await getLast7DaysMood();
  const [goodStreak, badStreak] = await Promise.all([getTopHabitStreak('good'), getTopHabitStreak('bad')]);

  const habitDoneFrac = ringData.total ? ringData.done / ringData.total : 0;
  const habitMissedFrac = ringData.total ? ringData.missed / ringData.total : 0;
  const habitRing = renderRing({
    segments: [
      { frac: habitDoneFrac, color: 'var(--mint-deep)' },
      { frac: habitMissedFrac, color: 'var(--rose-deep)' }
    ]
  });
  const taskFrac = trackedTasks.length ? doneTaskCount / trackedTasks.length : 0;
  const taskRing = renderRing({
    segments: [{ frac: taskFrac, color: 'var(--btn-color, var(--pink-deep))' }]
  });

  const smallRings = await renderHomeSmallRings();
  const chips = await buildRemainingTodayChips();

  container.innerHTML = `
    <div class="rings-row">
      <button class="ring-item ring-item-tappable" data-path="/habits" aria-label="عاداتك">
        <div class="ring-wrap">
          ${habitRing}
          <div class="ring-center-text">${ringData.total ? `${toArabicNumeral(ringData.done)}/${toArabicNumeral(ringData.total)}` : '—'}</div>
        </div>
        <span class="ring-label">عاداتك</span>
      </button>
      <button class="ring-item ring-item-tappable" data-path="/tasks" aria-label="مهامك">
        <div class="ring-wrap">
          ${taskRing}
          <div class="ring-center-text">${trackedTasks.length ? `${toArabicNumeral(doneTaskCount)}/${toArabicNumeral(trackedTasks.length)}` : '—'}</div>
        </div>
        <span class="ring-label">مهامك</span>
      </button>
    </div>

    ${smallRings}

    ${chips.length ? `
      <div class="remaining-today">
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
        ${goodStreak ? `<span class="streak-chip">${goodStreak.emoji} ${escapeHtml(goodStreak.name)} 🔥${goodStreak.streak}</span>` : ''}
        ${badStreak ? `<span class="streak-chip">🚫 ${escapeHtml(badStreak.name)} 🔥${badStreak.streak}</span>` : ''}
        ${worshipStats.streak > 0 ? `<span class="streak-chip">🕌 صلوات 🔥${worshipStats.streak}</span>` : ''}
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

  document.getElementById('header-settings').addEventListener('click', () => goTo('/settings'));
  await renderHomeRingSection(document.getElementById('home-ring-section'));
  document.getElementById('header-pfp').addEventListener('click', () => goTo('/settings'));
  document.getElementById('food-action').addEventListener('click', () => goTo('/food'));
  document.getElementById('worship-action').addEventListener('click', () => goTo('/worship'));
  document.getElementById('diary-action').addEventListener('click', () => goTo('/diary'));
  document.getElementById('period-action').addEventListener('click', () => goTo('/period'));
  document.getElementById('economy-action').addEventListener('click', () => goTo('/economy'));
  document.getElementById('body-action').addEventListener('click', () => goTo('/body'));
  document.getElementById('yearly-overview-btn').addEventListener('click', () => goTo('/yearly'));
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
  await applyStoredTheme();
  const profile = await db.profile.get(1);
  if (!profile) {
    renderSetupWizard();
    return;
  }
  const settings = await db.settings.get(1);
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
