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

function pickWelcomePhrase() { return pickRotating(WELCOME_PHRASES, 'rahlati_last_welcome'); }
function pickHabitMotivation() { return pickRotating(HABIT_MOTIVATION, 'rahlati_last_habit_tip'); }

// ---------- first-run setup wizard ----------

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
        <input type="file" accept="image/*" id="wz-pfp-input" class="hidden-file-input">
        <button class="btn btn-secondary btn-block" id="wz-choose-pic">اختيار صورة</button>
        <div class="wizard-actions">
          <button class="btn btn-text" id="wz-skip2">تخطي</button>
          <button class="btn btn-primary" id="wz-next2">التالي</button>
        </div>
      </div>`;
    const preview = document.getElementById('wz-pfp-preview');
    document.getElementById('wz-choose-pic').addEventListener('click', () => document.getElementById('wz-pfp-input').click());
    document.getElementById('wz-pfp-input').addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        state.pictureBlob = await resizeImageToBlob(file, 256, 0.85);
        preview.innerHTML = `<img src="${pictureUrl(state.pictureBlob)}" alt="">`;
      } catch { /* silently keep previous state if the image failed to load */ }
    });
    document.getElementById('wz-skip2').addEventListener('click', step3);
    document.getElementById('wz-next2').addEventListener('click', step3);
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
    startApp(await db.profile.get(1), await db.settings.get(1));
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

async function renderSettingsPage(params, view) {
  const profile = await db.profile.get(1);
  const settings = await db.settings.get(1);
  const notifStatus = notificationStatus();

  view.innerHTML = `
    <div class="page-header">
      <button class="icon-btn" id="settings-back">→</button>
      <h1>الإعدادات</h1>
    </div>

    <div class="card settings-card">
      <div class="pfp-preview pfp-small" id="settings-pfp">${profile.pictureBlob ? `<img src="${pictureUrl(profile.pictureBlob)}" alt="">` : '🌸'}</div>
      <input type="file" accept="image/*" id="settings-pfp-input" class="hidden-file-input">
      <button class="btn btn-secondary btn-sm" id="settings-change-pic">تغيير الصورة</button>
      <label class="field-label">الاسم</label>
      <input class="text-input" id="settings-name" value="${escapeHtml(profile.name)}">
      <button class="btn btn-primary btn-sm" id="settings-save-name">حفظ الاسم</button>
    </div>

    <div class="card settings-card">
      <div class="settings-row">
        <span>رمز الحماية (PIN)</span>
        <label class="switch"><input type="checkbox" id="settings-pin-toggle" ${settings.pinEnabled ? 'checked' : ''}><span class="switch-track"></span></label>
      </div>
      <div id="settings-pin-change-wrap" class="${settings.pinEnabled ? '' : 'hidden'}">
        <button class="btn btn-secondary btn-sm" id="settings-change-pin">تغيير الرمز</button>
      </div>
    </div>

    <div class="card settings-card">
      <div class="settings-row">
        <span>الإشعارات والتذكيرات</span>
        <span class="settings-status">${notifStatus === 'granted' ? 'مفعّلة ✅' : notifStatus === 'denied' ? 'محظورة من الجهاز' : 'غير مفعّلة'}</span>
      </div>
      ${notifStatus !== 'granted' && notifStatus !== 'unsupported' ? `<button class="btn btn-secondary btn-sm" id="settings-enable-notif">تفعيل الإشعارات</button>` : ''}
      <p class="settings-note">ملاحظة: التطبيق محلي بالكامل بدون سيرفر، فالتذكيرات تعمل بشكل موثوق أثناء تشغيل التطبيق، وتظهر التذكيرات الفائتة عند فتحه من جديد.</p>
    </div>

    <div class="card settings-card">
      <div class="settings-row"><span>نسخة احتياطية</span></div>
      <p class="settings-note">${settings.lastBackupAt ? 'آخر نسخة احتياطية: ' + new Date(settings.lastBackupAt).toLocaleDateString('ar') : 'لم تُنشأ نسخة احتياطية بعد'}</p>
      <button class="btn btn-primary btn-sm" id="settings-export">تنزيل نسخة احتياطية</button>
      <input type="file" accept=".zip" id="settings-import-input" class="hidden-file-input">
      <button class="btn btn-secondary btn-sm" id="settings-import">استعادة من نسخة احتياطية</button>
    </div>

    <p class="app-footer">🌸 رحلتي — نسخة محلية بالكامل، بياناتك لا تغادر هذا الجهاز أبدًا</p>
  `;

  document.getElementById('settings-back').addEventListener('click', () => history.back());

  document.getElementById('settings-change-pic').addEventListener('click', () => document.getElementById('settings-pfp-input').click());
  document.getElementById('settings-pfp-input').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const blob = await resizeImageToBlob(file, 256, 0.85);
    await db.profile.update(1, { pictureBlob: blob });
    document.getElementById('settings-pfp').innerHTML = `<img src="${pictureUrl(blob)}" alt="">`;
  });

  document.getElementById('settings-save-name').addEventListener('click', async () => {
    const val = document.getElementById('settings-name').value.trim();
    if (!val) return;
    await db.profile.update(1, { name: val });
    toast('تم حفظ الاسم');
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
