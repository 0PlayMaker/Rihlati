// chewing.js — وضع المضغ (mindful / slow eating).
//
// WHY THIS EXISTS: satiety hormones take roughly twenty minutes to
// register. A meal inhaled in five is one you finish still hungry, and
// then eat again. So the app can't just count calories at you — it can
// help you actually SLOW DOWN, which is the part that works.
//
// The pacer runs a three-phase loop until the meal's target duration is
// reached:
//   امضغي (chew)  ->  ابلعي (swallow)  ->  استراحة (rest)  ->  repeat
//
// TIMING: driven entirely by absolute timestamps (phaseEndsAt,
// mealEndsAt), never by counting interval ticks. A meal pacer that a
// backgrounded tab can silently desync is worse than no pacer at all —
// it would confidently tell you you'd eaten for twenty minutes when you
// hadn't. Same wall-clock rule as every other timer in this app.

const CHEW_DEFAULTS = { chewSeconds: 30, restSeconds: 10, mealMinutes: 20 };

const CHEW_PRESETS = [
  { key: 'gentle', label: 'لطيف', chewSeconds: 20, restSeconds: 8, mealMinutes: 15, note: 'بداية سهلة' },
  { key: 'balanced', label: 'متوازن', chewSeconds: 30, restSeconds: 10, mealMinutes: 20, note: 'الموصى به' },
  { key: 'mindful', label: 'متأنٍّ', chewSeconds: 40, restSeconds: 15, mealMinutes: 30, note: 'أبطأ وأعمق' }
];

// ---------- settings ----------

async function getChewSettings() {
  const s = await db.settings.get(1);
  return {
    chewSeconds: s?.chewSeconds ?? CHEW_DEFAULTS.chewSeconds,
    restSeconds: s?.chewRestSeconds ?? CHEW_DEFAULTS.restSeconds,
    mealMinutes: s?.chewMealMinutes ?? CHEW_DEFAULTS.mealMinutes,
    soundOn: s?.chewSoundOn !== false // default ON
  };
}
async function saveChewSettings({ chewSeconds, restSeconds, mealMinutes, soundOn }) {
  const patch = {};
  if (chewSeconds != null) patch.chewSeconds = chewSeconds;
  if (restSeconds != null) patch.chewRestSeconds = restSeconds;
  if (mealMinutes != null) patch.chewMealMinutes = mealMinutes;
  if (soundOn != null) patch.chewSoundOn = !!soundOn;
  await db.settings.update(1, patch);
}

// ---------- sessions ----------

async function logChewSession({ foodLogId, chewSeconds, restSeconds, mealMinutes, bites, actualSeconds, completed, avgChewMs, targetChewMs }) {
  return db.chewSessions.add({
    date: todayStr(),
    foodLogId: foodLogId ?? null,
    chewSeconds, restSeconds, mealMinutes,
    bites,
    actualSeconds,
    // How long she ACTUALLY chewed per bite vs how long she was asked to.
    // A session where every bite was cut short at 8s out of 30 is not a
    // slow meal, however long she sat there.
    avgChewMs: avgChewMs ?? null,
    targetChewMs: targetChewMs ?? null,
    completed: !!completed,
    createdAt: Date.now()
  });
}
async function getChewSessions() {
  return db.chewSessions.toArray();
}
async function getChewSessionsForDate(dateStr) {
  return db.chewSessions.where('date').equals(dateStr).toArray();
}
async function getChewSessionForMeal(foodLogId) {
  const rows = await db.chewSessions.where('foodLogId').equals(foodLogId).toArray();
  return rows.length ? rows[rows.length - 1] : null;
}
async function getChewStreak() {
  const rows = await getChewSessions();
  return computeCurrentStreak(rows.map(r => r.date), []);
}

function formatChewDuration(totalSec) {
  const m = Math.floor(totalSec / 60);
  const s = Math.round(totalSec % 60);
  if (m === 0) return `${toArabicNumeral(s)} ث`;
  return `${toArabicNumeral(m)}:${String(s).padStart(2, '0').replace(/[0-9]/g, d => '٠١٢٣٤٥٦٧٨٩'[Number(d)])}`;
}

// ============================================================
//  The pacer itself
// ============================================================

const CHEW_PHASES = {
  chew:    { label: 'امضغي', hint: 'ببطء… وبتركيز', tone: 'chew' },
  swallow: { label: 'ابلعي', hint: 'خذي نفساً', tone: 'swallow' },
  rest:    { label: 'استراحة', hint: 'ضعي الملعقة', tone: 'rest' },
  done:    { label: 'انتهت الوجبة', hint: 'أحسنتِ 🌿', tone: 'done' }
};
const SWALLOW_MS = 1600; // long enough to see the animation and mean it

function openChewingPacer({ foodLog, chewSeconds, restSeconds, mealMinutes, soundOn, onFinished }) {
  let phase = 'chew';
  let bites = 0;
  const biteChewMs = [];      // how long each bite was ACTUALLY chewed
  let chewPhaseStartedAt = Date.now();
  let intervalId = null;
  let chewTickTimer = null;
  let phaseEndsAt = Date.now() + chewSeconds * 1000;
  const mealStartedAt = Date.now();
  const mealEndsAt = mealStartedAt + mealMinutes * 60 * 1000;
  let finished = false;

  const RING_R = 96;
  const CIRC = 2 * Math.PI * RING_R;

  const overlay = document.createElement('div');
  overlay.className = 'chew-overlay';
  overlay.innerHTML = `
    <div class="chew-screen">
      <button class="icon-btn chew-close" id="chew-close" aria-label="إنهاء">✕</button>

      <p class="chew-meal-name">${foodLog ? `${mealTypeIcon(foodLog.mealType)} ${escapeHtml(foodLog.notes || mealTypeLabel(foodLog.mealType))}` : '🍽️ وجبتك'}</p>

      <div class="chew-stage">
        <svg class="chew-ring" viewBox="0 0 220 220" aria-hidden="true">
          <circle class="chew-ring-track" cx="110" cy="110" r="${RING_R}"/>
          <circle class="chew-ring-fill" id="chew-ring-fill" cx="110" cy="110" r="${RING_R}"/>
        </svg>

        <div class="chew-blob" id="chew-blob">
          <div class="chew-blob-inner">
            <span class="chew-emoji" id="chew-emoji">😋</span>
          </div>
        </div>

        <span class="chew-droplet" id="chew-droplet"></span>
      </div>

      <p class="chew-phase" id="chew-phase">${CHEW_PHASES.chew.label}</p>
      <p class="chew-hint" id="chew-hint">${CHEW_PHASES.chew.hint}</p>
      <p class="chew-count" id="chew-count">٠٠</p>

      <div class="chew-meta">
        <div class="chew-meta-item">
          <span class="chew-meta-num" id="chew-bites">٠</span>
          <span class="chew-meta-label">لقمة</span>
        </div>
        <div class="chew-meta-item">
          <span class="chew-meta-num" id="chew-elapsed">٠:٠٠</span>
          <span class="chew-meta-label">من ${toArabicNumeral(mealMinutes)} د</span>
        </div>
      </div>

      <div class="chew-meal-track"><div class="chew-meal-fill" id="chew-meal-fill"></div></div>

      <button class="btn btn-primary btn-block chew-swallow-btn" id="chew-swallowed">🫗 بلعت</button>
      <p class="chew-swallow-hint">اضغطي حين تبلعين فعلاً — المؤقّت اقتراح، وفمك هو الحقيقة</p>

      <div class="chew-actions">
        <button class="btn btn-text" id="chew-sound-toggle">${soundOn ? '🔊' : '🔇'}</button>
        <button class="btn btn-secondary" id="chew-finish">إنهاء الوجبة</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  const ringFill = overlay.querySelector('#chew-ring-fill');
  const blob = overlay.querySelector('#chew-blob');
  const emoji = overlay.querySelector('#chew-emoji');
  const droplet = overlay.querySelector('#chew-droplet');
  const phaseEl = overlay.querySelector('#chew-phase');
  const hintEl = overlay.querySelector('#chew-hint');
  const countEl = overlay.querySelector('#chew-count');
  const bitesEl = overlay.querySelector('#chew-bites');
  const elapsedEl = overlay.querySelector('#chew-elapsed');
  const mealFill = overlay.querySelector('#chew-meal-fill');
  const screen = overlay.querySelector('.chew-screen');
  ringFill.style.strokeDasharray = String(CIRC);

  let sound = soundOn;

  function setPhaseClass(p) {
    screen.classList.remove('chew-mode-chew', 'chew-mode-swallow', 'chew-mode-rest', 'chew-mode-done');
    screen.classList.add('chew-mode-' + p);
  }
  setPhaseClass('chew');

  // The chew tick is fired on its own rhythm, matched to the animation, so
  // the sound and the squish stay in sync. Cleared whenever we leave the
  // chew phase — a tick during "rest" would be nonsense.
  function startChewTicks() {
    stopChewTicks();
    if (!sound) return;
    chewTickTimer = setInterval(() => {
      if (phase !== 'chew') return;
      playChewTick();
      haptic([12], 'chewTick'); // off by default — a buzz twice a second for
                                // twenty minutes is a lot to ask of anyone
    }, 550);
  }
  function stopChewTicks() {
    if (chewTickTimer) { clearInterval(chewTickTimer); chewTickTimer = null; }
  }

  function enterPhase(next) {
    phase = next;
    setPhaseClass(next);
    phaseEl.textContent = CHEW_PHASES[next].label;
    hintEl.textContent = CHEW_PHASES[next].hint;

    blob.classList.toggle('chewing', next === 'chew');
    blob.classList.toggle('swallowing', next === 'swallow');
    blob.classList.toggle('resting', next === 'rest');

    if (next === 'chew') {
      emoji.textContent = '😋';
      chewPhaseStartedAt = Date.now();
      phaseEndsAt = Date.now() + chewSeconds * 1000;
      startChewTicks();
    } else if (next === 'swallow') {
      emoji.textContent = '😌';
      stopChewTicks();
      // How long this bite was actually chewed — she may have swallowed
      // early, and that's the number worth knowing.
      biteChewMs.push(Math.max(0, Date.now() - chewPhaseStartedAt));
      phaseEndsAt = Date.now() + SWALLOW_MS;
      bites += 1;
      bitesEl.textContent = toArabicNumeral(bites);
      if (sound) playSwallowSound();
      haptic([40, 40, 70], 'chewSwallow');
      // The droplet slides down: the one motion that reads as "swallow"
      // without needing a caption.
      droplet.classList.remove('chew-droplet-go');
      void droplet.offsetWidth; // restart the animation
      droplet.classList.add('chew-droplet-go');
    } else if (next === 'rest') {
      emoji.textContent = '🌿';
      stopChewTicks();
      phaseEndsAt = Date.now() + restSeconds * 1000;
    }
  }

  function paintRing(remainingMs, totalMs) {
    const frac = totalMs > 0 ? Math.max(0, Math.min(1, remainingMs / totalMs)) : 0;
    ringFill.style.strokeDashoffset = String(CIRC * (1 - frac));
  }

  function tick() {
    if (finished) return;
    const now = Date.now();

    // Meal over? That decision is made against the wall clock, so a
    // backgrounded tab can't stretch or shrink the meal.
    if (now >= mealEndsAt) { finish(true); return; }

    const remaining = Math.max(0, phaseEndsAt - now);
    const totalMs = phase === 'chew' ? chewSeconds * 1000
      : phase === 'swallow' ? SWALLOW_MS
      : restSeconds * 1000;

    paintRing(remaining, totalMs);
    countEl.textContent = phase === 'swallow'
      ? '…'
      : toArabicNumeral(String(Math.ceil(remaining / 1000)).padStart(2, '0'));

    const elapsed = Math.floor((now - mealStartedAt) / 1000);
    elapsedEl.textContent = formatChewDuration(elapsed);
    mealFill.style.width = `${Math.min(100, ((now - mealStartedAt) / (mealEndsAt - mealStartedAt)) * 100)}%`;

    if (remaining <= 0) {
      if (phase === 'chew') enterPhase('swallow');
      else if (phase === 'swallow') enterPhase('rest');
      else if (phase === 'rest') enterPhase('chew');
    }
  }

  async function finish(completed) {
    if (finished) return;
    finished = true;
    stopChewTicks();
    if (intervalId) { clearInterval(intervalId); intervalId = null; }

    const actualSeconds = Math.round((Date.now() - mealStartedAt) / 1000);
    setPhaseClass('done');
    blob.classList.remove('chewing', 'swallowing', 'resting');
    emoji.textContent = '🌿';
    phaseEl.textContent = CHEW_PHASES.done.label;
    hintEl.textContent = CHEW_PHASES.done.hint;
    countEl.textContent = '';
    if (completed) playEventChime('chewMeal', { hapticPattern: [90, 50, 90, 50, 160], hapticEvent: 'completion' });

    // avgChewMs is the number that actually says whether she chewed, as
    // opposed to whether she sat in front of a timer for twenty minutes.
    const avgChewMs = biteChewMs.length
      ? Math.round(biteChewMs.reduce((s, x) => s + x, 0) / biteChewMs.length)
      : 0;
    await logChewSession({
      foodLogId: foodLog ? foodLog.id : null,
      chewSeconds, restSeconds, mealMinutes,
      bites, actualSeconds, completed,
      avgChewMs, targetChewMs: chewSeconds * 1000
    });

    // A short beat so the "done" state is actually seen, rather than the
    // screen vanishing the instant the last second ticks over.
    setTimeout(() => {
      overlay.remove();
      if (onFinished) onFinished({ bites, actualSeconds, completed });
    }, completed ? 1400 : 200);
  }

  overlay.querySelector('#chew-sound-toggle').addEventListener('click', async (e) => {
    sound = !sound;
    e.currentTarget.textContent = sound ? '🔊' : '🔇';
    await saveChewSettings({ soundOn: sound });
    if (sound && phase === 'chew') startChewTicks(); else stopChewTicks();
  });
  overlay.querySelector('#chew-swallowed').addEventListener('click', () => {
    // Only meaningful mid-chew; during rest/swallow it's a no-op.
    if (phase !== 'chew') return;
    enterPhase('swallow');
  });
  overlay.querySelector('#chew-finish').addEventListener('click', () => finish(false));
  overlay.querySelector('#chew-close').addEventListener('click', () => finish(false));

  // Audio must be unlocked inside the real tap that opened this.
  unlockAudioContext();
  enterPhase('chew');
  intervalId = setInterval(tick, 200);
  tick();

  // The pacer must never outlive the page.
  registerCleanup(() => {
    stopChewTicks();
    if (intervalId) clearInterval(intervalId);
    overlay.remove();
  });
}

// ============================================================
//  Setup modal: pick the meal, then the pace
// ============================================================

async function openChewSetupModal(onDone) {
  const settings = await getChewSettings();
  const today = todayStr();
  const meals = await getFoodLogsForDate(today);

  // Which meals already have a session — so she doesn't accidentally
  // double-pace one, and can see which she's already done.
  const paced = new Set();
  for (const m of meals) {
    if (await getChewSessionForMeal(m.id)) paced.add(m.id);
  }

  let selectedMealId = meals.length ? meals[meals.length - 1].id : null; // newest by default
  let chewSeconds = settings.chewSeconds;
  let restSeconds = settings.restSeconds;
  let mealMinutes = settings.mealMinutes;

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal modal-lg">
      <h2 class="modal-title">🍽️ وضع المضغ</h2>
      <p class="settings-note">إشارات الشبع تصل بعد ~٢٠ دقيقة. الأكل ببطء ليس تقييداً — بل إعطاء جسمك وقتاً ليقول لكِ إنّه اكتفى.</p>

      <label class="field-label">لأي وجبة؟</label>
      <div class="chew-meal-list" id="chew-meal-list">
        ${meals.length ? meals.map(m => `
          <button class="chew-meal-option ${m.id === selectedMealId ? 'active' : ''}" data-meal="${m.id}">
            <span class="chew-meal-icon">${mealTypeIcon(m.mealType)}</span>
            <span class="chew-meal-text">
              <span class="chew-meal-title">${escapeHtml(m.notes || mealTypeLabel(m.mealType))}</span>
              <span class="chew-meal-sub">${mealTypeLabel(m.mealType)}${m.calories ? ` · ${toArabicNumeral(m.calories)} سعرة` : ''}</span>
            </span>
            ${paced.has(m.id) ? '<span class="chew-meal-badge">✓</span>' : ''}
          </button>`).join('')
        : '<p class="empty-state-sub">ما في وجبات مسجّلة اليوم.</p>'}
      </div>
      <button class="btn btn-secondary btn-block chew-new-meal-btn" id="chew-new-meal">＋ تسجيل وجبة جديدة</button>

      <label class="field-label">الإيقاع</label>
      <div class="chew-preset-grid" id="chew-presets">
        ${CHEW_PRESETS.map(p => `
          <button class="chew-preset ${p.chewSeconds === chewSeconds && p.mealMinutes === mealMinutes ? 'active' : ''}" data-preset="${p.key}">
            <span class="chew-preset-name">${p.label}</span>
            <span class="chew-preset-nums">${toArabicNumeral(p.chewSeconds)} ث · ${toArabicNumeral(p.mealMinutes)} د</span>
            <span class="chew-preset-note">${p.note}</span>
          </button>`).join('')}
      </div>

      <details class="pomo-settings">
        <summary>ضبط دقيق</summary>
        <div class="chew-fine-row">
          <div class="chew-fine-field">
            <label class="field-label">مدّة المضغ (ثانية)</label>
            <input class="text-input" type="text" inputmode="numeric" id="chew-sec-input" value="${toArabicNumeral(chewSeconds)}">
          </div>
          <div class="chew-fine-field">
            <label class="field-label">الاستراحة (ثانية)</label>
            <input class="text-input" type="text" inputmode="numeric" id="chew-rest-input" value="${toArabicNumeral(restSeconds)}">
          </div>
          <div class="chew-fine-field">
            <label class="field-label">مدّة الوجبة (دقيقة)</label>
            <input class="text-input" type="text" inputmode="numeric" id="chew-meal-input" value="${toArabicNumeral(mealMinutes)}">
          </div>
        </div>
      </details>

      <div class="modal-actions">
        <button class="btn btn-text" id="chew-cancel">إلغاء</button>
        <button class="btn btn-primary" id="chew-start">ابدئي 🌿</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  function wireMealOptions() {
    overlay.querySelectorAll('.chew-meal-option').forEach(btn => {
      btn.addEventListener('click', () => {
        selectedMealId = Number(btn.dataset.meal);
        overlay.querySelectorAll('.chew-meal-option').forEach(b => b.classList.toggle('active', b === btn));
      });
    });
  }
  wireMealOptions();

  overlay.querySelectorAll('.chew-preset').forEach(btn => {
    btn.addEventListener('click', () => {
      const p = CHEW_PRESETS.find(x => x.key === btn.dataset.preset);
      chewSeconds = p.chewSeconds; restSeconds = p.restSeconds; mealMinutes = p.mealMinutes;
      overlay.querySelectorAll('.chew-preset').forEach(b => b.classList.toggle('active', b === btn));
      document.getElementById('chew-sec-input').value = toArabicNumeral(chewSeconds);
      document.getElementById('chew-rest-input').value = toArabicNumeral(restSeconds);
      document.getElementById('chew-meal-input').value = toArabicNumeral(mealMinutes);
    });
  });

  // Log a meal without leaving the flow — otherwise "chew a meal" would
  // require going away, logging it, and coming back.
  document.getElementById('chew-new-meal').addEventListener('click', () => {
    openFoodModal({
      date: today,
      onSaved: async () => {
        const fresh = await getFoodLogsForDate(today);
        const newest = fresh[fresh.length - 1];
        selectedMealId = newest ? newest.id : null;
        const listEl = document.getElementById('chew-meal-list');
        listEl.innerHTML = fresh.map(m => `
          <button class="chew-meal-option ${m.id === selectedMealId ? 'active' : ''}" data-meal="${m.id}">
            <span class="chew-meal-icon">${mealTypeIcon(m.mealType)}</span>
            <span class="chew-meal-text">
              <span class="chew-meal-title">${escapeHtml(m.notes || mealTypeLabel(m.mealType))}</span>
              <span class="chew-meal-sub">${mealTypeLabel(m.mealType)}${m.calories ? ` · ${toArabicNumeral(m.calories)} سعرة` : ''}</span>
            </span>
          </button>`).join('');
        wireMealOptions();
      }
    });
  });

  document.getElementById('chew-cancel').addEventListener('click', () => overlay.remove());
  document.getElementById('chew-start').addEventListener('click', async () => {
    chewSeconds = readNumericField('chew-sec-input', { int: true, min: 5, max: 120 }) ?? CHEW_DEFAULTS.chewSeconds;
    restSeconds = readNumericField('chew-rest-input', { int: true, min: 0, max: 120 }) ?? CHEW_DEFAULTS.restSeconds;
    mealMinutes = readNumericField('chew-meal-input', { int: true, min: 1, max: 90 }) ?? CHEW_DEFAULTS.mealMinutes;
    await saveChewSettings({ chewSeconds, restSeconds, mealMinutes });

    const foodLog = selectedMealId ? (await db.foodLogs.get(selectedMealId)) : null;
    overlay.remove();
    const s = await getChewSettings();
    openChewingPacer({
      foodLog, chewSeconds, restSeconds, mealMinutes, soundOn: s.soundOn,
      onFinished: (result) => {
        toast(result.completed
          ? `🌿 أنهيتِ وجبتك بـ ${toArabicNumeral(result.bites)} لقمة`
          : `تم الحفظ · ${toArabicNumeral(result.bites)} لقمة`);
        if (onDone) onDone();
      }
    });
  });
}

// ============================================================
//  The card on the Food page
// ============================================================

async function renderChewCard(container, onChange) {
  if (!container) return;
  const today = todayStr();
  const [todaySessions, streak, allSessions] = await Promise.all([
    getChewSessionsForDate(today),
    getChewStreak(),
    getChewSessions()
  ]);

  const todayBites = todaySessions.reduce((s, x) => s + (x.bites || 0), 0);
  const todaySeconds = todaySessions.reduce((s, x) => s + (x.actualSeconds || 0), 0);
  const completedToday = todaySessions.filter(x => x.completed).length;

  // Average meal length across all sessions — the number that shows whether
  // the habit is actually landing.
  const avgSec = allSessions.length
    ? allSessions.reduce((s, x) => s + (x.actualSeconds || 0), 0) / allSessions.length
    : 0;
  const perf = await getChewPerformance();
  const tip = chewTip(perf);

  container.innerHTML = `
    <div class="section-header">
      <h2 class="card-title">🌿 وضع المضغ</h2>
      ${streak > 0 ? `<span class="tsr-streak">🔥 ${toArabicNumeral(streak)}</span>` : ''}
    </div>

    ${allSessions.length === 0 ? `
      <p class="settings-note">إشارات الشبع تحتاج ~٢٠ دقيقة لتصل. جرّبي إبطاء وجبة واحدة وانظري الفرق.</p>
    ` : `
      <div class="chew-stat-row">
        <div class="chew-stat">
          <span class="chew-stat-num">${toArabicNumeral(todaySessions.length)}</span>
          <span class="chew-stat-label">وجبة اليوم</span>
        </div>
        <div class="chew-stat">
          <span class="chew-stat-num">${toArabicNumeral(todayBites)}</span>
          <span class="chew-stat-label">لقمة</span>
        </div>
        <div class="chew-stat">
          <span class="chew-stat-num">${todaySeconds ? formatChewDuration(todaySeconds) : '—'}</span>
          <span class="chew-stat-label">وقت الأكل</span>
        </div>
        <div class="chew-stat">
          <span class="chew-stat-num">${avgSec ? formatChewDuration(avgSec) : '—'}</span>
          <span class="chew-stat-label">متوسط الوجبة</span>
        </div>
      </div>
      ${completedToday > 0 ? `<p class="settings-note">✨ أكملتِ ${toArabicNumeral(completedToday)} ${completedToday === 1 ? 'وجبة كاملة' : 'وجبات كاملة'} اليوم</p>` : ''}
      ${tip ? `<p class="chew-tip chew-tip-${tip.tone}">${tip.text}</p>` : ''}
      ${perf?.avgAdherence != null ? `
        <div class="chew-adherence">
          <div class="mini-progress-track">
            <div class="mini-progress-fill ${perf.avgAdherence >= 0.9 ? 'chew-adherence-good' : ''}" style="width:${Math.min(100, perf.avgAdherence * 100)}%"></div>
          </div>
          <span class="mini-progress-text">تمضغين ${toArabicNumeral(Math.round(perf.avgAdherence * 100))}٪ من المدّة المطلوبة</span>
        </div>` : ''}
    `}

    <button class="btn btn-primary btn-block" id="chew-start-btn">🌿 ابدئي وضع المضغ</button>
  `;

  document.getElementById('chew-start-btn').addEventListener('click', () => {
    openChewSetupModal(onChange);
  });
}

// ---------- Day Detail provider ----------

async function chewDayProvider(dateStr) {
  const sessions = await getChewSessionsForDate(dateStr);
  if (sessions.length === 0) return null;
  const node = document.createElement('div');
  const rows = await Promise.all(sessions.map(async s => {
    const meal = s.foodLogId ? await db.foodLogs.get(s.foodLogId) : null;
    const name = meal ? (meal.notes || mealTypeLabel(meal.mealType)) : 'وجبة';
    return `<div class="yearly-row">
      <span>${s.completed ? '🌿' : '⏸️'} ${escapeHtml(name)}</span>
      <span>${toArabicNumeral(s.bites)} لقمة · ${formatChewDuration(s.actualSeconds)}</span>
    </div>`;
  }));
  node.innerHTML = rows.join('');
  return { title: 'وضع المضغ', node };
}

// ---------- Yearly stats provider ----------

async function chewYearlyProvider(year) {
  const prefix = String(year);
  const sessions = (await getChewSessions()).filter(s => s.date.startsWith(prefix));
  if (sessions.length === 0) return null;

  const totalBites = sessions.reduce((s, x) => s + (x.bites || 0), 0);
  const totalSec = sessions.reduce((s, x) => s + (x.actualSeconds || 0), 0);
  const completed = sessions.filter(s => s.completed).length;
  const days = new Set(sessions.map(s => s.date)).size;
  const avgSec = sessions.length ? totalSec / sessions.length : 0;

  // Is she actually getting slower? Compare the first quarter of the year's
  // sessions against the last — that's the only number that says whether
  // the habit is working.
  const sorted = [...sessions].sort((a, b) => a.createdAt - b.createdAt);
  let trendLine = '';
  if (sorted.length >= 4) {
    const q = Math.max(1, Math.floor(sorted.length / 4));
    const firstAvg = sorted.slice(0, q).reduce((s, x) => s + (x.actualSeconds || 0), 0) / q;
    const lastAvg = sorted.slice(-q).reduce((s, x) => s + (x.actualSeconds || 0), 0) / q;
    const diff = lastAvg - firstAvg;
    if (Math.abs(diff) >= 30) {
      trendLine = `<div class="yearly-row"><span>الاتجاه</span><span>${diff > 0 ? '↑ صرتِ أبطأ بـ ' : '↓ صرتِ أسرع بـ '}${formatChewDuration(Math.abs(diff))}</span></div>`;
    }
  }

  // Adherence: did she actually CHEW, or just wait? A twenty-minute meal
  // where every bite was swallowed at eight seconds is not a slow meal.
  const withAdh = sessions.filter(s => s.avgChewMs && s.targetChewMs);
  const avgAdh = withAdh.length
    ? withAdh.reduce((s, x) => s + (x.avgChewMs / x.targetChewMs), 0) / withAdh.length
    : null;

  // Which meal she rushes most.
  const byMeal = {};
  for (const s of withAdh) {
    if (!s.foodLogId) continue;
    const meal = await db.foodLogs.get(s.foodLogId);
    if (!meal) continue;
    if (!byMeal[meal.mealType]) byMeal[meal.mealType] = [];
    byMeal[meal.mealType].push(s.avgChewMs / s.targetChewMs);
  }
  const mealRows = Object.entries(byMeal)
    .map(([type, arr]) => ({ type, adh: arr.reduce((a, b) => a + b, 0) / arr.length, n: arr.length }))
    .sort((a, b) => a.adh - b.adh)
    .map(m => `<div class="yearly-row"><span>${mealTypeIcon(m.type)} ${mealTypeLabel(m.type)}</span><span>${toArabicNumeral(Math.round(m.adh * 100))}٪ · ${toArabicNumeral(m.n)} مرّة</span></div>`)
    .join('');

  const html = `
    <div class="yearly-row"><span>جلسات المضغ</span><span>${toArabicNumeral(sessions.length)}</span></div>
    <div class="yearly-row"><span>وجبات أكملتِها كاملة</span><span>${toArabicNumeral(completed)}</span></div>
    <div class="yearly-row"><span>أيام تدرّبتِ فيها</span><span>${toArabicNumeral(days)} يوم</span></div>
    <div class="yearly-row"><span>إجمالي اللقمات</span><span>${toArabicNumeral(totalBites)}</span></div>
    <div class="yearly-row"><span>متوسط مدّة الوجبة</span><span>${formatChewDuration(avgSec)}</span></div>
    ${avgAdh != null ? `<div class="yearly-row"><span>نسبة المضغ الفعلي</span><span>${toArabicNumeral(Math.round(avgAdh * 100))}٪ من المدّة المطلوبة</span></div>` : ''}
    ${trendLine}
    ${mealRows ? `
      <details class="yearly-pain-details">
        <summary>أي وجبة تبلعينها أسرع؟</summary>
        ${mealRows}
      </details>` : ''}
  `;
  return { title: 'وضع المضغ', html, count: sessions.length };
}


// ============================================================
//  Performance: what the numbers actually say
// ============================================================
// A long meal isn't the goal; a CHEWED meal is. Someone who sits in front
// of the timer for twenty minutes but swallows every bite at eight seconds
// has not eaten slowly — they've waited slowly. avgChewMs vs targetChewMs
// is the only pair that can tell those two apart.

function chewAdherence(session) {
  if (!session.avgChewMs || !session.targetChewMs) return null;
  return session.avgChewMs / session.targetChewMs; // 1.0 = chewed exactly as long as asked
}

async function getChewPerformance() {
  const sessions = await getChewSessions();
  if (sessions.length === 0) return null;

  const withData = sessions.filter(s => s.avgChewMs && s.targetChewMs);
  const adherences = withData.map(chewAdherence).filter(x => x != null);
  const avgAdherence = adherences.length
    ? adherences.reduce((s, x) => s + x, 0) / adherences.length
    : null;

  const avgSec = sessions.reduce((s, x) => s + (x.actualSeconds || 0), 0) / sessions.length;
  const completedRate = sessions.filter(s => s.completed).length / sessions.length;

  // Which MEAL she rushes. Grouping by mealType answers a question she can
  // act on ("I inhale breakfast") in a way an overall average never will.
  const byMeal = {};
  for (const s of withData) {
    if (!s.foodLogId) continue;
    const meal = await db.foodLogs.get(s.foodLogId);
    if (!meal) continue;
    if (!byMeal[meal.mealType]) byMeal[meal.mealType] = [];
    byMeal[meal.mealType].push(chewAdherence(s));
  }
  const mealAvgs = Object.entries(byMeal).map(([type, arr]) => ({
    type,
    adherence: arr.reduce((s, x) => s + x, 0) / arr.length,
    count: arr.length
  })).sort((a, b) => a.adherence - b.adherence);

  return {
    sessions: sessions.length,
    avgSec,
    avgAdherence,
    completedRate,
    fastestMeal: mealAvgs.length && mealAvgs[0].adherence < 0.85 ? mealAvgs[0] : null,
    mealAvgs
  };
}

// One honest sentence about how she's doing — not a scolding, not a
// meaningless "great job!".
function chewTip(perf) {
  if (!perf) return null;
  if (perf.avgAdherence == null) {
    return { tone: 'neutral', text: 'أنهي جلسة بزرّ «بلعت» لأعرف كم تمضغين فعلاً.' };
  }
  const a = perf.avgAdherence;
  if (a >= 0.95) {
    return { tone: 'success', text: '🌿 تمضغين المدّة كاملة تقريباً — هذا بالضبط ما يعطي جسمك وقتاً ليشبع.' };
  }
  if (a >= 0.7) {
    return { tone: 'neutral', text: `تمضغين ~${toArabicNumeral(Math.round(a * 100))}٪ من المدّة المطلوبة. جرّبي إنقاص مدّة المضغ قليلاً بدل إجبار نفسك — الالتزام أهم من الرقم.` };
  }
  if (perf.fastestMeal) {
    return { tone: 'warning', text: `تبلعين مبكراً غالباً، وأسرع وجباتك: ${mealTypeIcon(perf.fastestMeal.type)} ${mealTypeLabel(perf.fastestMeal.type)}. جرّبي مدّة مضغ أقصر لتصلي إليها فعلاً.` };
  }
  return { tone: 'warning', text: 'تبلعين قبل انتهاء المدّة غالباً — قلّلي مدّة المضغ حتى تصبح قابلة للالتزام.' };
}
