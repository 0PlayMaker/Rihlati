// courses.js — Phase 12 (التعلم).
// Materials are one type per entry (link/youtube/photo/text), not a
// combined multi-type card like recipes — she listed the four forms
// without asking for "all three at once" here, so keeping each entry
// single-purpose is the simpler, more literal fit.

// ===================== Courses =====================

async function createCourse(title, description) {
  const all = await db.courses.toArray();
  return db.courses.add({ title, description: description || '', archived: false, order: all.length, createdAt: Date.now() });
}
async function updateCourse(id, { title, description }) {
  await db.courses.update(id, { title, description: description || '' });
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
      <label class="field-label">وصف (اختياري)</label>
      <textarea class="mood-note-input" id="course-desc-input"></textarea>
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
    document.getElementById('course-desc-input').value = existing.description || '';
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
    const description = document.getElementById('course-desc-input').value.trim();
    if (existingId) await updateCourse(existingId, { title, description });
    else await createCourse(title, description);
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
    .sort((a, b) => {
      if (a.dueDate && b.dueDate) return a.dueDate.localeCompare(b.dueDate);
      if (a.dueDate) return -1; // dated todos surface above undated ones
      if (b.dueDate) return 1;
      return b.createdAt - a.createdAt;
    });
}

function courseTodoRowHtml(todo, showCourse) {
  return `
    <div class="task-row-wrap">
      <label class="task-row ${todo.done ? 'done' : ''}">
        <input type="checkbox" data-course-todo-id="${todo.id}" ${todo.done ? 'checked' : ''}>
        <span class="task-title">${escapeHtml(todo.title)}${showCourse ? ` <span class="course-todo-source">— ${escapeHtml(todo.courseTitle)}</span>` : ''}</span>
        ${todo.dueDate ? `<span class="task-reminder">📅 ${formatDateArabic(todo.dueDate, { weekday: false })}</span>` : ''}
      </label>
      <div class="row-actions-wrap">${kebabMenuHtml(String(todo.id), [
        { key: 'edit', label: 'تعديل' },
        { key: 'delete', label: 'حذف', danger: true }
      ])}</div>
    </div>`;
}

async function renderCourseTodoList(container, courseId) {
  const todos = (await db.courseTodos.where('courseId').equals(courseId).toArray()).sort((a, b) => (a.done - b.done) || (b.createdAt - a.createdAt));
  if (todos.length === 0) {
    container.innerHTML = `<div class="empty-state"><p>ما في مهام لهذه الدورة بعد.</p></div>`;
    return;
  }
  container.innerHTML = todos.map(t => courseTodoRowHtml(t, false)).join('');
  container.querySelectorAll('[data-course-todo-id]').forEach(cb => {
    cb.addEventListener('change', async () => {
      await toggleCourseTodo(Number(cb.dataset.courseTodoId));
      await renderCourseTodoList(container, courseId);
    });
  });
  wireKebabMenus(container, async (rowId, action) => {
    const id = Number(rowId);
    if (action === 'edit') {
      openCourseTodoModal({ courseId, existingId: id, onSaved: () => renderCourseTodoList(container, courseId) });
    } else if (action === 'delete') {
      if (!confirm('حذف هذه المهمة؟')) return;
      await deleteCourseTodo(id);
      await renderCourseTodoList(container, courseId);
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

function renderPomodoroCard(container) {
  (async () => {
    const { workMinutes, breakMinutes } = await getPomodoroSettings();
    let isBreak = false;
    let remaining = workMinutes * 60;
    let intervalId = null;

    container.innerHTML = `
      <h2 class="card-title">🍅 مؤقّت بومودورو</h2>
      <div class="timer-display" id="pomo-display">${formatTimer(remaining)}</div>
      <p class="settings-note" id="pomo-phase-label">وقت التركيز</p>
      <div class="timer-duration-row">
        <label class="field-label">تركيز (د)</label>
        <input class="text-input" type="number" min="1" id="pomo-work-input" value="${workMinutes}">
        <label class="field-label">راحة (د)</label>
        <input class="text-input" type="number" min="1" id="pomo-break-input" value="${breakMinutes}">
      </div>
      <div class="modal-actions timer-controls">
        <button class="btn btn-secondary" id="pomo-reset">إعادة</button>
        <button class="btn btn-primary" id="pomo-toggle">ابدأ</button>
      </div>
    `;

    const display = document.getElementById('pomo-display');
    const phaseLabel = document.getElementById('pomo-phase-label');
    const toggleBtn = document.getElementById('pomo-toggle');
    const workInput = document.getElementById('pomo-work-input');
    const breakInput = document.getElementById('pomo-break-input');

    function tick() {
      remaining -= 1;
      display.textContent = formatTimer(Math.max(0, remaining));
      if (remaining <= 0) {
        playBeep();
        if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
        isBreak = !isBreak;
        remaining = (isBreak ? Number(breakInput.value) : Number(workInput.value)) * 60;
        phaseLabel.textContent = isBreak ? 'وقت الراحة' : 'وقت التركيز';
        display.classList.toggle('timer-done', false);
      }
    }

    toggleBtn.addEventListener('click', async () => {
      if (intervalId) {
        clearInterval(intervalId);
        intervalId = null;
        toggleBtn.textContent = 'استئناف';
      } else {
        unlockAudioContext();
        await savePomodoroSettings(Number(workInput.value) || 25, Number(breakInput.value) || 5);
        intervalId = setInterval(tick, 1000);
        toggleBtn.textContent = 'إيقاف';
      }
    });
    document.getElementById('pomo-reset').addEventListener('click', () => {
      clearInterval(intervalId);
      intervalId = null;
      isBreak = false;
      remaining = Number(workInput.value) * 60 || workMinutes * 60;
      phaseLabel.textContent = 'وقت التركيز';
      display.textContent = formatTimer(remaining);
      toggleBtn.textContent = 'ابدأ';
    });
  })();
}

// ===================== Pages =====================

async function renderStudyPage(params, view) {
  view.innerHTML = `
    <div class="page-header">
      <button class="icon-btn" id="study-back">→</button>
      <h1>التعلم</h1>
    </div>
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
      return `
        <button class="food-row course-row" data-course-id="${c.id}">
          <span class="food-thumb food-thumb-placeholder">🎓</span>
          <div class="food-row-info">
            <span class="food-row-title">${escapeHtml(c.title)}</span>
            ${progress.total > 0 ? `<span class="food-row-notes">${progress.done}/${progress.total} مهمة</span>` : ''}
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

  renderPomodoroCard(document.getElementById('pomodoro-card'));
}

async function renderCoursePage(params, view) {
  const courseId = Number(params[0]);
  const course = await db.courses.get(courseId);
  if (!course) { view.innerHTML = `<div class="empty-state"><p>الدورة غير موجودة.</p></div>`; return; }

  view.innerHTML = `
    <div class="page-header">
      <button class="icon-btn" id="course-back">→</button>
      <h1>${escapeHtml(course.title)}</h1>
      ${kebabMenuHtml('course-' + courseId, [{ key: 'edit', label: 'تعديل الدورة' }, { key: 'delete', label: 'حذف الدورة', danger: true }])}
    </div>
    ${course.description ? `<p class="settings-note">${escapeHtml(course.description)}</p>` : ''}
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

  const todosEl = document.getElementById('course-todos-list');
  await renderCourseTodoList(todosEl, courseId);
  document.getElementById('add-ctodo-btn').addEventListener('click', () => {
    openCourseTodoModal({ courseId, onSaved: () => renderCourseTodoList(todosEl, courseId) });
  });

  const materialsEl = document.getElementById('course-materials-list');
  await renderMaterialsList(materialsEl, courseId);
  document.getElementById('add-material-btn').addEventListener('click', () => {
    openMaterialModal({ courseId, onSaved: () => renderMaterialsList(materialsEl, courseId) });
  });
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
  if (newCourses.length === 0 && doneTodos.length === 0) return null;
  const html = `
    <div class="yearly-row"><span>دورات جديدة</span><span>${newCourses.length}</span></div>
    <div class="yearly-row"><span>مهام منجزة</span><span>${doneTodos.length}</span></div>
  `;
  return { title: 'التعلم', html, count: newCourses.length + doneTodos.length };
}
