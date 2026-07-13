// reminders.js — best-effort local reminders, covering multiple
// features via a shared provider registry (same pattern as Day
// Detail/Yearly Overview) rather than being hard-coded to just Fixed
// Tasks the way this started out.
//
// Being upfront about a real platform limit: a static, server-free PWA
// can only reliably fire a notification while the browser/app process is
// alive (open, or backgrounded but not fully closed/killed). There is no
// standard, widely-supported way for a website to wake up the OS at an
// exact time while completely closed — that needs either Push
// notifications (which requires a server, ruled out on purpose here) or
// a native app. So this module does two honest things instead:
//   1. While the app is open, it schedules today's remaining reminders
//      as in-page timers.
//   2. Every time the app is opened or comes back to the foreground, it
//      checks for anything that was due while it was closed and shows it
//      then — "missed while closed" becomes "here's what's due" instead
//      of silently vanishing.

let scheduledTimers = [];
let reminderProviders = [];

// A provider is async (settings) => [{ time: 'HH:MM', title, body }].
// Each one decides for itself whether it has anything to say today
// (e.g. skip if already done, or if she's disabled that category) —
// this file doesn't need to know what any of them mean.
function registerReminderProvider(fn) {
  reminderProviders.push(fn);
}

async function requestNotificationPermission() {
  if (!('Notification' in window)) return 'unsupported';
  if (Notification.permission === 'granted') return 'granted';
  if (Notification.permission === 'denied') return 'denied';
  return await Notification.requestPermission();
}

function notificationStatus() {
  if (!('Notification' in window)) return 'unsupported';
  return Notification.permission; // 'granted' | 'denied' | 'default'
}

// Quiet hours: a reminder that wakes you at 3am is not a reminder, it's a
// reason to turn notifications off entirely. Handles the wrap-around case
// (22:00 → 07:00 crosses midnight) rather than assuming start < end.
function isWithinQuietHours(settings, at = new Date()) {
  if (!settings?.quietHoursEnabled) return false;
  const from = settings.quietHoursFrom || '22:30';
  const to = settings.quietHoursTo || '07:00';
  const [fh, fm] = from.split(':').map(Number);
  const [th, tm] = to.split(':').map(Number);
  const mins = at.getHours() * 60 + at.getMinutes();
  const fromM = fh * 60 + fm;
  const toM = th * 60 + tm;
  return fromM <= toM
    ? (mins >= fromM && mins < toM)          // same-day window
    : (mins >= fromM || mins < toM);         // wraps past midnight
}

async function fireNotification(title, body, { force = false } = {}) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return false;

  const settings = await db.settings.get(1);

  // Don't notify about something she is literally looking at. A push for
  // "drink water" while the water card is on screen is pure noise — the
  // app is already the notification.
  if (!force && settings?.suppressWhenOpen !== false && document.visibilityState === 'visible') {
    return false;
  }
  if (!force && isWithinQuietHours(settings)) return false;

  try {
    if (navigator.serviceWorker && navigator.serviceWorker.controller) {
      const reg = await navigator.serviceWorker.ready;
      reg.showNotification(title, { body, icon: 'icons/icon-192.png', badge: 'icons/icon-192.png' });
    } else {
      new Notification(title, { body, icon: 'icons/icon-192.png' });
    }
    return true;
  } catch (err) {
    console.error('Notification failed:', err);
    return false;
  }
}

// "Did it actually work?" is the first thing anyone wants to know after
// granting permission, and there was no way to find out.
async function sendTestNotification() {
  const ok = await fireNotification('رحلتي 🌸', 'التذكيرات تعمل ✅', { force: true });
  return ok;
}

function clearScheduledReminders() {
  scheduledTimers.forEach(t => clearTimeout(t));
  scheduledTimers = [];
}

async function collectTodayReminders() {
  const settings = await db.settings.get(1);
  let all = [];
  for (const provider of reminderProviders) {
    try {
      const items = await provider(settings);
      if (items && items.length) all = all.concat(items);
    } catch (e) { console.error('Reminder provider failed:', e); }
  }
  return all;
}

// Schedules whatever is left of today's reminders (across every
// registered provider) as in-page timers. Safe to call repeatedly
// (e.g. on every Home render) — it clears old timers first so nothing
// double-fires.
async function scheduleAllTodayReminders() {
  clearScheduledReminders();
  if (notificationStatus() !== 'granted') return;
  const items = await collectTodayReminders();
  const now = new Date();
  for (const item of items) {
    const [h, m] = item.time.split(':').map(Number);
    const when = new Date();
    when.setHours(h, m, 0, 0);
    const delay = when - now;
    if (delay > 0 && delay < 24 * 60 * 60 * 1000) {
      const t = setTimeout(() => fireNotification(item.title, item.body), delay);
      scheduledTimers.push(t);
    }
  }
}

// Called on load and on visibility change: catches reminders whose time
// passed while the app was closed, so opening the app surfaces them
// instead of losing them silently.
async function checkAllMissedReminders() {
  if (notificationStatus() !== 'granted') return;
  const now = new Date();
  const lastCheckKey = 'rahlati_last_reminder_check';
  const lastCheckRaw = localStorage.getItem(lastCheckKey);
  const lastCheck = lastCheckRaw ? new Date(lastCheckRaw) : new Date(now.getTime() - 60 * 60 * 1000);

  const items = await collectTodayReminders();
  for (const item of items) {
    const [h, m] = item.time.split(':').map(Number);
    const when = new Date();
    when.setHours(h, m, 0, 0);
    if (when <= now && when > lastCheck) {
      fireNotification(item.title, item.body);
    }
  }
  localStorage.setItem(lastCheckKey, now.toISOString());
}

// ============================================================
//  Custom reminders
// ============================================================
// Medication, an appointment, prayer times she enters by hand — the six
// built-in categories can't express any of those, and they're the things
// people most want a reminder for.

const WEEKDAY_LABELS = ['أحد', 'اثنين', 'ثلاثاء', 'أربعاء', 'خميس', 'جمعة', 'سبت'];

async function getCustomReminders() {
  const all = await db.customReminders.toArray();
  return all.sort((a, b) => (a.time || '').localeCompare(b.time || ''));
}
async function addCustomReminder({ label, emoji, time, days }) {
  return db.customReminders.add({
    label,
    emoji: emoji || '🔔',
    time,
    days: (days && days.length) ? days : [0, 1, 2, 3, 4, 5, 6], // every day by default
    enabled: true,
    createdAt: Date.now()
  });
}
async function updateCustomReminder(id, fields) {
  await db.customReminders.update(id, fields);
}
async function deleteCustomReminder(id) {
  await db.customReminders.delete(id);
}

function reminderDaysLabel(days) {
  if (!days || days.length === 7) return 'كل يوم';
  if (days.length === 0) return 'لا أيام';
  return days.slice().sort().map(d => WEEKDAY_LABELS[d]).join('، ');
}

// The editor for a custom reminder.
function openCustomReminderModal(existing, onSaved) {
  const days = existing?.days || [0, 1, 2, 3, 4, 5, 6];
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal modal-lg">
      <h2 class="modal-title">${existing ? 'تعديل التذكير' : 'تذكير جديد'}</h2>

      <div class="rem-emoji-row">
        <input class="text-input emoji-input" id="rem-emoji" maxlength="2" value="${existing?.emoji || '🔔'}">
        <input class="text-input" id="rem-label" placeholder="مثلاً: حبة الفيتامين" value="${existing ? escapeHtml(existing.label) : ''}" autofocus>
      </div>

      <label class="field-label">الوقت</label>
      <input class="text-input" type="time" id="rem-time" value="${existing?.time || '09:00'}">

      <label class="field-label">الأيام</label>
      <div class="rem-days-row" id="rem-days">
        ${WEEKDAY_LABELS.map((d, i) => `
          <button class="rem-day ${days.includes(i) ? 'active' : ''}" data-day="${i}">${d}</button>`).join('')}
      </div>

      <div class="modal-actions">
        <button class="btn btn-text" id="rem-cancel">إلغاء</button>
        <button class="btn btn-primary" id="rem-save">حفظ</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  const picked = new Set(days);
  overlay.querySelectorAll('.rem-day').forEach(btn => {
    btn.addEventListener('click', () => {
      const d = Number(btn.dataset.day);
      if (picked.has(d)) picked.delete(d); else picked.add(d);
      btn.classList.toggle('active');
    });
  });

  document.getElementById('rem-cancel').addEventListener('click', () => overlay.remove());
  document.getElementById('rem-save').addEventListener('click', async () => {
    const label = document.getElementById('rem-label').value.trim();
    if (!label) return;
    const emoji = document.getElementById('rem-emoji').value.trim() || '🔔';
    const time = document.getElementById('rem-time').value;
    const daysArr = [...picked].sort();
    if (daysArr.length === 0) { alert('اختاري يوماً واحداً على الأقل'); return; }

    if (existing) await updateCustomReminder(existing.id, { label, emoji, time, days: daysArr });
    else await addCustomReminder({ label, emoji, time, days: daysArr });
    overlay.remove();
    if (onSaved) await onSaved();
    if (typeof rescheduleHomeReminders === 'function') await rescheduleHomeReminders();
    toast('🔔 تم الحفظ');
  });
}
