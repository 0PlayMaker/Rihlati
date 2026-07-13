// training.js — Phase 9.
// Same shape as custom adhkar: a numeric per-day log (sets), presence
// of a log = done that day, reusing computeImplicitStats for
// streak/succeeded/failed rather than inventing a new pattern.
// The timer is a real countdown (setInterval + Web Audio beep +
// vibration on completion), not a decorative widget — "make it work"
// was explicit.

async function createExercise({ name, description, youtubeLink, defaultDurationSec, targetSets, photoBlob, photoDisplayMode }) {
  const all = await db.exercises.toArray();
  const id = await db.exercises.add({
    name, description: description || '', youtubeLink: youtubeLink || '',
    defaultDurationSec: defaultDurationSec || null, targetSets: targetSets ?? null,
    photoDisplayMode: photoDisplayMode || 'thumb_and_detail',
    archived: false, order: all.length, createdAt: Date.now()
  });
  if (photoBlob) await db.exercisePhotos.put({ exerciseId: id, photoBlob });
  return id;
}
async function updateExercise(id, { name, description, youtubeLink, defaultDurationSec, targetSets, photoBlob, removePhoto, photoDisplayMode }) {
  await db.exercises.update(id, { name, description: description || '', youtubeLink: youtubeLink || '', defaultDurationSec: defaultDurationSec || null, targetSets: targetSets ?? null, photoDisplayMode: photoDisplayMode || 'thumb_and_detail' });
  if (photoBlob) await db.exercisePhotos.put({ exerciseId: id, photoBlob });
  else if (removePhoto) await db.exercisePhotos.delete(id);
}
async function archiveExercise(id) {
  await db.exercises.update(id, { archived: true });
}
async function getActiveExercises() {
  const all = await db.exercises.toArray();
  return all.filter(e => !e.archived).sort((a, b) => a.order - b.order);
}
async function getExercisePhoto(id) {
  return db.exercisePhotos.get(id);
}

async function getExerciseSets(exerciseId, date) {
  const row = await getLog(db.exerciseLogs, 'exerciseId', exerciseId, date);
  return row ? row.sets : 0;
}
// Hitting an exercise's daily target is a completion — treat it like one.
async function setExerciseSets(exerciseId, date, sets) {
  if (date === todayStr()) {
    const ex = await db.exercises.get(exerciseId);
    const before = await getExerciseSets(exerciseId, date);
    if (ex?.targetSets && before < ex.targetSets && sets >= ex.targetSets) {
      playEventChime('training');
    }
  }
  return _setExerciseSetsRaw(exerciseId, date, sets);
}
async function _setExerciseSetsRaw(exerciseId, date, sets) {
  if (sets <= 0) await deleteLog(db.exerciseLogs, 'exerciseId', exerciseId, date);
  else await upsertLog(db.exerciseLogs, 'exerciseId', exerciseId, date, { sets });
}
async function incrementExerciseSets(exerciseId, date) {
  const current = await getExerciseSets(exerciseId, date);
  await setExerciseSets(exerciseId, date, current + 1);
}
async function getExerciseStats(exerciseId) {
  const logs = await db.exerciseLogs.where('exerciseId').equals(exerciseId).toArray();
  const dates = logs.filter(l => l.sets > 0).map(l => l.date);
  return computeImplicitStats(dates, []);
}

let _exercisePhotoUrls = [];
function trackExercisePhotoUrl(blob) {
  const url = URL.createObjectURL(blob);
  _exercisePhotoUrls.push(url);
  return url;
}
function revokeExercisePhotoUrls() {
  _exercisePhotoUrls.forEach(u => URL.revokeObjectURL(u));
  _exercisePhotoUrls = [];
}

// ---------- working countdown timer ----------

function formatTimer(totalSeconds) {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

// The countdown is driven by an absolute END TIMESTAMP, not by
// decrementing a counter once per interval tick. Mobile browsers
// throttle (or entirely suspend) intervals in a backgrounded tab, so
// "remaining -= 1 every 1000ms" silently under-counts: leave the app
// mid-set and the timer is simply wrong when you come back. Deriving
// the remaining time from (endsAt - Date.now()) on every tick means
// the display is correct the instant the tab wakes up, no matter how
// many ticks the browser skipped. `remaining` is only the paused
// leftover; while running, endsAt is the source of truth.
function openTimerModal(exercise) {
  let duration = exercise.defaultDurationSec || 60;
  let remaining = duration;   // seconds left while paused/idle
  let endsAt = null;          // absolute ms timestamp while running
  let intervalId = null;

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal">
      <h2 class="modal-title">${escapeHtml(exercise.name)}</h2>
      <div class="timer-display" id="timer-display">${formatTimer(remaining)}</div>
      <div class="timer-duration-row">
        <input class="text-input" type="number" min="5" step="5" id="timer-duration-input" value="${duration}">
        <span class="settings-note">ثانية</span>
      </div>
      <div class="modal-actions timer-controls">
        <button class="btn btn-secondary" id="timer-reset">إعادة</button>
        <button class="btn btn-primary" id="timer-toggle">ابدأ</button>
      </div>
      <button class="btn btn-text sheet-close" id="timer-close">إغلاق</button>
    </div>`;
  document.body.appendChild(overlay);

  const display = document.getElementById('timer-display');
  const toggleBtn = document.getElementById('timer-toggle');
  const durationInput = document.getElementById('timer-duration-input');

  // Reads the duration field safely (Arabic-Indic digits included).
  const readDuration = () => parseNumericInput(durationInput.value, { int: true, min: 1 }) ?? duration;

  function stopInterval() {
    if (intervalId) { clearInterval(intervalId); intervalId = null; }
  }

  function finish() {
    stopInterval();
    endsAt = null;
    remaining = 0;
    display.textContent = formatTimer(0);
    toggleBtn.textContent = 'ابدأ';
    display.classList.add('timer-done');
    playEventChime('timer', { hapticPattern: [200, 100, 200, 100, 200] });
  }

  function tick() {
    if (endsAt === null) return;
    // Derived from the clock, never accumulated — survives throttling.
    const left = Math.max(0, Math.round((endsAt - Date.now()) / 1000));
    display.textContent = formatTimer(left);
    if (left <= 0) finish();
  }

  toggleBtn.addEventListener('click', () => {
    if (intervalId) {
      // Pause: freeze the leftover, drop the end timestamp.
      remaining = Math.max(0, Math.round((endsAt - Date.now()) / 1000));
      stopInterval();
      endsAt = null;
      display.textContent = formatTimer(remaining);
      toggleBtn.textContent = 'استئناف';
    } else {
      unlockAudioContext(); // must happen inside this real tap, not later when the timer fires
      if (remaining <= 0) remaining = readDuration();
      display.classList.remove('timer-done');
      endsAt = Date.now() + remaining * 1000;
      tick(); // paint immediately rather than waiting a full second
      intervalId = setInterval(tick, 250); // sub-second polling keeps the display crisp
      toggleBtn.textContent = 'إيقاف';
    }
  });
  document.getElementById('timer-reset').addEventListener('click', () => {
    stopInterval();
    endsAt = null;
    duration = readDuration();
    remaining = duration;
    display.textContent = formatTimer(remaining);
    display.classList.remove('timer-done');
    toggleBtn.textContent = 'ابدأ';
  });
  durationInput.addEventListener('change', () => {
    if (!intervalId) {
      duration = readDuration();
      remaining = duration;
      display.textContent = formatTimer(remaining);
    }
  });

  // The interval must not outlive the modal — on close, or if the
  // person navigates away with the modal still open.
  const teardown = () => { stopInterval(); overlay.remove(); };
  document.getElementById('timer-close').addEventListener('click', teardown);
  registerCleanup(teardown);
}

// ---------- create/edit modal ----------

async function openExerciseModal({ existingId, onSaved } = {}) {
  let existing = null;
  let existingPhotoUrl = null;
  let pendingPhotoBlob = null;
  let removePhotoFlag = false;

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal modal-lg">
      <h2 class="modal-title" id="exercise-modal-title">تمرين جديد</h2>
      <label class="field-label">اسم التمرين</label>
      <input class="text-input" id="exercise-name-input" autofocus>
      <label class="field-label">وصف (اختياري)</label>
      <textarea class="mood-note-input" id="exercise-desc-input" placeholder="تفاصيل عن التمرين..."></textarea>
      <label class="field-label">رابط يوتيوب (اختياري)</label>
      <input class="text-input" type="url" id="exercise-youtube-input" placeholder="https://youtube.com/...">
      <label class="field-label">هدف المجموعات اليومي (اختياري)</label>
      <input class="text-input" type="text" inputmode="numeric" id="exercise-target-sets-input" placeholder="مثلاً: ٣">
      <label class="field-label">مدة المؤقّت الافتراضية (اختياري)</label>
      <div class="timer-duration-row">
        <input class="text-input" type="number" min="0" id="exercise-duration-min-input" placeholder="دقائق">
        <span>:</span>
        <input class="text-input" type="number" min="0" max="59" id="exercise-duration-sec-input" placeholder="ثواني">
      </div>
      <label class="field-label">صورة (اختياري)</label>
      <div class="food-photo-picker" id="exercise-photo-preview"></div>
      ${photoPickerHtml('exercise-photo')}
      <div class="habit-type-chips" id="exercise-photo-mode-chips">
        <button class="chip" data-mode="thumb_only">مصغرة فقط في القائمة</button>
        <button class="chip active" data-mode="thumb_and_detail">مصغرة + داخل التمرين</button>
      </div>
      <div class="modal-actions">
        ${existingId ? `<button class="btn btn-danger btn-sm" id="exercise-delete-btn">حذف</button>` : ''}
        <button class="btn btn-text" id="exercise-cancel-btn">إلغاء</button>
        <button class="btn btn-primary" id="exercise-save-btn">حفظ</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  overlay.querySelectorAll('#exercise-photo-mode-chips .chip').forEach(chip => {
    chip.addEventListener('click', () => {
      overlay.querySelectorAll('#exercise-photo-mode-chips .chip').forEach(c => c.classList.toggle('active', c === chip));
    });
  });

  // Only the transient preview URL is recycled; existingPhotoUrl is cached
  // and re-rendered later, so revoking it would break the image.
  let pendingPreviewUrl = null;
  function renderPhotoArea() {
    const el = document.getElementById('exercise-photo-preview');
    if (pendingPreviewUrl) { URL.revokeObjectURL(pendingPreviewUrl); pendingPreviewUrl = null; }
    if (pendingPhotoBlob) {
      pendingPreviewUrl = URL.createObjectURL(pendingPhotoBlob);
      el.innerHTML = `<img src="${pendingPreviewUrl}" alt="">`;
    }
    else if (existingPhotoUrl && !removePhotoFlag) el.innerHTML = `<img src="${existingPhotoUrl}" alt="">`;
    else el.innerHTML = '<span class="food-photo-placeholder">📷</span>';
  }

  async function applyExisting() {
    if (!existingId) { renderPhotoArea(); return; }
    existing = (await db.exercises.toArray()).find(e => e.id === existingId);
    if (!existing) { renderPhotoArea(); return; }
    document.getElementById('exercise-modal-title').textContent = 'تعديل التمرين';
    document.getElementById('exercise-name-input').value = existing.name;
    document.getElementById('exercise-desc-input').value = existing.description || '';
    document.getElementById('exercise-youtube-input').value = existing.youtubeLink || '';
    document.getElementById('exercise-target-sets-input').value = existing.targetSets ? toArabicNumeral(existing.targetSets) : '';
    const dur = existing.defaultDurationSec || 0;
    document.getElementById('exercise-duration-min-input').value = dur ? Math.floor(dur / 60) : '';
    document.getElementById('exercise-duration-sec-input').value = dur ? dur % 60 : '';
    const mode = existing.photoDisplayMode || 'thumb_and_detail';
    overlay.querySelectorAll('#exercise-photo-mode-chips .chip').forEach(c => c.classList.toggle('active', c.dataset.mode === mode));
    const photoRow = await getExercisePhoto(existingId);
    if (photoRow) existingPhotoUrl = trackExercisePhotoUrl(photoRow.photoBlob);
    renderPhotoArea();
  }

  wirePhotoPicker('exercise-photo', async (file) => {
    pendingPhotoBlob = await resizeImageToBlob(file, 1200, 0.8);
    removePhotoFlag = false;
    renderPhotoArea();
  }, () => {
    pendingPhotoBlob = null;
    removePhotoFlag = true;
    renderPhotoArea();
  });
  document.getElementById('exercise-cancel-btn').addEventListener('click', () => overlay.remove());
  const deleteBtn = document.getElementById('exercise-delete-btn');
  if (deleteBtn) deleteBtn.addEventListener('click', async () => {
    if (!confirm('حذف هذا التمرين؟ سجل السجلات السابقة يبقى محفوظاً.')) return;
    await archiveExercise(existingId);
    overlay.remove();
    if (onSaved) onSaved();
  });
  document.getElementById('exercise-save-btn').addEventListener('click', async () => {
    const name = document.getElementById('exercise-name-input').value.trim();
    if (!name) return;
    const description = document.getElementById('exercise-desc-input').value.trim();
    const youtubeLink = document.getElementById('exercise-youtube-input').value.trim();
    const min = readNumericField('exercise-duration-min-input', { int: true, min: 0 }) ?? 0;
    const sec = readNumericField('exercise-duration-sec-input', { int: true, min: 0 }) ?? 0;
    const defaultDurationSec = (min > 0 || sec > 0) ? (min * 60 + sec) : null;
    const photoDisplayMode = overlay.querySelector('#exercise-photo-mode-chips .chip.active')?.dataset.mode || 'thumb_and_detail';
    const targetSets = readNumericField('exercise-target-sets-input', { int: true, min: 1 });
    if (existingId) await updateExercise(existingId, { name, description, youtubeLink, defaultDurationSec, targetSets, photoBlob: pendingPhotoBlob, removePhoto: removePhotoFlag, photoDisplayMode });
    else await createExercise({ name, description, youtubeLink, defaultDurationSec, targetSets, photoBlob: pendingPhotoBlob, photoDisplayMode });
    overlay.remove();
    if (onSaved) onSaved();
  });

  applyExisting();
}

// ---------- rendering ----------

function exerciseRowHtml(exercise, sets, photoUrl, statsText) {
  const target = exercise.targetSets || null;
  const frac = target ? Math.min(1, sets / target) : (sets > 0 ? 1 : 0);
  const done = target ? sets >= target : sets > 0;
  const showFullPhoto = photoUrl && (exercise.photoDisplayMode ?? 'thumb_and_detail') === 'thumb_and_detail';

  // The ring is the point: it answers "have I done enough today?" without
  // you having to remember what your target was.
  const ring = renderRing({
    size: 52, strokeWidth: 6,
    segments: [{ frac, color: done ? 'var(--success-strong)' : 'var(--btn-color, var(--pink-deep))' }]
  });

  return `
    <div class="exercise-card ${done ? 'exercise-done' : ''}" data-exercise-id="${exercise.id}">
      <div class="exercise-card-top">
        <div class="exercise-ring">
          ${ring}
          <span class="exercise-ring-center">${photoUrl ? '' : '💪'}</span>
          ${photoUrl ? `<img class="exercise-ring-photo" src="${photoUrl}" alt="">` : ''}
        </div>
        <div class="exercise-info">
          <span class="exercise-name">${escapeHtml(exercise.name)}${done ? ' ✅' : ''}</span>
          <span class="exercise-sets-line">
            <strong>${toArabicNumeral(sets)}</strong>${target ? `<span class="exercise-target">/${toArabicNumeral(target)}</span>` : ''} مجموعة
          </span>
          ${statsText ? `<span class="tsr-streak">${statsText}</span>` : ''}
        </div>
        ${kebabMenuHtml('ex-' + exercise.id, [
          { key: 'edit', label: 'تعديل' },
          { key: 'delete', label: 'حذف', danger: true }
        ])}
      </div>

      ${showFullPhoto ? `<img class="diary-entry-photo exercise-photo" src="${photoUrl}" alt="">` : ''}
      ${exercise.description ? `<p class="exercise-desc">${escapeHtml(exercise.description)}</p>` : ''}

      <div class="exercise-controls">
        <div class="exercise-stepper">
          <button class="exercise-step-btn" data-action="dec-sets" aria-label="أنقص مجموعة">−</button>
          <span class="exercise-step-val">${toArabicNumeral(sets)}</span>
          <button class="exercise-step-btn" data-action="inc-sets" aria-label="أضف مجموعة">+</button>
        </div>
        <button class="btn btn-secondary btn-sm" data-action="timer">⏱️ مؤقّت</button>
        ${exercise.youtubeLink ? `<a class="btn btn-secondary btn-sm" href="${escapeHtml(exercise.youtubeLink)}" target="_blank" rel="noopener">🎬</a>` : ''}
      </div>
    </div>`;
}

// Training summary — the page had no overview at all, so there was no way
// to see how the week was going without counting cards by eye.
async function renderTrainingSummary(container) {
  const exercises = await getActiveExercises();
  if (exercises.length === 0) {
    container.innerHTML = `
      <h2 class="card-title">💪 تمارينك</h2>
      <p class="mini-progress-text">أضيفي تمرينك الأول لتبدأ التتبّع</p>`;
    return;
  }
  const today = todayStr();
  const allLogs = await db.exerciseLogs.toArray();

  const todayLogs = allLogs.filter(l => l.date === today && l.sets > 0);
  const todaySets = todayLogs.reduce((s, l) => s + l.sets, 0);
  const weekFrom = addDays(today, -6);
  const weekLogs = allLogs.filter(l => l.date >= weekFrom && l.sets > 0);
  const weekSets = weekLogs.reduce((s, l) => s + l.sets, 0);
  const activeDays = new Set(allLogs.filter(l => l.sets > 0).map(l => l.date));
  const streak = computeCurrentStreak([...activeDays], []);

  // How many of today's exercises hit their target (or were done at all).
  let hitTarget = 0;
  for (const ex of exercises) {
    const sets = await getExerciseSets(ex.id, today);
    if (ex.targetSets ? sets >= ex.targetSets : sets > 0) hitTarget++;
  }
  const frac = exercises.length ? hitTarget / exercises.length : 0;

  // Last 7 days as tiny bars — the shape of the week at a glance.
  const maxDay = Math.max(1, ...Array.from({ length: 7 }, (_, i) => {
    const d = addDays(today, -6 + i);
    return allLogs.filter(l => l.date === d).reduce((s, l) => s + l.sets, 0);
  }));
  const bars = Array.from({ length: 7 }, (_, i) => {
    const d = addDays(today, -6 + i);
    const n = allLogs.filter(l => l.date === d).reduce((s, l) => s + l.sets, 0);
    return `<div class="tr-bar-col">
      <div class="tr-bar" style="height:${(n / maxDay) * 100}%" title="${d}: ${n}"></div>
      <span class="tr-bar-label">${d === today ? '●' : ''}</span>
    </div>`;
  }).join('');

  container.innerHTML = `
    <div class="section-header">
      <h2 class="card-title">💪 تمارينك</h2>
      ${streak > 0 ? `<span class="tsr-streak">🔥 ${toArabicNumeral(streak)}</span>` : ''}
    </div>
    <div class="mini-progress">
      <div class="mini-progress-track"><div class="mini-progress-fill" style="width:${frac * 100}%"></div></div>
      <span class="mini-progress-text">اليوم: ${toArabicNumeral(hitTarget)}/${toArabicNumeral(exercises.length)} تمرين</span>
    </div>
    <div class="diary-stat-row">
      <div class="diary-stat">
        <span class="diary-stat-num">${toArabicNumeral(todaySets)}</span>
        <span class="diary-stat-label">مجموعة اليوم</span>
      </div>
      <div class="diary-stat">
        <span class="diary-stat-num">${toArabicNumeral(weekSets)}</span>
        <span class="diary-stat-label">آخر ٧ أيام</span>
      </div>
      <div class="diary-stat">
        <span class="diary-stat-num">${toArabicNumeral(activeDays.size)}</span>
        <span class="diary-stat-label">يوم نشط</span>
      </div>
    </div>
    <div class="tr-week">${bars}</div>`;
}

async function renderExercisesList(container, { showStreak = true, onChange } = {}) {
  if (!container) return;
  revokeExercisePhotoUrls();
  const exercises = await getActiveExercises();
  if (exercises.length === 0) {
    container.innerHTML = `<div class="empty-state"><p>ما في تمارين مضافة بعد.</p></div>`;
    return;
  }
  const today = todayStr();
  const rows = await Promise.all(exercises.map(async ex => {
    const sets = await getExerciseSets(ex.id, today);
    const photoRow = await getExercisePhoto(ex.id);
    const photoUrl = photoRow ? trackExercisePhotoUrl(photoRow.photoBlob) : null;
    const statsText = showStreak ? statsLine(await getExerciseStats(ex.id)) : '';
    return exerciseRowHtml(ex, sets, photoUrl, statsText);
  }));
  container.innerHTML = rows.join('');

  async function refresh() {
    await renderExercisesList(container, { showStreak, onChange });
    if (onChange) await onChange();
  }

  wireKebabMenus(container, async (rowId, action) => {
    const id = Number(rowId.replace('ex-', ''));
    if (action === 'edit') openExerciseModal({ existingId: id, onSaved: refresh });
    else if (action === 'delete') {
      const ex = exercises.find(e => e.id === id);
      if (!confirm(`حذف "${ex.name}"؟ سجل السجلات السابقة يبقى محفوظاً.`)) return;
      await archiveExercise(id);
      await refresh();
    }
  });
  container.querySelectorAll('.exercise-card').forEach(row => {
    const id = Number(row.dataset.exerciseId);
    row.querySelector('[data-action="inc-sets"]').addEventListener('click', async () => {
      await incrementExerciseSets(id, today);
      await refresh();
    });
    row.querySelector('[data-action="dec-sets"]').addEventListener('click', async () => {
      const current = await getExerciseSets(id, today);
      if (current <= 0) return;
      await setExerciseSets(id, today, current - 1);
      await refresh();
    });
    const timerBtn = row.querySelector('[data-action="timer"]');
    if (timerBtn) timerBtn.addEventListener('click', () => {
      const ex = exercises.find(e => e.id === id);
      openTimerModal(ex);
    });
  });
}

// ---------- full Training page ----------

async function renderTrainingPage(params, view) {
  view.innerHTML = `
    <div class="page-header">
      <button class="icon-btn" aria-label="رجوع" id="training-back">→</button>
      <h1>التمارين</h1>
    </div>
    <div class="card" id="training-summary"></div>
    <div class="card">
      <button class="btn btn-primary btn-block" id="add-exercise-btn">+ تمرين جديد</button>
      <div id="exercises-list"></div>
    </div>
  `;
  document.getElementById('training-back').addEventListener('click', () => history.back());
  const listEl = document.getElementById('exercises-list');
  const summaryEl = document.getElementById('training-summary');

  // A set change must move the summary too, or the ring and the totals
  // contradict each other on the same screen. onChange refreshes ONLY the
  // summary — the list already re-renders itself, and having onChange
  // re-render it as well would paint the whole list twice per tap.
  async function refreshSummary() { await renderTrainingSummary(summaryEl); }
  async function refreshAll() {
    await renderExercisesList(listEl, { onChange: refreshSummary });
    await refreshSummary();
  }
  await refreshAll();
  document.getElementById('add-exercise-btn').addEventListener('click', () => {
    openExerciseModal({ onSaved: refreshAll });
  });
}

// ---------- Day Detail provider ----------

async function exercisesDayProvider(dateStr) {
  const exercises = await getActiveExercises();
  if (exercises.length === 0) return null;
  const rows = [];
  for (const ex of exercises) {
    const sets = await getExerciseSets(ex.id, dateStr);
    if (sets > 0) rows.push(`<div class="yearly-row"><span>${escapeHtml(ex.name)}</span><span>${sets} مجموعة</span></div>`);
  }
  if (rows.length === 0) return null;
  const node = document.createElement('div');
  node.innerHTML = rows.join('');
  return { title: 'التمارين', node };
}

// ---------- Yearly stats provider ----------

async function trainingYearlyProvider(year) {
  const exercises = await getActiveExercises();
  if (exercises.length === 0) return null;
  const prefix = String(year);
  let totalSessions = 0;
  const rows = await Promise.all(exercises.map(async ex => {
    const logs = await db.exerciseLogs.where('exerciseId').equals(ex.id).toArray();
    const yearLogs = logs.filter(l => l.date.startsWith(prefix) && l.sets > 0);
    totalSessions += yearLogs.length;
    const totalSets = yearLogs.reduce((s, l) => s + l.sets, 0);
    return yearLogs.length > 0
      ? `<div class="yearly-row"><span>${escapeHtml(ex.name)}</span><span>${toArabicNumeral(yearLogs.length)} يوم · ${toArabicNumeral(totalSets)} مجموعة</span></div>`
      : '';
  }));
  if (totalSessions === 0) return null;

  // Headline numbers first — a list of 15 exercises buries the answer to
  // "how did my year of training actually go?"
  const allLogs = (await db.exerciseLogs.toArray()).filter(l => l.date.startsWith(prefix) && l.sets > 0);
  const totalSets = allLogs.reduce((s, l) => s + l.sets, 0);
  const activeDays = [...new Set(allLogs.map(l => l.date))].sort();
  const longestStreak = (() => {
    let best = 0, run = 0, prev = null;
    for (const d of activeDays) {
      if (prev && daysBetween(prev, d) === 1) run += 1; else run = 1;
      if (run > best) best = run;
      prev = d;
    }
    return best;
  })();
  const byMonth = new Array(12).fill(0);
  activeDays.forEach(d => { byMonth[Number(d.slice(5, 7)) - 1] += 1; });
  const bestMonth = byMonth.indexOf(Math.max(...byMonth));

  const html = `
    <div class="yearly-row"><span>إجمالي المجموعات</span><span>${toArabicNumeral(totalSets)}</span></div>
    <div class="yearly-row"><span>أيام تدرّبتِ فيها</span><span>${toArabicNumeral(activeDays.length)} يوم</span></div>
    <div class="yearly-row"><span>أطول تتابع</span><span>🔥 ${toArabicNumeral(longestStreak)} يوم</span></div>
    <div class="yearly-row"><span>أنشط شهر</span><span>${ARABIC_MONTHS[bestMonth]}</span></div>
    <details class="yearly-pain-details">
      <summary>التفاصيل لكل تمرين</summary>
      ${rows.join('')}
    </details>`;
  return { title: 'التمارين', html, count: totalSessions };
}
