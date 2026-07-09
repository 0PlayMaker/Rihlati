// food.js — Phase 4.
// Photo is optional per entry (camera access can fail, or she's eating
// out and doesn't want to stop and photograph it) — not required just
// because "تصوير الطعام" was the first thing she listed.
// Calorie total is always derived from that day's entries, never stored
// as its own field — same "don't store what you can compute" rule as
// everywhere else.

async function addFoodLog({ date, mealType, time, notes, calories, photoBlob }) {
  const id = await db.foodLogs.add({
    date, mealType, time: time || null, notes: notes || '',
    calories: calories ?? null, createdAt: Date.now()
  });
  if (photoBlob) await db.foodPhotos.put({ foodLogId: id, photoBlob });
  return id;
}
async function updateFoodLog(id, { mealType, time, notes, calories, photoBlob, removePhoto }) {
  await db.foodLogs.update(id, { mealType, time: time || null, notes: notes || '', calories: calories ?? null });
  if (photoBlob) await db.foodPhotos.put({ foodLogId: id, photoBlob });
  else if (removePhoto) await db.foodPhotos.delete(id);
}
async function deleteFoodLog(id) {
  await db.foodLogs.delete(id);
  await db.foodPhotos.delete(id);
}
async function getFoodPhoto(foodLogId) {
  return db.foodPhotos.get(foodLogId);
}
async function getFoodLogsForDate(date) {
  const all = await db.foodLogs.toArray();
  return all.filter(f => f.date === date).sort((a, b) => (a.time || '99:99').localeCompare(b.time || '99:99'));
}
async function getFoodTotalCaloriesForDate(date) {
  const logs = await getFoodLogsForDate(date);
  const withCal = logs.filter(l => l.calories != null);
  if (withCal.length === 0) return null;
  return withCal.reduce((sum, l) => sum + l.calories, 0);
}
async function getFoodTodayStats() {
  const today = todayStr();
  const logs = await getFoodLogsForDate(today);
  const totalCal = await getFoodTotalCaloriesForDate(today);
  return { count: logs.length, totalCal };
}
function foodGlanceText(stats) {
  if (stats.count === 0) return 'لا وجبات بعد';
  return `${stats.count} ${stats.count === 1 ? 'وجبة' : 'وجبات'}${stats.totalCal != null ? ` · ${stats.totalCal} سعرة` : ''}`;
}

// ---------- water ----------
// Lives here, not a separate module — water is part of food/intake
// tracking, not its own top-level feature. Target is a plain adjustable
// number (default 2L), same "informational default, never a directive"
// treatment as BMI and target weight in body.js.

async function getWaterForDate(date) {
  const row = await db.waterLogs.where('date').equals(date).first();
  return row ? row.liters : 0;
}
async function addWater(date, deltaLiters) {
  const existing = await db.waterLogs.where('date').equals(date).first();
  const newTotal = Math.max(0, (existing ? existing.liters : 0) + deltaLiters);
  if (existing) await db.waterLogs.update(existing.id, { liters: newTotal });
  else await db.waterLogs.add({ date, liters: newTotal, createdAt: Date.now() });
}
async function setWaterExact(date, liters) {
  const existing = await db.waterLogs.where('date').equals(date).first();
  if (existing) await db.waterLogs.update(existing.id, { liters });
  else await db.waterLogs.add({ date, liters, createdAt: Date.now() });
}
async function getWaterTarget() {
  const settings = await db.settings.get(1);
  return settings?.dailyWaterTargetL ?? 2.0;
}

async function renderWaterCard(container) {
  const today = todayStr();
  const [liters, target] = await Promise.all([getWaterForDate(today), getWaterTarget()]);
  const frac = Math.min(1, liters / target);
  container.innerHTML = `
    <div class="section-header">
      <h2 class="card-title">💧 الماء</h2>
      <button class="btn btn-text btn-sm" id="water-edit-target">الهدف: ${target}ل</button>
    </div>
    <div class="mini-progress-track"><div class="mini-progress-fill water-fill" style="width:${frac * 100}%"></div></div>
    <p class="period-status-sub">${liters.toFixed(2)} من ${target} لتر</p>
    <div class="water-actions">
      <button class="btn btn-secondary btn-sm" id="water-add-cup">+ كوب (٠.٢٥ل)</button>
      <button class="btn btn-text btn-sm" id="water-edit-exact">تعديل يدوي</button>
    </div>
  `;
  document.getElementById('water-add-cup').addEventListener('click', async () => {
    await addWater(today, 0.25);
    renderWaterCard(container);
  });
  document.getElementById('water-edit-exact').addEventListener('click', async () => {
    const current = await getWaterForDate(today);
    const input = prompt('كمية الماء اليوم (لتر):', current.toFixed(2));
    if (input === null) return;
    const n = parseFloat(input);
    if (!Number.isNaN(n) && n >= 0) { await setWaterExact(today, n); renderWaterCard(container); }
  });
  document.getElementById('water-edit-target').addEventListener('click', async () => {
    const input = prompt('الهدف اليومي (لتر):', String(target));
    if (input === null) return;
    const n = parseFloat(input);
    if (!Number.isNaN(n) && n > 0) { await db.settings.update(1, { dailyWaterTargetL: n }); renderWaterCard(container); }
  });
}

// ---------- object URL bookkeeping ----------
// A food list can show several photos at once (unlike the single
// profile picture), so this tracks a batch and revokes all of them each
// time the list is about to be rebuilt.

let _foodPhotoUrls = [];
function trackFoodPhotoUrl(blob) {
  const url = URL.createObjectURL(blob);
  _foodPhotoUrls.push(url);
  return url;
}
function revokeFoodPhotoUrls() {
  _foodPhotoUrls.forEach(u => URL.revokeObjectURL(u));
  _foodPhotoUrls = [];
}

// ---------- create/edit modal ----------

async function openFoodModal({ date, existingId, onSaved }) {
  let existing = null;
  let existingPhotoUrl = null;
  if (existingId) {
    existing = await db.foodLogs.get(existingId);
    const photoRow = await getFoodPhoto(existingId);
    if (photoRow) existingPhotoUrl = trackFoodPhotoUrl(photoRow.photoBlob);
  }

  let pendingPhotoBlob = null;
  let removePhotoFlag = false;
  let selectedMealType = existing?.mealType || MEAL_TYPES[0].key;

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal modal-lg">
      <h2 class="modal-title">${existing ? 'تعديل الوجبة' : 'وجبة جديدة'}</h2>

      <label class="field-label">نوع الوجبة</label>
      <div class="meal-type-chips" id="meal-type-chips">
        ${MEAL_TYPES.map(m => `<button class="chip ${selectedMealType === m.key ? 'active' : ''}" data-meal="${m.key}">${m.icon} ${m.label}</button>`).join('')}
      </div>

      <label class="field-label">صورة (اختياري)</label>
      <div class="food-photo-picker" id="food-photo-preview"></div>
      ${photoPickerHtml('food-photo')}

      <label class="field-label">الوقت (اختياري)</label>
      <input class="text-input" type="time" id="food-time-input" value="${existing?.time || ''}">

      <label class="field-label">السعرات (اختياري)</label>
      <input class="text-input" type="number" min="0" id="food-calories-input" value="${existing?.calories ?? ''}" placeholder="مثلاً: 350">

      <label class="field-label">ملاحظات (اختياري)</label>
      <textarea class="mood-note-input" id="food-notes-input" placeholder="شعورك، تفاصيل الوجبة...">${escapeHtml(existing?.notes || '')}</textarea>

      <div class="modal-actions">
        ${existing ? `<button class="btn btn-danger btn-sm" id="food-delete-btn">حذف</button>` : ''}
        <button class="btn btn-text" id="food-cancel-btn">إلغاء</button>
        <button class="btn btn-primary" id="food-save-btn">حفظ</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  function renderPhotoArea() {
    const el = document.getElementById('food-photo-preview');
    if (pendingPhotoBlob) el.innerHTML = `<img src="${trackFoodPhotoUrl(pendingPhotoBlob)}" alt="">`;
    else if (existingPhotoUrl && !removePhotoFlag) el.innerHTML = `<img src="${existingPhotoUrl}" alt="">`;
    else el.innerHTML = '<span class="food-photo-placeholder">📷</span>';
  }
  renderPhotoArea();

  overlay.querySelectorAll('#meal-type-chips .chip').forEach(chip => {
    chip.addEventListener('click', () => {
      selectedMealType = chip.dataset.meal;
      overlay.querySelectorAll('#meal-type-chips .chip').forEach(c => c.classList.toggle('active', c.dataset.meal === selectedMealType));
    });
  });

  wirePhotoPicker('food-photo', async (file) => {
    pendingPhotoBlob = await resizeImageToBlob(file, 1200, 0.8);
    removePhotoFlag = false;
    renderPhotoArea();
  }, () => {
    pendingPhotoBlob = null;
    removePhotoFlag = true;
    renderPhotoArea();
  });

  document.getElementById('food-cancel-btn').addEventListener('click', () => overlay.remove());
  const deleteBtn = document.getElementById('food-delete-btn');
  if (deleteBtn) deleteBtn.addEventListener('click', async () => {
    if (!confirm('حذف هذه الوجبة؟')) return;
    await deleteFoodLog(existing.id);
    overlay.remove();
    if (onSaved) onSaved();
  });

  document.getElementById('food-save-btn').addEventListener('click', async () => {
    const time = document.getElementById('food-time-input').value || null;
    const caloriesRaw = document.getElementById('food-calories-input').value;
    let calories = null;
    if (caloriesRaw !== '') {
      const n = parseInt(caloriesRaw, 10);
      if (!Number.isNaN(n)) calories = Math.max(0, n);
    }
    const notes = document.getElementById('food-notes-input').value.trim();

    if (existing) {
      await updateFoodLog(existing.id, { mealType: selectedMealType, time, notes, calories, photoBlob: pendingPhotoBlob, removePhoto: removePhotoFlag });
    } else {
      await addFoodLog({ date, mealType: selectedMealType, time, notes, calories, photoBlob: pendingPhotoBlob });
    }
    overlay.remove();
    if (onSaved) onSaved();
  });
}

// ---------- list rendering ----------

async function renderFoodList(container, date, { onChange } = {}) {
  revokeFoodPhotoUrls();
  const logs = await getFoodLogsForDate(date);
  if (logs.length === 0) {
    container.innerHTML = `<div class="empty-state"><p>ما في وجبات مسجلة بهذا اليوم.</p></div>`;
    return;
  }
  const rows = await Promise.all(logs.map(async l => {
    const photoRow = await getFoodPhoto(l.id);
    const photoUrl = photoRow ? trackFoodPhotoUrl(photoRow.photoBlob) : null;
    return `
      <button class="food-row" data-food-id="${l.id}">
        ${photoUrl ? `<img class="food-thumb" src="${photoUrl}" alt="">` : `<span class="food-thumb food-thumb-placeholder">${mealTypeIcon(l.mealType)}</span>`}
        <div class="food-row-info">
          <span class="food-row-title">${mealTypeIcon(l.mealType)} ${mealTypeLabel(l.mealType)}${l.time ? ' · ' + l.time : ''}</span>
          ${l.notes ? `<span class="food-row-notes">${escapeHtml(l.notes)}</span>` : ''}
        </div>
        ${l.calories != null ? `<span class="food-row-calories">${l.calories} سعرة</span>` : ''}
      </button>`;
  }));
  container.innerHTML = rows.join('');
  container.querySelectorAll('.food-row').forEach(row => {
    row.addEventListener('click', () => {
      openFoodModal({ date, existingId: Number(row.dataset.foodId), onSaved: onChange });
    });
  });
}

// ---------- full Food page ----------

async function renderFoodPage(params, view) {
  const today = todayStr();
  view.innerHTML = `
    <div class="page-header">
      <button class="icon-btn" id="food-back">→</button>
      <h1>الطعام</h1>
    </div>
    <div class="card" id="food-summary-card"></div>
    <div class="card" id="water-card"></div>
    <div class="card">
      <button class="btn btn-primary btn-block" id="food-add-btn">+ تسجيل وجبة</button>
      <div id="food-list"></div>
    </div>
    <div class="card">
      <div class="section-header">
        <h2 class="card-title">📖 وصفاتي</h2>
        <a class="see-all-link" href="#/recipes">فتح ←</a>
      </div>
      <p class="settings-note">احفظي وصفاتك: فيديو يوتيوب، صور، مكونات وطريقة التحضير.</p>
    </div>
  `;
  document.getElementById('food-back').addEventListener('click', () => history.back());

  async function refresh() {
    const stats = await getFoodTodayStats();
    document.getElementById('food-summary-card').innerHTML = `
      <p class="ring-label">وجباتك اليوم</p>
      <p class="period-status-text">${foodGlanceText(stats)}</p>
    `;
    await renderFoodList(document.getElementById('food-list'), today, { onChange: refresh });
  }

  await renderWaterCard(document.getElementById('water-card'));

  document.getElementById('food-add-btn').addEventListener('click', () => {
    openFoodModal({ date: today, onSaved: refresh });
  });

  await refresh();
}

// ---------- Day Detail provider ----------

async function foodDayProvider(dateStr) {
  const editable = !isFutureDate(dateStr);
  const logs = await getFoodLogsForDate(dateStr);
  if (logs.length === 0 && !editable) return null;

  const node = document.createElement('div');
  const listWrap = document.createElement('div');
  node.appendChild(listWrap);

  async function refresh() {
    await renderFoodList(listWrap, dateStr, { onChange: refresh });
  }
  await refresh();

  if (editable) {
    const addBtn = document.createElement('button');
    addBtn.className = 'btn btn-secondary btn-block food-day-add-btn';
    addBtn.textContent = '+ تسجيل وجبة';
    addBtn.addEventListener('click', () => openFoodModal({ date: dateStr, onSaved: refresh }));
    node.appendChild(addBtn);
  }

  return { title: 'الطعام', node };
}

async function waterDayProvider(dateStr) {
  const editable = !isFutureDate(dateStr);
  const liters = await getWaterForDate(dateStr);
  if (liters === 0 && !editable) return null;

  const node = document.createElement('div');
  function render(currentLiters) {
    node.innerHTML = `
      <p class="period-day-note">💧 ${currentLiters.toFixed(2)} لتر</p>
      ${editable ? `<button class="btn btn-secondary btn-block" id="day-water-btn">تعديل</button>` : ''}
    `;
    const btn = node.querySelector('#day-water-btn');
    if (btn) btn.addEventListener('click', async () => {
      const input = prompt('كمية الماء (لتر):', currentLiters.toFixed(2));
      if (input === null) return;
      const n = parseFloat(input);
      if (!Number.isNaN(n) && n >= 0) { await setWaterExact(dateStr, n); render(n); }
    });
  }
  render(liters);
  return { title: 'الماء', node };
}

// ---------- Yearly stats provider (food + water together) ----------

async function foodYearlyProvider(year) {
  const prefix = String(year);
  const [allFood, allWater] = await Promise.all([db.foodLogs.toArray(), db.waterLogs.toArray()]);
  const yearLogs = allFood.filter(l => l.date.startsWith(prefix));
  const yearWater = allWater.filter(w => w.date.startsWith(prefix));
  const totalWaterL = yearWater.reduce((s, w) => s + w.liters, 0);
  if (yearLogs.length === 0 && totalWaterL === 0) return null;

  const totalCal = yearLogs.filter(l => l.calories != null).reduce((s, l) => s + l.calories, 0);
  const byType = {};
  yearLogs.forEach(l => { byType[l.mealType] = (byType[l.mealType] || 0) + 1; });
  const typeRows = MEAL_TYPES.filter(m => byType[m.key]).map(m => `<div class="yearly-row"><span>${m.icon} ${m.label}</span><span>${byType[m.key]}</span></div>`).join('');

  const html = `
    <div class="yearly-row"><span>إجمالي الوجبات</span><span>${yearLogs.length}</span></div>
    ${typeRows}
    ${totalCal > 0 ? `<div class="yearly-row"><span>إجمالي السعرات</span><span>${totalCal}</span></div>` : ''}
    <div class="yearly-row"><span>💧 إجمالي الماء</span><span>${totalWaterL.toFixed(1)} لتر</span></div>
  `;
  return { title: 'الطعام والماء', html, count: yearLogs.length };
}
