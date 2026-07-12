// dailycare.js — Phase 17 (العناية اليومية).
// Each routine item gets its own daily checkbox and its own streak —
// more granular than dailyAdhkarItems (worship.js), which only tracks
// one combined done/not-done per morning/evening rather than per item.


// ===================== CRUD =====================

async function addCareRoutine(kind, { title, youtubeLink, photoBlob }) {
  const all = await getCareRoutines(kind);
  const id = await db.dailyCareRoutines.add({ kind, title, youtubeLink: youtubeLink || '', order: all.length, createdAt: Date.now() });
  if (photoBlob) await db.dailyCareRoutinePhotos.put({ routineId: id, photoBlob });
  return id;
}
async function updateCareRoutine(id, { title, youtubeLink, photoBlob, removePhoto }) {
  await db.dailyCareRoutines.update(id, { title, youtubeLink: youtubeLink || '' });
  if (photoBlob) await db.dailyCareRoutinePhotos.put({ routineId: id, photoBlob });
  else if (removePhoto) await db.dailyCareRoutinePhotos.delete(id);
}
async function deleteCareRoutine(id) {
  await db.dailyCareRoutines.delete(id);
  await db.dailyCareRoutinePhotos.delete(id);
}
async function getCareRoutines(kind) {
  const all = await db.dailyCareRoutines.where('kind').equals(kind).toArray();
  return all.sort((a, b) => a.order - b.order);
}
async function getCareRoutinePhoto(id) {
  return db.dailyCareRoutinePhotos.get(id);
}

async function isCareRoutineDone(routineId, date) {
  return !!(await getLog(db.dailyCareLogs, 'routineId', routineId, date));
}
async function toggleCareRoutine(routineId, date) {
  const existing = await getLog(db.dailyCareLogs, 'routineId', routineId, date);
  if (existing) await deleteLog(db.dailyCareLogs, 'routineId', routineId, date);
  else await upsertLog(db.dailyCareLogs, 'routineId', routineId, date, {});
}
async function getCareRoutineStats(routineId) {
  const logs = await db.dailyCareLogs.where('routineId').equals(routineId).toArray();
  return computeImplicitStats(logs.map(l => l.date), []);
}

// How many of a given routine list are ticked on a date. Shared so the
// Home rings and the Daily Care card can't drift apart on what "done"
// means.
async function countCareRoutinesDone(routines, dateStr) {
  if (!routines.length) return 0;
  const flags = await Promise.all(routines.map(r => isCareRoutineDone(r.id, dateStr)));
  return flags.filter(Boolean).length;
}

// ===================== Modal =====================

function openCareRoutineModal(kind, { existingId, onSaved } = {}) {
  let pendingPhotoBlob = null;
  let existingPhotoUrl = null;
  let removePhotoFlag = false;
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal modal-lg">
      <h2 class="modal-title" id="care-modal-title">${kind === 'morning' ? 'روتين صباحي' : 'روتين مسائي'} جديد</h2>
      <label class="field-label">اسم الروتين</label>
      <input class="text-input" id="care-title-input" placeholder="مثلاً: غسل الوجه" autofocus>
      <label class="field-label">رابط فيديو يوتيوب (اختياري)</label>
      <input class="text-input" type="url" id="care-youtube-input" placeholder="https://youtube.com/...">
      <label class="field-label">صورة (اختياري)</label>
      <div class="food-photo-picker" id="care-photo-preview"></div>
      ${photoPickerHtml('care-photo')}
      <div class="modal-actions">
        ${existingId ? `<button class="btn btn-danger btn-sm" id="care-delete-btn">حذف</button>` : ''}
        <button class="btn btn-text" id="care-cancel-btn">إلغاء</button>
        <button class="btn btn-primary" id="care-save-btn">حفظ</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  // Only the transient preview URL is recycled here. existingPhotoUrl is
  // cached and re-rendered on later passes, so it must NOT be revoked --
  // doing so would leave a dead blob: src and a broken image.
  let pendingPreviewUrl = null;
  function renderPhotoArea() {
    const el = document.getElementById('care-photo-preview');
    if (pendingPreviewUrl) { URL.revokeObjectURL(pendingPreviewUrl); pendingPreviewUrl = null; }
    if (pendingPhotoBlob) {
      pendingPreviewUrl = URL.createObjectURL(pendingPhotoBlob);
      el.innerHTML = `<img src="${pendingPreviewUrl}" alt="">`;
    }
    else if (existingPhotoUrl && !removePhotoFlag) el.innerHTML = `<img src="${existingPhotoUrl}" alt="">`;
    else el.innerHTML = '<span class="food-photo-placeholder">📷</span>';
  }
  renderPhotoArea();
  wirePhotoPicker('care-photo', async (file) => {
    pendingPhotoBlob = await resizeImageToBlob(file, 1200, 0.8);
    removePhotoFlag = false;
    renderPhotoArea();
  }, () => {
    pendingPhotoBlob = null;
    removePhotoFlag = true;
    renderPhotoArea();
  });

  (async () => {
    if (!existingId) return;
    const existing = await db.dailyCareRoutines.get(existingId);
    if (!existing) return;
    document.getElementById('care-modal-title').textContent = 'تعديل الروتين';
    document.getElementById('care-title-input').value = existing.title;
    document.getElementById('care-youtube-input').value = existing.youtubeLink || '';
    const photoRow = await getCareRoutinePhoto(existingId);
    if (photoRow) { existingPhotoUrl = URL.createObjectURL(photoRow.photoBlob); renderPhotoArea(); }
  })();

  // Every exit path must free both blob URLs this modal created,
  // otherwise each open/close cycle pins another copy of the photo.
  function closeModal() {
    if (pendingPreviewUrl) URL.revokeObjectURL(pendingPreviewUrl);
    if (existingPhotoUrl) URL.revokeObjectURL(existingPhotoUrl);
    pendingPreviewUrl = null;
    existingPhotoUrl = null;
    overlay.remove();
  }
  document.getElementById('care-cancel-btn').addEventListener('click', closeModal);
  const deleteBtn = document.getElementById('care-delete-btn');
  if (deleteBtn) deleteBtn.addEventListener('click', async () => {
    if (!confirm('حذف هذا الروتين؟')) return;
    await deleteCareRoutine(existingId);
    closeModal();
    if (onSaved) onSaved();
  });
  document.getElementById('care-save-btn').addEventListener('click', async () => {
    const title = document.getElementById('care-title-input').value.trim();
    if (!title) return;
    const youtubeLink = document.getElementById('care-youtube-input').value.trim();
    if (existingId) await updateCareRoutine(existingId, { title, youtubeLink, photoBlob: pendingPhotoBlob, removePhoto: removePhotoFlag });
    else await addCareRoutine(kind, { title, youtubeLink, photoBlob: pendingPhotoBlob });
    closeModal();
    if (onSaved) onSaved();
  });
}

// ===================== Rendering =====================

async function careRoutineRowHtml(routine, dateStr) {
  const done = await isCareRoutineDone(routine.id, dateStr);
  const stats = await getCareRoutineStats(routine.id);
  const photoRow = await getCareRoutinePhoto(routine.id);
  const photoUrl = photoRow ? URL.createObjectURL(photoRow.photoBlob) : null;
  const embed = routine.youtubeLink ? youtubeEmbedUrl(routine.youtubeLink) : null;
  return `
    <div class="care-routine-card" data-routine-id="${routine.id}">
      <div class="task-row-wrap">
        <label class="task-row ${done ? 'done' : ''}">
          <input type="checkbox" class="care-routine-checkbox" data-routine-id="${routine.id}" ${done ? 'checked' : ''}>
          <span class="task-title">${escapeHtml(routine.title)}</span>
          ${stats.streak > 0 ? `<span class="tsr-streak">🔥${stats.streak}</span>` : ''}
        </label>
        ${kebabMenuHtml('care-' + routine.id, [
          { key: 'edit', label: 'تعديل' },
          { key: 'delete', label: 'حذف', danger: true }
        ])}
      </div>
      ${photoUrl ? `<img class="diary-entry-photo care-routine-photo" src="${photoUrl}" alt="">` : ''}
      ${embed ? `<div class="youtube-embed-wrap care-routine-video"><iframe src="${embed}" allowfullscreen loading="lazy"></iframe></div>` : ''}
    </div>`;
}

async function renderCareSection(container, kind, dateStr, onChange) {
  // This card re-renders on every checkbox tick and each render mints a
  // fresh blob URL per routine photo, so the outgoing render's URLs must
  // be released or the images pile up in memory indefinitely. Scoped to
  // THIS container: a blanket revoke-all would kill the sibling section's
  // photos (morning and evening render separately).
  revokeBlobUrlsIn(container);
  const routines = await getCareRoutines(kind);
  if (routines.length === 0) {
    container.innerHTML = `<p class="empty-state-sub">ما في روتين مضاف بعد.</p>`;
    return;
  }
  container.innerHTML = (await Promise.all(routines.map(r => careRoutineRowHtml(r, dateStr)))).join('');
  container.querySelectorAll('.care-routine-checkbox').forEach(cb => {
    cb.addEventListener('change', async () => {
      await toggleCareRoutine(Number(cb.dataset.routineId), dateStr);
      await renderCareSection(container, kind, dateStr, onChange);
      if (onChange) onChange();
    });
  });
  wireKebabMenus(container, async (rowId, action) => {
    const id = Number(rowId.replace('care-', ''));
    if (action === 'edit') {
      openCareRoutineModal(kind, { existingId: id, onSaved: () => renderCareSection(container, kind, dateStr, onChange) });
    } else if (action === 'delete') {
      if (!confirm('حذف هذا الروتين؟')) return;
      await deleteCareRoutine(id);
      await renderCareSection(container, kind, dateStr, onChange);
      if (onChange) onChange();
    }
  });
}

async function renderCareGlance(container) {
  const today = todayStr();
  const [morning, evening] = await Promise.all([getCareRoutines('morning'), getCareRoutines('evening')]);
  const all = [...morning, ...evening];
  if (all.length === 0) {
    container.innerHTML = `<p class="settings-note">أضيفي روتينك لتبدأ التتبّع.</p>`;
    return;
  }
  const doneFlags = await Promise.all(all.map(r => isCareRoutineDone(r.id, today)));
  const doneCount = doneFlags.filter(Boolean).length;
  container.innerHTML = `
    <div class="mini-progress">
      <div class="mini-progress-track"><div class="mini-progress-fill" style="width:${all.length ? doneCount / all.length * 100 : 0}%"></div></div>
      <span class="mini-progress-text">اليوم: ${doneCount}/${all.length}</span>
    </div>`;
}

async function renderDailyCareCard(container) {
  const today = todayStr();
  container.innerHTML = `
    <div class="section-header">
      <h2 class="card-title">🧴 العناية اليومية</h2>
    </div>
    <div id="care-glance"></div>
    <h3 class="material-type-label">🌅 الروتين الصباحي</h3>
    <div id="care-morning-list"></div>
    <button class="link-btn" id="care-add-morning">+ إضافة روتين صباحي</button>
    <h3 class="material-type-label" style="margin-top: var(--space-3);">🌙 الروتين المسائي</h3>
    <div id="care-evening-list"></div>
    <button class="link-btn" id="care-add-evening">+ إضافة روتين مسائي</button>
  `;
  async function refreshGlance() { await renderCareGlance(document.getElementById('care-glance')); }
  await refreshGlance();
  const morningEl = document.getElementById('care-morning-list');
  const eveningEl = document.getElementById('care-evening-list');
  await renderCareSection(morningEl, 'morning', today, refreshGlance);
  await renderCareSection(eveningEl, 'evening', today, refreshGlance);
  document.getElementById('care-add-morning').addEventListener('click', () => {
    openCareRoutineModal('morning', { onSaved: async () => { await renderCareSection(morningEl, 'morning', today, refreshGlance); await refreshGlance(); } });
  });
  document.getElementById('care-add-evening').addEventListener('click', () => {
    openCareRoutineModal('evening', { onSaved: async () => { await renderCareSection(eveningEl, 'evening', today, refreshGlance); await refreshGlance(); } });
  });
}

// ---------- Day Detail provider ----------

async function dailyCareDayProvider(dateStr) {
  const logs = await db.dailyCareLogs.toArray();
  const dayLogs = logs.filter(l => l.date === dateStr);
  if (dayLogs.length === 0) return null;
  const routines = [...(await getCareRoutines('morning')), ...(await getCareRoutines('evening'))];
  const routineMap = new Map(routines.map(r => [r.id, r]));
  const node = document.createElement('div');
  node.innerHTML = dayLogs
    .map(l => routineMap.get(l.routineId))
    .filter(Boolean)
    .map(r => `<div class="yearly-row"><span>✅ ${escapeHtml(r.title)}</span><span>${r.kind === 'morning' ? '🌅' : '🌙'}</span></div>`)
    .join('');
  return { title: 'العناية اليومية', node };
}

// ---------- Yearly stats provider ----------

async function dailyCareYearlyProvider(year) {
  const prefix = String(year);
  const logs = (await db.dailyCareLogs.toArray()).filter(l => l.date.startsWith(prefix));
  if (logs.length === 0) return null;
  const routines = [...(await getCareRoutines('morning')), ...(await getCareRoutines('evening'))];
  const routineMap = new Map(routines.map(r => [r.id, r]));
  const byRoutine = {};
  logs.forEach(l => { byRoutine[l.routineId] = (byRoutine[l.routineId] || 0) + 1; });
  const rows = Object.entries(byRoutine)
    .filter(([id]) => routineMap.has(Number(id)))
    .map(([id, count]) => {
      const r = routineMap.get(Number(id));
      return `<div class="yearly-row"><span>${r.kind === 'morning' ? '🌅' : '🌙'} ${escapeHtml(r.title)}</span><span>${count} يوم</span></div>`;
    }).join('');
  return { title: 'العناية اليومية', html: rows, count: logs.length };
}
