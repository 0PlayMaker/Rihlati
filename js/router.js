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

async function renderRoute() {
  const path = currentPath();
  const segments = path.split('/').filter(Boolean); // e.g. ['day','2026-07-04']
  const base = '/' + (segments[0] || 'home');
  const params = segments.slice(1);
  const handler = routes[base] || routes['/home'];
  const view = document.getElementById('view');
  if (!view) return;
  try {
    await handler(params, view);
  } catch (err) {
    console.error('Route render failed:', err);
    view.innerHTML = '<div class="empty-state"><p>حدث خطأ غير متوقع في هذه الشاشة.</p></div>';
  }
  window.scrollTo(0, 0);
}

function goTo(path) {
  if (location.hash.slice(1) === path) {
    renderRoute();
  } else {
    location.hash = path;
  }
}

window.addEventListener('hashchange', renderRoute);
