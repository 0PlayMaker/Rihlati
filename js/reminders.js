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

async function fireNotification(title, body) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  try {
    if (navigator.serviceWorker && navigator.serviceWorker.controller) {
      const reg = await navigator.serviceWorker.ready;
      reg.showNotification(title, { body, icon: 'icons/icon-192.png', badge: 'icons/icon-192.png' });
    } else {
      new Notification(title, { body, icon: 'icons/icon-192.png' });
    }
  } catch (err) {
    console.error('Notification failed:', err);
  }
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
