// recipes.js — Phase 8.
// Ingredients/method are plain textareas (one line per ingredient),
// not structured rows with separate amount/unit fields — simpler to
// build and maintain, and still fully captures "write ingredients and
// measurements, then the method," just as free text rather than a
// dynamic add/remove-row UI.

async function createRecipe({ title, youtubeLink, ingredientsText, methodText, photoBlob, photoDisplayMode }) {
  const id = await db.recipes.add({
    title, youtubeLink: youtubeLink || '', ingredientsText: ingredientsText || '',
    methodText: methodText || '', photoDisplayMode: photoDisplayMode || 'thumb_and_detail', createdAt: Date.now()
  });
  if (photoBlob) await db.recipePhotos.put({ recipeId: id, photoBlob });
  return id;
}
async function updateRecipe(id, { title, youtubeLink, ingredientsText, methodText, photoBlob, removePhoto, photoDisplayMode }) {
  await db.recipes.update(id, { title, youtubeLink: youtubeLink || '', ingredientsText: ingredientsText || '', methodText: methodText || '', photoDisplayMode: photoDisplayMode || 'thumb_and_detail' });
  if (photoBlob) await db.recipePhotos.put({ recipeId: id, photoBlob });
  else if (removePhoto) await db.recipePhotos.delete(id);
}
async function deleteRecipe(id) {
  await db.recipes.delete(id);
  await db.recipePhotos.delete(id);
}
async function getAllRecipes() {
  const all = await db.recipes.toArray();
  return all.sort((a, b) => b.createdAt - a.createdAt);
}
async function getRecipePhoto(id) {
  return db.recipePhotos.get(id);
}

let _recipePhotoUrls = [];
function trackRecipePhotoUrl(blob) {
  const url = URL.createObjectURL(blob);
  _recipePhotoUrls.push(url);
  return url;
}
function revokeRecipePhotoUrls() {
  _recipePhotoUrls.forEach(u => URL.revokeObjectURL(u));
  _recipePhotoUrls = [];
}

function youtubeEmbedUrl(link) {
  const m = link.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/))([a-zA-Z0-9_-]{6,})/);
  return m ? `https://www.youtube.com/embed/${m[1]}` : null;
}

// ---------- create/edit modal ----------

async function openRecipeModal({ existingId, onSaved } = {}) {
  let existing = null;
  let existingPhotoUrl = null;
  let pendingPhotoBlob = null;
  let removePhotoFlag = false;

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal modal-lg">
      <h2 class="modal-title" id="recipe-modal-title">وصفة جديدة</h2>
      <label class="field-label">اسم الوصفة</label>
      <input class="text-input" id="recipe-title-input" autofocus>
      <label class="field-label">رابط يوتيوب (اختياري)</label>
      <input class="text-input" type="url" id="recipe-youtube-input" placeholder="https://youtube.com/...">
      <label class="field-label">صورة (اختياري)</label>
      <div class="food-photo-picker" id="recipe-photo-preview"></div>
      ${photoPickerHtml('recipe-photo')}
      <div class="habit-type-chips" id="recipe-photo-mode-chips">
        <button class="chip" data-mode="thumb_only">مصغرة فقط في القائمة</button>
        <button class="chip active" data-mode="thumb_and_detail">مصغرة + داخل الوصفة</button>
      </div>
      <label class="field-label">المكونات (سطر لكل مكوّن)</label>
      <textarea class="mood-note-input diary-textarea" id="recipe-ingredients-input" placeholder="مثلاً:&#10;كوبين دقيق&#10;بيضة واحدة&#10;نصف كوب سكر"></textarea>
      <label class="field-label">طريقة التحضير</label>
      <textarea class="mood-note-input diary-textarea" id="recipe-method-input" placeholder="اكتبي خطوات التحضير هنا..."></textarea>
      <div class="modal-actions">
        ${existingId ? `<button class="btn btn-danger btn-sm" id="recipe-delete-btn">حذف</button>` : ''}
        <button class="btn btn-text" id="recipe-cancel-btn">إلغاء</button>
        <button class="btn btn-primary" id="recipe-save-btn">حفظ</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  overlay.querySelectorAll('#recipe-photo-mode-chips .chip').forEach(chip => {
    chip.addEventListener('click', () => {
      overlay.querySelectorAll('#recipe-photo-mode-chips .chip').forEach(c => c.classList.toggle('active', c === chip));
    });
  });

  function renderPhotoArea() {
    const el = document.getElementById('recipe-photo-preview');
    if (pendingPhotoBlob) el.innerHTML = `<img src="${trackRecipePhotoUrl(pendingPhotoBlob)}" alt="">`;
    else if (existingPhotoUrl && !removePhotoFlag) el.innerHTML = `<img src="${existingPhotoUrl}" alt="">`;
    else el.innerHTML = '<span class="food-photo-placeholder">📷</span>';
  }

  async function applyExisting() {
    if (!existingId) { renderPhotoArea(); return; }
    existing = (await db.recipes.toArray()).find(r => r.id === existingId);
    if (!existing) { renderPhotoArea(); return; }
    document.getElementById('recipe-modal-title').textContent = 'تعديل الوصفة';
    document.getElementById('recipe-title-input').value = existing.title;
    document.getElementById('recipe-youtube-input').value = existing.youtubeLink || '';
    document.getElementById('recipe-ingredients-input').value = existing.ingredientsText || '';
    document.getElementById('recipe-method-input').value = existing.methodText || '';
    const mode = existing.photoDisplayMode || 'thumb_and_detail';
    overlay.querySelectorAll('#recipe-photo-mode-chips .chip').forEach(c => c.classList.toggle('active', c.dataset.mode === mode));
    const photoRow = await getRecipePhoto(existingId);
    if (photoRow) existingPhotoUrl = trackRecipePhotoUrl(photoRow.photoBlob);
    renderPhotoArea();
  }

  wirePhotoPicker('recipe-photo', async (file) => {
    pendingPhotoBlob = await resizeImageToBlob(file, 1200, 0.8);
    removePhotoFlag = false;
    renderPhotoArea();
  }, () => {
    pendingPhotoBlob = null;
    removePhotoFlag = true;
    renderPhotoArea();
  });
  document.getElementById('recipe-cancel-btn').addEventListener('click', () => overlay.remove());
  const deleteBtn = document.getElementById('recipe-delete-btn');
  if (deleteBtn) deleteBtn.addEventListener('click', async () => {
    if (!confirm('حذف هذه الوصفة؟')) return;
    await deleteRecipe(existingId);
    overlay.remove();
    if (onSaved) onSaved();
  });
  document.getElementById('recipe-save-btn').addEventListener('click', async () => {
    const title = document.getElementById('recipe-title-input').value.trim();
    if (!title) return;
    const youtubeLink = document.getElementById('recipe-youtube-input').value.trim();
    const ingredientsText = document.getElementById('recipe-ingredients-input').value.trim();
    const methodText = document.getElementById('recipe-method-input').value.trim();
    const photoDisplayMode = overlay.querySelector('#recipe-photo-mode-chips .chip.active')?.dataset.mode || 'thumb_and_detail';
    if (existingId) await updateRecipe(existingId, { title, youtubeLink, ingredientsText, methodText, photoBlob: pendingPhotoBlob, removePhoto: removePhotoFlag, photoDisplayMode });
    else await createRecipe({ title, youtubeLink, ingredientsText, methodText, photoBlob: pendingPhotoBlob, photoDisplayMode });
    overlay.remove();
    if (onSaved) onSaved();
  });

  applyExisting();
}

// ---------- detail view (read-only, reached by tapping a list row) ----------

function openRecipeDetail(recipe, photoUrl, onChanged) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay sheet-overlay';
  const embedUrl = recipe.youtubeLink ? youtubeEmbedUrl(recipe.youtubeLink) : null;
  overlay.innerHTML = `
    <div class="sheet">
      <div class="sheet-handle"></div>
      <h2 class="sheet-title">${escapeHtml(recipe.title)}</h2>
      <div class="sheet-body">
        ${photoUrl && (recipe.photoDisplayMode ?? 'thumb_and_detail') === 'thumb_and_detail' ? `<img class="diary-entry-photo" src="${photoUrl}" alt="">` : ''}
        ${embedUrl ? `<div class="youtube-embed-wrap"><iframe src="${embedUrl}" allowfullscreen loading="lazy"></iframe></div>` : ''}
        ${recipe.ingredientsText ? `<h3 class="day-detail-section-title">المكونات</h3><p class="diary-entry-text">${escapeHtml(recipe.ingredientsText)}</p>` : ''}
        ${recipe.methodText ? `<h3 class="day-detail-section-title">طريقة التحضير</h3><p class="diary-entry-text">${escapeHtml(recipe.methodText)}</p>` : ''}
      </div>
      <div class="modal-actions">
        <button class="btn btn-secondary btn-sm" id="recipe-detail-edit">✏️ تعديل</button>
        <button class="btn btn-text sheet-close" id="recipe-detail-close">إغلاق</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  document.getElementById('recipe-detail-close').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  document.getElementById('recipe-detail-edit').addEventListener('click', () => {
    overlay.remove();
    openRecipeModal({ existingId: recipe.id, onSaved: onChanged });
  });
}

// ---------- full Recipes page ----------

async function renderRecipesPage(params, view) {
  view.innerHTML = `
    <div class="page-header">
      <button class="icon-btn" aria-label="رجوع" id="recipes-back">→</button>
      <h1>وصفاتي</h1>
    </div>
    <div class="card">
      <button class="btn btn-primary btn-block" id="add-recipe-btn">+ وصفة جديدة</button>
      <div id="recipes-list"></div>
    </div>
  `;
  document.getElementById('recipes-back').addEventListener('click', () => history.back());

  async function refresh() {
    revokeRecipePhotoUrls();
    const recipes = await getAllRecipes();
    const listEl = document.getElementById('recipes-list');
    if (recipes.length === 0) {
      listEl.innerHTML = `<div class="empty-state"><p>ما في وصفات مضافة بعد.</p></div>`;
      return;
    }
    const rows = await Promise.all(recipes.map(async r => {
      const photoRow = await getRecipePhoto(r.id);
      const photoUrl = photoRow ? trackRecipePhotoUrl(photoRow.photoBlob) : null;
      return `
        <button class="food-row" data-recipe-id="${r.id}">
          ${photoUrl ? `<img class="food-thumb" src="${photoUrl}" alt="">` : `<span class="food-thumb food-thumb-placeholder">📖</span>`}
          <div class="food-row-info">
            <span class="food-row-title">${escapeHtml(r.title)}</span>
            ${r.youtubeLink ? '<span class="food-row-notes">🎬 فيديو مرفق</span>' : ''}
          </div>
        </button>`;
    }));
    listEl.innerHTML = rows.join('');
    listEl.querySelectorAll('[data-recipe-id]').forEach(row => {
      row.addEventListener('click', async () => {
        const id = Number(row.dataset.recipeId);
        const recipe = recipes.find(r => r.id === id);
        const photoRow = await getRecipePhoto(id);
        const photoUrl = photoRow ? trackRecipePhotoUrl(photoRow.photoBlob) : null;
        openRecipeDetail(recipe, photoUrl, refresh);
      });
    });
  }

  document.getElementById('add-recipe-btn').addEventListener('click', () => {
    openRecipeModal({ onSaved: refresh });
  });

  await refresh();
}
