// ui-shared.js — rendering pieces used by more than one feature.
// Habits and Fard prayers both need the exact same ❤️/💔/↩️ interaction
// and the exact same two-tone ring. One component, two call sites.

// Shared everywhere a photo can be added. Explicit camera + gallery
// buttons rather than one plain file input — a bare <input type="file">
// merges them into a single OS picker on some phones/browsers but not
// others (confirmed: shows both on one phone, gallery-only on
// another), so relying on that merge isn't reliable. Two inputs, one
// hinted with capture="environment" to open the camera directly, the
// other plain for the gallery — guarantees both are always reachable
// as their own clearly-labeled button, regardless of the device.
function photoPickerHtml(idPrefix, { withRemove = true } = {}) {
  return `
    <input type="file" accept="image/*" capture="environment" id="${idPrefix}-camera-input" class="hidden-file-input">
    <input type="file" accept="image/*" id="${idPrefix}-gallery-input" class="hidden-file-input">
    <div class="food-photo-actions">
      <button type="button" class="btn btn-secondary btn-sm" id="${idPrefix}-camera-btn">📷 كاميرا</button>
      <button type="button" class="btn btn-secondary btn-sm" id="${idPrefix}-gallery-btn">🖼️ معرض</button>
      ${withRemove ? `<button type="button" class="btn btn-text btn-sm" id="${idPrefix}-remove-btn">إزالة الصورة</button>` : ''}
    </div>`;
}
function wirePhotoPicker(idPrefix, onFileSelected, onRemove) {
  document.getElementById(`${idPrefix}-camera-btn`).addEventListener('click', () => document.getElementById(`${idPrefix}-camera-input`).click());
  document.getElementById(`${idPrefix}-gallery-btn`).addEventListener('click', () => document.getElementById(`${idPrefix}-gallery-input`).click());
  document.getElementById(`${idPrefix}-camera-input`).addEventListener('change', async (e) => {
    if (e.target.files[0]) await onFileSelected(e.target.files[0]);
  });
  document.getElementById(`${idPrefix}-gallery-input`).addEventListener('change', async (e) => {
    if (e.target.files[0]) await onFileSelected(e.target.files[0]);
  });
  const removeBtn = document.getElementById(`${idPrefix}-remove-btn`);
  if (removeBtn && onRemove) removeBtn.addEventListener('click', onRemove);
}

// Shared beep for any timer (training's exercise timer, Pomodoro).
// Deliberately two functions, not one: browsers only reliably allow
// audio that's tied to a genuine user gesture (a tap), and a
// timer-completion beep is fired from a setInterval callback, which is
// NOT a gesture — many mobile browsers silently block audio created
// there. The fix is to create (or resume) the AudioContext ONCE,
// directly inside the actual tap that starts the timer, then have the
// later timer-fired beep reuse that already-unlocked context instead
// of creating a fresh one at completion time.
let _sharedAudioCtx = null;
function unlockAudioContext() {
  if (!_sharedAudioCtx) {
    try { _sharedAudioCtx = new (window.AudioContext || window.webkitAudioContext)(); }
    catch { return; }
  }
  if (_sharedAudioCtx.state === 'suspended') _sharedAudioCtx.resume();
}
function playBeep() {
  if (!_sharedAudioCtx) return; // never unlocked by a real tap — skip rather than risk a blocked context
  try {
    const osc = _sharedAudioCtx.createOscillator();
    const gain = _sharedAudioCtx.createGain();
    osc.connect(gain);
    gain.connect(_sharedAudioCtx.destination);
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.001, _sharedAudioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.3, _sharedAudioCtx.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, _sharedAudioCtx.currentTime + 0.35);
    osc.start();
    osc.stop(_sharedAudioCtx.currentTime + 0.4);
  } catch (e) { /* fail silently — vibration still fires separately */ }
}
// A single beep wasn't noticeable enough — a short burst is what
// actually gets attention when a timer finishes.
function playBeepSequence(count = 3, gapMs = 220) {
  for (let i = 0; i < count; i++) setTimeout(() => playBeep(), i * gapMs);
}

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

// Release the blob: URLs held by any <img> inside `el` before its
// contents get replaced. Every URL.createObjectURL() pins the whole
// image blob in memory until it's explicitly revoked, so a card that
// re-renders (a checkbox tick, a list refresh) would otherwise leak a
// fresh copy of every photo, forever.
//
// Deliberately DOM-scoped rather than a module-level "revoke everything
// I ever created" list: several pages render two sibling sections from
// the same function (daily care does morning + evening), and a blanket
// revoke-all would tear down the sibling's still-visible images. Only
// what is actually being thrown away gets freed.
function revokeBlobUrlsIn(el) {
  if (!el) return;
  el.querySelectorAll('img[src^="blob:"]').forEach(img => {
    URL.revokeObjectURL(img.src);
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
  const s = stats || { streak: 0, succeeded: 0, failed: 0 };
  return `🔥${s.streak}&nbsp;&nbsp;·&nbsp;&nbsp;✅${s.succeeded}&nbsp;&nbsp;·&nbsp;&nbsp;💔${s.failed}`;
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

// ---------- المسبحة: a big, tappable counter ----------
// The whole point is that it's HARD TO MISS with a thumb — the old
// approach (a small "+" chip next to the name) is fine for logging
// "I did it", but it's the wrong tool for actually counting a dhikr
// 33 or 100 times while your eyes are elsewhere. So: one large target,
// a progress ring that closes as you approach the goal, and a reset.
//
// It's deliberately generic (getCount/setCount are injected) so the
// exact same component drives the standalone custom adhkar AND the
// individual morning/evening dhikr items, which store their counts in
// different tables.
function openTasbeehModal({ title, benefit, goal, getCount, setCount, onClose }) {
  let count = 0;
  const hasGoal = typeof goal === 'number' && goal > 0;

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay tasbeeh-overlay';
  overlay.innerHTML = `
    <div class="tasbeeh-modal">
      <button class="icon-btn tasbeeh-close" id="tasbeeh-close" aria-label="إغلاق">✕</button>
      <h2 class="tasbeeh-title">${escapeHtml(title)}</h2>
      ${benefit ? `<p class="tasbeeh-benefit">${escapeHtml(benefit)}</p>` : ''}

      <button class="tasbeeh-circle" id="tasbeeh-tap" aria-label="عدّ">
        <svg class="tasbeeh-ring" viewBox="0 0 200 200" aria-hidden="true">
          <circle class="tasbeeh-ring-track" cx="100" cy="100" r="92"/>
          <circle class="tasbeeh-ring-fill" id="tasbeeh-ring-fill" cx="100" cy="100" r="92"/>
        </svg>
        <span class="tasbeeh-count" id="tasbeeh-count">٠</span>
        ${hasGoal ? `<span class="tasbeeh-goal" id="tasbeeh-goal-text"></span>` : ''}
      </button>

      <p class="tasbeeh-hint">اضغطي على الدائرة للعدّ</p>
      <div class="tasbeeh-actions">
        <button class="btn btn-text" id="tasbeeh-minus">− واحد</button>
        <button class="btn btn-text tasbeeh-reset" id="tasbeeh-reset">↺ تصفير</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  const countEl = overlay.querySelector('#tasbeeh-count');
  const goalEl = overlay.querySelector('#tasbeeh-goal-text');
  const fillEl = overlay.querySelector('#tasbeeh-ring-fill');
  const tapEl = overlay.querySelector('#tasbeeh-tap');
  const CIRCUMFERENCE = 2 * Math.PI * 92;
  fillEl.style.strokeDasharray = String(CIRCUMFERENCE);

  function paint() {
    countEl.textContent = toArabicNumeral(count);
    if (hasGoal) {
      goalEl.textContent = `من ${toArabicNumeral(goal)}`;
      const frac = Math.min(1, count / goal);
      fillEl.style.strokeDashoffset = String(CIRCUMFERENCE * (1 - frac));
      const reached = count >= goal;
      tapEl.classList.toggle('tasbeeh-complete', reached);
    } else {
      // No goal set: the ring cycles every 33 so there's still a sense of
      // rhythm and progress rather than a dead, permanently-empty circle.
      const frac = (count % 33) / 33;
      fillEl.style.strokeDashoffset = String(CIRCUMFERENCE * (1 - frac));
    }
  }

  let lastMilestone = 0;
  async function bump(delta) {
    const next = Math.max(0, count + delta);
    if (next === count) return;
    count = next;
    paint();
    await setCount(count);
    // Haptic + tone only at meaningful moments, not on every single tap —
    // a buzz per tap while counting to 100 would be maddening.
    const milestone = hasGoal ? (count === goal) : (count > 0 && count % 33 === 0);
    if (milestone && count !== lastMilestone) {
      lastMilestone = count;
      if (navigator.vibrate) navigator.vibrate([120, 60, 120]);
      if (typeof playBeepSequence === 'function') { unlockAudioContext(); playBeepSequence(2); }
    } else if (delta > 0 && navigator.vibrate) {
      navigator.vibrate(12); // a whisper of feedback per tap
    }
  }

  tapEl.addEventListener('click', () => bump(1));
  overlay.querySelector('#tasbeeh-minus').addEventListener('click', () => bump(-1));
  overlay.querySelector('#tasbeeh-reset').addEventListener('click', async () => {
    if (count === 0) return;
    if (!confirm('تصفير العدّاد؟')) return;
    count = 0;
    lastMilestone = 0;
    paint();
    await setCount(0);
  });

  function close() {
    overlay.remove();
    if (onClose) onClose();
  }
  overlay.querySelector('#tasbeeh-close').addEventListener('click', close);
  // Tapping the dim area outside the sheet closes it, but taps INSIDE
  // must not bubble out and close it mid-count.
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

  (async () => {
    count = (await getCount()) || 0;
    lastMilestone = count;
    paint();
  })();
}

// Arabic-Indic digits for display. (Kept here so ui-shared has no
// dependency on period-pain.js, which defines its own copy for its
// own charts.)
function toArabicNumeral(n) {
  return String(n).replace(/[0-9]/g, d => '٠١٢٣٤٥٦٧٨٩'[Number(d)]);
}
