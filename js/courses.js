// courses.js — Phase 12 (التعلم).
// Materials are one type per entry (link/youtube/photo/text), not a
// combined multi-type card like recipes — she listed the four forms
// without asking for "all three at once" here, so keeping each entry
// single-purpose is the simpler, more literal fit.

// ===================== Courses =====================

async function createCourse(title, description, endDate, emoji) {
  const all = await db.courses.toArray();
  return db.courses.add({ title, description: description || '', endDate: endDate || null, emoji: emoji || '', archived: false, order: all.length, createdAt: Date.now() });
}
async function updateCourse(id, { title, description, endDate, emoji }) {
  await db.courses.update(id, { title, description: description || '', endDate: endDate || null, emoji: emoji || '' });
}
async function archiveCourse(id) {
  await db.courses.update(id, { archived: true });
}
async function getActiveCourses() {
  const all = await db.courses.toArray();
  return all.filter(c => !c.archived).sort((a, b) => a.order - b.order);
}
async function getCourseTodoProgress(courseId) {
  const todos = await db.courseTodos.where('courseId').equals(courseId).toArray();
  const done = todos.filter(t => t.done).length;
  return { done, total: todos.length };
}

function openCourseModal({ existingId, onSaved } = {}) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal">
      <h2 class="modal-title" id="course-modal-title">دورة جديدة</h2>
      <label class="field-label">اسم الدورة</label>
      <input class="text-input" id="course-title-input" placeholder="مثلاً: تعلم React" autofocus>
      <label class="field-label">رمز الدورة (اختياري)</label>
      <input class="text-input emoji-input" id="course-emoji-input" placeholder="🎓" maxlength="2">
      <label class="field-label">وصف (اختياري)</label>
      <textarea class="mood-note-input" id="course-desc-input"></textarea>
      <label class="field-label">تاريخ الانتهاء المتوقع (اختياري)</label>
      <input class="text-input" type="date" id="course-enddate-input">
      <div class="modal-actions">
        ${existingId ? `<button class="btn btn-danger btn-sm" id="course-delete-btn">حذف</button>` : ''}
        <button class="btn btn-text" id="course-cancel-btn">إلغاء</button>
        <button class="btn btn-primary" id="course-save-btn">حفظ</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  (async () => {
    if (!existingId) return;
    const existing = await db.courses.get(existingId);
    if (!existing) return;
    document.getElementById('course-modal-title').textContent = 'تعديل الدورة';
    document.getElementById('course-title-input').value = existing.title;
    document.getElementById('course-emoji-input').value = existing.emoji || '';
    document.getElementById('course-desc-input').value = existing.description || '';
    document.getElementById('course-enddate-input').value = existing.endDate || '';
  })();

  document.getElementById('course-cancel-btn').addEventListener('click', () => overlay.remove());
  const deleteBtn = document.getElementById('course-delete-btn');
  if (deleteBtn) deleteBtn.addEventListener('click', async () => {
    if (!confirm('حذف هذه الدورة؟ سيُحذف كل ما فيها من مهام ومواد.')) return;
    await archiveCourse(existingId);
    overlay.remove();
    if (onSaved) onSaved();
  });
  document.getElementById('course-save-btn').addEventListener('click', async () => {
    const title = document.getElementById('course-title-input').value.trim();
    if (!title) return;
    const emoji = document.getElementById('course-emoji-input').value.trim();
    const description = document.getElementById('course-desc-input').value.trim();
    const endDate = document.getElementById('course-enddate-input').value || null;
    if (existingId) await updateCourse(existingId, { title, description, endDate, emoji });
    else await createCourse(title, description, endDate, emoji);
    overlay.remove();
    if (onSaved) onSaved();
  });
}

// ===================== Course Todos =====================

async function addCourseTodo(courseId, title, dueDate) {
  await db.courseTodos.add({ courseId, title, done: false, dueDate: dueDate || null, createdAt: Date.now() });
}
async function updateCourseTodo(id, { title, dueDate }) {
  await db.courseTodos.update(id, { title, dueDate: dueDate || null });
}
async function toggleCourseTodo(id) {
  const t = await db.courseTodos.get(id);
  await db.courseTodos.update(id, { done: !t.done, doneAt: !t.done ? Date.now() : null });
}
async function deleteCourseTodo(id) {
  await db.courseTodos.delete(id);
}
async function getAllOpenCourseTodosWithCourse() {
  const [todos, courses] = await Promise.all([db.courseTodos.toArray(), getActiveCourses()]);
  const courseMap = new Map(courses.map(c => [c.id, c]));
  return todos
    .filter(t => !t.done && courseMap.has(t.courseId))
    .map(t => ({ ...t, courseTitle: courseMap.get(t.courseId).title }))
    .sort(compareCourseTodos);
}

function courseTodoRowHtml(todo, showCourse) {
  // A due date is only useful if it can shout. Overdue and due-today get
  // their own treatment instead of sitting in the same grey as everything
  // else — that's the whole point of having entered a date.
  const today = todayStr();
  const overdue = !todo.done && todo.dueDate && todo.dueDate < today;
  const dueToday = !todo.done && todo.dueDate === today;
  const dueClass = overdue ? 'due-overdue' : dueToday ? 'due-today' : '';
  const dueLabel = overdue ? 'متأخرة' : dueToday ? 'اليوم' : (todo.dueDate ? formatDateArabic(todo.dueDate, { weekday: false }) : '');
  return `
    <div class="task-row-wrap">
      <label class="task-row ${todo.done ? 'done' : ''}">
        <input type="checkbox" data-course-todo-id="${todo.id}" ${todo.done ? 'checked' : ''}>
        <span class="task-title">${escapeHtml(todo.title)}${showCourse ? ` <span class="course-todo-source">— ${escapeHtml(todo.courseTitle)}</span>` : ''}</span>
        ${todo.dueDate ? `<span class="task-reminder ${dueClass}">${overdue ? '⚠️' : '📅'} ${dueLabel}</span>` : ''}
      </label>
      <div class="row-actions-wrap">${kebabMenuHtml(String(todo.id), [
        { key: 'edit', label: 'تعديل' },
        { key: 'delete', label: 'حذف', danger: true }
      ])}</div>
    </div>`;
}

// The same ordering the Home aggregate uses, so a todo doesn't change
// position depending on which screen you look at it from: soonest due
// first, dated ahead of undated, newest-created as the final tiebreak.
function compareCourseTodos(a, b) {
  if (a.dueDate && b.dueDate) return a.dueDate.localeCompare(b.dueDate);
  if (a.dueDate) return -1;
  if (b.dueDate) return 1;
  return b.createdAt - a.createdAt;
}

async function renderCourseTodoList(container, courseId, onChange) {
  const all = (await db.courseTodos.where('courseId').equals(courseId).toArray()).sort(compareCourseTodos);
  if (all.length === 0) {
    container.innerHTML = `<div class="empty-state"><p>ما في مهام لهذه الدورة بعد.</p></div>`;
    return;
  }
  const open = all.filter(t => !t.done);
  const done = all.filter(t => t.done);
  container.innerHTML = `
    ${open.length ? open.map(t => courseTodoRowHtml(t, false)).join('') : '<p class="empty-state-sub">لا مهام مفتوحة. أحسنتِ! ✨</p>'}
    ${done.length ? `
      <h4 class="day-detail-subsection-title course-todos-done-title">منجزة (${done.length})</h4>
      ${done.map(t => courseTodoRowHtml(t, false)).join('')}` : ''}
  `;
  container.querySelectorAll('[data-course-todo-id]').forEach(cb => {
    cb.addEventListener('change', async () => {
      await toggleCourseTodo(Number(cb.dataset.courseTodoId));
      await renderCourseTodoList(container, courseId, onChange);
      if (onChange) await onChange(); // hero ring must move with the checkbox
    });
  });
  wireKebabMenus(container, async (rowId, action) => {
    const id = Number(rowId);
    if (action === 'edit') {
      openCourseTodoModal({ courseId, existingId: id, onSaved: async () => {
        await renderCourseTodoList(container, courseId, onChange);
        if (onChange) await onChange();
      }});
    } else if (action === 'delete') {
      if (!confirm('حذف هذه المهمة؟')) return;
      await deleteCourseTodo(id);
      await renderCourseTodoList(container, courseId, onChange);
      if (onChange) await onChange();
    }
  });
}

function openCourseTodoModal({ courseId, existingId, onSaved } = {}) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal">
      <h2 class="modal-title" id="ctodo-modal-title">مهمة جديدة</h2>
      <label class="field-label">العنوان</label>
      <input class="text-input" id="ctodo-title-input" autofocus>
      <label class="field-label">تاريخ الاستحقاق (اختياري)</label>
      <input class="text-input" type="date" id="ctodo-date-input">
      <div class="modal-actions">
        ${existingId ? `<button class="btn btn-danger btn-sm" id="ctodo-delete-btn">حذف</button>` : ''}
        <button class="btn btn-text" id="ctodo-cancel-btn">إلغاء</button>
        <button class="btn btn-primary" id="ctodo-save-btn">حفظ</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  (async () => {
    if (!existingId) return;
    const existing = await db.courseTodos.get(existingId);
    if (!existing) return;
    document.getElementById('ctodo-modal-title').textContent = 'تعديل المهمة';
    document.getElementById('ctodo-title-input').value = existing.title;
    document.getElementById('ctodo-date-input').value = existing.dueDate || '';
  })();

  document.getElementById('ctodo-cancel-btn').addEventListener('click', () => overlay.remove());
  const deleteBtn = document.getElementById('ctodo-delete-btn');
  if (deleteBtn) deleteBtn.addEventListener('click', async () => {
    if (!confirm('حذف هذه المهمة؟')) return;
    await deleteCourseTodo(existingId);
    overlay.remove();
    if (onSaved) onSaved();
  });
  document.getElementById('ctodo-save-btn').addEventListener('click', async () => {
    const title = document.getElementById('ctodo-title-input').value.trim();
    if (!title) return;
    const dueDate = document.getElementById('ctodo-date-input').value || null;
    if (existingId) await updateCourseTodo(existingId, { title, dueDate });
    else await addCourseTodo(courseId, title, dueDate);
    overlay.remove();
    if (onSaved) onSaved();
  });
}

// ===================== Course Materials =====================

const MATERIAL_TYPES = [
  { key: 'link', label: '🔗 رابط' },
  { key: 'youtube', label: '🎬 فيديو يوتيوب' },
  { key: 'photo', label: '🖼️ صورة' },
  { key: 'text', label: '📝 نص' }
];

let _materialPhotoUrls = [];
function trackMaterialPhotoUrl(blob) {
  const url = URL.createObjectURL(blob);
  _materialPhotoUrls.push(url);
  return url;
}
function revokeMaterialPhotoUrls() {
  _materialPhotoUrls.forEach(u => URL.revokeObjectURL(u));
  _materialPhotoUrls = [];
}

async function addCourseMaterial(courseId, { type, title, content, photoBlob }) {
  const id = await db.courseMaterials.add({ courseId, type, title: title || '', content: content || '', createdAt: Date.now() });
  if (photoBlob) await db.courseMaterialPhotos.put({ materialId: id, photoBlob });
  return id;
}
async function updateCourseMaterial(id, { title, content, photoBlob, removePhoto }) {
  await db.courseMaterials.update(id, { title: title || '', content: content || '' });
  if (photoBlob) await db.courseMaterialPhotos.put({ materialId: id, photoBlob });
  else if (removePhoto) await db.courseMaterialPhotos.delete(id);
}
async function deleteCourseMaterial(id) {
  await db.courseMaterials.delete(id);
  await db.courseMaterialPhotos.delete(id);
}

async function materialRowHtml(m) {
  const typeInfo = MATERIAL_TYPES.find(t => t.key === m.type) || MATERIAL_TYPES[0];
  let bodyHtml = '';
  if (m.type === 'link') bodyHtml = `<a class="see-all-link" href="${escapeHtml(m.content)}" target="_blank" rel="noopener">فتح الرابط ←</a>`;
  else if (m.type === 'youtube') {
    const embed = youtubeEmbedUrl(m.content);
    bodyHtml = embed ? `<div class="youtube-embed-wrap"><iframe src="${embed}" allowfullscreen loading="lazy"></iframe></div>` : `<a class="see-all-link" href="${escapeHtml(m.content)}" target="_blank" rel="noopener">فتح الفيديو ←</a>`;
  } else if (m.type === 'photo') {
    const photoRow = await db.courseMaterialPhotos.get(m.id);
    bodyHtml = photoRow ? `<img class="diary-entry-photo" src="${trackMaterialPhotoUrl(photoRow.photoBlob)}" alt="">` : '';
  } else if (m.type === 'text') {
    bodyHtml = `<p class="diary-entry-text">${escapeHtml(m.content)}</p>`;
  }
  return `
    <div class="card material-card" data-material-id="${m.id}">
      <div class="section-header">
        <span class="material-type-label">${typeInfo.label}${m.title ? ' — ' + escapeHtml(m.title) : ''}</span>
        ${kebabMenuHtml(String(m.id), [
          { key: 'edit', label: 'تعديل' },
          { key: 'delete', label: 'حذف', danger: true }
        ])}
      </div>
      ${bodyHtml}
    </div>`;
}

async function renderMaterialsList(container, courseId) {
  revokeMaterialPhotoUrls();
  const materials = (await db.courseMaterials.where('courseId').equals(courseId).toArray()).sort((a, b) => b.createdAt - a.createdAt);
  if (materials.length === 0) {
    container.innerHTML = `<div class="empty-state"><p>ما في مواد مضافة بعد.</p></div>`;
    return;
  }
  container.innerHTML = (await Promise.all(materials.map(materialRowHtml))).join('');
  wireKebabMenus(container, async (rowId, action) => {
    const id = Number(rowId);
    if (action === 'edit') {
      openMaterialModal({ courseId, existingId: id, onSaved: () => renderMaterialsList(container, courseId) });
    } else if (action === 'delete') {
      if (!confirm('حذف هذه المادة؟')) return;
      await deleteCourseMaterial(id);
      await renderMaterialsList(container, courseId);
    }
  });
}

function openMaterialModal({ courseId, existingId, onSaved } = {}) {
  let selectedType = 'link';
  let pendingPhotoBlob = null;
  let existingPhotoUrl = null;
  let removePhotoFlag = false;
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal modal-lg">
      <h2 class="modal-title" id="material-modal-title">مادة جديدة</h2>
      <div class="habit-type-chips" id="material-type-chips">
        ${MATERIAL_TYPES.map(t => `<button class="chip ${t.key === 'link' ? 'active' : ''}" data-type="${t.key}">${t.label}</button>`).join('')}
      </div>
      <label class="field-label">عنوان (اختياري)</label>
      <input class="text-input" id="material-title-input">
      <div id="material-fields"></div>
      <div class="modal-actions">
        ${existingId ? `<button class="btn btn-danger btn-sm" id="material-delete-btn">حذف</button>` : ''}
        <button class="btn btn-text" id="material-cancel-btn">إلغاء</button>
        <button class="btn btn-primary" id="material-save-btn">حفظ</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  function renderFields() {
    const el = document.getElementById('material-fields');
    if (selectedType === 'link') {
      el.innerHTML = `<label class="field-label">الرابط</label><input class="text-input" type="url" id="material-content-input" placeholder="https://...">`;
    } else if (selectedType === 'youtube') {
      el.innerHTML = `<label class="field-label">رابط الفيديو</label><input class="text-input" type="url" id="material-content-input" placeholder="https://youtube.com/...">`;
    } else if (selectedType === 'text') {
      el.innerHTML = `<label class="field-label">النص</label><textarea class="mood-note-input" id="material-content-input"></textarea>`;
    } else if (selectedType === 'photo') {
      el.innerHTML = `
        <label class="field-label">الصورة</label>
        <div class="food-photo-picker" id="material-photo-preview"></div>
        ${photoPickerHtml('material-photo')}`;
      renderPhotoArea();
      wirePhotoPicker('material-photo', async (file) => {
        pendingPhotoBlob = await resizeImageToBlob(file, 1200, 0.8);
        removePhotoFlag = false;
        renderPhotoArea();
      }, () => {
        pendingPhotoBlob = null;
        removePhotoFlag = true;
        renderPhotoArea();
      });
    }
  }
  function renderPhotoArea() {
    const el = document.getElementById('material-photo-preview');
    if (!el) return;
    if (pendingPhotoBlob) el.innerHTML = `<img src="${trackMaterialPhotoUrl(pendingPhotoBlob)}" alt="">`;
    else if (existingPhotoUrl && !removePhotoFlag) el.innerHTML = `<img src="${existingPhotoUrl}" alt="">`;
    else el.innerHTML = '<span class="food-photo-placeholder">📷</span>';
  }
  renderFields();

  overlay.querySelectorAll('#material-type-chips .chip').forEach(chip => {
    chip.addEventListener('click', () => {
      selectedType = chip.dataset.type;
      overlay.querySelectorAll('#material-type-chips .chip').forEach(c => c.classList.toggle('active', c === chip));
      renderFields();
    });
  });

  (async () => {
    if (!existingId) return;
    const existing = await db.courseMaterials.get(existingId);
    if (!existing) return;
    selectedType = existing.type;
    document.getElementById('material-modal-title').textContent = 'تعديل المادة';
    document.getElementById('material-title-input').value = existing.title || '';
    overlay.querySelectorAll('#material-type-chips .chip').forEach(c => c.classList.toggle('active', c.dataset.type === selectedType));
    renderFields();
    if (selectedType === 'photo') {
      const photoRow = await db.courseMaterialPhotos.get(existingId);
      if (photoRow) { existingPhotoUrl = trackMaterialPhotoUrl(photoRow.photoBlob); renderPhotoArea(); }
    } else {
      const input = document.getElementById('material-content-input');
      if (input) input.value = existing.content || '';
    }
  })();

  document.getElementById('material-cancel-btn').addEventListener('click', () => overlay.remove());
  const deleteBtn = document.getElementById('material-delete-btn');
  if (deleteBtn) deleteBtn.addEventListener('click', async () => {
    if (!confirm('حذف هذه المادة؟')) return;
    await deleteCourseMaterial(existingId);
    overlay.remove();
    if (onSaved) onSaved();
  });
  document.getElementById('material-save-btn').addEventListener('click', async () => {
    const title = document.getElementById('material-title-input').value.trim();
    const contentInput = document.getElementById('material-content-input');
    const content = contentInput ? contentInput.value.trim() : '';
    if (selectedType !== 'photo' && !content) return;
    if (existingId) await updateCourseMaterial(existingId, { title, content, photoBlob: pendingPhotoBlob, removePhoto: removePhotoFlag });
    else await addCourseMaterial(courseId, { type: selectedType, title, content, photoBlob: pendingPhotoBlob });
    overlay.remove();
    if (onSaved) onSaved();
  });
}

// ===================== Pomodoro =====================

async function getPomodoroSettings() {
  const s = await db.settings.get(1);
  return { workMinutes: s?.pomodoroWorkMinutes || 25, breakMinutes: s?.pomodoroBreakMinutes || 5 };
}
async function savePomodoroSettings(workMinutes, breakMinutes) {
  await db.settings.update(1, { pomodoroWorkMinutes: workMinutes, pomodoroBreakMinutes: breakMinutes });
}

// Same wall-clock design as the exercise timer: the countdown is
// derived from an absolute end timestamp rather than accumulated one
// tick at a time, so a throttled/suspended background tab can't make
// the number lie. It also means a phase that "should" have ended while
// the app was backgrounded is detected correctly on return.

// ===================== Study sessions (focus time) =====================
// Logged only when a FOCUS phase actually completes — a break isn't study,
// and a phase you abandoned halfway isn't either. Attribution to a course
// is optional: plenty of focused work doesn't belong to a course.

async function logStudySession(minutes, courseId = null) {
  if (!minutes || minutes <= 0) return;
  await db.studySessions.add({
    date: todayStr(),
    courseId: courseId ?? null,
    minutes: Math.round(minutes),
    completedAt: Date.now()
  });
}
async function getStudySessions() {
  return db.studySessions.toArray();
}
async function getStudyMinutesForDate(dateStr) {
  const rows = await db.studySessions.where('date').equals(dateStr).toArray();
  return rows.reduce((sum, r) => sum + (r.minutes || 0), 0);
}
async function getStudyMinutesForCourse(courseId) {
  const rows = await db.studySessions.where('courseId').equals(courseId).toArray();
  return rows.reduce((sum, r) => sum + (r.minutes || 0), 0);
}
async function getStudyStreak() {
  const rows = await getStudySessions();
  return computeCurrentStreak(rows.map(r => r.date), []);
}
async function getStudyWeekMinutes() {
  const rows = await getStudySessions();
  const from = addDays(todayStr(), -6);
  return rows.filter(r => r.date >= from).reduce((sum, r) => sum + (r.minutes || 0), 0);
}
// "٢ س ١٥ د" reads better than "135 minutes" once sessions add up.
function formatStudyMinutes(mins) {
  if (!mins) return '٠ د';
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h === 0) return `${toArabicNumeral(m)} د`;
  if (m === 0) return `${toArabicNumeral(h)} س`;
  return `${toArabicNumeral(h)} س ${toArabicNumeral(m)} د`;
}

const POMO_WORK_PRESETS = [15, 25, 50];
const POMO_BREAK_PRESETS = [5, 10, 15];

// The old card put a native <select> (which borrowed .text-input, so it was
// width:100%) directly above two 100px-wide number fields — the dropdown
// ballooned across the whole card while the inputs stayed tiny, and their
// labels crowded into them. Rebuilt around a progress ring (so you can SEE
// the phase draining), preset chips instead of fiddly number spinners on a
// phone, and the course picker as chips rather than a full-width dropdown.
function renderPomodoroCard(container, onSessionLogged, lockedCourseId = null) {
  (async () => {
    const { workMinutes, breakMinutes } = await getPomodoroSettings();
    // On a course page the session already belongs to that course, so the
    // picker would just be noise.
    const courses = lockedCourseId ? [] : await getActiveCourses();
    let isBreak = false;
    let workMin = workMinutes;
    let breakMin = breakMinutes;
    let remaining = workMin * 60;
    let endsAt = null;
    let intervalId = null;
    let paused = false;
    let selectedCourseId = lockedCourseId;

    const RING_R = 74;
    const CIRC = 2 * Math.PI * RING_R;

    container.innerHTML = `
      <div class="section-header">
        <h2 class="card-title">🍅 بومودورو</h2>
        <span class="pomo-phase-chip" id="pomo-phase-label">وقت التركيز</span>
      </div>

      <div class="pomo-ring-wrap">
        <svg class="pomo-ring" viewBox="0 0 170 170" aria-hidden="true">
          <circle class="pomo-ring-track" cx="85" cy="85" r="${RING_R}"/>
          <circle class="pomo-ring-fill" id="pomo-ring-fill" cx="85" cy="85" r="${RING_R}"/>
        </svg>
        <div class="pomo-center">
          <span class="pomo-time" id="pomo-display">${formatTimer(remaining)}</span>
          <span class="pomo-sub" id="pomo-sub"></span>
        </div>
      </div>

      <div class="pomo-controls">
        <button class="btn btn-secondary btn-sm" id="pomo-reset">إعادة</button>
        <button class="btn btn-primary" id="pomo-toggle">ابدأ</button>
      </div>

      <details class="pomo-settings">
        <summary>الإعدادات</summary>
        ${courses.length ? `
          <label class="field-label">لأي دورة؟</label>
          <div class="pomo-chip-row" id="pomo-course-chips">
            <button class="pomo-chip active" data-course="">بدون دورة</button>
            ${courses.map(c => `<button class="pomo-chip" data-course="${c.id}">${c.emoji || '🎓'} ${escapeHtml(c.title)}</button>`).join('')}
          </div>` : ''}

        <label class="field-label">مدّة التركيز</label>
        <div class="pomo-chip-row" id="pomo-work-chips">
          ${POMO_WORK_PRESETS.map(m => `<button class="pomo-chip ${m === workMin ? 'active' : ''}" data-min="${m}">${toArabicNumeral(m)} د</button>`).join('')}
          <input class="pomo-num" type="text" inputmode="numeric" id="pomo-work-input" value="${workMin}" aria-label="مدّة التركيز بالدقائق">
        </div>

        <label class="field-label">مدّة الراحة</label>
        <div class="pomo-chip-row" id="pomo-break-chips">
          ${POMO_BREAK_PRESETS.map(m => `<button class="pomo-chip ${m === breakMin ? 'active' : ''}" data-min="${m}">${toArabicNumeral(m)} د</button>`).join('')}
          <input class="pomo-num" type="text" inputmode="numeric" id="pomo-break-input" value="${breakMin}" aria-label="مدّة الراحة بالدقائق">
        </div>
      </details>
    `;

    const display = document.getElementById('pomo-display');
    const subEl = document.getElementById('pomo-sub');
    const phaseLabel = document.getElementById('pomo-phase-label');
    const toggleBtn = document.getElementById('pomo-toggle');
    const workInput = document.getElementById('pomo-work-input');
    const breakInput = document.getElementById('pomo-break-input');
    const ringFill = document.getElementById('pomo-ring-fill');
    ringFill.style.strokeDasharray = String(CIRC);

    const readWork = () => parseNumericInput(workInput.value, { int: true, min: 1 }) ?? 25;
    const readBreak = () => parseNumericInput(breakInput.value, { int: true, min: 1 }) ?? 5;

    function paintRing(left, total) {
      const frac = total > 0 ? Math.max(0, Math.min(1, left / total)) : 0;
      ringFill.style.strokeDashoffset = String(CIRC * (1 - frac));
      ringFill.classList.toggle('pomo-ring-break', isBreak);
    }
    function stopInterval() {
      if (intervalId) { clearInterval(intervalId); intervalId = null; }
    }

    function tick() {
      if (endsAt === null) return;
      const total = (isBreak ? breakMin : workMin) * 60;
      const left = Math.max(0, Math.round((endsAt - Date.now()) / 1000));
      if (left > 0) {
        display.textContent = formatTimer(left);
        paintRing(left, total);
        return;
      }
      playBeepSequence(3);
      if (navigator.vibrate) navigator.vibrate([200, 100, 200, 100, 200]);

      // A completed FOCUS phase is real study time. A break isn't, so
      // nothing is logged when a break ends.
      if (!isBreak) {
        logStudySession(workMin, selectedCourseId).then(() => {
          if (typeof onSessionLogged === 'function') onSessionLogged();
        });
      }

      const finishedAt = endsAt;
      isBreak = !isBreak;
      workMin = readWork();
      breakMin = readBreak();
      const nextSeconds = (isBreak ? breakMin : workMin) * 60;
      endsAt = finishedAt + nextSeconds * 1000;
      if (endsAt <= Date.now()) endsAt = Date.now() + nextSeconds * 1000;
      phaseLabel.textContent = isBreak ? 'وقت الراحة' : 'وقت التركيز';
      phaseLabel.classList.toggle('pomo-phase-break', isBreak);
      const left2 = Math.max(0, Math.round((endsAt - Date.now()) / 1000));
      display.textContent = formatTimer(left2);
      paintRing(left2, nextSeconds);
    }

    function refreshIdleDisplay() {
      if (intervalId || paused) return;
      workMin = readWork();
      breakMin = readBreak();
      remaining = (isBreak ? breakMin : workMin) * 60;
      display.textContent = formatTimer(remaining);
      paintRing(remaining, remaining);
    }

    // Preset chips and the free-text field stay in sync both ways.
    function wireChipRow(rowId, input) {
      const row = document.getElementById(rowId);
      if (!row) return;
      row.querySelectorAll('.pomo-chip').forEach(chip => {
        chip.addEventListener('click', () => {
          input.value = chip.dataset.min;
          row.querySelectorAll('.pomo-chip').forEach(c => c.classList.toggle('active', c === chip));
          refreshIdleDisplay();
        });
      });
      input.addEventListener('input', () => {
        const v = parseNumericInput(input.value, { int: true, min: 1 });
        row.querySelectorAll('.pomo-chip').forEach(c => c.classList.toggle('active', Number(c.dataset.min) === v));
        refreshIdleDisplay();
      });
    }
    wireChipRow('pomo-work-chips', workInput);
    wireChipRow('pomo-break-chips', breakInput);

    const courseChips = document.getElementById('pomo-course-chips');
    if (courseChips) {
      courseChips.querySelectorAll('.pomo-chip').forEach(chip => {
        chip.addEventListener('click', () => {
          selectedCourseId = chip.dataset.course ? Number(chip.dataset.course) : null;
          courseChips.querySelectorAll('.pomo-chip').forEach(c => c.classList.toggle('active', c === chip));
          subEl.textContent = selectedCourseId ? chip.textContent.trim() : '';
        });
      });
    }

    toggleBtn.addEventListener('click', async () => {
      if (intervalId) {
        remaining = Math.max(0, Math.round((endsAt - Date.now()) / 1000));
        stopInterval();
        endsAt = null;
        paused = true;
        display.textContent = formatTimer(remaining);
        toggleBtn.textContent = 'استئناف';
      } else {
        unlockAudioContext();
        workMin = readWork();
        breakMin = readBreak();
        await savePomodoroSettings(workMin, breakMin);
        if (!paused) {
          remaining = workMin * 60;
          isBreak = false;
          phaseLabel.textContent = 'وقت التركيز';
          phaseLabel.classList.remove('pomo-phase-break');
        }
        paused = false;
        endsAt = Date.now() + remaining * 1000;
        display.textContent = formatTimer(remaining);
        paintRing(remaining, (isBreak ? breakMin : workMin) * 60);
        intervalId = setInterval(tick, 250);
        toggleBtn.textContent = 'إيقاف';
      }
    });
    document.getElementById('pomo-reset').addEventListener('click', () => {
      stopInterval();
      endsAt = null;
      paused = false;
      isBreak = false;
      workMin = readWork();
      remaining = workMin * 60;
      phaseLabel.textContent = 'وقت التركيز';
      phaseLabel.classList.remove('pomo-phase-break');
      display.textContent = formatTimer(remaining);
      paintRing(remaining, remaining);
      toggleBtn.textContent = 'ابدأ';
    });

    paintRing(remaining, remaining);
    registerCleanup(stopInterval);
  })();
}

// ===================== Pages =====================

async function renderStudyFocusCard(container) {
  const [todayMins, weekMins, streak] = await Promise.all([
    getStudyMinutesForDate(todayStr()),
    getStudyWeekMinutes(),
    getStudyStreak()
  ]);
  const sessions = await getStudySessions();

  if (sessions.length === 0) {
    container.innerHTML = `
      <h2 class="card-title">⏳ وقت التركيز</h2>
      <p class="mini-progress-text">أنهي جلسة بومودورو واحدة ليبدأ التتبّع — كل جلسة تُسجَّل تلقائياً.</p>`;
    return;
  }

  container.innerHTML = `
    <h2 class="card-title">⏳ وقت التركيز</h2>
    <div class="diary-stat-row">
      <div class="diary-stat">
        <span class="diary-stat-num">${formatStudyMinutes(todayMins)}</span>
        <span class="diary-stat-label">اليوم</span>
      </div>
      <div class="diary-stat">
        <span class="diary-stat-num">${formatStudyMinutes(weekMins)}</span>
        <span class="diary-stat-label">آخر ٧ أيام</span>
      </div>
      <div class="diary-stat">
        <span class="diary-stat-num">${streak > 0 ? '🔥' + toArabicNumeral(streak) : '—'}</span>
        <span class="diary-stat-label">أيام متتالية</span>
      </div>
    </div>`;
}

async function renderStudyPage(params, view) {
  view.innerHTML = `
    <div class="page-header">
      <button class="icon-btn" aria-label="رجوع" id="study-back">→</button>
      <h1>التعلم</h1>
    </div>
    <div class="card" id="study-focus-card"></div>
    <div class="card">
      <div class="section-header">
        <h2 class="card-title">دوراتي</h2>
        <button class="link-btn" id="add-course-btn">+ دورة جديدة</button>
      </div>
      <div id="courses-list"></div>
    </div>
    <div class="card">
      <h2 class="card-title">كل المهام</h2>
      <div id="all-course-todos"></div>
    </div>
    <div class="card" id="pomodoro-card"></div>
  `;
  document.getElementById('study-back').addEventListener('click', () => history.back());

  async function refreshCourses() {
    const courses = await getActiveCourses();
    const listEl = document.getElementById('courses-list');
    if (courses.length === 0) {
      listEl.innerHTML = `<div class="empty-state"><p>ما في دورات مضافة بعد.</p></div>`;
      return;
    }
    const rows = await Promise.all(courses.map(async c => {
      const progress = await getCourseTodoProgress(c.id);
      const focusMins = await getStudyMinutesForCourse(c.id);
      const frac = progress.total > 0 ? progress.done / progress.total : 0;
      const complete = progress.total > 0 && progress.done === progress.total;
      // A ring reads faster than "3/5 مهمة", and shows completion at a glance.
      const ring = renderRing({
        size: 44, strokeWidth: 5,
        segments: [{ frac, color: complete ? 'var(--success-strong)' : 'var(--btn-color, var(--pink-deep))' }]
      });
      return `
        <button class="food-row course-row" data-course-id="${c.id}">
          <div class="course-ring-wrap">
            ${progress.total > 0 ? ring : ''}
            <span class="course-ring-emoji">${c.emoji || '🎓'}</span>
          </div>
          <div class="food-row-info">
            <span class="food-row-title">${escapeHtml(c.title)}${complete ? ' ✅' : ''}</span>
            <span class="food-row-notes">
              ${progress.total > 0 ? `${toArabicNumeral(progress.done)}/${toArabicNumeral(progress.total)} مهمة` : 'لا مهام بعد'}
              ${focusMins > 0 ? ` · ⏳ ${formatStudyMinutes(focusMins)}` : ''}
            </span>
          </div>
        </button>`;
    }));
    listEl.innerHTML = rows.join('');
    listEl.querySelectorAll('.course-row').forEach(row => {
      row.addEventListener('click', () => goTo('/course/' + row.dataset.courseId));
    });
  }
  await refreshCourses();
  document.getElementById('add-course-btn').addEventListener('click', () => openCourseModal({ onSaved: refreshCourses }));

  async function refreshAllTodos() {
    const todos = await getAllOpenCourseTodosWithCourse();
    const el = document.getElementById('all-course-todos');
    if (todos.length === 0) {
      el.innerHTML = `<div class="empty-state"><p>ما في مهام مفتوحة. أحسنتِ! ✨</p></div>`;
      return;
    }
    el.innerHTML = todos.map(t => courseTodoRowHtml(t, true)).join('');
    el.querySelectorAll('[data-course-todo-id]').forEach(cb => {
      cb.addEventListener('change', async () => {
        await toggleCourseTodo(Number(cb.dataset.courseTodoId));
        await refreshAllTodos();
        await refreshCourses();
      });
    });
    wireKebabMenus(el, async (rowId, action) => {
      const id = Number(rowId);
      if (action === 'delete') {
        if (!confirm('حذف هذه المهمة؟')) return;
        await deleteCourseTodo(id);
        await refreshAllTodos();
      }
      // edit intentionally omitted here — the aggregate view doesn't know
      // which course modal to attribute it to at a glance; edit from
      // inside the course itself.
    });
  }
  await refreshAllTodos();

  async function refreshFocus() {
    await renderStudyFocusCard(document.getElementById('study-focus-card'));
  }
  await refreshFocus();
  // When a focus phase completes, the totals above must update immediately —
  // otherwise she finishes a session and the card still says zero.
  renderPomodoroCard(document.getElementById('pomodoro-card'), async () => {
    await refreshFocus();
    await refreshCourses();
  });
}

// The course hero: everything you'd actually want to know the moment you
// open a course. Previously this page opened with just a title and two
// lists, which told you nothing about how the course was going.
async function renderCourseHero(container, course) {
  const courseId = course.id;
  const [progress, focusMins, materials] = await Promise.all([
    getCourseTodoProgress(courseId),
    getStudyMinutesForCourse(courseId),
    db.courseMaterials.where('courseId').equals(courseId).toArray()
  ]);
  const sessions = (await getStudySessions()).filter(s => s.courseId === courseId);
  const frac = progress.total > 0 ? progress.done / progress.total : 0;
  const complete = progress.total > 0 && progress.done === progress.total;
  const pct = Math.round(frac * 100);

  const ring = renderRing({
    size: 92, strokeWidth: 10,
    segments: [{ frac, color: complete ? 'var(--success-strong)' : 'var(--btn-color, var(--pink-deep))' }]
  });

  // Deadline: how long left, and — more usefully — whether the remaining
  // work actually fits in the remaining time at her current pace.
  let deadlineBlock = '';
  if (course.endDate) {
    const daysLeft = daysBetween(todayStr(), course.endDate);
    const overdue = daysLeft < 0;
    const remainingTodos = progress.total - progress.done;

    let paceNote = '';
    if (!complete && remainingTodos > 0 && daysLeft > 0) {
      const perDay = remainingTodos / daysLeft;
      paceNote = perDay <= 1
        ? `بمعدّل مهمة كل ${toArabicNumeral(Math.max(1, Math.round(1 / perDay)))} ${Math.round(1 / perDay) === 1 ? 'يوم' : 'أيام'} تصلين في الموعد.`
        : `تحتاجين ~${toArabicNumeral(Math.ceil(perDay))} مهام يومياً للوصول في الموعد.`;
    } else if (complete) {
      paceNote = 'أنهيتِ كل المهام 🎉';
    }

    const tone = complete ? 'success' : overdue ? 'danger' : daysLeft <= 7 ? 'warning' : 'neutral';
    deadlineBlock = `
      <div class="course-deadline course-deadline-${tone}">
        <span class="course-deadline-main">
          ${complete ? '✅ مكتملة' : overdue ? `⚠️ تجاوزتِ الموعد بـ ${toArabicNumeral(Math.abs(daysLeft))} يوم` : `🎯 باقي ${toArabicNumeral(daysLeft)} ${daysLeft === 1 ? 'يوم' : 'يوم'}`}
        </span>
        <span class="course-deadline-date">${formatDateArabic(course.endDate, { weekday: false })}</span>
      </div>
      ${paceNote ? `<p class="course-pace">${paceNote}</p>` : ''}`;
  }

  // Next thing to actually do — the soonest-due open todo.
  const todos = (await db.courseTodos.where('courseId').equals(courseId).toArray())
    .filter(t => !t.done).sort(compareCourseTodos);
  const next = todos[0];

  container.innerHTML = `
    <div class="course-hero">
      <div class="course-hero-ring">
        ${ring}
        <div class="course-hero-emoji">${course.emoji || '🎓'}</div>
      </div>
      <div class="course-hero-info">
        <h2 class="course-hero-title">${escapeHtml(course.title)}</h2>
        ${course.description ? `<p class="course-hero-desc">${escapeHtml(course.description)}</p>` : ''}
        <div class="course-hero-pct">${progress.total > 0 ? `${toArabicNumeral(pct)}٪ مكتمل` : 'لا مهام بعد'}</div>
      </div>
    </div>

    <div class="course-stat-row">
      <div class="course-stat">
        <span class="course-stat-num">${toArabicNumeral(progress.done)}/${toArabicNumeral(progress.total)}</span>
        <span class="course-stat-label">مهام</span>
      </div>
      <div class="course-stat">
        <span class="course-stat-num">${focusMins > 0 ? formatStudyMinutes(focusMins) : '—'}</span>
        <span class="course-stat-label">وقت تركيز</span>
      </div>
      <div class="course-stat">
        <span class="course-stat-num">${toArabicNumeral(sessions.length)}</span>
        <span class="course-stat-label">جلسة</span>
      </div>
      <div class="course-stat">
        <span class="course-stat-num">${toArabicNumeral(materials.length)}</span>
        <span class="course-stat-label">مادة</span>
      </div>
    </div>

    ${deadlineBlock}

    ${next ? `
      <div class="course-next">
        <span class="course-next-label">التالي</span>
        <span class="course-next-title">${escapeHtml(next.title)}</span>
        ${next.dueDate ? `<span class="course-next-due">${formatDateArabic(next.dueDate, { weekday: false })}</span>` : ''}
      </div>` : ''}
  `;
}

async function renderCoursePage(params, view) {
  const courseId = Number(params[0]);
  const course = await db.courses.get(courseId);
  if (!course) { view.innerHTML = `<div class="empty-state"><p>الدورة غير موجودة.</p></div>`; return; }

  view.innerHTML = `
    <div class="page-header">
      <button class="icon-btn" aria-label="رجوع" id="course-back">→</button>
      <h1>${escapeHtml(course.title)}</h1>
      ${kebabMenuHtml('course-' + courseId, [{ key: 'edit', label: 'تعديل الدورة' }, { key: 'delete', label: 'حذف الدورة', danger: true }])}
    </div>

    <div class="card" id="course-hero-card"></div>

    <div class="card">
      <div class="section-header">
        <h2 class="card-title">المهام</h2>
        <button class="link-btn" id="add-ctodo-btn">+ مهمة</button>
      </div>
      <div id="course-todos-list"></div>
    </div>

    <div class="card">
      <div class="section-header">
        <h2 class="card-title">المواد</h2>
        <button class="link-btn" id="add-material-btn">+ مادة</button>
      </div>
      <div id="course-materials-list"></div>
    </div>

    <div class="card" id="course-pomodoro"></div>
  `;
  document.getElementById('course-back').addEventListener('click', () => goTo('/study'));
  wireKebabMenus(view, async (rowId, action) => {
    if (action === 'edit') openCourseModal({ existingId: courseId, onSaved: () => renderCoursePage(params, view) });
    else if (action === 'delete') {
      if (!confirm('حذف هذه الدورة؟ سيُحذف كل ما فيها.')) return;
      await archiveCourse(courseId);
      goTo('/study');
    }
  });

  const heroEl = document.getElementById('course-hero-card');
  const todosEl = document.getElementById('course-todos-list');
  const materialsEl = document.getElementById('course-materials-list');

  async function refreshHero() { await renderCourseHero(heroEl, course); }
  async function refreshTodos() {
    await renderCourseTodoList(todosEl, courseId, refreshHero);
    await refreshHero();
  }

  await refreshHero();
  await renderCourseTodoList(todosEl, courseId, refreshHero);
  document.getElementById('add-ctodo-btn').addEventListener('click', () => {
    openCourseTodoModal({ courseId, onSaved: refreshTodos });
  });

  await renderMaterialsList(materialsEl, courseId);
  document.getElementById('add-material-btn').addEventListener('click', () => {
    openMaterialModal({ courseId, onSaved: async () => { await renderMaterialsList(materialsEl, courseId); await refreshHero(); } });
  });

  // Focus on THIS course without having to go back to Study and pick it
  // from a list — the session is pre-attributed.
  renderCoursePomodoro(document.getElementById('course-pomodoro'), courseId, refreshHero);
}

// The same timer, but locked to this course so every completed session
// counts toward it automatically.
function renderCoursePomodoro(container, courseId, onSessionLogged) {
  renderPomodoroCard(container, onSessionLogged, courseId);
}

function studyGlanceText(courseCount, openTodoCount) {
  if (courseCount === 0) return 'أضيفي دورتك الأولى';
  return `${courseCount} ${courseCount === 1 ? 'دورة' : 'دورات'}${openTodoCount > 0 ? ` · ${openTodoCount} مهمة مفتوحة` : ''}`;
}

// ---------- Day Detail provider ----------

async function courseTodosDayProvider(dateStr) {
  const todos = (await db.courseTodos.toArray()).filter(t => t.dueDate === dateStr);
  if (todos.length === 0) return null;
  const courses = await getActiveCourses();
  const courseMap = new Map(courses.map(c => [c.id, c.title]));
  const node = document.createElement('div');
  node.innerHTML = todos.map(t => `
    <div class="yearly-row">
      <span>${t.done ? '✅' : '⬜'} ${escapeHtml(t.title)}</span>
      <span>${escapeHtml(courseMap.get(t.courseId) || '')}</span>
    </div>`).join('');
  return { title: 'مهام التعلم', node };
}

// ---------- Yearly stats provider ----------

async function studyYearlyProvider(year) {
  const prefix = String(year);
  const courses = await db.courses.toArray();
  const newCourses = courses.filter(c => new Date(c.createdAt).getFullYear() === year);
  const allTodos = await db.courseTodos.toArray();
  const doneTodos = allTodos.filter(t => t.done && t.doneAt && new Date(t.doneAt).getFullYear() === year);

  const sessions = (await getStudySessions()).filter(s => s.date.startsWith(prefix));
  const totalMins = sessions.reduce((sum, s) => sum + (s.minutes || 0), 0);
  const studyDays = new Set(sessions.map(s => s.date)).size;

  if (newCourses.length === 0 && doneTodos.length === 0 && sessions.length === 0) return null;

  // Per-course focus time, collapsed behind a details so the section stays
  // compact when she has many courses.
  const byCourse = {};
  sessions.forEach(s => {
    if (s.courseId == null) return;
    byCourse[s.courseId] = (byCourse[s.courseId] || 0) + (s.minutes || 0);
  });
  const courseMap = new Map(courses.map(c => [c.id, c]));
  const courseRows = Object.entries(byCourse)
    .sort((a, b) => b[1] - a[1])
    .filter(([id]) => courseMap.has(Number(id)))
    .map(([id, mins]) => {
      const c = courseMap.get(Number(id));
      return `<div class="yearly-row"><span>${c.emoji || '🎓'} ${escapeHtml(c.title)}</span><span>${formatStudyMinutes(mins)}</span></div>`;
    }).join('');

  const html = `
    <div class="yearly-row"><span>دورات جديدة</span><span>${toArabicNumeral(newCourses.length)}</span></div>
    <div class="yearly-row"><span>مهام منجزة</span><span>${toArabicNumeral(doneTodos.length)}</span></div>
    ${sessions.length ? `
      <div class="yearly-row"><span>إجمالي وقت التركيز</span><span>⏳ ${formatStudyMinutes(totalMins)}</span></div>
      <div class="yearly-row"><span>أيام الدراسة</span><span>${toArabicNumeral(studyDays)} يوم</span></div>
      <div class="yearly-row"><span>عدد الجلسات</span><span>${toArabicNumeral(sessions.length)}</span></div>` : ''}
    ${courseRows ? `
      <details class="yearly-pain-details">
        <summary>وقت التركيز لكل دورة</summary>
        ${courseRows}
      </details>` : ''}
  `;
  return { title: 'التعلم', html, count: newCourses.length + doneTodos.length + sessions.length };
}
