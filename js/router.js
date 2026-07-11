// router.js — tiny hash-based router.
// Using the URL hash (#/habits, #/day/2026-07-04, ...) means the phone's
// back gesture moves between screens in the app instead of immediately
// closing it, without needing any routing library.

const routes = {};

function route(base, renderFn) {
  routes[base] = renderFn;
}

function currentPath() {
  return location.hash.slice(1) || '/home';
}

let _renderToken = 0;

// ---------- page teardown ----------
// The router swaps view.innerHTML on every navigation, which detaches
// the old page's DOM — but anything the old page started OUTSIDE the
// DOM keeps running: setInterval timers tick forever against dead
// nodes (visit Study five times, get five zombie pomodoros all still
// beeping), and every URL.createObjectURL() for a photo pins that
// whole blob in memory until the tab closes. Pages register their
// cleanup here and it runs right before the next route renders, so
// this is fixed in ONE place instead of being re-remembered in every
// page that ever adds a timer or shows an image.
let _cleanups = [];
function registerCleanup(fn) {
  if (typeof fn === 'function') _cleanups.push(fn);
}
function runCleanups() {
  const fns = _cleanups;
  _cleanups = [];
  fns.forEach(fn => {
    try { fn(); } catch (err) { console.error('Cleanup failed:', err); }
  });
}

// Route handlers that do a lot of awaiting BEFORE their first
// view.innerHTML assignment (renderHome especially) can call this right
// before writing to the DOM, to bail out quietly if a newer navigation
// already started and finished while they were still loading — without
// this, a slow render finishing late could overwrite a page the person
// has already moved past, even though the error-path guard below
// already stops that from happening on a THROWN failure.
function isCurrentRenderToken(token) {
  return token === _renderToken;
}

async function renderRoute() {
  runCleanups(); // tear the previous page down before building the next
  const myToken = ++_renderToken;
  const path = currentPath();
  const segments = path.split('/').filter(Boolean); // e.g. ['day','2026-07-04']
  const base = '/' + (segments[0] || 'home');
  const params = segments.slice(1);
  const handler = routes[base] || routes['/home'];
  const view = document.getElementById('view');
  if (!view) return;
  try {
    await handler(params, view, myToken);
  } catch (err) {
    console.error('Route render failed:', err);
    // A newer navigation may have already started while this one was
    // still finishing (Home in particular does a lot of sequential
    // loading now) — don't let a stale failure stomp on a screen the
    // person has already moved past.
    if (myToken === _renderToken) {
      view.innerHTML = '<div class="empty-state"><p>حدث خطأ غير متوقع في هذه الشاشة.</p></div>';
    }
  }
  if (myToken === _renderToken) window.scrollTo(0, 0);
}

function goTo(path) {
  if (location.hash.slice(1) === path) {
    renderRoute();
  } else {
    location.hash = path;
  }
}

window.addEventListener('hashchange', renderRoute);
