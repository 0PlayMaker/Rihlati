// reminders.js — best-effort local reminders for Fixed Tasks.
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

// Schedules whatever is left of today's fixed-task reminders as in-page
// timers. Safe to call repeatedly (e.g. on every Home render) — it clears
// old timers first so nothing double-fires.
function scheduleTodayReminders(fixedTasks, isDoneToday) {
  clearScheduledReminders();
  if (notificationStatus() !== 'granted') return;
  const now = new Date();
  for (const task of fixedTasks) {
    if (!task.reminderTime || task.archived) continue;
    if (isDoneToday(task.id)) continue;
    const [h, m] = task.reminderTime.split(':').map(Number);
    const when = new Date();
    when.setHours(h, m, 0, 0);
    const delay = when - now;
    if (delay > 0 && delay < 24 * 60 * 60 * 1000) {
      const t = setTimeout(() => fireNotification('رحلتي 🌸', `تذكير: ${task.title}`), delay);
      scheduledTimers.push(t);
    }
  }
}

// Called on load and on visibility change: catches reminders whose time
// passed while the app was closed, so opening the app surfaces them
// instead of losing them silently.
async function checkMissedReminders(fixedTasks, isDoneToday) {
  if (notificationStatus() !== 'granted') return;
  const now = new Date();
  const lastCheckKey = 'rahlati_last_reminder_check';
  const lastCheckRaw = localStorage.getItem(lastCheckKey);
  const lastCheck = lastCheckRaw ? new Date(lastCheckRaw) : new Date(now.getTime() - 60 * 60 * 1000);

  for (const task of fixedTasks) {
    if (!task.reminderTime || task.archived) continue;
    if (isDoneToday(task.id)) continue;
    const [h, m] = task.reminderTime.split(':').map(Number);
    const when = new Date();
    when.setHours(h, m, 0, 0);
    if (when <= now && when > lastCheck) {
      fireNotification('رحلتي 🌸', `تذكير لم يفتك بعد: ${task.title}`);
    }
  }
  localStorage.setItem(lastCheckKey, now.toISOString());
}
