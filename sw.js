// sw.js — cache-first app shell. First load needs network; every load
// after that works fully offline, including on a fresh phone reboot.

const CACHE_NAME = 'rahlati-v41';

const ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './css/style.css',
  './fonts/files/tajawal-arabic-400-normal.woff2',
  './fonts/files/tajawal-arabic-500-normal.woff2',
  './fonts/files/tajawal-arabic-700-normal.woff2',
  './fonts/files/tajawal-arabic-800-normal.woff2',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
  './icons/favicon-32.png',
  './js/vendor/dexie.min.js',
  './js/vendor/jszip.min.js',
  './js/db.js',
  './js/theme.js',
  './js/streaks.js',
  './js/router.js',
  './js/reminders.js',
  './js/ui-shared.js',
  './js/profile.js',
  './js/habits.js',
  './js/tasks.js',
  './js/worship.js',
  './js/mood.js',
  './js/period.js',
  './js/food.js',
  './js/body.js',
  './js/sleep.js',
  './js/dailycare.js',
  './js/goals.js',
  './js/diary.js',
  './js/economy.js',
  './js/recipes.js',
  './js/training.js',
  './js/courses.js',
  './js/calendar.js',
  './js/backup.js',
  './js/app.js'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(resp => {
        const clone = resp.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(e.request, clone));
        return resp;
      }).catch(() => cached);
    })
  );
});
