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
  { key: 'tasks', label: 'المهام الثابتة', hasTime: false, note: 'كل مهمة تحدّد وقتها بنفسها' },
  { key: 'water', label: '💧 الماء', hasTime: true, defaultTime: '15:00' },
  { key: 'adhkarMorning', label: '🌅 أذكار الصباح', hasTime: true, defaultTime: '06:00' },
  { key: 'adhkarEvening', label: '🌙 أذكار المساء', hasTime: true, defaultTime: '18:00' },
  { key: 'wird', label: '📖 ورد القرآن', hasTime: true, defaultTime: '20:00' },
  { key: 'sleep', label: '😴 تذكير النوم', hasTime: true, defaultTime: '22:30' }
];

function renderReminderCategoriesHtml(settings) {
  const enabled = settings?.remindersEnabled || {};
  const times = settings?.reminderTimes || {};
  return `
    <div class="reminder-categories">
      ${REMINDER_CATEGORIES.map(cat => `
        <div class="reminder-category-row">
          <label class="switch"><input type="checkbox" class="reminder-cat-toggle" data-cat="${cat.key}" ${(cat.key === 'tasks' ? enabled.tasks !== false : !!enabled[cat.key]) ? 'checked' : ''}><span class="switch-track"></span></label>
          <span class="reminder-cat-label">${cat.label}</span>
          ${cat.hasTime ? `<input type="time" class="text-input reminder-cat-time" data-cat-time="${cat.key}" value="${times[cat.key] || cat.defaultTime}">` : `<span class="settings-note">${cat.note}</span>`}
        </div>`).join('')}
    </div>`;
}

async function renderSettingsPage(params, view) {
  const profile = await db.profile.get(1);
  const settings = await db.settings.get(1);
  const notifStatus = notificationStatus();

  view.innerHTML = `
    <div class="page-header">
      <button class="icon-btn" id="settings-back">→</button>
      <h1>الإعدادات</h1>
    </div>

    ${renderThemeSection(settings?.themeMode, settings?.accentColor, settings?.accentColorHistory, settings?.customBgColor, settings?.customModalBgColor)}

    <div class="card settings-card">
      <div class="pfp-preview pfp-small" id="settings-pfp">${profile.pictureBlob ? `<img src="${pictureUrl(profile.pictureBlob)}" alt="">` : '🌸'}</div>
      ${photoPickerHtml('settings-pfp', { withRemove: !!profile.pictureBlob })}
      <label class="field-label">الاسم</label>
      <input class="text-input" id="settings-name" value="${escapeHtml(profile.name)}">
      <button class="btn btn-primary btn-sm" id="settings-save-name">حفظ الاسم</button>
    </div>

    <div class="card settings-card">
      <h2 class="card-title">المعلومات الصحية</h2>
      <label class="field-label">العمر</label>
      <input class="text-input" type="number" id="settings-age" value="${settings.age ?? ''}" placeholder="مثلاً: 28">
      <label class="field-label">الجنس</label>
      <div class="sex-chips" id="settings-sex-chips">
        <button class="chip ${(settings.sex ?? 'female') === 'female' ? 'active' : ''}" data-sex="female">أنثى</button>
        <button class="chip ${settings.sex === 'male' ? 'active' : ''}" data-sex="male">ذكر</button>
      </div>
      <label class="field-label">الطول (سم)</label>
      <input class="text-input" type="number" id="settings-height" value="${settings.heightCm ?? ''}" placeholder="مثلاً: 165">
      <button class="link-btn" id="settings-save-health">حفظ المعلومات الصحية</button>
      <p class="settings-note">تُستخدم لحساب مؤشر كتلة الجسم في صفحة الوزن.</p>
    </div>

    <div class="card settings-card">
      <h2 class="card-title">العملة</h2>
      <input class="text-input" id="settings-currency" value="${escapeHtml(settings.currency || '')}" placeholder="دينار">
      <button class="link-btn" id="settings-save-currency">حفظ</button>
    </div>

    <div class="card settings-card">
      <h2 class="card-title">عبارات الترحيب</h2>
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

    <div class="card settings-card">
      <div class="settings-row">
        <span>رمز الحماية (PIN)</span>
        <label class="switch"><input type="checkbox" id="settings-pin-toggle" ${settings.pinEnabled ? 'checked' : ''}><span class="switch-track"></span></label>
      </div>
      <div id="settings-pin-change-wrap" class="${settings.pinEnabled ? '' : 'hidden'}">
        <button class="link-btn" id="settings-change-pin">تغيير الرمز</button>
      </div>
    </div>

    <div class="card settings-card">
      <div class="settings-row">
        <span>الإشعارات والتذكيرات</span>
        <span class="settings-status">${notifStatus === 'granted' ? 'مفعّلة ✅' : notifStatus === 'denied' ? 'محظورة من الجهاز' : 'غير مفعّلة'}</span>
      </div>
      ${notifStatus !== 'granted' && notifStatus !== 'unsupported' ? `<button class="btn btn-secondary btn-sm" id="settings-enable-notif">تفعيل الإشعارات</button>` : ''}
      <p class="settings-note">ملاحظة: التطبيق محلي بالكامل بدون سيرفر، فالتذكيرات تعمل بشكل موثوق أثناء تشغيل التطبيق، وتظهر التذكيرات الفائتة عند فتحه من جديد.</p>
      ${notifStatus === 'granted' ? renderReminderCategoriesHtml(settings) : ''}
    </div>

    <div class="card settings-card">
      <div class="settings-row"><span>نسخة احتياطية</span></div>
      <p class="settings-note">${settings.lastBackupAt ? 'آخر نسخة احتياطية: ' + new Date(settings.lastBackupAt).toLocaleDateString('ar') : 'لم تُنشأ نسخة احتياطية بعد'}</p>
      <button class="btn btn-primary btn-sm" id="settings-export">تنزيل نسخة احتياطية</button>
      <input type="file" accept=".zip" id="settings-import-input" class="hidden-file-input">
      <button class="btn btn-secondary btn-sm" id="settings-import">استعادة من نسخة احتياطية</button>
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

    <div class="card settings-card credit-settings-card">
      ${creditBlockHtml()}
    </div>

    <p class="app-footer">🌸 رحلتي — نسخة محلية بالكامل، بياناتك لا تغادر هذا الجهاز أبدًا</p>
    <p class="app-version">الإصدار: ${APP_VERSION}</p>
  `;

  document.getElementById('settings-back').addEventListener('click', () => history.back());
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
    const ageRaw = document.getElementById('settings-age').value;
    const heightRaw = document.getElementById('settings-height').value;
    const age = ageRaw === '' ? null : parseInt(ageRaw, 10);
    const heightCm = heightRaw === '' ? null : parseInt(heightRaw, 10);
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

  document.getElementById('settings-export').addEventListener('click', async () => {
    await exportBackup();
    await db.settings.update(1, { lastBackupAt: Date.now() });
    renderRoute();
  });
  document.getElementById('settings-import').addEventListener('click', () => document.getElementById('settings-import-input').click());
  document.getElementById('settings-import-input').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (!confirm('سيتم استبدال جميع البيانات الحالية بالبيانات من النسخة الاحتياطية. هل أنتِ متأكدة؟')) return;
    try {
      await importBackup(file);
      alert('تمت الاستعادة بنجاح. سيُعاد تحميل التطبيق الآن.');
      location.reload();
    } catch (err) {
      console.error(err);
      alert('تعذّرت قراءة ملف النسخة الاحتياطية. تأكدي أنه الملف الصحيح.');
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
