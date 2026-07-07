// app.js — boots the app, wires routes, registers Day Detail providers,
// and renders Home. This is the one file that knows about every module;
// every other file only knows about db.js/streaks.js/router.js.
// (renderRing lives in ui-shared.js now — Worship needs it too.)

async function rescheduleHomeReminders() {
  const tasks = await getActiveFixedTasks();
  const doneSet = await getFixedTasksDoneSet(tasks, todayStr());
  const isDoneToday = (id) => doneSet.has(id);
  scheduleTodayReminders(tasks, isDoneToday);
  return isDoneToday;
}

async function renderHome(params, view) {
  const profile = await db.profile.get(1);
  const today = todayStr();
  const ringData = await getHabitsRingData();
  const fixedTasks = await getActiveFixedTasks();
  const doneSet = await getFixedTasksDoneSet(fixedTasks, today);
  const doneTaskCount = doneSet.size;
  const worshipStats = await getWorshipTodayStats();
  const periodStatus = await getPeriodStatus();
  const foodStats = await getFoodTodayStats();
  const weightStats = await getWeightStats();
  const activeGoals = await getActiveGoals();

  const habitDoneFrac = ringData.total ? ringData.done / ringData.total : 0;
  const habitMissedFrac = ringData.total ? ringData.missed / ringData.total : 0;
  const ringSvg = renderRing({
    segments: [
      { frac: habitDoneFrac, color: 'var(--mint-deep)' },
      { frac: habitMissedFrac, color: 'var(--rose-deep)' }
    ]
  });

  view.innerHTML = `
    <header class="home-header">
      <button class="pfp-preview pfp-small" id="header-pfp" aria-label="الإعدادات">${profile.pictureBlob ? `<img src="${pictureUrl(profile.pictureBlob)}" alt="">` : '🌸'}</button>
      <div class="home-header-text">
        <h1 class="greeting-line">${greetingWord()}، ${escapeHtml(profile.name)} 🌸</h1>
        <p class="greeting-sub">${escapeHtml(pickWelcomePhrase())}</p>
      </div>
      <button class="icon-btn" id="header-settings" aria-label="الإعدادات">⚙️</button>
    </header>

    <section class="card rings-card">
      <div class="rings-row">
        <div class="ring-wrap">
          ${ringSvg}
          <div class="ring-center-text">${ringData.total ? `${ringData.done}/${ringData.total}` : '—'}</div>
        </div>
        <div class="ring-label-block">
          <p class="ring-label">عاداتك اليوم</p>
          ${fixedTasks.length ? `
            <div class="mini-progress">
              <div class="mini-progress-track"><div class="mini-progress-fill" style="width:${doneTaskCount / fixedTasks.length * 100}%"></div></div>
              <span class="mini-progress-text">مهامك: ${doneTaskCount}/${fixedTasks.length}</span>
            </div>` : `<span class="mini-progress-text">أضيفي مهمة ثابتة من قسم المهام 👇</span>`}
        </div>
      </div>
    </section>

    <section class="quick-actions-row">
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
    </section>

    <section class="card">
      <div id="home-calendar"></div>
    </section>

    <section class="glance-row">
      <button class="glance-card" id="period-action">
        <span class="glance-icon">🌙</span>
        <span class="glance-label">الدورة الشهرية</span>
        <span class="quick-action-stat">${periodGlanceText(periodStatus)}</span>
      </button>
      <button class="glance-card" id="body-action">
        <span class="glance-icon">⚖️</span>
        <span class="glance-label">الوزن والمزاج</span>
        <span class="quick-action-stat">${weightGlanceText(weightStats)}</span>
      </button>
    </section>

    <section class="card">
      <div class="section-header">
        <h2 class="card-title">العادات</h2>
        <a class="see-all-link" href="#/habits">عرض الكل ←</a>
      </div>
      <div id="home-habits-preview"></div>
    </section>

    <section class="card">
      <div class="section-header">
        <h2 class="card-title">المهام</h2>
        <a class="see-all-link" href="#/tasks">عرض الكل ←</a>
      </div>
      <div id="home-tasks-preview"></div>
    </section>

    <button class="card goals-card-btn" id="goals-card">
      <span class="quick-action-icon">🎯</span>
      <p class="card-title">الأهداف</p>
      <span class="quick-action-stat">${goalsGlanceText(activeGoals)}</span>
    </button>

    <button class="btn btn-secondary btn-block yearly-overview-btn" id="yearly-overview-btn">📊 نظرة على عامك</button>

    <p class="app-footer">🌸 رحلتي — نسخة محلية بالكامل، بياناتك لا تغادر هذا الجهاز</p>
  `;

  document.getElementById('header-settings').addEventListener('click', () => goTo('/settings'));
  document.getElementById('header-pfp').addEventListener('click', () => goTo('/settings'));
  document.getElementById('food-action').addEventListener('click', () => goTo('/food'));
  document.getElementById('worship-action').addEventListener('click', () => goTo('/worship'));
  document.getElementById('period-action').addEventListener('click', () => goTo('/period'));
  document.getElementById('body-action').addEventListener('click', () => goTo('/body'));
  document.getElementById('goals-card').addEventListener('click', () => goTo('/goals'));
  document.getElementById('yearly-overview-btn').addEventListener('click', () => goTo('/yearly'));
  view.querySelectorAll('[data-soon]').forEach(el => {
    el.addEventListener('click', () => toast('قيد التطوير - قريباً! 🌸'));
  });

  initHomeCalendar(document.getElementById('home-calendar'));
  await renderHabitList(document.getElementById('home-habits-preview'), today, { editable: true, showStreak: true, limit: 3 });
  await renderFixedTaskList(document.getElementById('home-tasks-preview'), today, { editable: true, limit: 4, onChange: rescheduleHomeReminders });

  const isDoneToday = await rescheduleHomeReminders();
  checkMissedReminders(fixedTasks, isDoneToday);
}

// ---------- boot ----------

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
  registerActivityProvider(async () => (await db.moodLogs.toArray()).map(l => l.date));
  registerActivityProvider(async () => (await db.foodLogs.toArray()).map(l => l.date));
  registerActivityProvider(async () => (await db.waterLogs.toArray()).filter(w => w.liters > 0).map(w => w.date));
  registerActivityProvider(async () => (await db.weightLogs.toArray()).map(l => l.date));
  registerActivityProvider(async () => (await db.bodyMeasurementLogs.toArray()).map(l => l.date));
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
}

function startApp(profile, settings) {
  registerAllDayProviders();
  registerAllActivityProviders();
  registerAllYearlyStatsProviders();
  route('/home', renderHome);
  route('/habits', renderHabitsPage);
  route('/tasks', renderTasksPage);
  route('/worship', renderWorshipPage);
  route('/period', renderPeriodPage);
  route('/mood-history', renderMoodHistoryPage);
  route('/food', renderFoodPage);
  route('/body', renderBodyPage);
  route('/goals', renderGoalsPage);
  route('/yearly', renderYearlyOverviewPage);
  route('/settings', renderSettingsPage);

  document.getElementById('app-root').innerHTML = '<div id="view"></div>';
  renderRoute();

  document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState === 'visible') {
      const tasks = await getActiveFixedTasks();
      const doneSet = await getFixedTasksDoneSet(tasks, todayStr());
      checkMissedReminders(tasks, (id) => doneSet.has(id));
      if (currentPath() === '/home') renderRoute();
    }
  });

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(err => console.error('Service worker registration failed:', err));
  }
}

async function boot() {
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
