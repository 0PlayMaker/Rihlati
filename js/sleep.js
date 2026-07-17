// sleep.js — Phase 14 (النوم).
// 'date' on a sleep log is the night it STARTED — matches how a person
// naturally thinks about "how did I sleep last night."
//
// Time entry: a single base date + two time-of-day values (sleep, wake)
// rather than two separate date+time pickers — simpler to fill in, and
// whether wake time rolled over to the next calendar day is inferred
// (if wake-time-of-day <= sleep-time-of-day, it rolled over — the
// normal overnight case, e.g. slept 23:30, woke 07:00). To remove any
// ambiguity about which 12-hour period a time means (her specific
// concern), every entered time is echoed back immediately in clear
// Arabic 12-hour form with an explicit صباحاً/مساءً — the raw
// <input type="time"> value alone doesn't reliably make that obvious.

function formatTimeArabic12h(timeStr) {
  if (!timeStr) return '';
  const [h, m] = timeStr.split(':').map(Number);
  const period = h >= 12 ? 'مساءً' : 'صباحاً';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${toArabicNumeral(h12)}:${toArabicNumeral(String(m).padStart(2, '0'))} ${period}`;
}

function formatSleepDuration(minutes) {
  if (minutes == null) return '';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} دقيقة`;
  if (m === 0) return `${h} ${h === 1 ? 'ساعة' : 'ساعات'}`;
  return `${h} ${h === 1 ? 'ساعة' : 'ساعات'} و${m} دقيقة`;
}

// Positive if wake is later THAT day; if wake-time-of-day is earlier
// than or equal to sleep-time-of-day, assumes it rolled to the next
// calendar day (the standard overnight case).
function computeSleepDurationMinutes(baseDate, sleepTime, wakeTime) {
  const sleepDt = new Date(`${baseDate}T${sleepTime}:00`);
  let wakeDt = new Date(`${baseDate}T${wakeTime}:00`);
  if (wakeTime <= sleepTime) wakeDt = new Date(wakeDt.getTime() + 24 * 60 * 60 * 1000);
  return Math.round((wakeDt - sleepDt) / 60000);
}

// ===================== CRUD =====================


async function addSleepLog({ date, sleepTime, wakeTime, isNap, dreamText, photoBlob }) {
  const durationMinutes = computeSleepDurationMinutes(date, sleepTime, wakeTime);
  const id = await db.sleepLogs.add({
    date, sleepTime, wakeTime, durationMinutes, isNap: !!isNap,
    dreamText: dreamText || '', createdAt: Date.now()
  });
  if (photoBlob) await db.sleepDreamPhotos.put({ sleepLogId: id, photoBlob });
  return id;
}
async function updateSleepLog(id, { date, sleepTime, wakeTime, isNap, dreamText, photoBlob, removePhoto }) {
  const durationMinutes = computeSleepDurationMinutes(date, sleepTime, wakeTime);
  await db.sleepLogs.update(id, { date, sleepTime, wakeTime, durationMinutes, isNap: !!isNap, dreamText: dreamText || '' });
  if (photoBlob) await db.sleepDreamPhotos.put({ sleepLogId: id, photoBlob });
  else if (removePhoto) await db.sleepDreamPhotos.delete(id);
}
async function deleteSleepLog(id) {
  await db.sleepLogs.delete(id);
  await db.sleepDreamPhotos.delete(id);
}
async function getAllSleepLogs() {
  const all = await db.sleepLogs.toArray();
  return all.sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt);
}
async function getSleepLogsForDate(dateStr) {
  return (await db.sleepLogs.toArray()).filter(l => l.date === dateStr);
}

// Descriptive, not prescriptive — compares her own recent nights to her
// own recent average rather than asserting any general medical claim.
async function getSleepSuggestion() {
  const mainSleep = (await getAllSleepLogs()).filter(l => !l.isNap);
  if (mainSleep.length < 3) return null;
  const recent = mainSleep.slice(0, 7);
  const avgMinutes = recent.reduce((s, l) => s + l.durationMinutes, 0) / recent.length;
  const lastMinutes = recent[0].durationMinutes;
  const diff = lastMinutes - avgMinutes;
  if (Math.abs(diff) < 30) return `نومك منتظم هالفترة 🌙 — قريب من متوسطك (${formatSleepDuration(Math.round(avgMinutes))})`;
  if (diff < 0) return `نمتِ ${formatSleepDuration(lastMinutes)} آخر مرة — أقل من متوسطك الأخير (${formatSleepDuration(Math.round(avgMinutes))})`;
  return `نمتِ ${formatSleepDuration(lastMinutes)} آخر مرة — أكثر من متوسطك الأخير (${formatSleepDuration(Math.round(avgMinutes))})`;
}

// ===================== Modal =====================

function openSleepModal({ existingId, onSaved } = {}) {
  let pendingPhotoBlob = null;
  let existingPhotoUrl = null;
  let removePhotoFlag = false;
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal modal-lg">
      <h2 class="modal-title" id="sleep-modal-title">تسجيل نوم</h2>
      <label class="field-label">النوع</label>
      <div class="habit-type-chips" id="sleep-type-chips">
        <button class="chip active" data-nap="0">🌙 نوم ليلة</button>
        <button class="chip" data-nap="1">💤 قيلولة</button>
      </div>
      <label class="field-label">التاريخ (ليلة النوم)</label>
      <input class="text-input" type="date" id="sleep-date-input" value="${todayStr()}">
      <label class="field-label">وقت النوم والاستيقاظ</label>
      <div class="timer-duration-row">
        <input class="text-input" type="time" id="sleep-sleeptime-input" value="23:00">
        <span>←</span>
        <input class="text-input" type="time" id="sleep-waketime-input" value="07:00">
      </div>
      <p class="settings-note" id="sleep-sleeptime-label"></p>
      <p class="settings-note" id="sleep-waketime-label"></p>
      <p class="mini-progress-text" id="sleep-duration-preview"></p>
      <label class="field-label">ماذا حلمتِ؟ (اختياري)</label>
      <textarea class="mood-note-input" id="sleep-dream-input"></textarea>
      <label class="field-label">صورة الحلم (اختياري)</label>
      <div class="food-photo-picker" id="sleep-photo-preview"></div>
      ${photoPickerHtml('sleep-photo')}
      <div class="modal-actions">
        ${existingId ? `<button class="btn btn-danger btn-sm" id="sleep-delete-btn">حذف</button>` : ''}
        <button class="btn btn-text" id="sleep-cancel-btn">إلغاء</button>
        <button class="btn btn-primary" id="sleep-save-btn">حفظ</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  const dateInput = document.getElementById('sleep-date-input');
  const sleepTimeInput = document.getElementById('sleep-sleeptime-input');
  const wakeTimeInput = document.getElementById('sleep-waketime-input');

  function refreshPreview() {
    document.getElementById('sleep-sleeptime-label').textContent = 'الساعة المختارة: ' + formatTimeArabic12h(sleepTimeInput.value);
    document.getElementById('sleep-waketime-label').textContent = 'الساعة المختارة: ' + formatTimeArabic12h(wakeTimeInput.value);
    if (sleepTimeInput.value && wakeTimeInput.value && dateInput.value) {
      const mins = computeSleepDurationMinutes(dateInput.value, sleepTimeInput.value, wakeTimeInput.value);
      document.getElementById('sleep-duration-preview').textContent = '⏱️ المجموع: ' + formatSleepDuration(mins);
    }
  }
  [sleepTimeInput, wakeTimeInput, dateInput].forEach(el => el.addEventListener('input', refreshPreview));
  refreshPreview();

  overlay.querySelectorAll('#sleep-type-chips .chip').forEach(chip => {
    chip.addEventListener('click', () => {
      overlay.querySelectorAll('#sleep-type-chips .chip').forEach(c => c.classList.toggle('active', c === chip));
    });
  });

  // Only the transient preview URL is recycled; existingPhotoUrl is cached
  // and re-rendered later, so revoking it would break the image.
  let pendingPreviewUrl = null;
  function renderPhotoArea() {
    const el = document.getElementById('sleep-photo-preview');
    if (pendingPreviewUrl) { URL.revokeObjectURL(pendingPreviewUrl); pendingPreviewUrl = null; }
    if (pendingPhotoBlob) {
      pendingPreviewUrl = URL.createObjectURL(pendingPhotoBlob);
      el.innerHTML = `<img src="${pendingPreviewUrl}" alt="">`;
    }
    else if (existingPhotoUrl && !removePhotoFlag) el.innerHTML = `<img src="${existingPhotoUrl}" alt="">`;
    else el.innerHTML = '<span class="food-photo-placeholder">📷</span>';
  }
  renderPhotoArea();
  wirePhotoPicker('sleep-photo', async (file) => {
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
    const existing = await db.sleepLogs.get(existingId);
    if (!existing) return;
    document.getElementById('sleep-modal-title').textContent = 'تعديل تسجيل النوم';
    overlay.querySelectorAll('#sleep-type-chips .chip').forEach(c => c.classList.toggle('active', (c.dataset.nap === '1') === existing.isNap));
    dateInput.value = existing.date;
    sleepTimeInput.value = existing.sleepTime;
    wakeTimeInput.value = existing.wakeTime;
    document.getElementById('sleep-dream-input').value = existing.dreamText || '';
    refreshPreview();
    const photoRow = await db.sleepDreamPhotos.get(existingId);
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
  document.getElementById('sleep-cancel-btn').addEventListener('click', closeModal);
  const deleteBtn = document.getElementById('sleep-delete-btn');
  if (deleteBtn) deleteBtn.addEventListener('click', async () => {
    if (!confirm('حذف هذا التسجيل؟')) return;
    await deleteSleepLog(existingId);
    closeModal();
    if (onSaved) onSaved();
  });
  document.getElementById('sleep-save-btn').addEventListener('click', async () => {
    const date = dateInput.value;
    const sleepTime = sleepTimeInput.value;
    const wakeTime = wakeTimeInput.value;
    if (!date || !sleepTime || !wakeTime) return;
    const isNap = overlay.querySelector('#sleep-type-chips .chip.active')?.dataset.nap === '1';
    const dreamText = document.getElementById('sleep-dream-input').value.trim();
    if (existingId) await updateSleepLog(existingId, { date, sleepTime, wakeTime, isNap, dreamText, photoBlob: pendingPhotoBlob, removePhoto: removePhotoFlag });
    else await addSleepLog({ date, sleepTime, wakeTime, isNap, dreamText, photoBlob: pendingPhotoBlob });
    closeModal();
    if (onSaved) onSaved();
  });
}

// ===================== Pages =====================

function sleepRowHtml(log) {
  return `
    <div class="task-row-wrap" data-sleep-id="${log.id}">
      <div class="food-row-info">
        <span class="food-row-title">${log.isNap ? '💤 قيلولة' : '🌙 نوم'} — ${formatSleepDuration(log.durationMinutes)}</span>
        <span class="food-row-notes">${formatDateArabic(log.date, { weekday: false })} · ${formatTimeArabic12h(log.sleepTime)} ← ${formatTimeArabic12h(log.wakeTime)}${log.dreamText ? ' · 💭 حلم مسجّل' : ''}</span>
      </div>
      ${kebabMenuHtml(String(log.id), [
        { key: 'edit', label: 'تعديل' },
        { key: 'delete', label: 'حذف', danger: true }
      ])}
    </div>`;
}

async function renderSleepPage(params, view) {
  view.innerHTML = `
    <div class="page-header">
      <button class="icon-btn" aria-label="رجوع" id="sleep-back">→</button>
      <h1>النوم</h1>
    </div>
    <div class="card">
      <button class="btn btn-primary btn-block" id="sleep-add-btn">+ تسجيل نوم</button>
    </div>
    <div class="card" id="sleep-suggestion-card" style="display:none"></div>
    <div class="card">
      <h2 class="card-title">السجل</h2>
      <div id="sleep-history-list"></div>
    </div>
  `;
  document.getElementById('sleep-back').addEventListener('click', () => history.back());

  async function refresh() {
    const suggestion = await getSleepSuggestion();
    const suggestionCard = document.getElementById('sleep-suggestion-card');
    if (suggestion) {
      suggestionCard.style.display = '';
      suggestionCard.innerHTML = `<p class="mini-progress-text">💡 ${suggestion}</p>`;
    } else {
      suggestionCard.style.display = 'none';
    }

    const logs = await getAllSleepLogs();
    const listEl = document.getElementById('sleep-history-list');
    if (logs.length === 0) {
      listEl.innerHTML = `<div class="empty-state"><p>ما في تسجيلات نوم بعد.</p></div>`;
      return;
    }
    listEl.innerHTML = logs.map(sleepRowHtml).join('');
    wireKebabMenus(listEl, async (rowId, action) => {
      const id = Number(rowId);
      if (action === 'edit') {
        openSleepModal({ existingId: id, onSaved: refresh });
      } else if (action === 'delete') {
        if (!confirm('حذف هذا التسجيل؟')) return;
        await deleteSleepLog(id);
        await refresh();
      }
    });
  }
  await refresh();
  document.getElementById('sleep-add-btn').addEventListener('click', () => openSleepModal({ onSaved: refresh }));
}

async function renderSleepSummaryCard(container) {
  const logs = await getAllSleepLogs();
  const mainSleep = logs.filter(l => !l.isNap);
  if (logs.length === 0) {
    container.innerHTML = `
      <div class="section-header">
        <h2 class="card-title">😴 النوم</h2>
        <a class="see-all-link" href="#/sleep">فتح ←</a>
      </div>
      <p class="mini-progress-text">سجّلي أول نومة لتبدأ التتبّع</p>`;
    return;
  }
  const last = mainSleep[0];
  container.innerHTML = `
    <div class="section-header">
      <h2 class="card-title">😴 النوم</h2>
      <a class="see-all-link" href="#/sleep">فتح ←</a>
    </div>
    <p class="mini-progress-text">${last ? `آخر نومة: ${formatSleepDuration(last.durationMinutes)}` : 'سجّلي أول نومة لتبدأ التتبّع'}</p>`;
}

// ---------- Day Detail provider ----------

async function sleepDayProvider(dateStr) {
  const logs = await getSleepLogsForDate(dateStr);
  if (logs.length === 0) return null;
  const node = document.createElement('div');
  logs.forEach(log => {
    const row = document.createElement('div');
    row.className = 'yearly-row';
    row.innerHTML = `<span>${log.isNap ? '💤 قيلولة' : '🌙 نوم'}</span><span>${formatSleepDuration(log.durationMinutes)}</span>`;
    node.appendChild(row);
    if (log.dreamText) {
      const dreamP = document.createElement('p');
      dreamP.className = 'period-day-note';
      dreamP.textContent = '💭 ' + log.dreamText;
      node.appendChild(dreamP);
    }
  });
  return { title: 'النوم', node };
}

// ---------- Yearly stats provider ----------

async function sleepYearlyProvider(year) {
  const prefix = String(year);
  const logs = (await db.sleepLogs.toArray()).filter(l => l.date.startsWith(prefix));
  if (logs.length === 0) return null;
  const mainSleep = logs.filter(l => !l.isNap);
  const naps = logs.filter(l => l.isNap);
  const dreams = logs.filter(l => l.dreamText);
  const avgMinutes = mainSleep.length ? Math.round(mainSleep.reduce((s, l) => s + l.durationMinutes, 0) / mainSleep.length) : 0;
  const html = `
    <div class="yearly-row"><span>ليالٍ مسجَّلة</span><span>${mainSleep.length}</span></div>
    <div class="yearly-row"><span>متوسط النوم</span><span>${avgMinutes ? formatSleepDuration(avgMinutes) : '—'}</span></div>
    <div class="yearly-row"><span>قيلولات</span><span>${naps.length}</span></div>
    <div class="yearly-row"><span>💭 أحلام مسجَّلة</span><span>${dreams.length}</span></div>
  `;
  return { title: 'النوم', html, count: logs.length };
}
