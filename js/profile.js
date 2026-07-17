// profile.js — first-run setup, the rotating welcome greeting, PIN lock,
// and the Settings screen.
// (resizeImageToBlob lives in ui-shared.js — Food photos need it too.)

let lastProfilePicUrl = null;
function pictureUrl(blob) {
  if (lastProfilePicUrl) URL.revokeObjectURL(lastProfilePicUrl);
  lastProfilePicUrl = blob ? URL.createObjectURL(blob) : null;
  return lastProfilePicUrl;
}

// ---------- PIN hashing ----------

async function hashPin(pin) {
  const enc = new TextEncoder().encode('rahlati:' + pin);
  const buf = await crypto.subtle.digest('SHA-256', enc);
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// ---------- welcome + motivational phrase banks (feminine Arabic) ----------

const WELCOME_PHRASES = [
  'خطوة صغيرة اليوم بتفرق كثير بكرا.',
  'كل يوم بتبدئيه هو فرصة جديدة.',
  'افتخري بكل خطوة، مهما كانت بسيطة.',
  'أنتِ أقوى مما تتخيلين.',
  'استمراريتك هي سر تقدمك.',
  'لا بأس لو تعثرتِ، المهم إنك ما وقفتِ.',
  'رحلتك، بوقتك، وبطريقتك.',
  'كوني لطيفة مع نفسك اليوم.',
  'التقدم الصغير يبقى تقدم.',
  'ثقي بنفسك، إنتِ عم تسوي شي حلو لحالك.',
  'خذي نفس عميق، وابدئي يومك بهدوء.'
];

const HABIT_MOTIVATION = [
  'الاستمرار أهم من الكمال.',
  'يوم واحد كل مرة.',
  'تعثرتِ؟ ولا يهمك، كمّلي من جديد.',
  'التزامك اليوم بيبني ثقتك بنفسك.',
  'لا تقارني نفسك بالأمس، قارنيها بالبداية.',
  'كل ❤️ هو صوت بيقول "أنا قادرة".',
  'صغيرة اليوم، وحقيقية بكرا.'
];

function greetingWord() {
  const h = new Date().getHours();
  if (h >= 4 && h < 12) return 'صباح الخير';
  if (h >= 12 && h < 18) return 'نهارك سعيد';
  return 'مساء الخير';
}

function pickRotating(bank, lastIndexKey) {
  let idx = Math.floor(Math.random() * bank.length);
  if (bank.length > 1) {
    const last = Number(localStorage.getItem(lastIndexKey) ?? -1);
    while (idx === last) idx = Math.floor(Math.random() * bank.length);
  }
  localStorage.setItem(lastIndexKey, String(idx));
  return bank[idx];
}

function pickWelcomePhrase(customPhrases) {
  const pool = (customPhrases && customPhrases.length) ? customPhrases : WELCOME_PHRASES;
  return pickRotating(pool, 'rahlati_last_welcome');
}
function pickHabitMotivation() { return pickRotating(HABIT_MOTIVATION, 'rahlati_last_habit_tip'); }

// ---------- first-run setup wizard ----------

// Shared by the one-time first-launch splash AND the Settings page
// (she asked for both) — one function so they can't drift apart.
function creditBlockHtml() {
  return `
    <p class="credit-line credit-line-main">صُمم بمحبة ليكون صدقة جارية</p>
    <p class="credit-dua">"اللهم اجعله نافعاً لمن يستخدمه"</p>
    <p class="credit-by">صُنع بواسطة ساكوهين (Sakuhin)</p>
    <a class="credit-instagram" href="https://www.instagram.com/sakuhin_store" target="_blank" rel="noopener">📷 إنستغرام: Sakuhin</a>
  `;
}

function renderSetupWizard() {
  const root = document.getElementById('app-root');
  const state = { name: '', pictureBlob: null, pin: null };

  function step1() {
    root.innerHTML = `
      <div class="wizard">
        <div class="wizard-logo"><img src="icons/icon-192.png" alt=""></div>
        <h1 class="wizard-title">رحلتي</h1>
        <p class="wizard-tag">رفيقتك اليومية 🌸</p>
        <label class="field-label" for="wz-name">شو اسمك؟</label>
        <input id="wz-name" class="text-input" type="text" placeholder="اكتبي اسمك هنا" autofocus>
        <button class="btn btn-primary btn-block" id="wz-next1">التالي</button>
      </div>`;
    const input = document.getElementById('wz-name');
    document.getElementById('wz-next1').addEventListener('click', () => {
      const val = input.value.trim();
      if (!val) { input.focus(); return; }
      state.name = val;
      step2();
    });
    input.addEventListener('keydown', e => { if (e.key === 'Enter') document.getElementById('wz-next1').click(); });
  }

  function step2() {
    root.innerHTML = `
      <div class="wizard">
        <h1 class="wizard-title-sm">صورتك الشخصية</h1>
        <p class="wizard-sub">اختياري — تقدري تتخطي هالخطوة</p>
        <div class="pfp-preview" id="wz-pfp-preview">🌸</div>
        ${photoPickerHtml('wz-pfp', { withRemove: false })}
        <div class="wizard-actions">
          <button class="btn btn-text" id="wz-skip2">تخطي</button>
          <button class="btn btn-primary" id="wz-next2">التالي</button>
        </div>
      </div>`;
    const preview = document.getElementById('wz-pfp-preview');
    wirePhotoPicker('wz-pfp', async (file) => {
      try {
        state.pictureBlob = await resizeImageToBlob(file, 256, 0.85);
        preview.innerHTML = `<img src="${pictureUrl(state.pictureBlob)}" alt="">`;
      } catch { /* silently keep previous state if the image failed to load */ }
    });
    document.getElementById('wz-skip2').addEventListener('click', () => step3());
    document.getElementById('wz-next2').addEventListener('click', () => step3());
  }

  function step3(mismatchError) {
    root.innerHTML = `
      <div class="wizard">
        <h1 class="wizard-title-sm">رمز حماية (اختياري)</h1>
        <p class="wizard-sub">٤ أرقام لحماية خصوصيتك من أي شخص يفتح جهازك</p>
        ${mismatchError ? `<p class="field-error">${mismatchError}</p>` : ''}
        <div class="pin-dots" id="wz-pin-dots"><span></span><span></span><span></span><span></span></div>
        <div class="pin-pad" id="wz-pin-pad"></div>
        <div class="wizard-actions">
          <button class="btn btn-text" id="wz-skip3">تخطي، بدون رمز</button>
        </div>
      </div>`;
    buildPinPad('wz-pin-pad', 'wz-pin-dots', async (enteredPin) => {
      if (!state.pin) {
        state.pin = enteredPin;
        step3(); // re-render for confirmation entry
        setTimeout(() => document.querySelector('#wz-pin-dots').dataset.confirming = '1', 0);
        document.getElementById('wz-pin-dots').closest('.wizard').querySelector('.wizard-sub').textContent = 'أعيدي كتابة الرمز للتأكيد';
      } else if (state.pin === enteredPin) {
        await finish(state.pin);
      } else {
        state.pin = null;
        step3('الرمزان غير متطابقين، حاولي مرة أخرى');
      }
    });
    document.getElementById('wz-skip3').addEventListener('click', () => finish(null));
  }

  async function finish(pin) {
    const now = Date.now();
    await db.profile.put({ id: 1, name: state.name, pictureBlob: state.pictureBlob, createdAt: now });
    await db.settings.put({
      id: 1,
      pinHash: pin ? await hashPin(pin) : null,
      pinEnabled: !!pin,
      notificationsEnabled: false,
      lastBackupAt: null
    });
    sessionStorage.setItem('rahlati_unlocked', '1');
    renderCreditScreen();
  }

  function renderCreditScreen() {
    root.innerHTML = `
      <div class="wizard credit-screen">
        <div class="wizard-logo"><img src="icons/icon-192.png" alt=""></div>
        <p class="credit-line">🌸 رحلتي</p>
        ${creditBlockHtml()}
        <button class="btn btn-primary btn-block" id="credit-continue">متابعة ←</button>
      </div>`;
    document.getElementById('credit-continue').addEventListener('click', async () => {
      startApp(await db.profile.get(1), await db.settings.get(1));
    });
  }

  step1();
}

// ---------- PIN pad (shared by setup + lock screen) ----------

function buildPinPad(padElId, dotsElId, onComplete) {
  const pad = document.getElementById(padElId);
  const dotsEl = document.getElementById(dotsElId);
  let entered = '';
  const keys = ['١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩', '', '٠', '⌫'];
  const digitMap = { '١': '1', '٢': '2', '٣': '3', '٤': '4', '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9', '٠': '0' };
  pad.innerHTML = keys.map(k => k ? `<button class="pin-key" data-key="${k}">${k}</button>` : `<span></span>`).join('');

  function renderDots() {
    const dots = dotsEl.querySelectorAll('span');
    dots.forEach((d, i) => d.classList.toggle('filled', i < entered.length));
  }

  pad.querySelectorAll('.pin-key').forEach(btn => {
    btn.addEventListener('click', () => {
      const key = btn.dataset.key;
      if (key === '⌫') {
        entered = entered.slice(0, -1);
      } else if (entered.length < 4) {
        entered += digitMap[key];
      }
      renderDots();
      if (entered.length === 4) {
        const pin = entered;
        entered = '';
        onComplete(pin);
      }
    });
  });
}

// ---------- lock screen ----------

function renderLockScreen(profile, onUnlock) {
  const root = document.getElementById('app-root');
  root.innerHTML = `
    <div class="wizard lock-screen">
      <div class="pfp-preview pfp-small">${profile.pictureBlob ? `<img src="${pictureUrl(profile.pictureBlob)}" alt="">` : '🌸'}</div>
      <h1 class="wizard-title-sm">أهلاً، ${escapeHtml(profile.name)}</h1>
      <p class="wizard-sub" id="lock-error">اكتبي رمزك للدخول</p>
      <div class="pin-dots" id="lock-pin-dots"><span></span><span></span><span></span><span></span></div>
      <div class="pin-pad" id="lock-pin-pad"></div>
      <button class="btn btn-text" id="forgot-pin">نسيتِ الرمز؟</button>
    </div>`;

  const settingsPromise = db.settings.get(1);
  buildPinPad('lock-pin-pad', 'lock-pin-dots', async (entered) => {
    const settings = await settingsPromise;
    const hash = await hashPin(entered);
    if (hash === settings.pinHash) {
      onUnlock();
    } else {
      const dots = document.getElementById('lock-pin-dots');
      dots.classList.add('shake');
      document.getElementById('lock-error').textContent = 'الرمز غير صحيح، حاولي مرة أخرى';
      setTimeout(() => dots.classList.remove('shake'), 400);
    }
  });

  document.getElementById('forgot-pin').addEventListener('click', () => renderForgotPin(profile, onUnlock));
}

function renderForgotPin(profile, onUnlock) {
  const root = document.getElementById('app-root');
  root.innerHTML = `
    <div class="wizard lock-screen">
      <h1 class="wizard-title-sm">نسيتِ الرمز؟</h1>
      <p class="wizard-sub">
        بياناتك محفوظة على هذا الجهاز فقط، فلا توجد طريقة لاستعادة الرمز عن بُعد.
        الخيار الوحيد هو مسح بيانات التطبيق والبدء من جديد — إذا كانت عندك نسخة احتياطية، تقدري تستعيديها بعد ذلك.
      </p>
      <label class="checkbox-row">
        <input type="checkbox" id="confirm-wipe">
        <span>أفهم أن هذا سيحذف كل بياناتي المحفوظة على هذا الجهاز</span>
      </label>
      <button class="btn btn-danger btn-block" id="wipe-btn" disabled>مسح البيانات والبدء من جديد</button>
      <button class="btn btn-text" id="back-to-lock">رجوع</button>
    </div>`;
  const checkbox = document.getElementById('confirm-wipe');
  const wipeBtn = document.getElementById('wipe-btn');
  checkbox.addEventListener('change', () => { wipeBtn.disabled = !checkbox.checked; });
  wipeBtn.addEventListener('click', async () => {
    await db.delete();
    location.reload();
  });
  document.getElementById('back-to-lock').addEventListener('click', () => renderLockScreen(profile, onUnlock));
}

// ---------- Settings page (registered as a route in app.js) ----------

const REMINDER_CATEGORIES = [
  { key: 'tasks', label: '📋 المهام الثابتة', hasTime: false, note: 'كل مهمة تحدّد وقتها بنفسها' },
  { key: 'water', label: '💧 الماء', hasTime: true, defaultTime: '15:00' },
  { key: 'adhkarMorning', label: '🌅 أذكار الصباح', hasTime: true, defaultTime: '06:00' },
  { key: 'adhkarEvening', label: '🌙 أذكار المساء', hasTime: true, defaultTime: '18:00' },
  { key: 'wird', label: '📖 ورد القرآن', hasTime: true, defaultTime: '20:00' },
  { key: 'reflect', label: '📔 وقفة اليوم (يومية + مزاج)', hasTime: true, defaultTime: '21:00' },
  { key: 'sleep', label: '😴 تذكير النوم', hasTime: true, defaultTime: '22:30' },
  { key: 'period', label: '🌸 اقتراب الدورة', hasTime: true, defaultTime: '09:00' },
  { key: 'periodPain', label: '🩸 تسجيل ألم الدورة', hasTime: true, defaultTime: '20:00' },
  { key: 'training', label: '💪 التمارين', hasTime: true, defaultTime: '17:00' },
  { key: 'food', label: '🍽️ تسجيل وجباتك', hasTime: true, defaultTime: '13:00' },
  { key: 'study', label: '⏳ وقت الدراسة', hasTime: true, defaultTime: '16:00' },
  { key: 'habits', label: '🌱 مراجعة عاداتك', hasTime: true, defaultTime: '19:00' },
  { key: 'nudge', label: '💗 لمسة حنان', hasTime: true, defaultTime: '20:00' },
  { key: 'deadlines', label: '⚠️ مهام ومواعيد اليوم', hasTime: true, defaultTime: '08:00' },
  { key: 'backup', label: '💾 نسخة احتياطية (شهرياً)', hasTime: true, defaultTime: '20:00', defaultOn: true }
];

function renderReminderCategoriesHtml(settings) {
  const enabled = settings?.remindersEnabled || {};
  const times = settings?.reminderTimes || {};
  return `
    <div class="reminder-categories">
      ${REMINDER_CATEGORIES.map(cat => `
        <div class="reminder-category-row">
          <label class="switch"><input type="checkbox" class="reminder-cat-toggle" data-cat="${cat.key}" ${((cat.key === 'tasks' || cat.defaultOn) ? enabled[cat.key] !== false : !!enabled[cat.key]) ? 'checked' : ''}><span class="switch-track"></span></label>
          <span class="reminder-cat-label">${cat.label}</span>
          ${cat.hasTime ? `<input type="time" class="text-input reminder-cat-time" data-cat-time="${cat.key}" value="${times[cat.key] || cat.defaultTime}">` : `<span class="settings-note">${cat.note}</span>`}
        </div>`).join('')}
    </div>`;
}

async function renderSettingsPage(params, view) {
  const profile = await db.profile.get(1);
  const settings = await db.settings.get(1);
  const notifStatus = notificationStatus();

  const prefs = await getHomeTrackerPrefs();
  const arabicNums = settings?.useArabicNumerals !== false;
  const hapticSupport = hapticsSupportLabel();

  view.innerHTML = `
    <div class="page-header">
      <button class="icon-btn" aria-label="رجوع" id="settings-back">→</button>
      <h1>الإعدادات</h1>
    </div>

    <div class="settings-jump">
      <button class="settings-jump-chip" data-jump="sec-home">🏠 الرئيسية</button>
      <button class="settings-jump-chip" data-jump="sec-look">🎨 المظهر</button>
      <button class="settings-jump-chip" data-jump="sec-account">👤 حسابك</button>
      <button class="settings-jump-chip" data-jump="sec-prefs">⚙️ تفضيلات</button>
      <button class="settings-jump-chip" data-jump="sec-sound">🔊 الصوت</button>
      <button class="settings-jump-chip" data-jump="sec-notif">🔔 الإشعارات</button>
      <button class="settings-jump-chip" data-jump="sec-data">💾 البيانات</button>
    </div>

    <h2 class="settings-group-title" id="sec-home">🏠 الصفحة الرئيسية</h2>

    <div class="card settings-card">
      <h3 class="card-title">البطاقة العلوية</h3>
      <p class="settings-note">اختاري ما تريدين رؤيته. حتى ${toArabicNumeral(HOME_MAX_BIG)} دائرة كبيرة و${toArabicNumeral(HOME_MAX_SMALL)} صغيرة — أو لا شيء إن أردتِ.</p>

      <label class="field-label">الدوائر الكبيرة <span class="settings-count" id="big-count">${toArabicNumeral(prefs.big.length)}/${toArabicNumeral(HOME_MAX_BIG)}</span></label>
      <div class="tracker-grid" id="big-trackers">
        ${HOME_TRACKERS.map(t => `
          <button class="tracker-chip ${prefs.big.includes(t.key) ? 'active' : ''}" data-size="big" data-key="${t.key}">
            <span class="tracker-chip-icon">${t.icon}</span>
            <span class="tracker-chip-label">${t.label}</span>
          </button>`).join('')}
      </div>

      <label class="field-label">الدوائر الصغيرة <span class="settings-count" id="small-count">${toArabicNumeral(prefs.small.length)}/${toArabicNumeral(HOME_MAX_SMALL)}</span></label>
      <div class="tracker-grid" id="small-trackers">
        ${HOME_TRACKERS.map(t => `
          <button class="tracker-chip ${prefs.small.includes(t.key) ? 'active' : ''}" data-size="small" data-key="${t.key}">
            <span class="tracker-chip-icon">${t.icon}</span>
            <span class="tracker-chip-label">${t.label}</span>
          </button>`).join('')}
      </div>

      <div id="tasbeeh-picker-wrap" class="${prefs.small.includes('tasbeeh') ? '' : 'hidden'}">
        <label class="field-label">📿 أي الأذكار تظهر في دائرة المسبحة؟</label>
        <p class="settings-note">تنقسم الدائرة إلى قوس لكل ذكر (حتى ${toArabicNumeral(ADHKAR_RING_MAX)}). الأذكار بلا هدف لا تظهر — لا شيء يملأ قوسها.</p>
        <div id="tasbeeh-picker"></div>
      </div>

      <button class="link-btn" id="reset-home-trackers">↺ استعادة الترتيب الافتراضي</button>
    </div>

    <div class="card settings-card">
      <div class="settings-row">
        <span>الشريط السفلي</span>
        <label class="switch"><input type="checkbox" id="settings-bottombar-toggle" ${settings.bottomBarEnabled === false ? '' : 'checked'}><span class="switch-track"></span></label>
      </div>
      <div id="bottombar-items-wrap" class="${settings.bottomBarEnabled === false ? 'hidden' : ''}">
        ${BOTTOM_BAR_ITEMS.map(i => `
          <label class="checkbox-row">
            <input type="checkbox" data-bbkey="${i.key}" ${(settings.bottomBarItems || BOTTOM_BAR_ITEMS.map(x => x.key)).includes(i.key) ? 'checked' : ''}>
            <span>${i.icon} ${i.label}</span>
          </label>`).join('')}
      </div>
    </div>

    <h2 class="settings-group-title" id="sec-look">🎨 المظهر</h2>
    ${renderThemeSection(settings?.themeMode, settings?.accentColor, settings?.customThemePresets)}

    <div class="card settings-card">
      <div class="settings-row">
        <span>الأرقام العربية (١٢٣)</span>
        <label class="switch"><input type="checkbox" id="settings-numerals" ${arabicNums ? 'checked' : ''}><span class="switch-track"></span></label>
      </div>
      <p class="settings-note">أطفئيه لعرض الأرقام هكذا: 123</p>
    </div>

    <h2 class="settings-group-title" id="sec-account">👤 حسابك</h2>

    <div class="card settings-card">
      <div class="pfp-preview pfp-small" id="settings-pfp">${profile.pictureBlob ? `<img src="${pictureUrl(profile.pictureBlob)}" alt="">` : '🌸'}</div>
      ${photoPickerHtml('settings-pfp', { withRemove: !!profile.pictureBlob })}
      <label class="field-label">الاسم</label>
      <input class="text-input" id="settings-name" value="${escapeHtml(profile.name)}">
      <button class="btn btn-primary btn-sm" id="settings-save-name">حفظ الاسم</button>
    </div>

    <div class="card settings-card">
      <h3 class="card-title">المعلومات الصحية</h3>
      <label class="field-label">العمر</label>
      <input class="text-input" type="text" inputmode="numeric" id="settings-age" value="${settings.age ?? ''}" placeholder="مثلاً: ٢٨">
      <label class="field-label">الجنس</label>
      <div class="sex-chips" id="settings-sex-chips">
        <button class="chip ${(settings.sex ?? 'female') === 'female' ? 'active' : ''}" data-sex="female">أنثى</button>
        <button class="chip ${settings.sex === 'male' ? 'active' : ''}" data-sex="male">ذكر</button>
      </div>
      <label class="field-label">الطول (سم)</label>
      <input class="text-input" type="text" inputmode="numeric" id="settings-height" value="${settings.heightCm ?? ''}" placeholder="مثلاً: ١٦٥">
      <button class="link-btn" id="settings-save-health">حفظ المعلومات الصحية</button>
      <p class="settings-note">تُستخدم لحساب مؤشرات الجسم في صفحة الصحة.</p>
    </div>

    <div class="card settings-card">
      <div class="settings-row">
        <span>رمز الحماية (PIN)</span>
        <label class="switch"><input type="checkbox" id="settings-pin-toggle" ${settings.pinEnabled ? 'checked' : ''}><span class="switch-track"></span></label>
      </div>
      <div id="settings-pin-change-wrap" class="${settings.pinEnabled ? '' : 'hidden'}">
        <button class="link-btn" id="settings-change-pin">تغيير الرمز</button>
      </div>
    </div>

    <h2 class="settings-group-title" id="sec-prefs">⚙️ تفضيلات</h2>

    <div class="card settings-card">
      <h3 class="card-title">العملة</h3>
      <input class="text-input" id="settings-currency" value="${escapeHtml(settings.currency || '')}" placeholder="دينار">
      <button class="link-btn" id="settings-save-currency">حفظ</button>
    </div>

    <div class="card settings-card">
      <h3 class="card-title">عبارات الترحيب</h3>
      <p class="settings-note">تظهر عشوائياً في الصفحة الرئيسية.</p>
      <details class="weight-history-details">
        <summary>عرض وإدارة العبارات</summary>
        <div id="welcome-phrases-list"></div>
        <div class="food-photo-actions">
          <input class="text-input" id="new-phrase-input" placeholder="أضيفي عبارة جديدة">
          <button class="btn btn-secondary btn-sm" id="add-phrase-btn">+ إضافة</button>
        </div>
      </details>
    </div>

    <h2 class="settings-group-title" id="sec-sound">🔊 الصوت والاهتزاز</h2>

    <div class="card settings-card">
      <div class="settings-row">
        <span>الأصوات</span>
        <label class="switch"><input type="checkbox" id="sound-enabled" ${settings.soundEnabled !== false ? 'checked' : ''}><span class="switch-track"></span></label>
      </div>
      <div id="sound-wrap" class="${settings.soundEnabled !== false ? '' : 'hidden'}">
        <label class="field-label">مستوى الصوت: <span class="settings-count" id="vol-label">${toArabicNumeral(Math.round((settings.soundVolume ?? 0.7) * 100))}٪</span></label>
        <input type="range" class="mood-intensity" id="sound-volume" min="0" max="100" value="${Math.round((settings.soundVolume ?? 0.7) * 100)}">

        <label class="field-label">نغمة كل حدث</label>
        <p class="settings-note">إتمام صلواتك لا يجب أن يبدو كإنهاء وجبة — بعد أسبوع ستعرفين ما حدث دون النظر إلى الشاشة.</p>
        <div id="sound-events"></div>
      </div>
    </div>

    <div class="card settings-card">
      <div class="settings-row">
        <span>الاهتزاز</span>
        <label class="switch"><input type="checkbox" id="haptics-enabled" ${settings.hapticsEnabled !== false ? 'checked' : ''}><span class="switch-track"></span></label>
      </div>
      <p class="settings-note haptics-support ${hapticSupport.ok ? 'haptics-ok' : 'haptics-no'}">${hapticSupport.text}</p>
      <div id="haptics-wrap" class="${settings.hapticsEnabled !== false ? '' : 'hidden'}">
        <label class="field-label">قوّة الاهتزاز: <span class="settings-count" id="hap-label"></span></label>
        <input type="range" class="mood-intensity" id="haptics-strength" min="0" max="200" step="10" value="${Math.round((settings.hapticsStrength ?? 1) * 100)}">
        <button class="btn btn-secondary btn-sm btn-block" id="haptics-test">📳 جرّبي الاهتزاز الآن</button>
        <p class="settings-note" id="haptics-test-result"></p>

        <label class="field-label">أين يهتزّ؟</label>
        <div id="haptic-events"></div>
      </div>
    </div>

    <h2 class="settings-group-title" id="sec-notif">🔔 الإشعارات</h2>

    <div class="card settings-card">
      <div class="settings-row">
        <span>الإشعارات والتذكيرات</span>
        <span class="settings-status">${notifStatus === 'granted' ? 'مفعّلة ✅' : notifStatus === 'denied' ? 'محظورة من الجهاز' : 'غير مفعّلة'}</span>
      </div>
      ${notifStatus !== 'granted' && notifStatus !== 'unsupported' ? `<button class="btn btn-secondary btn-sm" id="settings-enable-notif">تفعيل الإشعارات</button>` : ''}
      ${notifStatus === 'denied' ? `<p class="settings-note">حظرتِ الإشعارات من إعدادات المتصفح أو الجهاز — يلزم السماح بها من هناك أولاً.</p>` : ''}
      ${notifStatus === 'granted' ? `<button class="btn btn-secondary btn-sm" id="settings-test-notif">🔔 إرسال إشعار تجريبي</button>` : ''}
      <p class="settings-note">التطبيق محلي بالكامل بلا سيرفر، فالتذكيرات تعمل بشكل موثوق أثناء تشغيله، وتظهر الفائتة منها عند فتحه من جديد.</p>
    </div>

    ${notifStatus === 'granted' ? `
      <div class="card settings-card">
        <details class="reminders-details" open>
          <summary class="reminders-summary">🔔 ما الذي يُذكّرك؟</summary>
          ${renderReminderCategoriesHtml(settings)}
          <div class="nudge-picker">
            <p class="material-type-label">💗 لمسات الحنان — اختاري ما تريدين تذكيره</p>
            <p class="settings-note">حين تُفعّلين «لمسة حنان» فوق، أُرسل رسالة لطيفة إذا نسيتِ تسجيل أحد هذه.</p>
            ${renderNudgeItemsHtml(settings)}
          </div>
        </details>
      </div>

      <div class="card settings-card">
        <div class="section-header">
          <h3 class="card-title">🔔 تذكيرات خاصة بك</h3>
          <button class="link-btn" id="add-custom-reminder">+ إضافة</button>
        </div>
        <p class="settings-note">دواء، موعد، أوقات الصلاة إن أردتِ إدخالها بنفسك — أي شيء.</p>
        <div id="custom-reminders-list"></div>
      </div>

      <div class="card settings-card">
        <div class="settings-row">
          <span>🌙 ساعات الهدوء</span>
          <label class="switch"><input type="checkbox" id="quiet-hours-toggle" ${settings.quietHoursEnabled ? 'checked' : ''}><span class="switch-track"></span></label>
        </div>
        <div id="quiet-hours-wrap" class="${settings.quietHoursEnabled ? '' : 'hidden'}">
          <div class="quiet-hours-row">
            <div class="quiet-hours-field">
              <label class="field-label">من</label>
              <input class="text-input" type="time" id="quiet-from" value="${settings.quietHoursFrom || '22:30'}">
            </div>
            <div class="quiet-hours-field">
              <label class="field-label">إلى</label>
              <input class="text-input" type="time" id="quiet-to" value="${settings.quietHoursTo || '07:00'}">
            </div>
          </div>
          <p class="settings-note">لا تُرسَل إشعارات في هذه الفترة. تذكير يوقظك الثالثة فجراً ليس تذكيراً — بل سبب لإطفاء الإشعارات كلّها.</p>
        </div>

        <div class="settings-row">
          <span>كتم الإشعارات والتطبيق مفتوح</span>
          <label class="switch"><input type="checkbox" id="suppress-open-toggle" ${settings.suppressWhenOpen !== false ? 'checked' : ''}><span class="switch-track"></span></label>
        </div>
        <p class="settings-note">إشعار عن شيء تنظرين إليه أصلاً هو ضجيج.</p>
      </div>` : ''}

    <h2 class="settings-group-title" id="sec-data">💾 البيانات</h2>

    <div class="card settings-card">
      <h3 class="card-title">نسخة احتياطية</h3>
      <p class="settings-note">${settings.lastBackupAt ? '✅ آخر نسخة: ' + new Date(settings.lastBackupAt).toLocaleDateString('ar') : '⚠️ لم تُنشأ نسخة احتياطية بعد'}</p>
      ${(!settings.lastBackupAt || (Date.now() - settings.lastBackupAt > 30 * 86400000)) ? `
        <p class="settings-warn">بياناتك على هذا الجهاز فقط. إن فُقد الجهاز أو مُسحت بيانات المتصفح، تضيع معها — النسخة الاحتياطية هي نسختك الوحيدة.</p>` : ''}
      <button class="btn btn-primary btn-sm" id="settings-export">⬇️ تنزيل نسخة احتياطية</button>
      <input type="file" accept=".zip" id="settings-import-input" class="hidden-file-input">
      <button class="btn btn-secondary btn-sm" id="settings-import">⬆️ استعادة من نسخة احتياطية</button>
      <p class="settings-note">النسخة تشمل كل شيء: بياناتك، صورك، إعداداتك ومظاهرك المخصصة.</p>
    </div>

    <div class="card settings-card credit-settings-card">
      ${creditBlockHtml()}
    </div>

    <p class="app-footer">🌸 رحلتي — نسخة محلية بالكامل، بياناتك لا تغادر هذا الجهاز أبدًا</p>
    <p class="app-version">الإصدار: ${APP_VERSION}</p>
  `;

  document.getElementById('settings-back').addEventListener('click', () => history.back());

  // ---- jump nav ----
  view.querySelectorAll('.settings-jump-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      const target = document.getElementById(chip.dataset.jump);
      safeScrollIntoView(target);
    });
  });

  // ---- home tracker picker ----
  let bigSel = [...prefs.big];
  let smallSel = [...prefs.small];

  function paintCounts() {
    document.getElementById('big-count').textContent = `${toArabicNumeral(bigSel.length)}/${toArabicNumeral(HOME_MAX_BIG)}`;
    document.getElementById('small-count').textContent = `${toArabicNumeral(smallSel.length)}/${toArabicNumeral(HOME_MAX_SMALL)}`;
    document.getElementById('tasbeeh-picker-wrap').classList.toggle('hidden', !smallSel.includes('tasbeeh'));
  }

  async function toggleTracker(size, key, chip) {
    const sel = size === 'big' ? bigSel : smallSel;
    const max = size === 'big' ? HOME_MAX_BIG : HOME_MAX_SMALL;
    const i = sel.indexOf(key);
    if (i >= 0) {
      sel.splice(i, 1);
      chip.classList.remove('active');
    } else {
      // A hard cap rather than silently dropping the oldest: quietly
      // removing something she picked would be worse than saying no.
      if (sel.length >= max) { toast(`الحد الأقصى ${toArabicNumeral(max)}`); return; }
      sel.push(key);
      chip.classList.add('active');
    }
    paintCounts();
    await saveHomeTrackerPrefs({ big: bigSel, small: smallSel });
  }

  view.querySelectorAll('.tracker-chip').forEach(chip => {
    chip.addEventListener('click', () => toggleTracker(chip.dataset.size, chip.dataset.key, chip));
  });

  document.getElementById('reset-home-trackers').addEventListener('click', async () => {
    if (!confirm('استعادة الدوائر الافتراضية؟')) return;
    bigSel = [...HOME_DEFAULT_BIG];
    smallSel = [...HOME_DEFAULT_SMALL];
    await saveHomeTrackerPrefs({ big: bigSel, small: smallSel });
    await db.settings.update(1, { homeAdhkarIds: null });
    renderSettingsPage(params, view);
  });

  // ---- which adhkar appear in the tasbeeh ring ----
  async function renderTasbeehPicker() {
    const el = document.getElementById('tasbeeh-picker');
    if (!el) return;
    // Every dhikr is listed. Filtering on goalCount hid the ones created
    // before goals existed — which is most of them — so the picker came up
    // empty and there was nothing to choose.
    const items = await getActiveCustomAdhkar();
    const s = await db.settings.get(1);
    const chosen = s?.homeAdhkarIds || items.slice(0, ADHKAR_RING_MAX).map(a => a.id);
    if (items.length === 0) {
      el.innerHTML = `<p class="settings-note">ما في أذكار مخصصة بعد. أضيفيها من صفحة العبادة.</p>`;
      return;
    }
    el.innerHTML = items.map(a => `
      <label class="checkbox-row">
        <input type="checkbox" data-adhkar="${a.id}" ${chosen.includes(a.id) ? 'checked' : ''}>
        <span>${escapeHtml(a.name)}
          ${a.goalCount > 0
            ? `<span class="settings-count">هدف ${toArabicNumeral(a.goalCount)}</span>`
            : `<span class="settings-count settings-count-hint">بلا هدف — يمتلئ القوس بمجرّد العدّ</span>`}
        </span>
      </label>`).join('');
    el.querySelectorAll('[data-adhkar]').forEach(cb => {
      cb.addEventListener('change', async () => {
        let picked = [...el.querySelectorAll('[data-adhkar]:checked')].map(x => Number(x.dataset.adhkar));
        if (picked.length > ADHKAR_RING_MAX) {
          cb.checked = false;
          toast(`الحد الأقصى ${toArabicNumeral(ADHKAR_RING_MAX)} أذكار`);
          picked = picked.filter(id => id !== Number(cb.dataset.adhkar));
        }
        await db.settings.update(1, { homeAdhkarIds: picked });
      });
    });
  }
  await renderTasbeehPicker();

  // ---- numeral system ----
  document.getElementById('settings-numerals').addEventListener('change', async (e) => {
    const useArabic = e.target.checked;
    await db.settings.update(1, { useArabicNumerals: useArabic });
    setNumeralMode(useArabic);
    // Repaint immediately — the whole point is to SEE the difference.
    renderSettingsPage(params, view);
  });

  // ---- sound & haptics ----
  const soundToggle = document.getElementById('sound-enabled');
  if (soundToggle) {
    soundToggle.addEventListener('change', async (e) => {
      await db.settings.update(1, { soundEnabled: e.target.checked });
      loadSoundPrefs(await db.settings.get(1));
      document.getElementById('sound-wrap').classList.toggle('hidden', !e.target.checked);
    });

    const volEl = document.getElementById('sound-volume');
    const volLabel = document.getElementById('vol-label');
    volEl.addEventListener('input', () => { volLabel.textContent = `${toArabicNumeral(volEl.value)}٪`; });
    volEl.addEventListener('change', async () => {
      await db.settings.update(1, { soundVolume: Number(volEl.value) / 100 });
      loadSoundPrefs(await db.settings.get(1));
      previewChime('chime'); // hear the change immediately
    });

    // A chime picker per event, each with its own ▶ — choosing a sound you
    // can't hear is choosing blind, and the change-event alone doesn't help
    // if you want to hear the SAME one twice.
    const evEl = document.getElementById('sound-events');
    const chosen = settings.eventSounds || {};
    evEl.innerHTML = SOUND_EVENTS.map(ev => `
      <div class="sound-event-row">
        <span class="sound-event-label">${ev.label}</span>
        <select class="text-input sound-event-select" data-ev="${ev.key}">
          ${Object.entries(CHIME_LIBRARY).map(([k, c]) =>
            `<option value="${k}" ${(chosen[ev.key] || ev.def) === k ? 'selected' : ''}>${c.label}</option>`).join('')}
        </select>
        <button class="sound-play-btn" data-play="${ev.key}" aria-label="استمعي">▶</button>
      </div>`).join('');
    evEl.querySelectorAll('.sound-event-select').forEach(sel => {
      sel.addEventListener('change', async () => {
        const s2 = await db.settings.get(1);
        const map = { ...(s2.eventSounds || {}), [sel.dataset.ev]: sel.value };
        await db.settings.update(1, { eventSounds: map });
        loadSoundPrefs(await db.settings.get(1));
        previewChime(sel.value);
      });
    });
    evEl.querySelectorAll('[data-play]').forEach(btn => {
      btn.addEventListener('click', () => {
        unlockAudioContext();
        previewChime(chimeKeyFor(btn.dataset.play));
      });
    });
  }

  const hapToggle = document.getElementById('haptics-enabled');
  if (hapToggle) {
    const HAP_LABELS = ['بلا', 'خفيف', 'عادي', 'قوي'];
    const hapEl = document.getElementById('haptics-strength');
    const hapLabel = document.getElementById('hap-label');
    const hapResult = document.getElementById('haptics-test-result');
    const hapText = (v) => HAP_LABELS[Math.min(3, Math.floor(Number(v) / 60))];
    hapLabel.textContent = hapText(hapEl.value);

    hapToggle.addEventListener('change', async (e) => {
      await db.settings.update(1, { hapticsEnabled: e.target.checked });
      loadSoundPrefs(await db.settings.get(1));
      document.getElementById('haptics-wrap').classList.toggle('hidden', !e.target.checked);
    });
    hapEl.addEventListener('input', () => { hapLabel.textContent = hapText(hapEl.value); });
    hapEl.addEventListener('change', async () => {
      await db.settings.update(1, { hapticsStrength: Number(hapEl.value) / 100 });
      loadSoundPrefs(await db.settings.get(1));
      haptic([90, 60, 90]);
    });

    // The test now REPORTS. It was failing silently, which is precisely why
    // it looked broken — you pressed it, nothing happened, and nothing told
    // you why.
    document.getElementById('haptics-test').addEventListener('click', () => {
      if (!hapticsSupported()) {
        hapResult.textContent = `❌ ${hapticsSupportLabel().text}`;
        hapResult.className = 'settings-note haptics-no';
        return;
      }
      const fired = haptic([120, 70, 120, 70, 200]);
      hapResult.textContent = fired
        ? '✅ اهتزّ — إن لم تشعري به، ارفعي القوّة أو تحقّقي من وضع الصامت في جهازك'
        : '⚠️ رفض المتصفّح الاهتزاز. جرّبي بعد لمس الشاشة، وتأكّدي أن الموقع يعمل عبر HTTPS';
      hapResult.className = fired ? 'settings-note haptics-ok' : 'settings-note haptics-no';
    });

    // Which events vibrate — a buzz on every tasbeeh tap is lovely or
    // maddening depending on the person, and that has nothing to do with
    // whether they want a chime at the goal.
    const hapEvEl = document.getElementById('haptic-events');
    const hapMap = settings.eventHaptics || {};
    hapEvEl.innerHTML = HAPTIC_EVENTS.map(ev => `
      <label class="checkbox-row">
        <input type="checkbox" data-hev="${ev.key}" ${(hapMap[ev.key] ?? ev.def) ? 'checked' : ''}>
        <span>${ev.label}</span>
      </label>`).join('');
    hapEvEl.querySelectorAll('[data-hev]').forEach(cb => {
      cb.addEventListener('change', async () => {
        const s2 = await db.settings.get(1);
        const map = { ...(s2.eventHaptics || {}), [cb.dataset.hev]: cb.checked };
        await db.settings.update(1, { eventHaptics: map });
        loadSoundPrefs(await db.settings.get(1));
        if (cb.checked) haptic([80, 50, 80], cb.dataset.hev);
      });
    });
  }

  // ---- notifications ----
  const testBtn = document.getElementById('settings-test-notif');
  if (testBtn) testBtn.addEventListener('click', async () => {
    const ok = await sendTestNotification();
    toast(ok ? '🔔 أُرسل — تحقّقي من إشعاراتك' : '⚠️ لم يُرسل. تحقّقي من إذن الإشعارات');
  });

  const quietToggle = document.getElementById('quiet-hours-toggle');
  if (quietToggle) {
    quietToggle.addEventListener('change', async (e) => {
      await db.settings.update(1, { quietHoursEnabled: e.target.checked });
      document.getElementById('quiet-hours-wrap').classList.toggle('hidden', !e.target.checked);
    });
    document.getElementById('quiet-from').addEventListener('change', async (e) => {
      await db.settings.update(1, { quietHoursFrom: e.target.value });
    });
    document.getElementById('quiet-to').addEventListener('change', async (e) => {
      await db.settings.update(1, { quietHoursTo: e.target.value });
    });
  }
  const suppressToggle = document.getElementById('suppress-open-toggle');
  if (suppressToggle) suppressToggle.addEventListener('change', async (e) => {
    await db.settings.update(1, { suppressWhenOpen: e.target.checked });
  });

  // ---- custom reminders ----
  async function refreshCustomReminders() {
    const el = document.getElementById('custom-reminders-list');
    if (!el) return;
    const items = await getCustomReminders();
    if (items.length === 0) {
      el.innerHTML = `<p class="empty-state-sub">لا تذكيرات خاصة بعد.</p>`;
      return;
    }
    el.innerHTML = items.map(r => `
      <div class="task-row-wrap custom-reminder-row" data-rem="${r.id}">
        <label class="switch"><input type="checkbox" data-rem-toggle="${r.id}" ${r.enabled ? 'checked' : ''}><span class="switch-track"></span></label>
        <div class="custom-reminder-main">
          <span class="custom-reminder-label">${r.emoji} ${escapeHtml(r.label)}</span>
          <span class="custom-reminder-sub">${r.time} · ${reminderDaysLabel(r.days)}</span>
        </div>
        ${kebabMenuHtml('rem-' + r.id, [
          { key: 'edit', label: 'تعديل' },
          { key: 'delete', label: 'حذف', danger: true }
        ])}
      </div>`).join('');

    el.querySelectorAll('[data-rem-toggle]').forEach(cb => {
      cb.addEventListener('change', async () => {
        await updateCustomReminder(Number(cb.dataset.remToggle), { enabled: cb.checked });
        await rescheduleHomeReminders();
      });
    });
    wireKebabMenus(el, async (rowId, action) => {
      const id = Number(rowId.replace('rem-', ''));
      if (action === 'edit') {
        const item = items.find(r => r.id === id);
        openCustomReminderModal(item, refreshCustomReminders);
      } else if (action === 'delete') {
        if (!confirm('حذف هذا التذكير؟')) return;
        await deleteCustomReminder(id);
        await refreshCustomReminders();
        await rescheduleHomeReminders();
      }
    });
  }
  const addRemBtn = document.getElementById('add-custom-reminder');
  if (addRemBtn) {
    addRemBtn.addEventListener('click', () => openCustomReminderModal(null, refreshCustomReminders));
    await refreshCustomReminders();
  }

  wireThemeSection(view);

  wirePhotoPicker('settings-pfp', async (file) => {
    const blob = await resizeImageToBlob(file, 256, 0.85);
    await db.profile.update(1, { pictureBlob: blob });
    document.getElementById('settings-pfp').innerHTML = `<img src="${pictureUrl(blob)}" alt="">`;
  }, async () => {
    await db.profile.update(1, { pictureBlob: null });
    renderSettingsPage(params, view);
  });

  document.getElementById('settings-save-name').addEventListener('click', async () => {
    const val = document.getElementById('settings-name').value.trim();
    if (!val) return;
    await db.profile.update(1, { name: val });
    toast('تم حفظ الاسم');
  });

  let selectedSex = settings.sex ?? 'female';
  document.getElementById('settings-sex-chips').querySelectorAll('.chip').forEach(chip => {
    chip.addEventListener('click', () => {
      selectedSex = chip.dataset.sex;
      document.getElementById('settings-sex-chips').querySelectorAll('.chip').forEach(c => c.classList.toggle('active', c.dataset.sex === selectedSex));
    });
  });
  document.getElementById('settings-save-health').addEventListener('click', async () => {
    const age = readNumericField('settings-age', { int: true });
    const heightCm = readNumericField('settings-height', { int: true });
    if (heightCm != null && (heightCm < 100 || heightCm > 220)) { alert('أدخلي طولاً صحيحاً بالسنتيمتر'); return; }
    if (age != null && (age < 1 || age > 120)) { alert('أدخلي عمراً صحيحاً'); return; }
    await db.settings.update(1, { age, sex: selectedSex, heightCm });
    toast('تم حفظ المعلومات الصحية');
  });

  document.getElementById('settings-save-currency').addEventListener('click', async () => {
    const currency = document.getElementById('settings-currency').value.trim();
    await db.settings.update(1, { currency: currency || null });
    toast('تم حفظ العملة');
  });

  async function renderWelcomePhrasesList() {
    const s = await db.settings.get(1);
    const phrases = (s?.welcomePhrases && s.welcomePhrases.length) ? s.welcomePhrases : WELCOME_PHRASES;
    const listEl = document.getElementById('welcome-phrases-list');
    listEl.innerHTML = phrases.map((p, i) => `
      <div class="txn-row" data-phrase-index="${i}">
        <div class="txn-info"><span class="txn-note">${escapeHtml(p)}</span></div>
        <button class="icon-btn icon-btn-danger" data-remove-phrase="${i}">🗑️</button>
      </div>`).join('');
    listEl.querySelectorAll('[data-remove-phrase]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const idx = Number(btn.dataset.removePhrase);
        const updated = phrases.filter((_, i) => i !== idx);
        await db.settings.update(1, { welcomePhrases: updated });
        await renderWelcomePhrasesList();
      });
    });
  }
  await renderWelcomePhrasesList();
  document.getElementById('add-phrase-btn').addEventListener('click', async () => {
    const input = document.getElementById('new-phrase-input');
    const text = input.value.trim();
    if (!text) return;
    const s = await db.settings.get(1);
    const current = (s?.welcomePhrases && s.welcomePhrases.length) ? s.welcomePhrases : WELCOME_PHRASES;
    await db.settings.update(1, { welcomePhrases: [...current, text] });
    input.value = '';
    await renderWelcomePhrasesList();
  });

  document.getElementById('settings-pin-toggle').addEventListener('change', async (e) => {
    if (e.target.checked) {
      openPinSetupModal(async (pin) => {
        await db.settings.update(1, { pinHash: await hashPin(pin), pinEnabled: true });
        renderRoute();
      }, () => { e.target.checked = false; });
    } else {
      await db.settings.update(1, { pinHash: null, pinEnabled: false });
      renderRoute();
    }
  });

  const changePinBtn = document.getElementById('settings-change-pin');
  if (changePinBtn) changePinBtn.addEventListener('click', () => {
    openPinSetupModal(async (pin) => {
      await db.settings.update(1, { pinHash: await hashPin(pin) });
      toast('تم تغيير الرمز');
    });
  });

  const enableNotifBtn = document.getElementById('settings-enable-notif');
  if (enableNotifBtn) enableNotifBtn.addEventListener('click', async () => {
    const result = await requestNotificationPermission();
    await db.settings.update(1, { notificationsEnabled: result === 'granted' });
    renderRoute();
  });

  document.querySelectorAll('.reminder-cat-toggle').forEach(toggle => {
    toggle.addEventListener('change', async () => {
      const s = await db.settings.get(1);
      const remindersEnabled = { ...(s?.remindersEnabled || {}), [toggle.dataset.cat]: toggle.checked };
      await db.settings.update(1, { remindersEnabled });
      await scheduleAllTodayReminders();
    });
  });
  document.querySelectorAll('.reminder-cat-time').forEach(input => {
    input.addEventListener('change', async () => {
      const s = await db.settings.get(1);
      const reminderTimes = { ...(s?.reminderTimes || {}), [input.dataset.catTime]: input.value };
      await db.settings.update(1, { reminderTimes });
      await scheduleAllTodayReminders();
    });
  });
  document.querySelectorAll('.nudge-item-toggle').forEach(toggle => {
    toggle.addEventListener('change', async () => {
      const s = await db.settings.get(1);
      const current = new Set(s?.nudgeItems || defaultNudgeItemKeys());
      if (toggle.checked) current.add(toggle.dataset.nudge); else current.delete(toggle.dataset.nudge);
      await db.settings.update(1, { nudgeItems: [...current] });
      await scheduleAllTodayReminders();
    });
  });

  document.getElementById('settings-export').addEventListener('click', async () => {
    await exportBackup();
    await db.settings.update(1, { lastBackupAt: Date.now() });
    renderRoute();
  });
  document.getElementById('settings-import').addEventListener('click', () => document.getElementById('settings-import-input').click());
  document.getElementById('settings-import-input').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    e.target.value = ''; // let the same file be re-picked if she cancels

    // Look inside FIRST. The old flow asked "replace everything?" without
    // saying what with — so the only way to find out whether you'd grabbed
    // the right file was to destroy the current one and see.
    let inspected;
    try {
      inspected = await inspectBackup(file);
    } catch (err) {
      console.error(err);
      alert(err.message || 'تعذّرت قراءة ملف النسخة الاحتياطية.');
      return;
    }

    const when = inspected.exportedAt
      ? inspected.exportedAt.toLocaleDateString('ar') + ' — ' + inspected.exportedAt.toLocaleTimeString('ar', { hour: '2-digit', minute: '2-digit' })
      : 'تاريخ غير معروف';
    const items = summariseBackup(inspected);
    const ok = confirm(
      `📦 نسخة احتياطية\n` +
      `التاريخ: ${when}\n` +
      (inspected.profileName ? `الاسم: ${inspected.profileName}\n` : '') +
      `تحتوي: ${toArabicNumeral(inspected.totalRows)} سجلاً · ${toArabicNumeral(inspected.photoCount)} صورة\n` +
      (items.length ? `\n${items.join('\n')}\n` : '') +
      `\n⚠️ سيُستبدل كل ما هو موجود الآن بهذه البيانات. متأكدة؟`
    );
    if (!ok) return;

    try {
      await applyBackup(inspected);
      alert('تمت الاستعادة بنجاح. سيُعاد تحميل التطبيق الآن.');
      location.reload();
    } catch (err) {
      console.error(err);
      alert('فشلت الاستعادة — لم تتغيّر بياناتك الحالية.');
    }
  });

  document.getElementById('settings-bottombar-toggle').addEventListener('change', async (e) => {
    await db.settings.update(1, { bottomBarEnabled: e.target.checked });
    document.getElementById('bottombar-items-wrap').classList.toggle('hidden', !e.target.checked);
    renderBottomBar();
  });
  document.querySelectorAll('#bottombar-items-wrap input[data-bbkey]').forEach(cb => {
    cb.addEventListener('change', async () => {
      const checked = Array.from(document.querySelectorAll('#bottombar-items-wrap input[data-bbkey]:checked')).map(el => el.dataset.bbkey);
      await db.settings.update(1, { bottomBarItems: checked });
      renderBottomBar();
    });
  });
}

function openPinSetupModal(onSet, onCancel) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal">
      <h2 class="modal-title">رمز جديد</h2>
      <p class="wizard-sub" id="modal-pin-sub">اكتبي رمزًا من ٤ أرقام</p>
      <div class="pin-dots" id="modal-pin-dots"><span></span><span></span><span></span><span></span></div>
      <div class="pin-pad" id="modal-pin-pad"></div>
      <button class="btn btn-text" id="modal-pin-cancel">إلغاء</button>
    </div>`;
  document.body.appendChild(overlay);
  let firstPin = null;
  buildPinPad('modal-pin-pad', 'modal-pin-dots', (entered) => {
    if (!firstPin) {
      firstPin = entered;
      document.getElementById('modal-pin-sub').textContent = 'أعيدي كتابة الرمز للتأكيد';
    } else if (firstPin === entered) {
      overlay.remove();
      onSet(firstPin);
    } else {
      firstPin = null;
      document.getElementById('modal-pin-sub').textContent = 'الرمزان غير متطابقين، حاولي من جديد';
      document.getElementById('modal-pin-dots').classList.add('shake');
      setTimeout(() => document.getElementById('modal-pin-dots')?.classList.remove('shake'), 400);
    }
  });
  document.getElementById('modal-pin-cancel').addEventListener('click', () => { overlay.remove(); onCancel && onCancel(); });
}

// ---------- tiny toast helper (used across modules) ----------

function toast(message) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = message;
  document.body.appendChild(el);
  requestAnimationFrame(() => el.classList.add('visible'));
  setTimeout(() => { el.classList.remove('visible'); setTimeout(() => el.remove(), 300); }, 2200);
}
