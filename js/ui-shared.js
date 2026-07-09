// ui-shared.js — rendering pieces used by more than one feature.
// Habits and Fard prayers both need the exact same ❤️/💔/↩️ interaction
// and the exact same two-tone ring. One component, two call sites.

// Resizes+compresses an image client-side before it ever touches
// IndexedDB. Profile picture uses a small maxDim (it's only ever a
// circle avatar); Food calls this with a larger one since photos get
// viewed bigger.
function resizeImageToBlob(file, maxDim = 256, quality = 0.85) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      let { width, height } = img;
      if (width > height) {
        if (width > maxDim) { height = Math.round(height * (maxDim / width)); width = maxDim; }
      } else {
        if (height > maxDim) { width = Math.round(width * (maxDim / height)); height = maxDim; }
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      canvas.getContext('2d').drawImage(img, 0, 0, width, height);
      canvas.toBlob(blob => {
        URL.revokeObjectURL(url);
        blob ? resolve(blob) : reject(new Error('toBlob failed'));
      }, 'image/jpeg', quality);
    };
    img.onerror = (e) => { URL.revokeObjectURL(url); reject(e); };
    img.src = url;
  });
}

function renderRing({ size = 120, strokeWidth = 14, segments }) {
  const r = (size - strokeWidth) / 2;
  const c = 2 * Math.PI * r;
  const center = size / 2;
  let acc = 0;
  const arcs = segments.map(seg => {
    if (seg.frac <= 0) return '';
    const len = seg.frac * c;
    const dash = `${len} ${c - len}`;
    const offset = -acc;
    acc += len;
    return `<circle cx="${center}" cy="${center}" r="${r}" fill="none" stroke="${seg.color}" stroke-width="${strokeWidth}" stroke-dasharray="${dash}" stroke-dashoffset="${offset}" stroke-linecap="round" transform="rotate(-90 ${center} ${center})"/>`;
  }).join('');
  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" class="ring-svg">
    <circle cx="${center}" cy="${center}" r="${r}" fill="none" stroke="var(--track)" stroke-width="${strokeWidth}"/>
    ${arcs}
  </svg>`;
}

// Returns one month's worth of grid cells as date strings, with `null`
// padding for the leading empty cells before day 1 — shared by Home's
// calendar and the Period page's calendar so date math (leap years,
// month lengths) lives in exactly one place.
function monthGridDates(year, month) {
  const firstDow = new Date(year, month, 1).getDay();
  const numDays = new Date(year, month + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < firstDow; i++) cells.push(null);
  for (let d = 1; d <= numDays; d++) {
    cells.push(`${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
  }
  return cells;
}

// ---------- streak stats (streak / total succeeded / total failed) ----------
// Two flavors, since not everything has an explicit "missed" marking:
//  - Habits and Fard log an explicit status ('done' or 'missed'), so
//    "failed" is just a count of the explicit misses.
//  - Sunnah, adhkar-after, daily adhkar, and custom adhkar are presence-
//    only (no relapse button) — "failed" there is implicit: every day
//    since the first-ever log where it wasn't marked counts as a miss,
//    same logic the streak engine already uses to break a streak on an
//    unmarked past day, just accumulated into a total instead of reset.

function computeStreakStats(doneDates, missedDates, pauses = []) {
  return {
    streak: computeCurrentStreak(doneDates, pauses),
    succeeded: doneDates.length,
    failed: missedDates.length
  };
}

function computeImplicitStats(loggedDates, pauses = []) {
  const streak = computeCurrentStreak(loggedDates, pauses);
  const succeeded = loggedDates.length;
  let failed = 0;
  if (succeeded > 0) {
    const first = [...loggedDates].sort()[0];
    const totalDays = daysBetween(first, todayStr()) + 1;
    failed = Math.max(0, totalDays - succeeded);
  }
  return { streak, succeeded, failed };
}

function statsLine(stats) {
  if (!stats || (stats.streak === 0 && stats.succeeded === 0 && stats.failed === 0)) return '';
  return `🔥${stats.streak} · ✅${stats.succeeded} · 💔${stats.failed}`;
}

// ---------- kebab (⋮) menu ----------
// Replaces the old paired ✏️/🗑️ icon buttons everywhere — one small
// button that opens a 2-3 item dropdown instead of two icons competing
// for space on every row. `actions` is [{key, label, danger?}]; the
// dropdown closes on any outside tap via one document-level listener
// (guarded so repeated renders don't stack up duplicate listeners).

function kebabMenuHtml(rowId, actions) {
  return `
    <div class="kebab-menu" data-kebab-row="${rowId}">
      <button class="kebab-btn" data-kebab-toggle aria-label="خيارات">⋮</button>
      <div class="kebab-dropdown hidden" data-kebab-dropdown>
        ${actions.map(a => `<button class="kebab-item ${a.danger ? 'kebab-item-danger' : ''}" data-kebab-action="${a.key}">${a.label}</button>`).join('')}
      </div>
    </div>`;
}

function wireKebabMenus(container, onAction) {
  container.querySelectorAll('.kebab-menu').forEach(menu => {
    const rowId = menu.dataset.kebabRow;
    const toggleBtn = menu.querySelector('[data-kebab-toggle]');
    const dropdown = menu.querySelector('[data-kebab-dropdown]');
    toggleBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      document.querySelectorAll('.kebab-dropdown').forEach(d => { if (d !== dropdown) d.classList.add('hidden'); });
      dropdown.classList.toggle('hidden');
    });
    dropdown.querySelectorAll('[data-kebab-action]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        dropdown.classList.add('hidden');
        onAction(rowId, btn.dataset.kebabAction);
      });
    });
  });
  if (!window._kebabGlobalListenerAdded) {
    document.addEventListener('click', () => {
      document.querySelectorAll('.kebab-dropdown').forEach(d => d.classList.add('hidden'));
    });
    window._kebabGlobalListenerAdded = true;
  }
}

// A row with an icon, a name, an optional streak+stats badge, and the
// shared ❤️ done / 💔 missed / ↩️ undo control. `rowId` is any string
// unique within the list (e.g. `habit-3` or `prayer-fajr`) — callers
// read it back off `data-row-id` to know which item was tapped.
// doneLabel/missedLabel default to "تم"/"لم يتم" — a "bad" habit (one
// she's quitting) passes "امتنعت"/"زلة" instead, since ❤️ means
// "abstained" rather than "did the thing" there. The emoji stay the
// same either way; only the meaning behind them flips.
function threeStateRowHtml({ rowId, colorClass, icon, name, status, editable, showStreak, stats, extra, doneLabel, missedLabel }) {
  return `
    <div class="tsr-row ${colorClass || ''}" data-row-id="${rowId}">
      <div class="tsr-info">
        <div class="tsr-info-top">
          <span class="tsr-icon">${icon}</span>
          <span class="tsr-name">${escapeHtml(name)}</span>
        </div>
        ${showStreak ? `<span class="tsr-streak">${statsLine(stats)}</span>` : ''}
      </div>
      <div class="tsr-actions ${editable ? '' : 'disabled'}">
        <button class="tsr-btn tsr-btn-done ${status === 'done' ? 'active' : ''}" data-action="done" ${editable ? '' : 'disabled'} aria-label="${doneLabel || 'تم'}">❤️</button>
        <button class="tsr-btn tsr-btn-missed ${status === 'missed' ? 'active' : ''}" data-action="missed" ${editable ? '' : 'disabled'} aria-label="${missedLabel || 'لم يتم'}">💔</button>
        <button class="tsr-btn tsr-btn-undo" data-action="undo" ${editable && status ? '' : 'disabled'} aria-label="تراجع">↩️</button>
      </div>
      ${extra ? `<div class="tsr-extra">${extra}</div>` : ''}
    </div>`;
}

// Wires the done/missed/undo buttons inside `container` for every row.
// `onAction(rowId, action)` is called with action = 'done'|'missed'|'undo'.
function wireThreeStateRows(container, onAction) {
  container.querySelectorAll('.tsr-row').forEach(row => {
    const rowId = row.dataset.rowId;
    row.querySelectorAll('[data-action]').forEach(btn => {
      btn.addEventListener('click', () => {
        if (btn.disabled) return;
        onAction(rowId, btn.dataset.action);
      });
    });
  });
}
