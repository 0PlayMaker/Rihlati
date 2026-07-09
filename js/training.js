// training.js — Phase 9.
// Same shape as custom adhkar: a numeric per-day log (sets), presence
// of a log = done that day, reusing computeImplicitStats for
// streak/succeeded/failed rather than inventing a new pattern.
// The timer is a real countdown (setInterval + Web Audio beep +
// vibration on completion), not a decorative widget — "make it work"
// was explicit.

async function createExercise({ name, description, youtubeLink, defaultDurationSec, photoBlob, photoDisplayMode }) {
  const all = await db.exercises.toArray();
  const id = await db.exercises.add({
    name, description: description || '', youtubeLink: youtubeLink || '',
    defaultDurationSec: defaultDurationSec || null, photoDisplayMode: photoDisplayMode || 'thumb_and_detail',
    archived: false, order: all.length, createdAt: Date.now()
  });
  if (photoBlob) await db.exercisePhotos.put({ exerciseId: id, photoBlob });
  return id;
}
async function updateExercise(id, { name, description, youtubeLink, defaultDurationSec, photoBlob, removePhoto, photoDisplayMode }) {
  await db.exercises.update(id, { name, description: description || '', youtubeLink: youtubeLink || '', defaultDurationSec: defaultDurationSec || null, photoDisplayMode: photoDisplayMode || 'thumb_and_detail' });
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
async function setExerciseSets(exerciseId, date, sets) {
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

function playBeep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.3, ctx.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
    osc.start();
    osc.stop(ctx.currentTime + 0.4);
  } catch (e) { /* Web Audio unavailable — fail silently, vibration still fires */ }
}

function formatTimer(totalSeconds) {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function openTimerModal(exercise) {
  let duration = exercise.defaultDurationSec || 60;
  let remaining = duration;
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

  function tick() {
    remaining -= 1;
    display.textContent = formatTimer(Math.max(0, remaining));
    if (remaining <= 0) {
      clearInterval(intervalId);
      intervalId = null;
      toggleBtn.textContent = 'ابدأ';
      display.classList.add('timer-done');
      playBeep();
      if (navigator.vibrate) navigator.vibrate([200, 100, 200, 100, 200]);
    }
  }

  toggleBtn.addEventListener('click', () => {
    if (intervalId) {
      clearInterval(intervalId);
      intervalId = null;
      toggleBtn.textContent = 'استئناف';
    } else {
      if (remaining <= 0) remaining = Number(durationInput.value) || duration;
      display.classList.remove('timer-done');
      intervalId = setInterval(tick, 1000);
      toggleBtn.textContent = 'إيقاف';
    }
  });
  document.getElementById('timer-reset').addEventListener('click', () => {
    clearInterval(intervalId);
    intervalId = null;
    duration = Number(durationInput.value) || 60;
    remaining = duration;
    display.textContent = formatTimer(remaining);
    display.classList.remove('timer-done');
    toggleBtn.textContent = 'ابدأ';
  });
  durationInput.addEventListener('change', () => {
    if (!intervalId) {
      duration = Number(durationInput.value) || 60;
      remaining = duration;
      display.textContent = formatTimer(remaining);
    }
  });
  document.getElementById('timer-close').addEventListener('click', () => {
    clearInterval(intervalId);
    overlay.remove();
  });
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
      <label class="field-label">مدة المؤقّت الافتراضية (اختياري)</label>
      <div class="timer-duration-row">
        <input class="text-input" type="number" min="0" id="exercise-duration-min-input" placeholder="دقائق">
        <span>:</span>
        <input class="text-input" type="number" min="0" max="59" id="exercise-duration-sec-input" placeholder="ثواني">
      </div>
      <label class="field-label">صورة (اختياري)</label>
      <div class="food-photo-picker" id="exercise-photo-preview"></div>
      <input type="file" accept="image/*" id="exercise-photo-input" class="hidden-file-input">
      <div class="food-photo-actions">
        <button class="btn btn-secondary btn-sm" id="exercise-photo-choose">إضافة صورة</button>
        <button class="btn btn-text btn-sm" id="exercise-photo-remove">إزالة الصورة</button>
      </div>
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

  function renderPhotoArea() {
    const el = document.getElementById('exercise-photo-preview');
    if (pendingPhotoBlob) el.innerHTML = `<img src="${trackExercisePhotoUrl(pendingPhotoBlob)}" alt="">`;
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
    const dur = existing.defaultDurationSec || 0;
    document.getElementById('exercise-duration-min-input').value = dur ? Math.floor(dur / 60) : '';
    document.getElementById('exercise-duration-sec-input').value = dur ? dur % 60 : '';
    const mode = existing.photoDisplayMode || 'thumb_and_detail';
    overlay.querySelectorAll('#exercise-photo-mode-chips .chip').forEach(c => c.classList.toggle('active', c.dataset.mode === mode));
    const photoRow = await getExercisePhoto(existingId);
    if (photoRow) existingPhotoUrl = trackExercisePhotoUrl(photoRow.photoBlob);
    renderPhotoArea();
  }

  document.getElementById('exercise-photo-choose').addEventListener('click', () => document.getElementById('exercise-photo-input').click());
  document.getElementById('exercise-photo-input').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    pendingPhotoBlob = await resizeImageToBlob(file, 1200, 0.8);
    removePhotoFlag = false;
    renderPhotoArea();
  });
  document.getElementById('exercise-photo-remove').addEventListener('click', () => {
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
    const min = parseInt(document.getElementById('exercise-duration-min-input').value, 10) || 0;
    const sec = parseInt(document.getElementById('exercise-duration-sec-input').value, 10) || 0;
    const defaultDurationSec = (min > 0 || sec > 0) ? (min * 60 + sec) : null;
    const photoDisplayMode = overlay.querySelector('#exercise-photo-mode-chips .chip.active')?.dataset.mode || 'thumb_and_detail';
    if (existingId) await updateExercise(existingId, { name, description, youtubeLink, defaultDurationSec, photoBlob: pendingPhotoBlob, removePhoto: removePhotoFlag, photoDisplayMode });
    else await createExercise({ name, description, youtubeLink, defaultDurationSec, photoBlob: pendingPhotoBlob, photoDisplayMode });
    overlay.remove();
    if (onSaved) onSaved();
  });

  applyExisting();
}

// ---------- rendering ----------

function exerciseRowHtml(exercise, sets, photoUrl, statsText) {
  return `
    <div class="exercise-row" data-exercise-id="${exercise.id}">
      <div class="exercise-row-top">
        ${photoUrl ? `<img class="food-thumb" src="${photoUrl}" alt="">` : `<span class="food-thumb food-thumb-placeholder">💪</span>`}
        <div class="food-row-info">
          <span class="food-row-title">${escapeHtml(exercise.name)}</span>
          ${statsText ? `<span class="tsr-streak">${statsText}</span>` : ''}
        </div>
        ${kebabMenuHtml('ex-' + exercise.id, [
          { key: 'edit', label: 'تعديل' },
          { key: 'delete', label: 'حذف', danger: true }
        ])}
      </div>
      ${photoUrl && (exercise.photoDisplayMode ?? 'thumb_and_detail') === 'thumb_and_detail' ? `<img class="diary-entry-photo" src="${photoUrl}" alt="">` : ''}
      ${exercise.description ? `<p class="exercise-desc">${escapeHtml(exercise.description)}</p>` : ''}
      <div class="exercise-controls">
        <button class="adhkar-count-btn" data-action="sets">${sets} مجموعة</button>
        <button class="adhkar-plus" data-action="inc-sets">+</button>
        <button class="btn btn-secondary btn-sm" data-action="timer">⏱️ مؤقّت</button>
        ${exercise.youtubeLink ? `<a class="btn btn-secondary btn-sm" href="${escapeHtml(exercise.youtubeLink)}" target="_blank" rel="noopener">🎬</a>` : ''}
      </div>
    </div>`;
}

async function renderExercisesList(container, { showStreak = true } = {}) {
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

  async function refresh() { await renderExercisesList(container, { showStreak }); }

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
  container.querySelectorAll('.exercise-row').forEach(row => {
    const id = Number(row.dataset.exerciseId);
    row.querySelector('[data-action="inc-sets"]').addEventListener('click', async () => {
      await incrementExerciseSets(id, today);
      await refresh();
    });
    row.querySelector('[data-action="sets"]').addEventListener('click', async () => {
      const current = await getExerciseSets(id, today);
      const input = prompt('عدد المجموعات اليوم:', String(current));
      if (input === null) return;
      const n = parseInt(input, 10);
      if (!Number.isNaN(n) && n >= 0) { await setExerciseSets(id, today, n); await refresh(); }
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
      <button class="icon-btn" id="training-back">→</button>
      <h1>التمارين</h1>
    </div>
    <div class="card">
      <button class="btn btn-primary btn-block" id="add-exercise-btn">+ تمرين جديد</button>
      <div id="exercises-list"></div>
    </div>
  `;
  document.getElementById('training-back').addEventListener('click', () => history.back());
  const listEl = document.getElementById('exercises-list');
  await renderExercisesList(listEl);
  document.getElementById('add-exercise-btn').addEventListener('click', () => {
    openExerciseModal({ onSaved: () => renderExercisesList(listEl) });
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
    return yearLogs.length > 0 ? `<div class="yearly-row"><span>${escapeHtml(ex.name)}</span><span>${yearLogs.length} يوم · ${totalSets} مجموعة</span></div>` : '';
  }));
  if (totalSessions === 0) return null;
  return { title: 'التمارين', html: rows.join(''), count: totalSessions };
}
