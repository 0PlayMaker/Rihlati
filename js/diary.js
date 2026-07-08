// diary.js — Phase 6.
// One entry per day (like mood/weight) so a streak is meaningful — she
// can always edit today's entry to add more later rather than needing
// multiple entries per day. Photo is optional, same 1:1-table pattern
// as food photos. Month grouping uses native <details>/<summary> —
// free collapse behavior, no JS state to manage.

async function getAllDiaryEntries() {
  const all = await db.diaryEntries.toArray();
  return all.sort((a, b) => b.date.localeCompare(a.date)); // newest first
}
async function getDiaryEntry(date) {
  return db.diaryEntries.where('date').equals(date).first();
}
async function getDiaryStreak() {
  const all = await db.diaryEntries.toArray();
  return computeCurrentStreak(all.map(e => e.date), []);
}
async function getDiaryPhoto(entryId) {
  return db.diaryPhotos.get(entryId);
}
async function setDiaryEntry(date, text, photoBlob, removePhoto) {
  const existing = await getDiaryEntry(date);
  let id;
  if (existing) { await db.diaryEntries.update(existing.id, { text }); id = existing.id; }
  else { id = await db.diaryEntries.add({ date, text, createdAt: Date.now() }); }
  if (photoBlob) await db.diaryPhotos.put({ entryId: id, photoBlob });
  else if (removePhoto) await db.diaryPhotos.delete(id);
  return id;
}
async function deleteDiaryEntry(date) {
  const existing = await getDiaryEntry(date);
  if (!existing) return;
  await db.diaryEntries.delete(existing.id);
  await db.diaryPhotos.delete(existing.id);
}

function diaryGlanceText(streak) {
  return streak > 0 ? `🔥 ${streak} يوم متتالي` : 'اكتبي يوميتك الأولى';
}

// ---------- object URL bookkeeping (a list can show several photos) ----------

let _diaryPhotoUrls = [];
function trackDiaryPhotoUrl(blob) {
  const url = URL.createObjectURL(blob);
  _diaryPhotoUrls.push(url);
  return url;
}
function revokeDiaryPhotoUrls() {
  _diaryPhotoUrls.forEach(u => URL.revokeObjectURL(u));
  _diaryPhotoUrls = [];
}

// ---------- create/edit modal ----------

async function openDiaryModal({ date, onSaved }) {
  const existing = await getDiaryEntry(date);
  let existingPhotoUrl = null;
  if (existing) {
    const photoRow = await getDiaryPhoto(existing.id);
    if (photoRow) existingPhotoUrl = trackDiaryPhotoUrl(photoRow.photoBlob);
  }
  let pendingPhotoBlob = null;
  let removePhotoFlag = false;

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal modal-lg">
      <h2 class="modal-title">${formatDateArabic(date, { weekday: false })}</h2>
      <textarea class="mood-note-input diary-textarea" id="diary-text-input" placeholder="اكتبي يوميتك هنا...">${escapeHtml(existing?.text || '')}</textarea>
      <label class="field-label">صورة (اختياري)</label>
      <div class="food-photo-picker" id="diary-photo-preview"></div>
      <input type="file" accept="image/*" id="diary-photo-input" class="hidden-file-input">
      <div class="food-photo-actions">
        <button class="btn btn-secondary btn-sm" id="diary-photo-choose">إضافة صورة</button>
        <button class="btn btn-text btn-sm" id="diary-photo-remove">إزالة الصورة</button>
      </div>
      <div class="modal-actions">
        ${existing ? `<button class="btn btn-danger btn-sm" id="diary-delete-btn">حذف</button>` : ''}
        <button class="btn btn-text" id="diary-cancel-btn">إلغاء</button>
        <button class="btn btn-primary" id="diary-save-btn">حفظ</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  function renderPhotoArea() {
    const el = document.getElementById('diary-photo-preview');
    if (pendingPhotoBlob) el.innerHTML = `<img src="${trackDiaryPhotoUrl(pendingPhotoBlob)}" alt="">`;
    else if (existingPhotoUrl && !removePhotoFlag) el.innerHTML = `<img src="${existingPhotoUrl}" alt="">`;
    else el.innerHTML = '<span class="food-photo-placeholder">📷</span>';
  }
  renderPhotoArea();

  document.getElementById('diary-photo-choose').addEventListener('click', () => document.getElementById('diary-photo-input').click());
  document.getElementById('diary-photo-input').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    pendingPhotoBlob = await resizeImageToBlob(file, 1200, 0.8);
    removePhotoFlag = false;
    renderPhotoArea();
  });
  document.getElementById('diary-photo-remove').addEventListener('click', () => {
    pendingPhotoBlob = null;
    removePhotoFlag = true;
    renderPhotoArea();
  });

  document.getElementById('diary-cancel-btn').addEventListener('click', () => overlay.remove());
  const deleteBtn = document.getElementById('diary-delete-btn');
  if (deleteBtn) deleteBtn.addEventListener('click', async () => {
    if (!confirm('حذف يومية هذا اليوم؟')) return;
    await deleteDiaryEntry(date);
    overlay.remove();
    if (onSaved) onSaved();
  });
  document.getElementById('diary-save-btn').addEventListener('click', async () => {
    const text = document.getElementById('diary-text-input').value.trim();
    if (!text && !pendingPhotoBlob && !existingPhotoUrl) { alert('اكتبي شيئاً أو أضيفي صورة'); return; }
    await setDiaryEntry(date, text, pendingPhotoBlob, removePhotoFlag);
    overlay.remove();
    if (onSaved) onSaved();
  });
}

// ---------- full Diary page ----------

async function renderDiaryPage(params, view) {
  view.innerHTML = `
    <div class="page-header">
      <button class="icon-btn" id="diary-back">→</button>
      <h1>يومياتي</h1>
    </div>
    <div class="card" id="diary-streak-card"></div>
    <div class="card">
      <button class="btn btn-primary btn-block" id="diary-add-btn"></button>
    </div>
    <div id="diary-months"></div>
  `;
  document.getElementById('diary-back').addEventListener('click', () => history.back());

  async function refresh() {
    revokeDiaryPhotoUrls();
    const streak = await getDiaryStreak();
    document.getElementById('diary-streak-card').innerHTML = `
      <p class="ring-label">يومياتك</p>
      <p class="period-status-text">${diaryGlanceText(streak)}</p>
    `;

    const today = todayStr();
    const todayEntry = await getDiaryEntry(today);
    const addBtn = document.getElementById('diary-add-btn');
    addBtn.textContent = todayEntry ? '✏️ تعديل يومية اليوم' : '+ إضافة يومية اليوم';
    addBtn.onclick = () => openDiaryModal({ date: today, onSaved: refresh });

    const entries = await getAllDiaryEntries();
    const monthsEl = document.getElementById('diary-months');
    if (entries.length === 0) {
      monthsEl.innerHTML = `<div class="card"><div class="empty-state"><p>ما في يوميات مسجلة بعد.</p></div></div>`;
      return;
    }

    const months = {};
    entries.forEach(e => {
      const key = e.date.slice(0, 7);
      if (!months[key]) months[key] = [];
      months[key].push(e);
    });

    const rowsHtml = await Promise.all(Object.entries(months).map(async ([monthKey, monthEntries], idx) => {
      const [y, m] = monthKey.split('-').map(Number);
      const entryRows = await Promise.all(monthEntries.map(async e => {
        const photoRow = await getDiaryPhoto(e.id);
        const photoUrl = photoRow ? trackDiaryPhotoUrl(photoRow.photoBlob) : null;
        return `
          <div class="diary-entry" data-date="${e.date}">
            <div class="diary-entry-top">
              <span class="diary-entry-date">${formatDateArabic(e.date, { weekday: true })}</span>
              <button class="icon-btn" data-diary-edit="${e.date}">✏️</button>
            </div>
            ${photoUrl ? `<img class="diary-entry-photo" src="${photoUrl}" alt="">` : ''}
            <p class="diary-entry-text">${escapeHtml(e.text)}</p>
          </div>`;
      }));
      return `
        <details class="diary-month" ${idx === 0 ? 'open' : ''}>
          <summary>${ARABIC_MONTHS[m - 1]} ${y} (${monthEntries.length})</summary>
          <div class="card diary-month-body">${entryRows.join('')}</div>
        </details>`;
    }));

    monthsEl.innerHTML = rowsHtml.join('');
    monthsEl.querySelectorAll('[data-diary-edit]').forEach(btn => {
      btn.addEventListener('click', () => openDiaryModal({ date: btn.dataset.diaryEdit, onSaved: refresh }));
    });
  }

  await refresh();
}

// ---------- Day Detail provider ----------

async function diaryDayProvider(dateStr) {
  const editable = !isFutureDate(dateStr);
  const entry = await getDiaryEntry(dateStr);
  if (!entry && !editable) return null;

  const node = document.createElement('div');
  async function render() {
    revokeDiaryPhotoUrls();
    const current = await getDiaryEntry(dateStr);
    let photoHtml = '';
    if (current) {
      const photoRow = await getDiaryPhoto(current.id);
      if (photoRow) photoHtml = `<img class="diary-entry-photo" src="${trackDiaryPhotoUrl(photoRow.photoBlob)}" alt="">`;
    }
    node.innerHTML = `
      ${current ? `${photoHtml}<p class="diary-entry-text">${escapeHtml(current.text)}</p>` : `<p class="empty-state-sub">ما في يومية مسجلة بهذا اليوم.</p>`}
      ${editable ? `<button class="btn btn-secondary btn-block" id="day-diary-btn">${current ? 'تعديل' : '+ إضافة يومية'}</button>` : ''}
    `;
    const btn = node.querySelector('#day-diary-btn');
    if (btn) btn.addEventListener('click', () => openDiaryModal({ date: dateStr, onSaved: render }));
  }
  await render();
  return { title: 'يومياتي', node };
}

// ---------- Yearly stats provider ----------

async function diaryYearlyProvider(year) {
  const prefix = String(year);
  const all = await db.diaryEntries.toArray();
  const yearEntries = all.filter(e => e.date.startsWith(prefix));
  if (yearEntries.length === 0) return null;
  const html = `<div class="yearly-row"><span>عدد اليوميات المكتوبة</span><span>${yearEntries.length}</span></div>`;
  return { title: 'يومياتي', html, count: yearEntries.length };
}
