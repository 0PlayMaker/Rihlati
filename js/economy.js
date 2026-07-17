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

// ===================== Accounts =====================
// Separate pots of money — مدخرات, راتب, مصروف — so \"how much is in
// savings\" is a different question from \"how much do I have\". Each
// account's balance is DERIVED (sum of its own transactions), never
// stored, same rule as the global balance. A transaction with no
// accountId belongs to no specific account — it still counts toward the
// overall balance, it just isn't filed under one pot (which is exactly
// how every transaction made before accounts existed behaves).

const ACCOUNT_COLORS = ['pink', 'blue', 'mint', 'yellow', 'lavender'];
// Offered as one-tap starting points the first time she opens accounts —
// she can rename, recolour, add or delete freely afterwards.
const ACCOUNT_SUGGESTIONS = [
  { name: 'مدخرات', emoji: '🐷' },
  { name: 'الراتب', emoji: '💼' },
  { name: 'مصروف', emoji: '👛' }
];

async function getEconomyAccounts() {
  const all = await db.economyAccounts.toArray();
  return all.filter(a => !a.archived).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}
async function createEconomyAccount({ name, emoji, color, excludeFromTotal }) {
  const all = await db.economyAccounts.toArray();
  return db.economyAccounts.add({
    name, emoji: emoji || '💰',
    color: color || ACCOUNT_COLORS[all.length % ACCOUNT_COLORS.length],
    excludeFromTotal: !!excludeFromTotal,
    archived: false, order: all.length, createdAt: Date.now()
  });
}
async function updateEconomyAccount(id, { name, emoji, color, excludeFromTotal }) {
  const patch = {};
  if (name != null) patch.name = name;
  if (emoji != null) patch.emoji = emoji;
  if (color != null) patch.color = color;
  if (excludeFromTotal != null) patch.excludeFromTotal = !!excludeFromTotal;
  await db.economyAccounts.update(id, patch);
}
// Archive rather than delete so its transactions keep their history; the
// transactions themselves are left untouched (they just point at an
// account that no longer shows in the list, and fall back to \"no account\").
async function archiveEconomyAccount(id) {
  await db.economyAccounts.update(id, { archived: true });
}
async function getAccountBalance(accountId) {
  const all = await db.economyTransactions.toArray();
  return all.filter(t => t.accountId === accountId).reduce((s, t) => s + t.amount, 0);
}
// The part of the overall balance not filed under any (active) account.
async function getUnassignedBalance() {
  const [all, accounts] = await Promise.all([db.economyTransactions.toArray(), getEconomyAccounts()]);
  const ids = new Set(accounts.map(a => a.id));
  return all.filter(t => t.accountId == null || !ids.has(t.accountId)).reduce((s, t) => s + t.amount, 0);
}

// ===================== Balance + Transactions =====================

async function getEconomyBalance() {
  const [all, accounts] = await Promise.all([db.economyTransactions.toArray(), db.economyAccounts.toArray()]);
  // Accounts she's marked "excluded" (e.g. long-term savings she doesn't
  // want mixed into her spendable balance) are kept out of the headline
  // total — their money still lives on its own account card, just not here.
  const excluded = new Set(accounts.filter(a => a.excludeFromTotal).map(a => a.id));
  return all.filter(t => t.accountId == null || !excluded.has(t.accountId)).reduce((sum, t) => sum + t.amount, 0);
}
// Whether any account is excluded — lets the balance card show a hint.
async function hasExcludedAccounts() {
  const accounts = await db.economyAccounts.toArray();
  return accounts.some(a => a.excludeFromTotal && !a.archived);
}
// opts carries the fields added in this phase — accountId / category /
// subcategory — all optional, so every existing caller keeps working.
async function addTransaction(amount, note, date, opts = {}) {
  // categories: the full multi-tag list [{cat, sub}]. The single
  // category/subcategory stay as the PRIMARY (first) tag so all the money
  // math is unchanged and nothing double-counts — the extra tags are only
  // for the "where does my spending touch" breakdowns.
  const cats = Array.isArray(opts.categories) ? opts.categories : (opts.category ? [{ cat: opts.category, sub: opts.subcategory ?? null }] : []);
  return db.economyTransactions.add({
    amount, note: note || '', date: date || todayStr(),
    accountId: opts.accountId ?? null,
    category: cats[0]?.cat ?? opts.category ?? null,
    subcategory: cats[0]?.sub ?? opts.subcategory ?? null,
    categories: cats,
    // Transfers between her own accounts move money but aren't income or
    // spending — flagged so the totals and category breakdown skip them,
    // while balances (which sum everything) still see them.
    isTransfer: opts.isTransfer ? true : false,
    createdAt: Date.now()
  });
}
// Every tag a transaction carries (primary + extras), as {cat, sub}. Falls
// back to the legacy single category for rows saved before multi-tag.
function transactionTags(t) {
  if (Array.isArray(t.categories) && t.categories.length) return t.categories;
  if (t.category) return [{ cat: t.category, sub: t.subcategory ?? null }];
  return [];
}
// \"Set the balance\" now targets a specific account when given one, so she
// can reconcile just her savings without disturbing everything else.
async function setBalance(newBalance, note, accountId = null) {
  const current = accountId != null ? await getAccountBalance(accountId) : await getEconomyBalance();
  const diff = Math.round((newBalance - current) * 100) / 100;
  if (diff !== 0) await addTransaction(diff, note || 'تعديل الرصيد', todayStr(), { accountId });
}
async function getAllTransactions() {
  const all = await db.economyTransactions.toArray();
  return all.sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt);
}

// Move money between two accounts as a matched pair of transactions —
// one out of the source, one into the destination — so both account
// balances stay correct and the overall balance is untouched.
async function transferBetweenAccounts(fromId, toId, amount, note) {
  const amt = Math.abs(amount);
  if (!amt || fromId === toId) return;
  const accounts = await getEconomyAccounts();
  const fromName = accounts.find(a => a.id === fromId)?.name || '';
  const toName = accounts.find(a => a.id === toId)?.name || '';
  const today = todayStr();
  await addTransaction(-amt, note || `تحويل إلى ${toName}`, today, { accountId: fromId, category: 'other', isTransfer: true });
  await addTransaction(amt, note || `تحويل من ${fromName}`, today, { accountId: toId, category: 'other', isTransfer: true });
}

// ---------- analytics ----------
// The page used to show a balance and nothing else, which tells you what
// you HAVE but nothing about where it's going. These are the numbers that
// actually change behaviour.

function monthKeyOf(dateStr) { return dateStr.slice(0, 7); } // YYYY-MM

async function getMonthSummary(monthKey) {
  const all = await getAllTransactions();
  const inMonth = all.filter(t => monthKeyOf(t.date) === monthKey);
  const income = inMonth.filter(t => t.amount > 0 && !t.isTransfer).reduce((s, t) => s + t.amount, 0);
  const expense = inMonth.filter(t => t.amount < 0 && !t.isTransfer).reduce((s, t) => s + Math.abs(t.amount), 0);
  return { income, expense, net: income - expense, count: inMonth.length, transactions: inMonth };
}

// Last N months of income/expense, oldest -> newest, for the trend bars.
async function getMonthlyTrend(months = 6) {
  const all = await getAllTransactions();
  const out = [];
  const now = new Date();
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const inMonth = all.filter(t => monthKeyOf(t.date) === key);
    out.push({
      key,
      label: ARABIC_MONTHS[d.getMonth()],
      income: inMonth.filter(t => t.amount > 0 && !t.isTransfer).reduce((s, t) => s + t.amount, 0),
      expense: inMonth.filter(t => t.amount < 0 && !t.isTransfer).reduce((s, t) => s + Math.abs(t.amount), 0)
    });
  }
  return out;
}

// Group expenses by their note — the closest thing to a category this
// model has, and in practice recurring spends reuse the same wording
// ("قهوة", "بنزين"), so it surfaces real patterns without forcing her to
// maintain a category list she never asked for.
async function getExpenseGroups(monthKey) {
  const { transactions } = await getMonthSummary(monthKey);
  const groups = {};
  transactions.filter(t => t.amount < 0 && !t.isTransfer).forEach(t => {
    const key = (t.note || 'بدون وصف').trim();
    if (!groups[key]) groups[key] = { total: 0, count: 0 };
    groups[key].total += Math.abs(t.amount);
    groups[key].count += 1;
  });
  return Object.entries(groups)
    .map(([note, g]) => ({ note, ...g }))
    .sort((a, b) => b.total - a.total);
}

// Group this month's expenses by CATEGORY (not free-text note) — this is
// the real \"where is my money going\" view now that transactions carry a
// category. Uncategorised expenses collect under 'other' so nothing is
// silently dropped.
async function getCategorySummary(monthKey) {
  const { transactions } = await getMonthSummary(monthKey);
  const groups = {};
  // Count under EVERY tag a transaction carries, not just the primary —
  // so "كم أنفقت على أي شيء موسوم بقهوة" is answerable even when the
  // dinar landed in the dining bucket. A transaction with two tags shows
  // in both; the UI labels this so the bars aren't read as a partition.
  transactions.filter(t => t.amount < 0 && !t.isTransfer).forEach(t => {
    const tags = transactionTags(t);
    const keys = tags.length ? tags : [{ cat: 'other', sub: null }];
    const seenCat = new Set();
    keys.forEach(({ cat, sub }) => {
      const key = cat || 'other';
      if (!groups[key]) groups[key] = { total: 0, count: 0, subs: {} };
      // Amount counts once per category even if two subs of it are tagged.
      if (!seenCat.has(key)) { groups[key].total += Math.abs(t.amount); groups[key].count += 1; seenCat.add(key); }
      if (sub) groups[key].subs[sub] = (groups[key].subs[sub] || 0) + Math.abs(t.amount);
    });
  });
  return Object.entries(groups)
    .map(([category, g]) => ({ category, ...g }))
    .sort((a, b) => b.total - a.total);
}

// Simple themed bar pair per month — income up, expense down.
function trendBarsHtml(trend, currency) {
  const max = Math.max(1, ...trend.flatMap(m => [m.income, m.expense]));
  return `
    <div class="econ-trend">
      ${trend.map(m => `
        <div class="econ-trend-col">
          <div class="econ-trend-bars">
            <div class="econ-bar econ-bar-in" style="height:${(m.income / max) * 100}%" title="دخل: ${m.income.toFixed(0)}"></div>
            <div class="econ-bar econ-bar-out" style="height:${(m.expense / max) * 100}%" title="صرف: ${m.expense.toFixed(0)}"></div>
          </div>
          <span class="econ-trend-label">${m.label.slice(0, 4)}</span>
        </div>`).join('')}
    </div>
    <div class="econ-trend-legend">
      <span><i class="econ-dot econ-dot-in"></i> دخل</span>
      <span><i class="econ-dot econ-dot-out"></i> صرف</span>
    </div>`;
}

async function deleteTransaction(id) {
  await db.economyTransactions.delete(id);
}
async function getCurrencyLabel() {
  const settings = await db.settings.get(1);
  return settings?.currency || 'دينار';
}

// Currency is passed in, not fetched here: this runs once per ROW, and
// re-reading the same never-changing setting from IndexedDB for every
// row turned one render into N database reads. `accountsById` is passed
// in for the same reason — one Map built per render, not one lookup per
// row.
function transactionRowHtml(t, currency, accountsById = null) {
  const isPositive = t.amount > 0;
  const account = (accountsById && t.accountId != null) ? accountsById.get(t.accountId) : null;
  const catLabel = t.category ? economyCategoryFullLabel(t.category, t.subcategory) : '';
  const tags = [];
  if (account) tags.push(`<span class="txn-tag txn-tag-account">${account.emoji} ${escapeHtml(account.name)}</span>`);
  if (catLabel) tags.push(`<span class="txn-tag">${catLabel}</span>`);
  return `
    <div class="txn-row" data-txn-id="${t.id}">
      <div class="txn-info">
        <span class="txn-note">${escapeHtml(t.note || (isPositive ? 'دخل' : 'مصروف'))}</span>
        ${tags.length ? `<span class="txn-tags">${tags.join('')}</span>` : ''}
        <span class="txn-date">${formatDateArabic(t.date, { weekday: false })}</span>
      </div>
      <span class="txn-amount ${isPositive ? 'txn-positive' : 'txn-negative'}">${isPositive ? '+' : ''}${t.amount.toFixed(2)} ${currency}</span>
      ${kebabMenuHtml(String(t.id), [{ key: 'edit', label: 'تعديل' }, { key: 'delete', label: 'حذف', danger: true }])}
    </div>`;
}

// Built once per render and threaded through the row renderers.
async function getAccountsById() {
  const accounts = await getEconomyAccounts();
  return new Map(accounts.map(a => [a.id, a]));
}

async function renderTransactionsList(container, { limit, onChange } = {}) {
  let all = await getAllTransactions();
  if (limit) all = all.slice(0, limit);
  if (all.length === 0) {
    container.innerHTML = `<div class="empty-state"><p>ما في معاملات مسجلة بعد.</p></div>`;
    return;
  }
  const currency = await getCurrencyLabel(); // once per render, not once per row
  const accountsById = await getAccountsById();
  container.innerHTML = all.map(t => transactionRowHtml(t, currency, accountsById)).join('');
  const refresh = async () => { await renderTransactionsList(container, { limit, onChange }); if (onChange) await onChange(); };
  wireKebabMenus(container, async (rowId, action) => {
    if (action === 'delete') {
      if (!confirm('حذف هذه المعاملة؟')) return;
      await deleteTransaction(Number(rowId));
      await refresh();
    } else if (action === 'edit') {
      const txn = await db.economyTransactions.get(Number(rowId));
      if (txn) openAddTransactionModal(refresh, txn);
    }
  });
}

// Banking-app style: grouped by month, each month showing its own
// income/expense totals before the detailed list — for the full
// transactions page specifically (the hub page's "recent" preview
// stays a simple flat list, which is all it needs at 3 items).
async function renderTransactionsGroupedByMonth(container, { filter = 'all', search = '', accountId = 'all', category = 'all' } = {}) {
  const currency = await getCurrencyLabel();
  const accountsById = await getAccountsById();
  let all = await getAllTransactions(); // newest first already
  if (all.length === 0) {
    container.innerHTML = `<div class="empty-state"><p>ما في معاملات مسجلة بعد.</p></div>`;
    return;
  }
  // Filtering matters here: "show me everything I spent" is a completely
  // different question from "what came in", and scrolling a mixed list
  // hunting for one of them is how you give up on tracking money.
  if (filter === 'income') all = all.filter(t => t.amount > 0);
  else if (filter === 'expense') all = all.filter(t => t.amount < 0);
  if (accountId !== 'all') {
    const wanted = accountId === 'none' ? null : Number(accountId);
    all = all.filter(t => (t.accountId ?? null) === wanted);
  }
  if (category !== 'all') all = all.filter(t => (t.category || 'other') === category);
  const q = (search || '').trim();
  if (q) all = all.filter(t => (t.note || '').includes(q) || economyCategoryLabel(t.category).includes(q));

  if (all.length === 0) {
    container.innerHTML = `<div class="empty-state"><p>لا نتائج مطابقة.</p></div>`;
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
    const totalIn = txns.filter(t => t.amount > 0 && !t.isTransfer).reduce((s, t) => s + t.amount, 0);
    const totalOut = txns.filter(t => t.amount < 0 && !t.isTransfer).reduce((s, t) => s + Math.abs(t.amount), 0);
    const rows = txns.map(t => transactionRowHtml(t, currency, accountsById)).join('');
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
  const refresh = () => renderTransactionsGroupedByMonth(container, { filter, search, accountId, category });
  wireKebabMenus(container, async (rowId, action) => {
    if (action === 'delete') {
      if (!confirm('حذف هذه المعاملة؟')) return;
      await deleteTransaction(Number(rowId));
      await refresh();
    } else if (action === 'edit') {
      const txn = await db.economyTransactions.get(Number(rowId));
      if (txn) openAddTransactionModal(refresh, txn);
    }
  });
}

// One modal for both new and edit. `existing` (a transaction row) fills
// the fields and flips Save to an update; category chips reveal their
// sub-category row only when the chosen category actually has subs.
async function openAddTransactionModal(onSaved, existing = null, presetAccountId = null) {
  const accounts = await getEconomyAccounts();
  let sign = existing ? (existing.amount >= 0 ? 1 : -1) : -1; // most logged rows are spending
  let selectedAccountId = existing ? (existing.accountId ?? null) : (presetAccountId ?? accounts[0]?.id ?? null);
  // Multi-tag state, mirroring the food builder: a flat [{cat, sub}] list.
  let txnTags = existing ? transactionTags(existing).map(t => ({ ...t })) : [];
  let activeCat = null;

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal modal-lg">
      <h2 class="modal-title">${existing ? 'تعديل المعاملة' : 'معاملة جديدة'}</h2>
      <div class="habit-type-chips" id="txn-sign-chips">
        <button class="chip ${sign === 1 ? 'active' : ''}" data-sign="1">+ دخل</button>
        <button class="chip ${sign === -1 ? 'active' : ''}" data-sign="-1">- مصروف</button>
      </div>
      <label class="field-label">المبلغ</label>
      <input class="text-input" type="number" step="0.01" min="0" id="txn-amount-input" placeholder="0.00" value="${existing ? Math.abs(existing.amount) : ''}" autofocus>

      ${accounts.length ? `
        <label class="field-label">الحساب</label>
        <div class="econ-chip-row" id="txn-account-chips">
          <button class="chip ${selectedAccountId === null ? 'active' : ''}" data-account="none">بدون حساب</button>
          ${accounts.map(a => `<button class="chip ${selectedAccountId === a.id ? 'active' : ''}" data-account="${a.id}">${a.emoji} ${escapeHtml(a.name)}</button>`).join('')}
        </div>` : ''}

      <label class="field-label">الفئات (اختياري — يمكن أكثر من واحدة)</label>
      <div class="food-tag-strip" id="txn-tag-strip"></div>
      <div class="food-cat-pills" id="txn-cat-pills">
        ${ECONOMY_CATEGORIES.map(c => `<button class="food-cat-pill" data-cat="${c.key}"><span class="food-cat-emoji">${c.icon}</span><span>${c.label}</span><span class="food-cat-badge" data-badge="${c.key}"></span></button>`).join('')}
      </div>
      <div class="food-sub-tray" id="txn-sub-tray" hidden></div>

      <label class="field-label">ملاحظة (اختياري)</label>
      <input class="text-input" id="txn-note-input" placeholder="مثلاً: راتب، فاتورة كهرباء" value="${existing ? escapeHtml(existing.note || '') : ''}">
      <label class="field-label">التاريخ</label>
      <input class="text-input" type="date" id="txn-date-input" value="${existing ? existing.date : todayStr()}">
      <div class="modal-actions">
        ${existing ? `<button class="btn btn-danger btn-sm" id="txn-delete">حذف</button>` : ''}
        <button class="btn btn-text" id="txn-cancel">إلغاء</button>
        <button class="btn btn-primary" id="txn-save">حفظ</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  const txnStripEl = document.getElementById('txn-tag-strip');
  const txnTrayEl = document.getElementById('txn-sub-tray');
  function txnHasTag(cat, sub) { return txnTags.some(t => t.cat === cat && (t.sub ?? null) === (sub ?? null)); }
  function txnCatCount(cat) { return txnTags.filter(t => t.cat === cat).length; }

  function renderTxnStrip() {
    if (txnTags.length === 0) {
      txnStripEl.innerHTML = '<span class="food-tag-empty">بدون فئة — أو اختاري واحدة أو أكثر</span>';
    } else {
      txnStripEl.innerHTML = txnTags.map((t, i) => {
        const catObj = economyCategory(t.cat);
        const label = t.sub ? `${catObj?.icon || ''} ${economySubLabel(t.cat, t.sub)}` : `${catObj?.icon || ''} ${catObj?.label || ''}`;
        return `<button class="food-tag-chip food-tag-chip-econ" data-rm="${i}">${label} <span class="food-tag-x">×</span></button>`;
      }).join('');
    }
    overlay.querySelectorAll('#txn-cat-pills .food-cat-badge').forEach(b => {
      const n = txnCatCount(b.dataset.badge);
      b.textContent = n ? toArabicNumeral(n) : '';
      b.classList.toggle('food-cat-badge-on', n > 0);
    });
    txnStripEl.querySelectorAll('[data-rm]').forEach(chip => {
      chip.addEventListener('click', () => { txnTags.splice(Number(chip.dataset.rm), 1); renderTxnStrip(); if (activeCat) renderTxnTray(); });
    });
  }

  function renderTxnTray() {
    const cat = economyCategory(activeCat);
    if (!activeCat) { txnTrayEl.hidden = true; return; }
    txnTrayEl.hidden = false;
    if (!cat.subs) {
      // No sub-categories: a single add/remove toggle for the category.
      txnTrayEl.innerHTML = `<div class="food-sub-chips"><button class="chip food-sub-chip ${txnHasTag(cat.key, null) ? 'active' : ''}" data-sub="none">${cat.icon} ${cat.label}${txnHasTag(cat.key, null) ? ' ✓' : ''}</button></div>`;
    } else {
      const chips = cat.subs.map(s => `<button class="chip food-sub-chip ${txnHasTag(cat.key, s.key) ? 'active' : ''}" data-sub="${s.key}">${s.icon} ${s.label}</button>`).join('');
      txnTrayEl.innerHTML = `<div class="food-sub-chips"><button class="chip food-sub-chip ${txnHasTag(cat.key, null) ? 'active' : ''}" data-sub="none">${cat.icon} كل ${cat.label}</button>${chips}</div>`;
    }
    txnTrayEl.querySelectorAll('.food-sub-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        const sub = chip.dataset.sub === 'none' ? null : chip.dataset.sub;
        if (txnHasTag(cat.key, sub)) txnTags = txnTags.filter(t => !(t.cat === cat.key && (t.sub ?? null) === (sub ?? null)));
        else txnTags.push({ cat: cat.key, sub });
        renderTxnStrip(); renderTxnTray();
      });
    });
  }

  overlay.querySelectorAll('#txn-cat-pills .food-cat-pill').forEach(pill => {
    pill.addEventListener('click', () => {
      activeCat = (activeCat === pill.dataset.cat) ? null : pill.dataset.cat;
      overlay.querySelectorAll('#txn-cat-pills .food-cat-pill').forEach(p => p.classList.toggle('active', p.dataset.cat === activeCat));
      renderTxnTray();
    });
  });
  renderTxnStrip();

  overlay.querySelectorAll('#txn-sign-chips .chip').forEach(chip => {
    chip.addEventListener('click', () => {
      sign = Number(chip.dataset.sign);
      overlay.querySelectorAll('#txn-sign-chips .chip').forEach(c => c.classList.toggle('active', Number(c.dataset.sign) === sign));
    });
  });
  overlay.querySelectorAll('#txn-account-chips .chip').forEach(chip => {
    chip.addEventListener('click', () => {
      selectedAccountId = chip.dataset.account === 'none' ? null : Number(chip.dataset.account);
      overlay.querySelectorAll('#txn-account-chips .chip').forEach(c => c.classList.toggle('active', c === chip));
    });
  });

  document.getElementById('txn-cancel').addEventListener('click', () => overlay.remove());
  const delBtn = document.getElementById('txn-delete');
  if (delBtn) delBtn.addEventListener('click', async () => {
    if (!confirm('حذف هذه المعاملة؟')) return;
    await deleteTransaction(existing.id);
    overlay.remove();
    if (onSaved) onSaved();
  });
  document.getElementById('txn-save').addEventListener('click', async () => {
    const amount = readNumericField('txn-amount-input');
    if (amount === null || amount <= 0) return;
    const note = document.getElementById('txn-note-input').value.trim();
    const date = document.getElementById('txn-date-input').value || todayStr();
    const fields = {
      amount: amount * sign, note, date,
      accountId: selectedAccountId,
      category: txnTags[0]?.cat ?? null,
      subcategory: txnTags[0]?.sub ?? null,
      categories: txnTags
    };
    if (existing) await db.economyTransactions.update(existing.id, fields);
    else await addTransaction(fields.amount, note, date, { accountId: selectedAccountId, categories: txnTags });
    overlay.remove();
    if (onSaved) onSaved();
  });
}

function openSetBalanceModal(onSaved, accountId = null, accountName = '') {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal">
      <h2 class="modal-title">تعديل ${accountId != null ? 'رصيد ' + escapeHtml(accountName) : 'الرصيد'}</h2>
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
    const v = readNumericField('balance-input');
    if (v === null) return;
    await setBalance(v, accountId != null ? `تعديل رصيد ${accountName}` : undefined, accountId);
    overlay.remove();
    if (onSaved) onSaved();
  });
}

// Create / rename / recolour a single account.
function openAccountModal({ existing, onSaved } = {}) {
  let color = existing?.color || ACCOUNT_COLORS[0];
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal">
      <h2 class="modal-title">${existing ? 'تعديل الحساب' : 'حساب جديد'}</h2>
      <div class="rem-emoji-row">
        <input class="text-input emoji-input" id="account-emoji" maxlength="2" value="${existing?.emoji || '💰'}">
        <input class="text-input" id="account-name" placeholder="مثلاً: مدخرات" value="${existing ? escapeHtml(existing.name) : ''}" autofocus>
      </div>
      <label class="field-label">اللون</label>
      <div class="econ-chip-row" id="account-colors">
        ${ACCOUNT_COLORS.map(c => `<button class="account-color-dot habit-color-${c} ${c === color ? 'active' : ''}" data-color="${c}" aria-label="${c}"></button>`).join('')}
      </div>
      <label class="checkbox-row">
        <input type="checkbox" id="account-exclude" ${existing?.excludeFromTotal ? 'checked' : ''}>
        <span>🔒 استثناء من الرصيد الكلي</span>
      </label>
      <p class="settings-note">للمدخرات أو أموال مخصّصة لا تريدين احتسابها ضمن رصيدك المتاح — تبقى ظاهرة على بطاقتها.</p>
      <div class="modal-actions">
        ${existing ? `<button class="btn btn-danger btn-sm" id="account-delete">حذف</button>` : ''}
        <button class="btn btn-text" id="account-cancel">إلغاء</button>
        <button class="btn btn-primary" id="account-save">حفظ</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  overlay.querySelectorAll('#account-colors .account-color-dot').forEach(dot => {
    dot.addEventListener('click', () => {
      color = dot.dataset.color;
      overlay.querySelectorAll('#account-colors .account-color-dot').forEach(d => d.classList.toggle('active', d === dot));
    });
  });
  document.getElementById('account-cancel').addEventListener('click', () => overlay.remove());
  const delBtn = document.getElementById('account-delete');
  if (delBtn) delBtn.addEventListener('click', async () => {
    if (!confirm(`حذف حساب "${existing.name}"؟ معاملاته تبقى محفوظة، فقط لن تكون منسوبة لحساب.`)) return;
    await archiveEconomyAccount(existing.id);
    overlay.remove();
    if (onSaved) onSaved();
  });
  document.getElementById('account-save').addEventListener('click', async () => {
    const name = document.getElementById('account-name').value.trim();
    if (!name) return;
    const emoji = document.getElementById('account-emoji').value.trim() || '💰';
    const excludeFromTotal = document.getElementById('account-exclude').checked;
    if (existing) await updateEconomyAccount(existing.id, { name, emoji, color, excludeFromTotal });
    else await createEconomyAccount({ name, emoji, color, excludeFromTotal });
    overlay.remove();
    if (onSaved) onSaved();
  });
}

// The accounts strip on the economy hub: one card per account showing
// its own derived balance, a tap to reconcile it, plus \"+ حساب\" and a
// transfer button when there are at least two accounts.
async function renderAccountsCard(container, onChange) {
  if (!container) return;
  const accounts = await getEconomyAccounts();
  const currency = await getCurrencyLabel();

  if (accounts.length === 0) {
    container.innerHTML = `
      <div class="section-header">
        <h2 class="card-title">🏦 الحسابات</h2>
      </div>
      <p class="settings-note">افصلي أموالك إلى حسابات — مدخرات، راتب، مصروف — لتعرفي أين يذهب كل شيء.</p>
      <div class="econ-chip-row">
        ${ACCOUNT_SUGGESTIONS.map(s => `<button class="chip econ-suggest-account" data-name="${escapeHtml(s.name)}" data-emoji="${s.emoji}">${s.emoji} ${s.name}</button>`).join('')}
      </div>
      <button class="btn btn-secondary btn-block" id="account-add-btn">+ حساب مخصّص</button>`;
    container.querySelectorAll('.econ-suggest-account').forEach(btn => {
      btn.addEventListener('click', async () => {
        await createEconomyAccount({ name: btn.dataset.name, emoji: btn.dataset.emoji });
        if (onChange) await onChange();
      });
    });
    document.getElementById('account-add-btn').addEventListener('click', () => openAccountModal({ onSaved: onChange }));
    return;
  }

  const balances = await Promise.all(accounts.map(a => getAccountBalance(a.id)));
  const unassigned = await getUnassignedBalance();
  const cards = accounts.map((a, i) => `
    <button class="econ-account-card habit-color-${a.color} ${a.excludeFromTotal ? 'econ-account-excluded' : ''}" data-account-id="${a.id}">
      ${a.excludeFromTotal ? '<span class="econ-account-lock" title="خارج الرصيد الكلي">🔒</span>' : ''}
      <span class="econ-account-emoji">${a.emoji}</span>
      <span class="econ-account-name">${escapeHtml(a.name)}</span>
      <span class="econ-account-balance ${balances[i] < 0 ? 'econ-negative' : ''}">${toArabicNumeral(balances[i].toFixed(2))}</span>
      <span class="econ-account-cur">${currency}</span>
    </button>`).join('');

  container.innerHTML = `
    <div class="section-header">
      <h2 class="card-title">🏦 الحسابات</h2>
      <div class="econ-account-actions">
        ${accounts.length >= 2 ? `<button class="capsule-btn" id="account-transfer-btn">⇄ تحويل</button>` : ''}
        <button class="capsule-btn" id="account-add-btn">+ حساب</button>
      </div>
    </div>
    <div class="econ-accounts-grid">${cards}</div>
    ${Math.abs(unassigned) > 0.001 ? `<p class="settings-note">➕ خارج الحسابات: ${toArabicNumeral(unassigned.toFixed(2))} ${currency}</p>` : ''}
  `;

  container.querySelectorAll('.econ-account-card').forEach(card => {
    const id = Number(card.dataset.accountId);
    const account = accounts.find(a => a.id === id);
    // Tap = reconcile balance; long-press / the pencil isn't available on a
    // card, so a second tap target is offered via the edit through a prompt.
    card.addEventListener('click', () => {
      openAccountActionSheet(account, onChange);
    });
  });
  document.getElementById('account-add-btn').addEventListener('click', () => openAccountModal({ onSaved: onChange }));
  const transferBtn = document.getElementById('account-transfer-btn');
  if (transferBtn) transferBtn.addEventListener('click', () => openTransferModal(accounts, onChange));
}

// A small sheet when an account card is tapped: edit it, set its balance,
// or add a transaction straight into it.
function openAccountActionSheet(account, onChange) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal">
      <h2 class="modal-title">${account.emoji} ${escapeHtml(account.name)}</h2>
      <button class="btn btn-primary btn-block" id="acct-add-txn">+ معاملة في هذا الحساب</button>
      <button class="btn btn-secondary btn-block" id="acct-view-txns">📃 عرض معاملات هذا الحساب</button>
      <button class="btn btn-secondary btn-block" id="acct-set-balance">تعديل الرصيد</button>
      <button class="btn btn-secondary btn-block" id="acct-edit">تعديل الحساب</button>
      <button class="btn btn-text btn-block" id="acct-close">إغلاق</button>
    </div>`;
  document.body.appendChild(overlay);
  const close = () => overlay.remove();
  document.getElementById('acct-close').addEventListener('click', close);
  document.getElementById('acct-add-txn').addEventListener('click', () => {
    close();
    openAddTransactionModal(onChange, null, account.id); // pre-file into this account
  });
  document.getElementById('acct-view-txns').addEventListener('click', () => { close(); openAccountTransactionsSheet(account, onChange); });
  document.getElementById('acct-set-balance').addEventListener('click', () => { close(); openSetBalanceModal(onChange, account.id, account.name); });
  document.getElementById('acct-edit').addEventListener('click', () => { close(); openAccountModal({ existing: account, onSaved: onChange }); });
}

// A full-height sheet showing ONLY this account's transactions, grouped by
// month — reuses the same list renderer the transactions page uses, just
// pinned to one accountId.
async function openAccountTransactionsSheet(account, onChange) {
  const [balance, currency] = await Promise.all([getAccountBalance(account.id), getCurrencyLabel()]);
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal modal-lg acct-txns-sheet">
      <div class="acct-txns-head">
        <h2 class="modal-title">${account.emoji} ${escapeHtml(account.name)}</h2>
        <div class="acct-txns-balance ${balance < 0 ? 'econ-negative' : ''}">${toArabicNumeral(balance.toFixed(2))} <span class="econ-account-cur">${currency}</span></div>
        ${account.excludeFromTotal ? '<span class="settings-note">🔒 هذا الحساب خارج رصيدك الكلي</span>' : ''}
      </div>
      <div id="acct-txns-list"></div>
      <div class="modal-actions">
        <button class="btn btn-primary" id="acct-txns-add">+ معاملة</button>
        <button class="btn btn-text" id="acct-txns-close">إغلاق</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  const listEl = overlay.querySelector('#acct-txns-list');
  const refresh = async () => {
    await renderTransactionsGroupedByMonth(listEl, { accountId: account.id, onChange: refresh });
    if (onChange) await onChange();
  };
  await renderTransactionsGroupedByMonth(listEl, { accountId: account.id, onChange: refresh });
  overlay.querySelector('#acct-txns-close').addEventListener('click', async () => { overlay.remove(); if (onChange) await onChange(); });
  overlay.querySelector('#acct-txns-add').addEventListener('click', () => {
    openAddTransactionModal(refresh, null, account.id);
  });
}

function openTransferModal(accounts, onChange) {
  let fromId = accounts[0].id;
  let toId = accounts[1].id;
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal">
      <h2 class="modal-title">⇄ تحويل بين الحسابات</h2>
      <label class="field-label">من</label>
      <div class="econ-chip-row" id="transfer-from">
        ${accounts.map(a => `<button class="chip ${a.id === fromId ? 'active' : ''}" data-id="${a.id}">${a.emoji} ${escapeHtml(a.name)}</button>`).join('')}
      </div>
      <label class="field-label">إلى</label>
      <div class="econ-chip-row" id="transfer-to">
        ${accounts.map(a => `<button class="chip ${a.id === toId ? 'active' : ''}" data-id="${a.id}">${a.emoji} ${escapeHtml(a.name)}</button>`).join('')}
      </div>
      <label class="field-label">المبلغ</label>
      <input class="text-input" type="number" step="0.01" min="0" id="transfer-amount" placeholder="0.00" autofocus>
      <div class="modal-actions">
        <button class="btn btn-text" id="transfer-cancel">إلغاء</button>
        <button class="btn btn-primary" id="transfer-save">تحويل</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  overlay.querySelectorAll('#transfer-from .chip').forEach(c => c.addEventListener('click', () => {
    fromId = Number(c.dataset.id);
    overlay.querySelectorAll('#transfer-from .chip').forEach(x => x.classList.toggle('active', x === c));
  }));
  overlay.querySelectorAll('#transfer-to .chip').forEach(c => c.addEventListener('click', () => {
    toId = Number(c.dataset.id);
    overlay.querySelectorAll('#transfer-to .chip').forEach(x => x.classList.toggle('active', x === c));
  }));
  document.getElementById('transfer-cancel').addEventListener('click', () => overlay.remove());
  document.getElementById('transfer-save').addEventListener('click', async () => {
    const amt = readNumericField('transfer-amount');
    if (amt === null || amt <= 0) return;
    if (fromId === toId) { toast('اختاري حسابين مختلفين'); return; }
    await transferBetweenAccounts(fromId, toId, amt);
    overlay.remove();
    if (onChange) await onChange();
    toast('⇄ تم التحويل');
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
  // Auto-sort: unchecked first, checked ones sink to the bottom —
  // within each group, oldest first so newly-added items don't jump around.
  return all.sort((a, b) => (a.done - b.done) || (a.createdAt - b.createdAt));
}
async function updateShoppingListName(listId, name) {
  await db.shoppingLists.update(listId, { name });
}
async function updateShoppingListItemText(id, text) {
  await db.shoppingListItems.update(id, { text });
}
async function deleteShoppingListItem(id) {
  await db.shoppingListItems.delete(id);
}

async function renderShoppingListsPage(params, view) {
  view.innerHTML = `
    <div class="page-header">
      <button class="icon-btn" aria-label="رجوع" id="shopping-back">→</button>
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
            ${kebabMenuHtml('list-' + list.id, [
              { key: 'rename-list', label: 'تعديل اسم القائمة' },
              { key: 'delete-list', label: 'حذف القائمة', danger: true }
            ])}
          </div>
          <div class="shopping-items" data-items-for="${list.id}">
            ${items.map(i => `
              <div class="task-row-wrap">
                <label class="task-row ${i.done ? 'done' : ''}">
                  <input type="checkbox" data-item-id="${i.id}" ${i.done ? 'checked' : ''}>
                  <span class="task-title">${escapeHtml(i.text)}</span>
                </label>
                ${kebabMenuHtml('item-' + i.id, [
                  { key: 'edit-item', label: 'تعديل' },
                  { key: 'delete-item', label: 'حذف', danger: true }
                ])}
              </div>`).join('') || '<p class="empty-state-sub">القائمة فاضية.</p>'}
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
      } else if (action === 'rename-list') {
        const listId = Number(rowId.replace('list-', ''));
        const list = lists.find(l => l.id === listId);
        const name = prompt('اسم القائمة:', list.name);
        if (!name || !name.trim()) return;
        await updateShoppingListName(listId, name.trim());
        await refresh();
      } else if (action === 'edit-item') {
        const itemId = Number(rowId.replace('item-', ''));
        const item = await db.shoppingListItems.get(itemId);
        const text = prompt('العنصر:', item.text);
        if (!text || !text.trim()) return;
        await updateShoppingListItemText(itemId, text.trim());
        await refresh();
      } else if (action === 'delete-item') {
        const itemId = Number(rowId.replace('item-', ''));
        await deleteShoppingListItem(itemId);
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
    label: 'الطعام', singular: 'طعام', defaultCategory: 'food'
  },
  things: {
    table: 'things', photoTable: 'thingPhotos', photoKey: 'thingId',
    wishTable: 'thingsWishlist', wishPhotoTable: 'thingsWishlistPhotos', wishPhotoKey: 'wishlistId',
    label: 'الأغراض', singular: 'غرض', defaultCategory: 'other'
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
    const txnId = await addTransaction(amount, `${cfg.singular}: ${name}`, purchaseDate, { category: cfg.defaultCategory });
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
    const txnId = await addTransaction(newAmount, `${cfg.singular}: ${name}`, purchaseDate, { category: cfg.defaultCategory });
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

function purchaseRowHtml(item, photoUrl, currency) {
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
  const currency = await getCurrencyLabel(); // once per render, not once per row
  const rows = await Promise.all(items.map(async item => {
    const photoRow = await getPurchasePhoto(kind, item.id);
    const photoUrl = photoRow ? trackEconomyPhotoUrl(photoRow.photoBlob) : null;
    return purchaseRowHtml(item, photoUrl, currency);
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
    const price = readNumericField('purchase-price-input');
    const deduct = document.getElementById('purchase-deduct-input').checked;
    const date = document.getElementById('purchase-date-input').value || todayStr();
    if (existingId) await updatePurchase(kind, existingId, { name, price, date, deductFromBalance: deduct, photoBlob: pendingPhotoBlob, removePhoto: removePhotoFlag });
    else await addPurchase(kind, { name, price, date, deductFromBalance: deduct, photoBlob: pendingPhotoBlob });
    overlay.remove();
    if (onSaved) onSaved();
  });

  applyExisting();
}

function wishlistRowHtml(item, photoUrl, currency) {
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
  const currency = await getCurrencyLabel(); // once per render, not once per row
  const rows = await Promise.all(items.map(async item => {
    const photoRow = await getWishlistPhoto(kind, item.id);
    const photoUrl = photoRow ? trackEconomyPhotoUrl(photoRow.photoBlob) : null;
    return wishlistRowHtml(item, photoUrl, currency);
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
    const price = readNumericField('wish-price-input');
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
      <button class="icon-btn" aria-label="رجوع" id="purchases-back">→</button>
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
      <button class="icon-btn" aria-label="رجوع" id="wishlist-back">→</button>
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
  const accounts = await getEconomyAccounts();
  view.innerHTML = `
    <div class="page-header">
      <button class="icon-btn" aria-label="رجوع" id="txn-page-back">→</button>
      <h1>المعاملات</h1>
    </div>
    <div class="card">
      <p class="ring-label">الرصيد الحالي</p>
      <p class="period-status-text" id="txn-balance-text"></p>
    </div>
    <div class="card">
      <button class="btn btn-primary btn-block" id="txn-add-btn">+ معاملة جديدة</button>
      <div class="habit-type-chips txn-filter-row" id="txn-filters">
        <button class="chip active" data-filter="all">الكل</button>
        <button class="chip" data-filter="income">دخل</button>
        <button class="chip" data-filter="expense">صرف</button>
      </div>
      ${accounts.length ? `
        <div class="econ-chip-row txn-account-filter" id="txn-account-filter">
          <button class="chip active" data-account="all">كل الحسابات</button>
          ${accounts.map(a => `<button class="chip" data-account="${a.id}">${a.emoji} ${escapeHtml(a.name)}</button>`).join('')}
          <button class="chip" data-account="none">بدون حساب</button>
        </div>` : ''}
      <div class="econ-chip-row txn-cat-filter" id="txn-cat-filter">
        <button class="chip active" data-cat="all">كل الفئات</button>
        ${ECONOMY_CATEGORIES.map(c => `<button class="chip" data-cat="${c.key}">${c.icon} ${c.label}</button>`).join('')}
      </div>
      <input class="text-input" type="search" id="txn-search" placeholder="🔎 بحث في الوصف أو الفئة...">
      <div id="txn-list"></div>
    </div>
  `;
  document.getElementById('txn-page-back').addEventListener('click', () => history.back());

  let filter = 'all';
  let search = '';
  let accountId = 'all';
  let category = 'all';

  async function refresh() {
    const balance = await getEconomyBalance();
    document.getElementById('txn-balance-text').textContent = `${toArabicNumeral(balance.toFixed(2))} ${currency}`;
    await renderTransactionsGroupedByMonth(document.getElementById('txn-list'), { filter, search, accountId, category });
  }
  document.getElementById('txn-add-btn').addEventListener('click', () => openAddTransactionModal(refresh));

  const filterRow = document.getElementById('txn-filters');
  filterRow.querySelectorAll('.chip').forEach(chip => {
    chip.addEventListener('click', async () => {
      filter = chip.dataset.filter;
      filterRow.querySelectorAll('.chip').forEach(c => c.classList.toggle('active', c === chip));
      await refresh();
    });
  });
  const accountRow = document.getElementById('txn-account-filter');
  if (accountRow) accountRow.querySelectorAll('.chip').forEach(chip => {
    chip.addEventListener('click', async () => {
      accountId = chip.dataset.account;
      accountRow.querySelectorAll('.chip').forEach(c => c.classList.toggle('active', c === chip));
      await refresh();
    });
  });
  const catRow = document.getElementById('txn-cat-filter');
  catRow.querySelectorAll('.chip').forEach(chip => {
    chip.addEventListener('click', async () => {
      category = chip.dataset.cat;
      catRow.querySelectorAll('.chip').forEach(c => c.classList.toggle('active', c === chip));
      await refresh();
    });
  });
  let searchTimer = null;
  document.getElementById('txn-search').addEventListener('input', (e) => {
    // Debounced: re-rendering the whole grouped list on every keystroke is
    // wasteful, and on a long history it stutters.
    clearTimeout(searchTimer);
    searchTimer = setTimeout(async () => { search = e.target.value; await refresh(); }, 200);
  });

  await refresh();
}

async function renderEconomyPage(params, view) {
  const currency = await getCurrencyLabel();
  const balance = await getEconomyBalance();

  view.innerHTML = `
    <div class="page-header">
      <button class="icon-btn" aria-label="رجوع" id="economy-back">→</button>
      <h1>الاقتصاد</h1>
      <button class="btn btn-primary btn-sm economy-shopping-btn" id="shopping-link">🛒 قوائم التسوق</button>
    </div>

    <div class="card" id="economy-balance-card"></div>
    <div class="card" id="economy-accounts-card"></div>
    <div class="card" id="economy-month-card"></div>
    <div class="card" id="economy-trend-card"></div>
    <div class="card" id="economy-categories-card"></div>
    <div class="card" id="economy-groups-card"></div>

    <div class="card">
      <div class="section-header">
        <h2 class="card-title">آخر المعاملات</h2>
        <a class="see-all-link" href="#/transactions">عرض الكل ←</a>
      </div>
      <div id="economy-recent-txns"></div>
    </div>

    <div class="card">
      <div class="section-header">
        <h2 class="card-title">🍎 الطعام</h2>
        <a class="see-all-link" href="#/edibles">عرض الكل ←</a>
      </div>
      <div id="economy-recent-edibles"></div>
      <button class="btn btn-secondary btn-block" id="economy-add-edible">+ تسجيل مشترى</button>
    </div>
    <div class="card">
      <div class="section-header">
        <h2 class="card-title">⭐ قائمة أمنيات الطعام</h2>
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

  const thisMonth = todayStr().slice(0, 7);

  async function refreshAnalytics() {
    const b = await getEconomyBalance();
    const month = await getMonthSummary(thisMonth);
    const trend = await getMonthlyTrend(6);
    const groups = await getExpenseGroups(thisMonth);
    const catGroups = await getCategorySummary(thisMonth);

    // Balance hero
    const excludedHint = await hasExcludedAccounts();
    document.getElementById('economy-balance-card').innerHTML = `
      <p class="ring-label">رصيدك${excludedHint ? ' <span class="econ-balance-hint">(بدون الحسابات المستثناة)</span>' : ''}</p>
      <div class="econ-balance">
        <span class="econ-balance-num ${b < 0 ? 'econ-negative' : ''}">${toArabicNumeral(b.toFixed(2))}</span>
        <span class="econ-balance-cur">${currency}</span>
      </div>
      <div class="econ-actions">
        <button class="btn btn-secondary btn-sm" id="economy-set-balance">تعديل الرصيد</button>
        <button class="btn btn-primary btn-sm" id="economy-add-txn">+ معاملة</button>
      </div>`;
    document.getElementById('economy-set-balance').addEventListener('click', () => openSetBalanceModal(refreshAll));
    document.getElementById('economy-add-txn').addEventListener('click', () => openAddTransactionModal(refreshAll));

    // This month
    const monthCard = document.getElementById('economy-month-card');
    if (month.count === 0) {
      monthCard.innerHTML = `
        <h2 class="card-title">هذا الشهر</h2>
        <p class="mini-progress-text">لا معاملات هذا الشهر بعد.</p>`;
    } else {
      const spentPct = month.income > 0 ? Math.min(100, (month.expense / month.income) * 100) : (month.expense > 0 ? 100 : 0);
      monthCard.innerHTML = `
        <h2 class="card-title">هذا الشهر</h2>
        <div class="econ-month-row">
          <div class="econ-month-stat">
            <span class="econ-month-num econ-in">+${toArabicNumeral(month.income.toFixed(0))}</span>
            <span class="econ-month-label">دخل</span>
          </div>
          <div class="econ-month-stat">
            <span class="econ-month-num econ-out">−${toArabicNumeral(month.expense.toFixed(0))}</span>
            <span class="econ-month-label">صرف</span>
          </div>
          <div class="econ-month-stat">
            <span class="econ-month-num ${month.net < 0 ? 'econ-out' : 'econ-in'}">${month.net >= 0 ? '+' : '−'}${toArabicNumeral(Math.abs(month.net).toFixed(0))}</span>
            <span class="econ-month-label">الصافي</span>
          </div>
        </div>
        ${month.income > 0 ? `
          <div class="mini-progress-track econ-spend-track">
            <div class="mini-progress-fill ${month.expense > month.income ? 'econ-over' : ''}" style="width:${spentPct}%"></div>
          </div>
          <p class="settings-note">${month.expense > month.income
            ? `⚠️ صرفتِ أكثر من دخلك هذا الشهر بـ ${toArabicNumeral((month.expense - month.income).toFixed(0))} ${currency}`
            : `صرفتِ ${toArabicNumeral(Math.round(spentPct))}٪ من دخل هذا الشهر`}</p>` : ''}`;
    }

    // Trend
    const trendCard = document.getElementById('economy-trend-card');
    const hasTrend = trend.some(m => m.income > 0 || m.expense > 0);
    if (hasTrend) {
      trendCard.innerHTML = `
        <h2 class="card-title">آخر ٦ أشهر</h2>
        ${trendBarsHtml(trend, currency)}`;
      trendCard.style.display = '';
    } else {
      trendCard.style.display = 'none';
    }

    // Spending by CATEGORY — the structured "where is it going" view.
    const catCard = document.getElementById('economy-categories-card');
    if (catGroups.length > 0) {
      const maxC = catGroups[0].total;
      const totalOut = catGroups.reduce((s, g) => s + g.total, 0);
      catCard.innerHTML = `
        <h2 class="card-title">الصرف حسب الفئة — هذا الشهر</h2>
        ${catGroups.map(g => {
          const subEntries = Object.entries(g.subs || {}).sort((a, b) => b[1] - a[1]);
          const subLine = subEntries.length
            ? `<div class="econ-cat-subs">${subEntries.map(([sk, sv]) => `<span class="econ-cat-sub-pill">${economySubIcon(g.category, sk)} ${economySubLabel(g.category, sk)} ${toArabicNumeral(sv.toFixed(0))}</span>`).join('')}</div>`
            : '';
          return `
            <div class="econ-group">
              <div class="econ-group-head">
                <span class="econ-group-name">${economyCategoryIcon(g.category)} ${economyCategoryLabel(g.category)}${g.count > 1 ? ` <span class="econ-group-count">×${toArabicNumeral(g.count)}</span>` : ''}</span>
                <span class="econ-group-total">${toArabicNumeral(g.total.toFixed(0))} ${currency} <span class="econ-cat-pct">${toArabicNumeral(Math.round((g.total / totalOut) * 100))}٪</span></span>
              </div>
              <div class="econ-group-track"><div class="econ-group-fill econ-cat-fill-${economyCategory(g.category)?.subs ? 'has' : 'plain'}" style="width:${(g.total / maxC) * 100}%"></div></div>
              ${subLine}
            </div>`;
        }).join('')}`;
      catCard.style.display = '';
    } else {
      catCard.style.display = 'none';
    }

    // Top spends by note — still useful for recurring named spends, but now
    // secondary to the category view, so it lives inside a details.
    const groupsCard = document.getElementById('economy-groups-card');
    if (groups.length > 0) {
      const maxG = groups[0].total;
      groupsCard.innerHTML = `
        <details class="econ-notes-details">
          <summary>أكثر ما صرفتِ عليه بالوصف</summary>
          ${groups.slice(0, 8).map(g => `
            <div class="econ-group">
              <div class="econ-group-head">
                <span class="econ-group-name">${escapeHtml(g.note)}${g.count > 1 ? ` <span class="econ-group-count">×${toArabicNumeral(g.count)}</span>` : ''}</span>
                <span class="econ-group-total">${toArabicNumeral(g.total.toFixed(0))} ${currency}</span>
              </div>
              <div class="econ-group-track"><div class="econ-group-fill" style="width:${(g.total / maxG) * 100}%"></div></div>
            </div>`).join('')}
        </details>`;
      groupsCard.style.display = '';
    } else {
      groupsCard.style.display = 'none';
    }
  }

  async function refreshAll() {
    await refreshAnalytics();
    await renderAccountsCard(document.getElementById('economy-accounts-card'), refreshAll);
    await renderTransactionsList(document.getElementById('economy-recent-txns'), { limit: 3, onChange: refreshAll });
  }
  const refreshBalance = refreshAll; // other sections call this name

  await refreshAll();

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

  const moneyIn = yearTxns.filter(t => t.amount > 0 && !t.isTransfer).reduce((s, t) => s + t.amount, 0);
  const moneyOut = yearTxns.filter(t => t.amount < 0 && !t.isTransfer).reduce((s, t) => s + Math.abs(t.amount), 0);
  const ediblesSum = yearEdibles.filter(e => e.price != null).reduce((s, e) => s + e.price, 0);
  const thingsSum = yearThings.filter(t => t.price != null).reduce((s, t) => s + t.price, 0);

  // Spending by category across the whole year.
  const catTotals = {};
  yearTxns.filter(t => t.amount < 0).forEach(t => {
    const k = t.category || 'other';
    catTotals[k] = (catTotals[k] || 0) + Math.abs(t.amount);
  });
  const catRows = Object.entries(catTotals).sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `<div class="yearly-row"><span>${economyCategoryIcon(k)} ${economyCategoryLabel(k)}</span><span>${v.toFixed(2)} ${currency}</span></div>`)
    .join('');

  // Current balance per account (a snapshot, not a year sum — a running
  // pot's balance is the number that matters).
  const accounts = await getEconomyAccounts();
  const accountRows = (await Promise.all(accounts.map(async a => {
    const bal = await getAccountBalance(a.id);
    return `<div class="yearly-row"><span>${a.emoji} ${escapeHtml(a.name)}</span><span>${bal.toFixed(2)} ${currency}</span></div>`;
  }))).join('');

  const html = `
    <div class="yearly-row"><span>💰 دخل</span><span>${moneyIn.toFixed(2)} ${currency}</span></div>
    <div class="yearly-row"><span>💸 تم صرف</span><span>${moneyOut.toFixed(2)} ${currency}</span></div>
    <div class="yearly-row"><span>🍎 طعام (عدد)</span><span>${yearEdibles.length}</span></div>
    <div class="yearly-row"><span>🍎 طعام (التكلفة)</span><span>${ediblesSum.toFixed(2)} ${currency}</span></div>
    <div class="yearly-row"><span>🛍️ أغراض (عدد)</span><span>${yearThings.length}</span></div>
    <div class="yearly-row"><span>🛍️ أغراض (التكلفة)</span><span>${thingsSum.toFixed(2)} ${currency}</span></div>
    ${accountRows ? `<details class="yearly-pain-details"><summary>الحسابات</summary>${accountRows}</details>` : ''}
    ${catRows ? `<details class="yearly-pain-details"><summary>الصرف حسب الفئة</summary>${catRows}</details>` : ''}
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
  const accountsById = await getAccountsById();
  const node = document.createElement('div');
  node.innerHTML = all.map(t => {
    const account = t.accountId != null ? accountsById.get(t.accountId) : null;
    const meta = [account ? `${account.emoji} ${escapeHtml(account.name)}` : '', t.category ? economyCategoryFullLabel(t.category, t.subcategory) : ''].filter(Boolean).join(' · ');
    return `
    <div class="yearly-row">
      <span>${escapeHtml(t.note || (t.amount > 0 ? 'دخل' : 'مصروف'))}${meta ? `<br><span class="txn-day-meta">${meta}</span>` : ''}</span>
      <span class="${t.amount > 0 ? 'txn-positive' : 'txn-negative'}">${t.amount > 0 ? '+' : ''}${t.amount.toFixed(2)} ${currency}</span>
    </div>`;
  }).join('');
  return { title: 'المعاملات', node };
}

async function purchaseDayProvider(kind, title, dateStr) {
  const items = (await getPurchases(kind)).filter(i => i.date === dateStr);
  if (items.length === 0) return null;
  const node = document.createElement('div');
  const currency = await getCurrencyLabel(); // once per render, not once per row
  const rows = await Promise.all(items.map(async item => {
    const photoRow = await getPurchasePhoto(kind, item.id);
    const photoUrl = photoRow ? trackEconomyPhotoUrl(photoRow.photoBlob) : null;
    return purchaseRowHtml(item, photoUrl, currency);
  }));
  node.innerHTML = rows.join('');
  node.querySelectorAll('.kebab-menu').forEach(el => el.remove());
  return { title, node };
}
async function ediblesDayProvider(dateStr) { return purchaseDayProvider('edibles', 'طعام هذا اليوم', dateStr); }
async function thingsDayProvider(dateStr) { return purchaseDayProvider('things', 'أغراض هذا اليوم', dateStr); }
