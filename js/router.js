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

// A pending "scroll to this section after the next render" request. The
// router owns this because the router is what resets the scroll position —
// a caller scrolling on its own gets immediately overridden.
let _pendingSection = null;
function requestSectionScroll(anchor) {
  _pendingSection = anchor || null;
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
  if (myToken !== _renderToken) return;

  const anchor = _pendingSection;
  _pendingSection = null;

  if (!anchor) {
    window.scrollTo(0, 0);
    return;
  }

  // Scrolling to a section is the ONLY case where the top-reset must not
  // run — it was firing after the caller's scrollIntoView and dragging the
  // page straight back up, so the card would highlight and then sit there
  // off-screen. Land at the top first, then walk down to the section once
  // the page has actually painted.
  window.scrollTo(0, 0);

  const settle = (attempt = 0) => {
    const el = document.getElementById(anchor);
    if (!el) {
      if (attempt < 40) requestAnimationFrame(() => settle(attempt + 1));
      return;
    }
    scrollToElement(el);
    // Sections below often finish loading a beat later and shift the layout,
    // which would leave the target off-screen again. Re-aim a couple of
    // times rather than trusting one shot.
    setTimeout(() => scrollToElement(el), 250);
    setTimeout(() => {
      scrollToElement(el);
      el.classList.add('section-flash');
      setTimeout(() => el.classList.remove('section-flash'), 1400);
    }, 600);
  };
  requestAnimationFrame(() => settle());
}

// Scroll an element into view, allowing for the fixed bottom bar so the
// target doesn't end up hidden underneath it.
function scrollToElement(el) {
  try {
    const rect = el.getBoundingClientRect();
    const y = window.scrollY + rect.top - 80; // clear the header comfortably
    if (typeof window.scrollTo === 'function') {
      window.scrollTo({ top: Math.max(0, y), behavior: 'smooth' });
    }
  } catch (e) {
    // A missed scroll is not worth breaking navigation over.
  }
}

function goTo(path) {
  if (location.hash.slice(1) === path) {
    renderRoute();
  } else {
    location.hash = path;
  }
}

window.addEventListener('hashchange', renderRoute);
