// economy.js — Phase 7.
// Balance is always derived (sum of economyTransactions), same
// "don't store what you can compute" rule as habit streaks, goal
// progress, and food calorie totals. "Set the balance to X" just adds
// a reconciliation transaction for the difference, so the transaction
// history always fully explains the current number — no separate
// balance field that could ever drift out of sync with its own history.
// Edibles and Things are deliberately identical in every way (per her
// request) — one set of functions, parameterized by table name, rather
// than two near-duplicate copies that could quietly drift apart.

// ===================== Balance + Transactions =====================

async function getEconomyBalance() {
  const all = await db.economyTransactions.toArray();
  return all.reduce((sum, t) => sum + t.amount, 0);
}
async function addTransaction(amount, note, date) {
  return db.economyTransactions.add({ amount, note: note || '', date: date || todayStr(), createdAt: Date.now() });
}
async function setBalance(newBalance, note) {
  const current = await getEconomyBalance();
  const diff = Math.round((newBalance - current) * 100) / 100;
  if (diff !== 0) await addTransaction(diff, note || 'تعديل الرصيد', todayStr());
}
async function getAllTransactions() {
  const all = await db.economyTransactions.toArray();
  return all.sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt);
}
async function deleteTransaction(id) {
  await db.economyTransactions.delete(id);
}
async function getCurrencyLabel() {
  const settings = await db.settings.get(1);
  return settings?.currency || 'دينار';
}

async function transactionRowHtml(t) {
  const currency = await getCurrencyLabel();
  const isPositive = t.amount > 0;
  return `
    <div class="txn-row" data-txn-id="${t.id}">
      <div class="txn-info">
        <span class="txn-note">${escapeHtml(t.note || (isPositive ? 'دخل' : 'مصروف'))}</span>
        <span class="txn-date">${formatDateArabic(t.date, { weekday: false })}</span>
      </div>
      <span class="txn-amount ${isPositive ? 'txn-positive' : 'txn-negative'}">${isPositive ? '+' : ''}${t.amount.toFixed(2)} ${currency}</span>
      ${kebabMenuHtml(String(t.id), [{ key: 'delete', label: 'حذف', danger: true }])}
    </div>`;
}

async function renderTransactionsList(container, { limit } = {}) {
  let all = await getAllTransactions();
  if (limit) all = all.slice(0, limit);
  if (all.length === 0) {
    container.innerHTML = `<div class="empty-state"><p>ما في معاملات مسجلة بعد.</p></div>`;
    return;
  }
  container.innerHTML = (await Promise.all(all.map(transactionRowHtml))).join('');
  wireKebabMenus(container, async (rowId, action) => {
    if (action === 'delete') {
      if (!confirm('حذف هذه المعاملة؟')) return;
      await deleteTransaction(Number(rowId));
      await renderTransactionsList(container, { limit });
    }
  });
}

// Banking-app style: grouped by month, each month showing its own
// income/expense totals before the detailed list — for the full
// transactions page specifically (the hub page's "recent" preview
// stays a simple flat list, which is all it needs at 3 items).
async function renderTransactionsGroupedByMonth(container) {
  const currency = await getCurrencyLabel();
  const all = await getAllTransactions(); // newest first already
  if (all.length === 0) {
    container.innerHTML = `<div class="empty-state"><p>ما في معاملات مسجلة بعد.</p></div>`;
    return;
  }
  const months = {};
  all.forEach(t => {
    const key = t.date.slice(0, 7);
    if (!months[key]) months[key] = [];
    months[key].push(t);
  });

  const sections = await Promise.all(Object.entries(months).map(async ([monthKey, txns], idx) => {
    const [y, m] = monthKey.split('-').map(Number);
    const totalIn = txns.filter(t => t.amount > 0).reduce((s, t) => s + t.amount, 0);
    const totalOut = txns.filter(t => t.amount < 0).reduce((s, t) => s + Math.abs(t.amount), 0);
    const rows = (await Promise.all(txns.map(transactionRowHtml))).join('');
    return `
      <details class="diary-month txn-month" ${idx === 0 ? 'open' : ''}>
        <summary>
          <span class="txn-month-name">${ARABIC_MONTHS[m - 1]} ${y}</span>
          <span class="txn-month-totals">
            <span class="txn-positive">+${totalIn.toFixed(2)}</span>
            <span class="txn-negative">-${totalOut.toFixed(2)}</span>
            <span class="txn-month-currency">${currency}</span>
          </span>
        </summary>
        <div class="card diary-month-body">${rows}</div>
      </details>`;
  }));

  container.innerHTML = sections.join('');
  wireKebabMenus(container, async (rowId, action) => {
    if (action === 'delete') {
      if (!confirm('حذف هذه المعاملة؟')) return;
      await deleteTransaction(Number(rowId));
      await renderTransactionsGroupedByMonth(container);
    }
  });
}

function openAddTransactionModal(onSaved) {
  let sign = 1;
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal">
      <h2 class="modal-title">معاملة جديدة</h2>
      <div class="habit-type-chips" id="txn-sign-chips">
        <button class="chip active" data-sign="1">+ دخل</button>
        <button class="chip" data-sign="-1">- مصروف</button>
      </div>
      <label class="field-label">المبلغ</label>
      <input class="text-input" type="number" step="0.01" min="0" id="txn-amount-input" placeholder="0.00" autofocus>
      <label class="field-label">ملاحظة (اختياري)</label>
      <input class="text-input" id="txn-note-input" placeholder="مثلاً: راتب، فاتورة كهرباء">
      <label class="field-label">التاريخ</label>
      <input class="text-input" type="date" id="txn-date-input" value="${todayStr()}">
      <div class="modal-actions">
        <button class="btn btn-text" id="txn-cancel">إلغاء</button>
        <button class="btn btn-primary" id="txn-save">حفظ</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  overlay.querySelectorAll('#txn-sign-chips .chip').forEach(chip => {
    chip.addEventListener('click', () => {
      sign = Number(chip.dataset.sign);
      overlay.querySelectorAll('#txn-sign-chips .chip').forEach(c => c.classList.toggle('active', Number(c.dataset.sign) === sign));
    });
  });
  document.getElementById('txn-cancel').addEventListener('click', () => overlay.remove());
  document.getElementById('txn-save').addEventListener('click', async () => {
    const amount = parseFloat(document.getElementById('txn-amount-input').value);
    if (Number.isNaN(amount) || amount <= 0) return;
    const note = document.getElementById('txn-note-input').value.trim();
    const date = document.getElementById('txn-date-input').value || todayStr();
    await addTransaction(amount * sign, note, date);
    overlay.remove();
    if (onSaved) onSaved();
  });
}

function openSetBalanceModal(onSaved) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal">
      <h2 class="modal-title">تعديل الرصيد</h2>
      <p class="settings-note">هذا يضيف معاملة تعديل تلقائياً لتصحيح الفرق — سجل معاملاتك يبقى واضحاً دائماً.</p>
      <label class="field-label">الرصيد الصحيح</label>
      <input class="text-input" type="number" step="0.01" id="balance-input" autofocus>
      <div class="modal-actions">
        <button class="btn btn-text" id="balance-cancel">إلغاء</button>
        <button class="btn btn-primary" id="balance-save">حفظ</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  document.getElementById('balance-cancel').addEventListener('click', () => overlay.remove());
  document.getElementById('balance-save').addEventListener('click', async () => {
    const v = parseFloat(document.getElementById('balance-input').value);
    if (Number.isNaN(v)) return;
    await setBalance(v);
    overlay.remove();
    if (onSaved) onSaved();
  });
}

// ===================== Shopping Lists =====================

async function createShoppingList(name) {
  return db.shoppingLists.add({ name, archived: false, createdAt: Date.now() });
}
async function getActiveShoppingLists() {
  const all = await db.shoppingLists.toArray();
  return all.filter(l => !l.archived).sort((a, b) => b.createdAt - a.createdAt);
}
async function deleteShoppingList(id) {
  await db.shoppingLists.delete(id);
  const items = await db.shoppingListItems.where('listId').equals(id).toArray();
  await db.shoppingListItems.bulkDelete(items.map(i => i.id));
}
async function addShoppingListItem(listId, text) {
  await db.shoppingListItems.add({ listId, text, done: false, createdAt: Date.now() });
}
async function toggleShoppingListItem(id) {
  const item = await db.shoppingListItems.get(id);
  await db.shoppingListItems.update(id, { done: !item.done });
}
async function getShoppingListItems(listId) {
  const all = await db.shoppingListItems.where('listId').equals(listId).toArray();
  return all.sort((a, b) => a.createdAt - b.createdAt);
}

async function renderShoppingListsPage(params, view) {
  view.innerHTML = `
    <div class="page-header">
      <button class="icon-btn" id="shopping-back">→</button>
      <h1>قوائم التسوق</h1>
    </div>
    <div class="card">
      <button class="btn btn-primary btn-block" id="add-list-btn">+ قائمة جديدة</button>
    </div>
    <div id="shopping-lists"></div>
  `;
  document.getElementById('shopping-back').addEventListener('click', () => history.back());

  async function refresh() {
    const lists = await getActiveShoppingLists();
    const container = document.getElementById('shopping-lists');
    if (lists.length === 0) {
      container.innerHTML = `<div class="card"><div class="empty-state"><p>ما في قوائم تسوق بعد.</p></div></div>`;
      return;
    }
    const cards = await Promise.all(lists.map(async list => {
      const items = await getShoppingListItems(list.id);
      return `
        <div class="card shopping-list-card" data-list-id="${list.id}">
          <div class="section-header">
            <h2 class="card-title">${escapeHtml(list.name)}</h2>
            ${kebabMenuHtml('list-' + list.id, [{ key: 'delete-list', label: 'حذف القائمة', danger: true }])}
          </div>
          <div class="shopping-items" data-items-for="${list.id}">
            ${items.map(i => `
              <label class="task-row ${i.done ? 'done' : ''}">
                <input type="checkbox" data-item-id="${i.id}" ${i.done ? 'checked' : ''}>
                <span class="task-title">${escapeHtml(i.text)}</span>
              </label>`).join('') || '<p class="empty-state-sub">القائمة فاضية.</p>'}
          </div>
          <div class="shopping-add-row">
            <input class="text-input" type="text" placeholder="أضيفي عنصر واضغطي Enter" data-new-item-for="${list.id}">
          </div>
        </div>`;
    }));
    container.innerHTML = cards.join('');

    wireKebabMenus(container, async (rowId, action) => {
      if (action === 'delete-list') {
        const listId = Number(rowId.replace('list-', ''));
        if (!confirm('حذف هذه القائمة بكل عناصرها؟')) return;
        await deleteShoppingList(listId);
        await refresh();
      }
    });
    container.querySelectorAll('[data-item-id]').forEach(cb => {
      cb.addEventListener('change', async () => {
        await toggleShoppingListItem(Number(cb.dataset.itemId));
        await refresh();
      });
    });
    container.querySelectorAll('[data-new-item-for]').forEach(input => {
      input.addEventListener('keydown', async (e) => {
        if (e.key !== 'Enter' || !input.value.trim()) return;
        await addShoppingListItem(Number(input.dataset.newItemFor), input.value.trim());
        await refresh();
      });
    });
  }

  document.getElementById('add-list-btn').addEventListener('click', async () => {
    const name = prompt('اسم القائمة:', 'قائمة تسوق');
    if (!name || !name.trim()) return;
    await createShoppingList(name.trim());
    await refresh();
  });

  await refresh();
}

// ===================== Edibles + Things (shared logic) =====================
// One implementation, used for both — she asked for them to be
// identical "in every possible way," so this is one code path with a
// `kind` parameter ('edibles'|'things') picking the right tables and
// labels, instead of two copies that could drift apart.

const ECONOMY_KINDS = {
  edibles: {
    table: 'edibles', photoTable: 'ediblePhotos', photoKey: 'edibleId',
    wishTable: 'edibleWishlist', wishPhotoTable: 'edibleWishlistPhotos', wishPhotoKey: 'wishlistId',
    label: 'المأكولات', singular: 'مأكول'
  },
  things: {
    table: 'things', photoTable: 'thingPhotos', photoKey: 'thingId',
    wishTable: 'thingsWishlist', wishPhotoTable: 'thingsWishlistPhotos', wishPhotoKey: 'wishlistId',
    label: 'الأغراض', singular: 'غرض'
  }
};

let _economyPhotoUrls = [];
function trackEconomyPhotoUrl(blob) {
  const url = URL.createObjectURL(blob);
  _economyPhotoUrls.push(url);
  return url;
}
function revokeEconomyPhotoUrls() {
  _economyPhotoUrls.forEach(u => URL.revokeObjectURL(u));
  _economyPhotoUrls = [];
}

async function getPurchases(kind) {
  const cfg = ECONOMY_KINDS[kind];
  const all = await db[cfg.table].toArray();
  return all.sort((a, b) => b.date.localeCompare(a.date));
}
async function addPurchase(kind, { name, price, date, deductFromBalance, photoBlob }) {
  const cfg = ECONOMY_KINDS[kind];
  const purchaseDate = date || todayStr();
  const id = await db[cfg.table].add({ name, price: price ?? null, date: purchaseDate, deductFromBalance: !!deductFromBalance, linkedTransactionId: null, createdAt: Date.now() });
  if (photoBlob) await db[cfg.photoTable].put({ [cfg.photoKey]: id, photoBlob });
  if (price != null) {
    // Always logged as a transaction, even when she chose not to deduct —
    // so "بدون خصم" purchases still show up in her history, just at zero
    // impact on the balance. Editing later can flip this without losing
    // the entry.
    const amount = deductFromBalance ? -Math.abs(price) : 0;
    const txnId = await addTransaction(amount, `${cfg.singular}: ${name}`, purchaseDate);
    await db[cfg.table].update(id, { linkedTransactionId: txnId });
  }
  return id;
}
async function updatePurchase(kind, id, { name, price, date, deductFromBalance, photoBlob, removePhoto }) {
  const cfg = ECONOMY_KINDS[kind];
  const existing = await db[cfg.table].get(id);
  const purchaseDate = date || existing.date;
  await db[cfg.table].update(id, { name, price: price ?? null, date: purchaseDate, deductFromBalance: !!deductFromBalance });
  if (photoBlob) await db[cfg.photoTable].put({ [cfg.photoKey]: id, photoBlob });
  else if (removePhoto) await db[cfg.photoTable].delete(id);

  // Reconcile the linked transaction to whatever the deduct setting is
  // NOW — this is what makes "I marked it don't-deduct, now I want it
  // to" (or the reverse) actually take effect on the balance.
  const newAmount = (price != null && deductFromBalance) ? -Math.abs(price) : 0;
  if (existing.linkedTransactionId != null) {
    await db.economyTransactions.update(existing.linkedTransactionId, { amount: newAmount, note: `${cfg.singular}: ${name}`, date: purchaseDate });
  } else if (price != null) {
    const txnId = await addTransaction(newAmount, `${cfg.singular}: ${name}`, purchaseDate);
    await db[cfg.table].update(id, { linkedTransactionId: txnId });
  }
}
async function deletePurchase(kind, id) {
  const cfg = ECONOMY_KINDS[kind];
  const existing = await db[cfg.table].get(id);
  if (existing?.linkedTransactionId != null) await db.economyTransactions.delete(existing.linkedTransactionId);
  await db[cfg.table].delete(id);
  await db[cfg.photoTable].delete(id);
}
async function getPurchasePhoto(kind, id) {
  const cfg = ECONOMY_KINDS[kind];
  return db[cfg.photoTable].get(id);
}

async function getWishlist(kind) {
  const cfg = ECONOMY_KINDS[kind];
  const all = await db[cfg.wishTable].toArray();
  return all.filter(w => !w.archived).sort((a, b) => b.createdAt - a.createdAt);
}
async function addWishlistItem(kind, { name, link, price, deductFromBalance, photoBlob }) {
  const cfg = ECONOMY_KINDS[kind];
  const id = await db[cfg.wishTable].add({ name, link: link || '', price: price ?? null, deductFromBalance: !!deductFromBalance, archived: false, createdAt: Date.now() });
  if (photoBlob) await db[cfg.wishPhotoTable].put({ [cfg.wishPhotoKey]: id, photoBlob });
  return id;
}
async function updateWishlistItem(kind, id, { name, link, price, deductFromBalance, photoBlob, removePhoto }) {
  const cfg = ECONOMY_KINDS[kind];
  await db[cfg.wishTable].update(id, { name, link: link || '', price: price ?? null, deductFromBalance: !!deductFromBalance });
  if (photoBlob) await db[cfg.wishPhotoTable].put({ [cfg.wishPhotoKey]: id, photoBlob });
  else if (removePhoto) await db[cfg.wishPhotoTable].delete(id);
}
async function deleteWishlistItem(kind, id) {
  const cfg = ECONOMY_KINDS[kind];
  await db[cfg.wishTable].delete(id);
  await db[cfg.wishPhotoTable].delete(id);
}
async function getWishlistPhoto(kind, id) {
  const cfg = ECONOMY_KINDS[kind];
  return db[cfg.wishPhotoTable].get(id);
}

async function purchaseRowHtml(item, photoUrl) {
  const currency = await getCurrencyLabel();
  const deducts = item.deductFromBalance ?? false; // old records made before this fix default to "no"
  return `
    <div class="food-row" data-purchase-id="${item.id}">
      ${photoUrl ? `<img class="food-thumb" src="${photoUrl}" alt="">` : `<span class="food-thumb food-thumb-placeholder">🛍️</span>`}
      <div class="food-row-info">
        <span class="food-row-title">${escapeHtml(item.name)}${item.date ? ' · ' + formatDateArabic(item.date, { weekday: false }) : ''}</span>
        ${item.price != null ? `<span class="food-row-notes">${deducts ? '💳 خُصم من الرصيد' : '➖ لم يُخصم'}</span>` : ''}
      </div>
      ${item.price != null ? `<span class="food-row-calories">${item.price} ${currency}</span>` : ''}
      ${kebabMenuHtml(String(item.id), [
        { key: 'edit', label: 'تعديل' },
        { key: 'delete', label: 'حذف', danger: true }
      ])}
    </div>`;
}

async function renderPurchasesList(kind, container, { limit, onBalanceChange } = {}) {
  revokeEconomyPhotoUrls();
  let items = await getPurchases(kind);
  if (limit) items = items.slice(0, limit);
  if (items.length === 0) {
    container.innerHTML = `<div class="empty-state"><p>ما في مشتريات مسجلة بعد.</p></div>`;
    return;
  }
  const rows = await Promise.all(items.map(async item => {
    const photoRow = await getPurchasePhoto(kind, item.id);
    const photoUrl = photoRow ? trackEconomyPhotoUrl(photoRow.photoBlob) : null;
    return purchaseRowHtml(item, photoUrl);
  }));
  container.innerHTML = rows.join('');
  wireKebabMenus(container, async (rowId, action) => {
    if (action === 'edit') {
      openAddPurchaseModal(kind, async () => {
        await renderPurchasesList(kind, container, { limit, onBalanceChange });
        if (onBalanceChange) await onBalanceChange();
      }, Number(rowId));
    } else if (action === 'delete') {
      if (!confirm('حذف هذا العنصر؟ سيُحذف أي خصم مرتبط به من رصيدك أيضاً.')) return;
      await deletePurchase(kind, Number(rowId));
      await renderPurchasesList(kind, container, { limit, onBalanceChange });
      if (onBalanceChange) await onBalanceChange();
    }
  });
}

function openAddPurchaseModal(kind, onSaved, existingId) {
  const cfg = ECONOMY_KINDS[kind];
  let existing = null;
  let existingPhotoUrl = null;
  let pendingPhotoBlob = null;
  let removePhotoFlag = false;
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal modal-lg">
      <h2 class="modal-title" id="purchase-modal-title">${cfg.singular} جديد</h2>
      <label class="field-label">الاسم</label>
      <input class="text-input" id="purchase-name-input" autofocus>
      <label class="field-label">السعر (اختياري)</label>
      <input class="text-input" type="number" step="0.01" id="purchase-price-input">
      <label class="checkbox-row"><input type="checkbox" id="purchase-deduct-input" checked><span>خصم من الرصيد تلقائياً</span></label>
      <label class="field-label">التاريخ</label>
      <input class="text-input" type="date" id="purchase-date-input" value="${todayStr()}">
      <label class="field-label">صورة (اختياري)</label>
      <div class="food-photo-picker" id="purchase-photo-preview"><span class="food-photo-placeholder">📷</span></div>
      ${photoPickerHtml('purchase-photo')}
      <div class="modal-actions">
        ${existingId ? `<button class="btn btn-danger btn-sm" id="purchase-delete-btn">حذف</button>` : ''}
        <button class="btn btn-text" id="purchase-cancel">إلغاء</button>
        <button class="btn btn-primary" id="purchase-save">حفظ</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  function renderPhotoArea() {
    const el = document.getElementById('purchase-photo-preview');
    if (pendingPhotoBlob) el.innerHTML = `<img src="${trackEconomyPhotoUrl(pendingPhotoBlob)}" alt="">`;
    else if (existingPhotoUrl && !removePhotoFlag) el.innerHTML = `<img src="${existingPhotoUrl}" alt="">`;
    else el.innerHTML = '<span class="food-photo-placeholder">📷</span>';
  }

  async function applyExisting() {
    if (!existingId) { renderPhotoArea(); return; }
    const cfgLocal = ECONOMY_KINDS[kind];
    existing = await db[cfgLocal.table].get(existingId);
    if (!existing) { renderPhotoArea(); return; }
    document.getElementById('purchase-modal-title').textContent = `تعديل ${cfgLocal.singular}`;
    document.getElementById('purchase-name-input').value = existing.name;
    document.getElementById('purchase-price-input').value = existing.price ?? '';
    document.getElementById('purchase-deduct-input').checked = existing.deductFromBalance ?? false;
    document.getElementById('purchase-date-input').value = existing.date || todayStr();
    const photoRow = await getPurchasePhoto(kind, existingId);
    if (photoRow) existingPhotoUrl = trackEconomyPhotoUrl(photoRow.photoBlob);
    renderPhotoArea();
  }

  wirePhotoPicker('purchase-photo', async (file) => {
    pendingPhotoBlob = await resizeImageToBlob(file, 1200, 0.8);
    removePhotoFlag = false;
    renderPhotoArea();
  }, () => {
    pendingPhotoBlob = null;
    removePhotoFlag = true;
    renderPhotoArea();
  });
  document.getElementById('purchase-cancel').addEventListener('click', () => overlay.remove());
  const deleteBtn = document.getElementById('purchase-delete-btn');
  if (deleteBtn) deleteBtn.addEventListener('click', async () => {
    if (!confirm('حذف هذا العنصر؟ سيُحذف أي خصم مرتبط به من رصيدك أيضاً.')) return;
    await deletePurchase(kind, existingId);
    overlay.remove();
    if (onSaved) onSaved();
  });
  document.getElementById('purchase-save').addEventListener('click', async () => {
    const name = document.getElementById('purchase-name-input').value.trim();
    if (!name) return;
    const priceRaw = document.getElementById('purchase-price-input').value;
    const price = priceRaw === '' ? null : parseFloat(priceRaw);
    const deduct = document.getElementById('purchase-deduct-input').checked;
    const date = document.getElementById('purchase-date-input').value || todayStr();
    if (existingId) await updatePurchase(kind, existingId, { name, price, date, deductFromBalance: deduct, photoBlob: pendingPhotoBlob, removePhoto: removePhotoFlag });
    else await addPurchase(kind, { name, price, date, deductFromBalance: deduct, photoBlob: pendingPhotoBlob });
    overlay.remove();
    if (onSaved) onSaved();
  });

  applyExisting();
}

async function wishlistRowHtml(item, photoUrl) {
  const currency = await getCurrencyLabel();
  const deducts = item.deductFromBalance ?? false;
  return `
    <div class="food-row" data-wish-id="${item.id}">
      ${photoUrl ? `<img class="food-thumb" src="${photoUrl}" alt="">` : `<span class="food-thumb food-thumb-placeholder">⭐</span>`}
      <div class="food-row-info">
        <span class="food-row-title">${escapeHtml(item.name)}</span>
        ${item.price != null ? `<span class="food-row-notes">${deducts ? '💳 سيُخصم عند الشراء' : '➖ لن يُخصم'}</span>` : ''}
        ${item.link ? `<a class="see-all-link wishlist-link" href="${escapeHtml(item.link)}" target="_blank" rel="noopener">الرابط ←</a>` : ''}
      </div>
      ${item.price != null ? `<span class="food-row-calories">${item.price} ${currency}</span>` : ''}
      ${kebabMenuHtml(String(item.id), [
        { key: 'edit', label: 'تعديل' },
        { key: 'buy', label: 'تم الشراء' },
        { key: 'delete', label: 'حذف', danger: true }
      ])}
    </div>`;
}

async function renderWishlist(kind, container, onBalanceChange) {
  revokeEconomyPhotoUrls();
  const items = await getWishlist(kind);
  if (items.length === 0) {
    container.innerHTML = `<div class="empty-state"><p>القائمة فاضية.</p></div>`;
    return;
  }
  const rows = await Promise.all(items.map(async item => {
    const photoRow = await getWishlistPhoto(kind, item.id);
    const photoUrl = photoRow ? trackEconomyPhotoUrl(photoRow.photoBlob) : null;
    return wishlistRowHtml(item, photoUrl);
  }));
  container.innerHTML = rows.join('');
  wireKebabMenus(container, async (rowId, action) => {
    const id = Number(rowId);
    if (action === 'delete') {
      if (!confirm('حذف هذا العنصر؟')) return;
      await deleteWishlistItem(kind, id);
      await renderWishlist(kind, container, onBalanceChange);
    } else if (action === 'edit') {
      openWishlistModal(kind, { existingId: id, onSaved: () => renderWishlist(kind, container, onBalanceChange) });
    } else if (action === 'buy') {
      const item = items.find(w => w.id === id);
      // Uses the item's OWN deduct setting from when it was added/edited —
      // this was hardcoded to false before, silently never deducting.
      await addPurchase(kind, { name: item.name, price: item.price, date: todayStr(), deductFromBalance: item.deductFromBalance ?? false });
      await deleteWishlistItem(kind, id);
      await renderWishlist(kind, container, onBalanceChange);
      if (onBalanceChange) await onBalanceChange();
      toast('انتقل إلى قائمة المشتريات 🌸');
    }
  });
}

function openWishlistModal(kind, { existingId, onSaved } = {}) {
  const cfg = ECONOMY_KINDS[kind];
  let existing = null;
  let existingPhotoUrl = null;
  let pendingPhotoBlob = null;
  let removePhotoFlag = false;

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal modal-lg">
      <h2 class="modal-title" id="wish-modal-title">إضافة إلى قائمة الأمنيات</h2>
      <label class="field-label">الاسم</label>
      <input class="text-input" id="wish-name-input" autofocus>
      <label class="field-label">الرابط (اختياري)</label>
      <input class="text-input" type="url" id="wish-link-input" placeholder="https://...">
      <label class="field-label">السعر (اختياري)</label>
      <input class="text-input" type="number" step="0.01" id="wish-price-input">
      <label class="checkbox-row"><input type="checkbox" id="wish-deduct-input"><span>خصم من الرصيد تلقائياً عند تحديد "تم الشراء"</span></label>
      <label class="field-label">صورة (اختياري)</label>
      <div class="food-photo-picker" id="wish-photo-preview"></div>
      ${photoPickerHtml('wish-photo')}
      <div class="modal-actions">
        <button class="btn btn-text" id="wish-cancel">إلغاء</button>
        <button class="btn btn-primary" id="wish-save">حفظ</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  function renderPhotoArea() {
    const el = document.getElementById('wish-photo-preview');
    if (pendingPhotoBlob) el.innerHTML = `<img src="${trackEconomyPhotoUrl(pendingPhotoBlob)}" alt="">`;
    else if (existingPhotoUrl && !removePhotoFlag) el.innerHTML = `<img src="${existingPhotoUrl}" alt="">`;
    else el.innerHTML = '<span class="food-photo-placeholder">📷</span>';
  }

  async function applyExisting() {
    if (!existingId) { renderPhotoArea(); return; }
    existing = (await db[cfg.wishTable].toArray()).find(w => w.id === existingId);
    if (!existing) { renderPhotoArea(); return; }
    document.getElementById('wish-modal-title').textContent = 'تعديل العنصر';
    document.getElementById('wish-name-input').value = existing.name;
    document.getElementById('wish-link-input').value = existing.link || '';
    document.getElementById('wish-price-input').value = existing.price ?? '';
    document.getElementById('wish-deduct-input').checked = existing.deductFromBalance ?? false;
    const photoRow = await getWishlistPhoto(kind, existingId);
    if (photoRow) existingPhotoUrl = trackEconomyPhotoUrl(photoRow.photoBlob);
    renderPhotoArea();
  }

  wirePhotoPicker('wish-photo', async (file) => {
    pendingPhotoBlob = await resizeImageToBlob(file, 1200, 0.8);
    removePhotoFlag = false;
    renderPhotoArea();
  }, () => {
    pendingPhotoBlob = null;
    removePhotoFlag = true;
    renderPhotoArea();
  });
  document.getElementById('wish-cancel').addEventListener('click', () => overlay.remove());
  document.getElementById('wish-save').addEventListener('click', async () => {
    const name = document.getElementById('wish-name-input').value.trim();
    if (!name) return;
    const link = document.getElementById('wish-link-input').value.trim();
    const priceRaw = document.getElementById('wish-price-input').value;
    const price = priceRaw === '' ? null : parseFloat(priceRaw);
    const deductFromBalance = document.getElementById('wish-deduct-input').checked;
    if (existingId) await updateWishlistItem(kind, existingId, { name, link, price, deductFromBalance, photoBlob: pendingPhotoBlob, removePhoto: removePhotoFlag });
    else await addWishlistItem(kind, { name, link, price, deductFromBalance, photoBlob: pendingPhotoBlob });
    overlay.remove();
    if (onSaved) onSaved();
  });

  applyExisting();
}

// ===================== full pages =====================

async function renderPurchasesPage(kind, params, view) {
  const cfg = ECONOMY_KINDS[kind];
  view.innerHTML = `
    <div class="page-header">
      <button class="icon-btn" id="purchases-back">→</button>
      <h1>${cfg.label}</h1>
    </div>
    <div class="card">
      <button class="btn btn-primary btn-block" id="add-purchase-btn">+ تسجيل مشترى</button>
      <div id="purchases-list"></div>
    </div>
  `;
  document.getElementById('purchases-back').addEventListener('click', () => history.back());
  const listEl = document.getElementById('purchases-list');
  await renderPurchasesList(kind, listEl);
  document.getElementById('add-purchase-btn').addEventListener('click', () => {
    openAddPurchaseModal(kind, () => renderPurchasesList(kind, listEl));
  });
}
async function renderEdiblesPage(params, view) { await renderPurchasesPage('edibles', params, view); }
async function renderThingsPage(params, view) { await renderPurchasesPage('things', params, view); }

async function renderWishlistPage(kind, params, view) {
  const cfg = ECONOMY_KINDS[kind];
  view.innerHTML = `
    <div class="page-header">
      <button class="icon-btn" id="wishlist-back">→</button>
      <h1>قائمة أمنيات ${cfg.label}</h1>
    </div>
    <div class="card">
      <button class="btn btn-primary btn-block" id="add-wish-btn">+ إضافة</button>
      <div id="wishlist-list"></div>
    </div>
  `;
  document.getElementById('wishlist-back').addEventListener('click', () => history.back());
  const listEl = document.getElementById('wishlist-list');
  await renderWishlist(kind, listEl);
  document.getElementById('add-wish-btn').addEventListener('click', () => {
    openWishlistModal(kind, { onSaved: () => renderWishlist(kind, listEl) });
  });
}
async function renderEdibleWishlistPage(params, view) { await renderWishlistPage('edibles', params, view); }
async function renderThingsWishlistPage(params, view) { await renderWishlistPage('things', params, view); }

async function renderTransactionsPage(params, view) {
  const currency = await getCurrencyLabel();
  view.innerHTML = `
    <div class="page-header">
      <button class="icon-btn" id="txn-page-back">→</button>
      <h1>المعاملات</h1>
    </div>
    <div class="card">
      <p class="ring-label">الرصيد الحالي</p>
      <p class="period-status-text" id="txn-balance-text"></p>
    </div>
    <div class="card">
      <button class="btn btn-primary btn-block" id="txn-add-btn">+ معاملة جديدة</button>
      <div id="txn-list"></div>
    </div>
  `;
  document.getElementById('txn-page-back').addEventListener('click', () => history.back());
  async function refresh() {
    const balance = await getEconomyBalance();
    document.getElementById('txn-balance-text').textContent = `${balance.toFixed(2)} ${currency}`;
    await renderTransactionsGroupedByMonth(document.getElementById('txn-list'));
  }
  document.getElementById('txn-add-btn').addEventListener('click', () => openAddTransactionModal(refresh));
  await refresh();
}

async function renderEconomyPage(params, view) {
  const currency = await getCurrencyLabel();
  const balance = await getEconomyBalance();

  view.innerHTML = `
    <div class="page-header">
      <button class="icon-btn" id="economy-back">→</button>
      <h1>الاقتصاد</h1>
      <button class="btn btn-primary btn-sm economy-shopping-btn" id="shopping-link">🛒 قوائم التسوق</button>
    </div>

    <div class="card">
      <p class="ring-label">رصيدك</p>
      <p class="period-status-text" id="economy-balance-text">${balance.toFixed(2)} ${currency}</p>
      <div class="modal-actions">
        <button class="btn btn-secondary btn-sm" id="economy-set-balance">تعديل الرصيد</button>
        <button class="btn btn-primary btn-sm" id="economy-add-txn">+ معاملة</button>
      </div>
    </div>

    <div class="card">
      <div class="section-header">
        <h2 class="card-title">آخر المعاملات</h2>
        <a class="see-all-link" href="#/transactions">عرض الكل ←</a>
      </div>
      <div id="economy-recent-txns"></div>
    </div>

    <div class="card">
      <div class="section-header">
        <h2 class="card-title">🍎 المأكولات</h2>
        <a class="see-all-link" href="#/edibles">عرض الكل ←</a>
      </div>
      <div id="economy-recent-edibles"></div>
      <button class="btn btn-secondary btn-block" id="economy-add-edible">+ تسجيل مشترى</button>
    </div>
    <div class="card">
      <div class="section-header">
        <h2 class="card-title">⭐ قائمة أمنيات المأكولات</h2>
        <a class="see-all-link" href="#/edibles-wishlist">عرض الكل ←</a>
      </div>
      <div id="economy-edibles-wish-preview"></div>
    </div>

    <div class="card">
      <div class="section-header">
        <h2 class="card-title">🛍️ الأغراض</h2>
        <a class="see-all-link" href="#/things">عرض الكل ←</a>
      </div>
      <div id="economy-recent-things"></div>
      <button class="btn btn-secondary btn-block" id="economy-add-thing">+ تسجيل مشترى</button>
    </div>
    <div class="card">
      <div class="section-header">
        <h2 class="card-title">⭐ قائمة أمنيات الأغراض</h2>
        <a class="see-all-link" href="#/things-wishlist">عرض الكل ←</a>
      </div>
      <div id="economy-things-wish-preview"></div>
    </div>
  `;

  document.getElementById('economy-back').addEventListener('click', () => history.back());
  document.getElementById('shopping-link').addEventListener('click', () => goTo('/shopping-lists'));

  async function refreshBalance() {
    const b = await getEconomyBalance();
    document.getElementById('economy-balance-text').textContent = `${b.toFixed(2)} ${currency}`;
    await renderTransactionsList(document.getElementById('economy-recent-txns'), { limit: 3 });
  }
  document.getElementById('economy-set-balance').addEventListener('click', () => openSetBalanceModal(refreshBalance));
  document.getElementById('economy-add-txn').addEventListener('click', () => openAddTransactionModal(refreshBalance));

  await renderTransactionsList(document.getElementById('economy-recent-txns'), { limit: 3 });

  await renderPurchasesList('edibles', document.getElementById('economy-recent-edibles'), { limit: 2, onBalanceChange: refreshBalance });
  document.getElementById('economy-add-edible').addEventListener('click', () => {
    openAddPurchaseModal('edibles', async () => {
      await renderPurchasesList('edibles', document.getElementById('economy-recent-edibles'), { limit: 2, onBalanceChange: refreshBalance });
      await refreshBalance();
    });
  });

  await renderPurchasesList('things', document.getElementById('economy-recent-things'), { limit: 2, onBalanceChange: refreshBalance });
  document.getElementById('economy-add-thing').addEventListener('click', () => {
    openAddPurchaseModal('things', async () => {
      await renderPurchasesList('things', document.getElementById('economy-recent-things'), { limit: 2, onBalanceChange: refreshBalance });
      await refreshBalance();
    });
  });

  const ediblesWishEl = document.getElementById('economy-edibles-wish-preview');
  const ediblesWishItems = await getWishlist('edibles');
  if (ediblesWishItems.length) await renderWishlist('edibles', ediblesWishEl, refreshBalance);
  else ediblesWishEl.innerHTML = `<p class="empty-state-sub">القائمة فاضية.</p>`;

  const thingsWishEl = document.getElementById('economy-things-wish-preview');
  const thingsWishItems = await getWishlist('things');
  if (thingsWishItems.length) await renderWishlist('things', thingsWishEl, refreshBalance);
  else thingsWishEl.innerHTML = `<p class="empty-state-sub">القائمة فاضية.</p>`;
}

// ---------- Yearly stats provider ----------

async function economyYearlyProvider(year) {
  const prefix = String(year);
  const currency = await getCurrencyLabel();
  const [txns, edibles, things] = await Promise.all([
    db.economyTransactions.toArray(), db.edibles.toArray(), db.things.toArray()
  ]);
  const yearTxns = txns.filter(t => t.date.startsWith(prefix));
  const yearEdibles = edibles.filter(e => e.date.startsWith(prefix));
  const yearThings = things.filter(t => t.date.startsWith(prefix));
  if (yearTxns.length === 0 && yearEdibles.length === 0 && yearThings.length === 0) return null;

  const moneyIn = yearTxns.filter(t => t.amount > 0).reduce((s, t) => s + t.amount, 0);
  const moneyOut = yearTxns.filter(t => t.amount < 0).reduce((s, t) => s + Math.abs(t.amount), 0);
  const ediblesSum = yearEdibles.filter(e => e.price != null).reduce((s, e) => s + e.price, 0);
  const thingsSum = yearThings.filter(t => t.price != null).reduce((s, t) => s + t.price, 0);

  const html = `
    <div class="yearly-row"><span>💰 دخل</span><span>${moneyIn.toFixed(2)} ${currency}</span></div>
    <div class="yearly-row"><span>💸 تم صرف</span><span>${moneyOut.toFixed(2)} ${currency}</span></div>
    <div class="yearly-row"><span>🍎 مأكولات (عدد)</span><span>${yearEdibles.length}</span></div>
    <div class="yearly-row"><span>🍎 مأكولات (التكلفة)</span><span>${ediblesSum.toFixed(2)} ${currency}</span></div>
    <div class="yearly-row"><span>🛍️ أغراض (عدد)</span><span>${yearThings.length}</span></div>
    <div class="yearly-row"><span>🛍️ أغراض (التكلفة)</span><span>${thingsSum.toFixed(2)} ${currency}</span></div>
  `;
  return { title: 'الاقتصاد', html, count: yearTxns.length + yearEdibles.length + yearThings.length };
}

// ---------- Day Detail providers ----------
// Read-only (no kebab) — same reasoning as habits.js: editing an
// entry's definition isn't a per-date action.

async function transactionsDayProvider(dateStr) {
  const all = (await db.economyTransactions.toArray()).filter(t => t.date === dateStr);
  if (all.length === 0) return null;
  const currency = await getCurrencyLabel();
  const node = document.createElement('div');
  node.innerHTML = all.map(t => `
    <div class="yearly-row">
      <span>${escapeHtml(t.note || (t.amount > 0 ? 'دخل' : 'مصروف'))}</span>
      <span class="${t.amount > 0 ? 'txn-positive' : 'txn-negative'}">${t.amount > 0 ? '+' : ''}${t.amount.toFixed(2)} ${currency}</span>
    </div>`).join('');
  return { title: 'المعاملات', node };
}

async function purchaseDayProvider(kind, title, dateStr) {
  const items = (await getPurchases(kind)).filter(i => i.date === dateStr);
  if (items.length === 0) return null;
  const node = document.createElement('div');
  const rows = await Promise.all(items.map(async item => {
    const photoRow = await getPurchasePhoto(kind, item.id);
    const photoUrl = photoRow ? trackEconomyPhotoUrl(photoRow.photoBlob) : null;
    return purchaseRowHtml(item, photoUrl);
  }));
  node.innerHTML = rows.join('');
  node.querySelectorAll('.kebab-menu').forEach(el => el.remove());
  return { title, node };
}
async function ediblesDayProvider(dateStr) { return purchaseDayProvider('edibles', 'مأكولات هذا اليوم', dateStr); }
async function thingsDayProvider(dateStr) { return purchaseDayProvider('things', 'أغراض هذا اليوم', dateStr); }
