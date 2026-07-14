// food.js — Phase 4.
// Photo is optional per entry (camera access can fail, or she's eating
// out and doesn't want to stop and photograph it) — not required just
// because "تصوير الطعام" was the first thing she listed.
// Calorie total is always derived from that day's entries, never stored
// as its own field — same "don't store what you can compute" rule as
// everywhere else.

async function addFoodLog({ date, mealType, mealName, time, notes, calories, photoBlob }) {
  const id = await db.foodLogs.add({
    date, mealType, mealName: mealName || '', time: time || null, notes: notes || '',
    calories: calories ?? null, createdAt: Date.now()
  });
  if (photoBlob) await db.foodPhotos.put({ foodLogId: id, photoBlob });
  return id;
}
async function updateFoodLog(id, { mealType, mealName, time, notes, calories, photoBlob, removePhoto }) {
  await db.foodLogs.update(id, { mealType, mealName: mealName || '', time: time || null, notes: notes || '', calories: calories ?? null });
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
// Crossing the water target (not merely being at or above it) is the moment
// worth a sound — otherwise every sip past the line would re-fire it.
async function setWaterExact(date, liters) {
  const before = await getWaterForDate(date);
  const target = await getWaterTarget();
  if (date === todayStr() && before < target && liters >= target) {
    playEventChime('water', { hapticPattern: [60, 40, 60, 40, 100] });
  }
  return _setWaterExactRaw(date, liters);
}
async function _setWaterExactRaw(date, liters) {
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
  const reached = liters >= target;

  // Glasses, not a bar: a row of cups you can SEE filling is far more
  // legible at a glance than "1.75 من 2 لتر", and it makes the remaining
  // amount countable rather than something you have to compute.
  const glassCount = Math.max(1, Math.round(target / 0.25));
  const filled = Math.floor(liters / 0.25);
  const partial = (liters / 0.25) - filled;
  const glasses = Array.from({ length: Math.min(glassCount, 12) }, (_, i) => {
    if (i < filled) return `<span class="water-glass water-glass-full">💧</span>`;
    if (i === filled && partial > 0.15) return `<span class="water-glass water-glass-part">💧</span>`;
    return `<span class="water-glass">💧</span>`;
  }).join('');

  container.innerHTML = `
    <div class="section-header">
      <h2 class="card-title">💧 الماء</h2>
      <button class="capsule-btn" id="water-edit-target">الهدف: ${toArabicNumeral(target)} ل</button>
    </div>

    <div class="water-glasses">${glasses}</div>

    <div class="mini-progress-track"><div class="mini-progress-fill ${reached ? 'water-reached' : 'water-fill'}" style="width:${frac * 100}%"></div></div>
    <p class="water-amount">
      <strong>${toArabicNumeral(liters.toFixed(2))}</strong> من ${toArabicNumeral(target)} لتر
      ${reached ? '<span class="water-done">✨ بلغتِ هدفك</span>' : `<span class="water-left">متبقّي ${toArabicNumeral((target - liters).toFixed(2))} ل</span>`}
    </p>

    <div class="water-quick-row">
      <button class="water-quick" data-add="0.2">☕ ٢٠٠</button>
      <button class="water-quick" data-add="0.25">🥛 ٢٥٠</button>
      <button class="water-quick" data-add="0.5">🍶 ٥٠٠</button>
      <button class="water-quick water-quick-minus" data-add="-0.25">−</button>
      <button class="water-quick" id="water-edit-exact">✏️</button>
    </div>
  `;

  container.querySelectorAll('.water-quick[data-add]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const delta = Number(btn.dataset.add);
      const current = await getWaterForDate(today);
      const next = Math.max(0, current + delta);
      await setWaterExact(today, Math.round(next * 100) / 100);
      if (navigator.vibrate && delta > 0) navigator.vibrate(10);
      renderWaterCard(container);
    });
  });
  document.getElementById('water-edit-exact').addEventListener('click', async () => {
    const current = await getWaterForDate(today);
    const input = prompt('كمية الماء اليوم (لتر):', current.toFixed(2));
    if (input === null) return;
    const n = parseNumericInput(input);
    if (n !== null && n >= 0) { await setWaterExact(today, n); renderWaterCard(container); }
  });
  document.getElementById('water-edit-target').addEventListener('click', async () => {
    const input = prompt('الهدف اليومي (لتر):', String(target));
    if (input === null) return;
    const n = parseNumericInput(input);
    if (n !== null && n > 0) { await db.settings.update(1, { dailyWaterTargetL: n }); renderWaterCard(container); }
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

      <label class="field-label">اسم الوجبة (اختياري)</label>
      <input class="text-input" id="food-name-input" placeholder="مثلاً: بيض مخفوق" value="${escapeHtml(existing?.mealName || '')}">

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
    const calories = readNumericField('food-calories-input', { int: true, min: 0 });
    const notes = document.getElementById('food-notes-input').value.trim();
    const mealName = document.getElementById('food-name-input').value.trim();

    if (existing) {
      await updateFoodLog(existing.id, { mealType: selectedMealType, mealName, time, notes, calories, photoBlob: pendingPhotoBlob, removePhoto: removePhotoFlag });
    } else {
      await addFoodLog({ date, mealType: selectedMealType, mealName, time, notes, calories, photoBlob: pendingPhotoBlob });
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
    const chewed = await getChewSessionForMeal(l.id);
    return `
    <div class="food-row-wrap">
      <button class="food-row" data-food-id="${l.id}">
        ${photoUrl ? `<img class="food-thumb" src="${photoUrl}" alt="">` : `<span class="food-thumb food-thumb-placeholder">${mealTypeIcon(l.mealType)}</span>`}
        <div class="food-row-info">
          <span class="food-row-title">${mealTypeIcon(l.mealType)} ${mealTypeLabel(l.mealType)}${l.mealName ? ' — ' + escapeHtml(l.mealName) : ''}${l.time ? ' · ' + l.time : ''}</span>
          ${l.notes ? `<span class="food-row-notes">${escapeHtml(l.notes)}</span>` : ''}
        </div>
        ${l.calories != null ? `<span class="food-row-calories">${toArabicNumeral(l.calories)} سعرة</span>` : ''}
      </button>
      <button class="food-chew-btn ${chewed ? 'food-chew-done' : ''}" data-chew-meal="${l.id}" aria-label="وضع المضغ">
        ${chewed ? '🌿' : '🍽️'}
      </button>
    </div>`;
  }));
  container.innerHTML = rows.join('');

  // Start the pacer on THIS meal, without going hunting for it in a list.
  container.querySelectorAll('[data-chew-meal]').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const meal = await db.foodLogs.get(Number(btn.dataset.chewMeal));
      if (!meal) return;
      const cs = await getChewSettings();
      openChewingPacer({
        foodLog: meal,
        chewSeconds: cs.chewSeconds, restSeconds: cs.restSeconds, mealMinutes: cs.mealMinutes,
        soundOn: cs.soundOn,
        onFinished: (r) => {
          toast(r.completed ? `🌿 ${toArabicNumeral(r.bites)} لقمة` : `تم الحفظ`);
          if (onChange) onChange();
        }
      });
    });
  });

  container.querySelectorAll('.food-row').forEach(row => {
    row.addEventListener('click', () => {
      openFoodModal({ date, existingId: Number(row.dataset.foodId), onSaved: onChange });
    });
  });
}

// ---------- full Food page ----------

async function getFoodGoals() {
  const settings = await db.settings.get(1);
  return { mealsGoal: settings?.dailyMealsGoal ?? null, caloriesGoal: settings?.dailyCaloriesGoal ?? null };
}
async function saveFoodGoals(mealsGoal, caloriesGoal) {
  await db.settings.update(1, { dailyMealsGoal: mealsGoal, dailyCaloriesGoal: caloriesGoal });
}

function openFoodGoalsModal(onSaved) {
  (async () => {
    const { mealsGoal, caloriesGoal } = await getFoodGoals();
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal">
        <h2 class="modal-title">أهداف الطعام اليومية</h2>
        <label class="field-label">عدد الوجبات المستهدف</label>
        <input class="text-input" type="number" min="1" id="meals-goal-input" value="${mealsGoal ?? ''}" placeholder="مثلاً: 4">
        <label class="field-label">السعرات المستهدفة</label>
        <input class="text-input" type="number" min="1" id="calories-goal-input" value="${caloriesGoal ?? ''}" placeholder="مثلاً: 2000">
        <div class="modal-actions">
          <button class="btn btn-text" id="food-goals-cancel">إلغاء</button>
          <button class="btn btn-primary" id="food-goals-save">حفظ</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    document.getElementById('food-goals-cancel').addEventListener('click', () => overlay.remove());
    document.getElementById('food-goals-save').addEventListener('click', async () => {
      const meals = readNumericField('meals-goal-input', { int: true, min: 1 });
      const cal = readNumericField('calories-goal-input', { int: true, min: 1 });
      await saveFoodGoals(meals, cal);
      overlay.remove();
      if (onSaved) onSaved();
    });
  })();
}

async function renderFoodPage(params, view) {
  const today = todayStr();
  view.innerHTML = `
    <div class="page-header">
      <button class="icon-btn" aria-label="رجوع" id="food-back">→</button>
      <h1>الطعام</h1>
    </div>
    <div class="card">
      <div class="section-header">
        <p class="ring-label">وجباتك اليوم</p>
        <button class="capsule-btn" id="food-goals-btn">🎯 الهدف</button>
      </div>
      <div id="food-summary-card"></div>
    </div>
    <div class="card" id="water-card"></div>
    <div class="card">
      <button class="btn btn-primary btn-block" id="food-add-btn">+ تسجيل وجبة</button>
      <div id="food-list"></div>
    </div>
    <div class="card" id="chew-card"></div>
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
    const { mealsGoal, caloriesGoal } = await getFoodGoals();
    const summaryEl = document.getElementById('food-summary-card');
    const logs = await getFoodLogsForDate(today);

    // Which meal types she's actually had today. This is useful with or
    // without a goal — the old card showed nothing but a sentence unless a
    // goal existed, which is the less common case.
    const hadTypes = new Set(logs.map(l => l.mealType));
    const typeStrip = MEAL_TYPES.map(m => `
      <div class="food-type-pill ${hadTypes.has(m.key) ? 'food-type-had' : ''}">
        <span class="food-type-icon">${m.icon}</span>
        <span class="food-type-label">${m.label}</span>
      </div>`).join('');

    const calFrac = caloriesGoal ? Math.min(1, (stats.totalCal || 0) / caloriesGoal) : 0;
    const mealFrac = mealsGoal ? Math.min(1, stats.count / mealsGoal) : 0;
    const overCal = caloriesGoal && (stats.totalCal || 0) > caloriesGoal;

    // Chewing is now half of what this section tracks — a food summary that
    // says nothing about HOW she ate is only half a summary.
    const chewToday = await getChewSessionsForDate(today);
    const pacedIds = new Set(chewToday.map(c => c.foodLogId).filter(Boolean));
    const pacedCount = logs.filter(l => pacedIds.has(l.id)).length;
    const chewPerf = await getChewPerformance();

    summaryEl.innerHTML = `
      <div class="food-rings-row">
        ${mealsGoal ? `
          <div class="food-ring-item">
            <div class="ring-wrap">
              ${renderRing({ size: 72, strokeWidth: 8, segments: [{ frac: mealFrac, color: mealFrac >= 1 ? 'var(--success-strong)' : 'var(--btn-color, var(--pink-deep))' }] })}
              <div class="ring-center-text">${toArabicNumeral(stats.count)}/${toArabicNumeral(mealsGoal)}</div>
            </div>
            <span class="food-ring-label">وجبات</span>
          </div>` : `
          <div class="food-ring-item">
            <div class="ring-wrap">
              ${renderRing({ size: 72, strokeWidth: 8, segments: [{ frac: stats.count > 0 ? 1 : 0, color: 'var(--btn-color, var(--pink-deep))' }] })}
              <div class="ring-center-text">${toArabicNumeral(stats.count)}</div>
            </div>
            <span class="food-ring-label">وجبات</span>
          </div>`}

        ${caloriesGoal ? `
          <div class="food-ring-item">
            <div class="ring-wrap">
              ${renderRing({ size: 72, strokeWidth: 8, segments: [{ frac: calFrac, color: overCal ? 'var(--warning-strong)' : 'var(--success-strong)' }] })}
              <div class="ring-center-text food-cal-center">${toArabicNumeral(stats.totalCal || 0)}</div>
            </div>
            <span class="food-ring-label">${overCal ? `+${toArabicNumeral((stats.totalCal || 0) - caloriesGoal)}` : `من ${toArabicNumeral(caloriesGoal)}`}</span>
          </div>` : (stats.totalCal ? `
          <div class="food-ring-item">
            <div class="ring-wrap">
              ${renderRing({ size: 72, strokeWidth: 8, segments: [{ frac: 1, color: 'var(--capsule-color, var(--pink))' }] })}
              <div class="ring-center-text food-cal-center">${toArabicNumeral(stats.totalCal)}</div>
            </div>
            <span class="food-ring-label">سعرة</span>
          </div>` : '')}

        ${logs.length > 0 ? `
          <div class="food-ring-item">
            <div class="ring-wrap">
              ${renderRing({ size: 72, strokeWidth: 8, segments: [{ frac: pacedCount / logs.length, color: pacedCount === logs.length ? 'var(--success-strong)' : 'var(--ring-health)' }] })}
              <div class="ring-center-text">${toArabicNumeral(pacedCount)}/${toArabicNumeral(logs.length)}</div>
            </div>
            <span class="food-ring-label">🌿 مضغ</span>
          </div>` : ''}
      </div>

      <div class="food-type-strip">${typeStrip}</div>

      ${chewPerf?.avgAdherence != null ? `
        <p class="food-chew-line">
          🌿 تمضغين <strong>${toArabicNumeral(Math.round(chewPerf.avgAdherence * 100))}٪</strong> من المدّة المطلوبة${chewPerf.fastestMeal ? ` · أسرع وجباتك: ${mealTypeIcon(chewPerf.fastestMeal.type)} ${mealTypeLabel(chewPerf.fastestMeal.type)}` : ''}
        </p>` : (logs.length > 0 && pacedCount === 0 ? `
        <p class="food-chew-line food-chew-hint">🌿 لم تمضغي أي وجبة اليوم — اضغطي 🍽️ بجانب أي وجبة لتبدئي</p>` : '')}
    `;
    await renderFoodList(document.getElementById('food-list'), today, { onChange: refresh });
    await renderChewCard(document.getElementById('chew-card'), refresh);
  }

  document.getElementById('food-goals-btn').addEventListener('click', () => openFoodGoalsModal(refresh));
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
      const n = parseNumericInput(input);
      if (n !== null && n >= 0) { await setWaterExact(dateStr, n); render(n); }
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
  const typeRows = MEAL_TYPES.filter(m => byType[m.key]).map(m => `<div class="yearly-row"><span>${m.icon} ${m.label}</span><span>${toArabicNumeral(byType[m.key])}</span></div>`).join('');

  // Averages and adherence: a big total tells you nothing about a typical
  // day, which is the thing worth knowing.
  const foodDays = new Set(yearLogs.map(l => l.date));
  const waterDays = yearWater.filter(w => w.liters > 0);
  const avgWater = waterDays.length ? totalWaterL / waterDays.length : 0;
  const target = await getWaterTarget();
  const daysHitTarget = waterDays.filter(w => w.liters >= target).length;
  const calDays = new Set(yearLogs.filter(l => l.calories != null).map(l => l.date));
  const avgCalPerDay = calDays.size ? Math.round(totalCal / calDays.size) : 0;

  const html = `
    <div class="yearly-row"><span>إجمالي الوجبات</span><span>${toArabicNumeral(yearLogs.length)}</span></div>
    <div class="yearly-row"><span>أيام سجّلتِ فيها طعامك</span><span>${toArabicNumeral(foodDays.size)} يوم</span></div>
    ${avgCalPerDay > 0 ? `<div class="yearly-row"><span>متوسط السعرات يومياً</span><span>${toArabicNumeral(avgCalPerDay)}</span></div>` : ''}
    <div class="yearly-row"><span>💧 إجمالي الماء</span><span>${toArabicNumeral(totalWaterL.toFixed(1))} لتر</span></div>
    ${waterDays.length ? `
      <div class="yearly-row"><span>💧 متوسط الماء يومياً</span><span>${toArabicNumeral(avgWater.toFixed(2))} لتر</span></div>
      <div class="yearly-row"><span>💧 أيام بلغتِ فيها هدفك</span><span>${toArabicNumeral(daysHitTarget)} من ${toArabicNumeral(waterDays.length)}</span></div>` : ''}
    ${typeRows ? `
      <details class="yearly-pain-details">
        <summary>تفصيل الوجبات</summary>
        ${typeRows}
        ${totalCal > 0 ? `<div class="yearly-row"><span>إجمالي السعرات</span><span>${toArabicNumeral(totalCal)}</span></div>` : ''}
      </details>` : ''}
  `;
  return { title: 'الطعام والماء', html, count: yearLogs.length };
}
