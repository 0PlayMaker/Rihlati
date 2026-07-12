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
async function setDiaryEntry(date, { title, text, emoji, photoBlob, removePhoto, photoDisplayMode }) {
  const existing = await getDiaryEntry(date);
  let id;
  const fields = { title: title || '', text, emoji: emoji || '', photoDisplayMode: photoDisplayMode || 'thumb_and_detail' };
  if (existing) { await db.diaryEntries.update(existing.id, fields); id = existing.id; }
  else { id = await db.diaryEntries.add({ date, ...fields, createdAt: Date.now() }); }
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

async function getDiaryStats() {
  const entries = await getAllDiaryEntries(); // newest first
  const dates = entries.map(e => e.date).sort(); // oldest -> newest
  const total = dates.length;
  const streak = await getDiaryStreak();

  let longest = 0, run = 0, prev = null;
  for (const d of dates) {
    if (prev && daysBetween(prev, d) === 1) run += 1;
    else run = 1;
    if (run > longest) longest = run;
    prev = d;
  }
  const last = dates.length ? dates[dates.length - 1] : null;
  const daysSince = last ? daysBetween(last, todayStr()) : null;
  const wroteToday = last === todayStr();
  return { total, streak, longest, last, daysSince, wroteToday };
}

// Rotates by date so the same line doesn't greet her every single visit.
function pickByDay(options) {
  const seed = Number(todayStr().replace(/-/g, ''));
  return options[seed % options.length];
}

function diaryMessage(stats) {
  if (stats.total === 0) {
    return { title: 'اكتبي يوميتك الأولى', body: 'صفحة بيضاء تنتظرك — لا يوجد "صح" و"خطأ" هنا.', tone: 'neutral' };
  }
  if (stats.wroteToday) {
    return {
      title: pickByDay(['كتبتِ اليوم ✨', 'يوميّة اليوم محفوظة', 'أحسنتِ — دوّنتِ يومك']),
      body: stats.streak > 1 ? `${toArabicNumeral(stats.streak)} أيام متتالية. استمرّي.` : 'بداية جميلة.',
      tone: 'success'
    };
  }
  // Wrote yesterday: the streak is alive but today is still empty.
  if (stats.daysSince === 1) {
    return {
      title: 'سلسلتك على المحكّ 🔥',
      body: stats.streak > 0
        ? `${toArabicNumeral(stats.streak)} ${stats.streak === 1 ? 'يوم' : 'أيام'} متتالية — لا تكسريها اليوم.`
        : 'اكتبي اليوم لتبدأ سلسلتك.',
      tone: 'warning'
    };
  }
  // Gone quiet for a while — this is where the streak actually broke.
  if (stats.daysSince >= 2) {
    const gone = toArabicNumeral(stats.daysSince);
    return {
      title: pickByDay([
        'وينك غايبة عني يا حلوة؟ مابدك تكتبي؟',
        `مرّت ${gone} أيام… اشتقنا لخطّك`,
        'الصفحة لسّه فاضية — تعالي'
      ]),
      body: stats.longest > 0
        ? `أطول سلسلة لكِ كانت ${toArabicNumeral(stats.longest)} ${stats.longest === 1 ? 'يوم' : 'أيام'}. تتحدّينها؟`
        : 'ابدئي من جديد اليوم.',
      tone: 'challenge'
    };
  }
  return { title: 'يومياتك', body: '', tone: 'neutral' };
}

async function renderDiaryStreakCard(container, onWrite) {
  const stats = await getDiaryStats();
  const msg = diaryMessage(stats);

  container.innerHTML = `
    <div class="diary-hero diary-hero-${msg.tone}">
      <div class="diary-hero-text">
        <p class="diary-hero-title">${msg.title}</p>
        ${msg.body ? `<p class="diary-hero-body">${msg.body}</p>` : ''}
      </div>
      ${stats.streak > 0 ? `<div class="diary-hero-streak"><span class="diary-hero-flame">🔥</span><span class="diary-hero-num">${toArabicNumeral(stats.streak)}</span></div>` : ''}
    </div>
    ${stats.total > 0 ? `
      <div class="diary-stat-row">
        <div class="diary-stat"><span class="diary-stat-num">${toArabicNumeral(stats.total)}</span><span class="diary-stat-label">يوميّة</span></div>
        <div class="diary-stat"><span class="diary-stat-num">${toArabicNumeral(stats.longest)}</span><span class="diary-stat-label">أطول سلسلة</span></div>
        <div class="diary-stat"><span class="diary-stat-num">${stats.daysSince === 0 ? '٠' : toArabicNumeral(stats.daysSince)}</span><span class="diary-stat-label">يوم منذ آخر يوميّة</span></div>
      </div>` : ''}
    ${!stats.wroteToday ? `<button class="btn btn-primary btn-block" id="diary-hero-write">✍️ اكتبي الآن</button>` : ''}
  `;
  const writeBtn = document.getElementById('diary-hero-write');
  if (writeBtn && onWrite) writeBtn.addEventListener('click', onWrite);
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
      <label class="field-label">عنوان (اختياري)</label>
      <input class="text-input" id="diary-title-input" placeholder="مثلاً: يوم جميل" value="${escapeHtml(existing?.title || '')}">
      <label class="field-label">رمز مصغّر (اختياري)</label>
      <input class="text-input emoji-input" id="diary-emoji-input" placeholder="📔" maxlength="2" value="${existing?.emoji || ''}">
      <textarea class="mood-note-input diary-textarea" id="diary-text-input" placeholder="اكتبي يوميتك هنا...">${escapeHtml(existing?.text || '')}</textarea>
      <label class="field-label">صورة (اختياري)</label>
      <div class="food-photo-picker" id="diary-photo-preview"></div>
      ${photoPickerHtml('diary-photo')}
      <div class="habit-type-chips" id="diary-photo-mode-chips">
        <button class="chip" data-mode="thumb_only">مصغرة فقط في القائمة</button>
        <button class="chip active" data-mode="thumb_and_detail">مصغرة + داخل اليومية</button>
      </div>
      <div class="modal-actions">
        ${existing ? `<button class="btn btn-danger btn-sm" id="diary-delete-btn">حذف</button>` : ''}
        <button class="btn btn-text" id="diary-cancel-btn">إلغاء</button>
        <button class="btn btn-primary" id="diary-save-btn">حفظ</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  overlay.querySelectorAll('#diary-photo-mode-chips .chip').forEach(chip => {
    chip.addEventListener('click', () => {
      overlay.querySelectorAll('#diary-photo-mode-chips .chip').forEach(c => c.classList.toggle('active', c === chip));
    });
  });
  if (existing) {
    const mode = existing.photoDisplayMode || 'thumb_and_detail';
    overlay.querySelectorAll('#diary-photo-mode-chips .chip').forEach(c => c.classList.toggle('active', c.dataset.mode === mode));
  }

  function renderPhotoArea() {
    const el = document.getElementById('diary-photo-preview');
    if (pendingPhotoBlob) el.innerHTML = `<img src="${trackDiaryPhotoUrl(pendingPhotoBlob)}" alt="">`;
    else if (existingPhotoUrl && !removePhotoFlag) el.innerHTML = `<img src="${existingPhotoUrl}" alt="">`;
    else el.innerHTML = '<span class="food-photo-placeholder">📷</span>';
  }
  renderPhotoArea();

  wirePhotoPicker('diary-photo', async (file) => {
    pendingPhotoBlob = await resizeImageToBlob(file, 1200, 0.8);
    removePhotoFlag = false;
    renderPhotoArea();
  }, () => {
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
    const title = document.getElementById('diary-title-input').value.trim();
    const emoji = document.getElementById('diary-emoji-input').value.trim();
    const photoDisplayMode = overlay.querySelector('#diary-photo-mode-chips .chip.active')?.dataset.mode || 'thumb_and_detail';
    await setDiaryEntry(date, { title, text, emoji, photoBlob: pendingPhotoBlob, removePhoto: removePhotoFlag, photoDisplayMode });
    overlay.remove();
    if (onSaved) onSaved();
  });
}

// ---------- full Diary page ----------

async function renderDiaryPage(params, view) {
  view.innerHTML = `
    <div class="page-header">
      <button class="icon-btn" aria-label="رجوع" id="diary-back">→</button>
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
    const today = todayStr();
    await renderDiaryStreakCard(
      document.getElementById('diary-streak-card'),
      () => openDiaryModal({ date: today, onSaved: refresh })
    );

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
        const text = e.text || ''; // photo-only entries have no text
        const isLong = text.length > 140;
        const showFullPhoto = photoUrl && (e.photoDisplayMode || 'thumb_and_detail') === 'thumb_and_detail';
        const wordCount = text.trim() ? text.trim().split(/\s+/).length : 0;
        // The mood she logged that same day — context the entry itself
        // doesn't carry, and it costs nothing to surface.
        const moodLog = await getMoodLog(e.date);
        const dayMood = moodLog ? moodLog.emoji : null;
        return `
          <div class="card diary-entry-card" data-date="${e.date}">
            <div class="diary-entry-top">
              ${e.emoji ? `<span class="food-thumb food-thumb-placeholder diary-entry-thumb">${e.emoji}</span>` : (photoUrl ? `<img class="food-thumb diary-entry-thumb" src="${photoUrl}" alt="">` : '')}
              <div class="diary-entry-top-text">
                ${e.title ? `<span class="diary-entry-title">${escapeHtml(e.title)}</span>` : ''}
                <span class="diary-entry-date">${formatDateArabic(e.date, { weekday: true })}</span>
              </div>
              ${kebabMenuHtml(e.date, [
                { key: 'edit', label: 'تعديل' },
                { key: 'delete', label: 'حذف', danger: true }
              ])}
            </div>
            ${showFullPhoto ? `<img class="diary-entry-photo" src="${photoUrl}" alt="">` : ''}
            ${e.text ? `<p class="diary-entry-text ${isLong ? 'diary-entry-text-clamped' : ''}">${escapeHtml(e.text)}</p>` : ''}
            ${isLong ? `<button class="link-btn diary-expand-btn" data-expand="${e.date}">عرض المزيد ↓</button>` : ''}
            ${(wordCount > 0 || dayMood) ? `
              <div class="diary-entry-meta-row">
                ${dayMood ? `<span class="diary-entry-meta">${dayMood}</span>` : ''}
                ${wordCount > 0 ? `<span class="diary-entry-meta">${toArabicNumeral(wordCount)} ${wordCount === 1 ? 'كلمة' : 'كلمة'}</span>` : ''}
                ${photoUrl ? `<span class="diary-entry-meta">📷</span>` : ''}
              </div>` : ''}
          </div>`;
      }));
      return `
        <details class="diary-month" ${idx === 0 ? 'open' : ''}>
          <summary>${ARABIC_MONTHS[m - 1]} ${y} (${monthEntries.length})</summary>
          <div class="diary-month-body">${entryRows.join('')}</div>
        </details>`;
    }));

    monthsEl.innerHTML = rowsHtml.join('');
    monthsEl.querySelectorAll('.diary-expand-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const card = btn.closest('.diary-entry-card');
        const textEl = card.querySelector('.diary-entry-text');
        const expanding = textEl.classList.contains('diary-entry-text-clamped');
        textEl.classList.toggle('diary-entry-text-clamped', !expanding);
        btn.textContent = expanding ? 'عرض أقل ↑' : 'عرض المزيد ↓';
      });
    });
    wireKebabMenus(monthsEl, async (rowId, action) => {
      if (action === 'edit') {
        openDiaryModal({ date: rowId, onSaved: refresh });
      } else if (action === 'delete') {
        if (!confirm('حذف يومية هذا اليوم؟')) return;
        await deleteDiaryEntry(rowId);
        await refresh();
      }
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
