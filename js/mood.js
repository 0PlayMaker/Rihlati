// mood.js — one table, reused everywhere mood shows up (Period now,
// Body+Mood later). "Same element reflects on the main calendar" only
// works if there's exactly one mood table — this is it.

const MOOD_PRESETS = [
  { emoji: '😊', label: 'مبسوطة' },
  { emoji: '😐', label: 'عادي' },
  { emoji: '😢', label: 'حزينة' },
  { emoji: '😣', label: 'متوترة' },
  { emoji: '🌑', label: 'يوم ثقيل' }
];

async function getMoodLog(date) {
  return db.moodLogs.where('date').equals(date).first();
}

// Last 7 days of mood, oldest first — for Home's ring card. Days with
// no entry show as a faint placeholder dot rather than being skipped,
// so the strip always reads as "the last 7 days," not "the last 7 days
// she happened to log."
async function getLast7DaysMood() {
  const today = todayStr();
  const dates = [];
  for (let i = 6; i >= 0; i--) dates.push(addDays(today, -i));
  const logs = await Promise.all(dates.map(d => getMoodLog(d)));
  return dates.map((date, i) => ({ date, emoji: logs[i]?.emoji || null }));
}
async function setMood(date, emoji, note) {
  const existing = await getMoodLog(date);
  if (existing) await db.moodLogs.update(existing.id, { emoji, note: note || '' });
  else await db.moodLogs.add({ date, emoji, note: note || '', createdAt: Date.now() });
}
async function clearMood(date) {
  await db.moodLogs.where('date').equals(date).delete();
}

async function renderMoodWidget(container, dateStr, { onSaved, editable = true } = {}) {
  const existing = await getMoodLog(dateStr);
  const currentEmoji = existing ? existing.emoji : null;
  const currentNote = existing ? existing.note : '';
  const isPreset = MOOD_PRESETS.some(p => p.emoji === currentEmoji);

  container.innerHTML = `
    <div class="mood-emoji-row">
      ${MOOD_PRESETS.map(p => `
        <button class="mood-emoji-btn ${currentEmoji === p.emoji ? 'active' : ''}" data-emoji="${p.emoji}" aria-label="${p.label}" ${editable ? '' : 'disabled'}>${p.emoji}</button>
      `).join('')}
      <button class="mood-emoji-btn mood-emoji-custom ${currentEmoji && !isPreset ? 'active' : ''}" data-action="custom" ${editable ? '' : 'disabled'}>${currentEmoji && !isPreset ? currentEmoji : '+'}</button>
    </div>
    ${editable
      ? `<textarea class="mood-note-input" id="mood-note-${dateStr}" placeholder="اكتبي عن يومك (اختياري)">${escapeHtml(currentNote)}</textarea>`
      : (currentNote ? `<p class="mood-note-readonly">${escapeHtml(currentNote)}</p>` : '')}
  `;

  if (!editable) return;

  const noteEl = container.querySelector(`#mood-note-${dateStr}`);

  container.querySelectorAll('.mood-emoji-btn[data-emoji]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const note = noteEl?.value ?? '';
      if (btn.dataset.emoji === currentEmoji) await clearMood(dateStr);
      else await setMood(dateStr, btn.dataset.emoji, note);
      await renderMoodWidget(container, dateStr, { onSaved, editable });
      if (onSaved) onSaved();
    });
  });

  container.querySelector('[data-action="custom"]').addEventListener('click', async () => {
    const input = prompt('اكتبي إيموجي مخصص:');
    if (!input) return;
    const note = noteEl?.value ?? '';
    await setMood(dateStr, input.trim(), note);
    await renderMoodWidget(container, dateStr, { onSaved, editable });
    if (onSaved) onSaved();
  });

  if (noteEl) noteEl.addEventListener('blur', async () => {
    const current = await getMoodLog(dateStr);
    if (!current) return; // no emoji chosen yet — nothing to attach a note to
    await setMood(dateStr, current.emoji, noteEl.value);
  });
}

// ---------- Day Detail provider ----------
// Unlike other providers, this always returns a section (any day can get
// a mood note added retroactively) rather than only when data exists —
// so Day Detail always has at least one thing to show.

async function moodDayProvider(dateStr) {
  const node = document.createElement('div');
  await renderMoodWidget(node, dateStr, { editable: !isFutureDate(dateStr) });
  return { title: 'المزاج', node };
}

// ---------- Mood History (pattern browsing) ----------
// She wanted to open a mood, see which days were happy, and see what
// else was true that day. Day Detail already answers "what else was
// true that day" — this page just needs to link into it.

async function renderMoodHistoryPage(params, view) {
  view.innerHTML = `
    <div class="page-header">
      <button class="icon-btn" id="mood-history-back">→</button>
      <h1>سجل المزاج</h1>
    </div>
    <div class="card">
      <div class="mood-filter-row" id="mood-filter-row"></div>
      <div id="mood-history-list"></div>
    </div>
  `;
  document.getElementById('mood-history-back').addEventListener('click', () => history.back());

  const all = await db.moodLogs.toArray();
  all.sort((a, b) => b.date.localeCompare(a.date)); // YYYY-MM-DD sorts correctly as plain strings
  const distinctEmojis = [...new Set(all.map(l => l.emoji))];
  let activeFilter = null;

  function renderList() {
    const filtered = activeFilter ? all.filter(l => l.emoji === activeFilter) : all;
    const listEl = document.getElementById('mood-history-list');
    if (filtered.length === 0) {
      listEl.innerHTML = `<div class="empty-state"><p>ما في تسجيلات مزاج بعد.</p></div>`;
      return;
    }
    listEl.innerHTML = filtered.map(l => `
      <button class="mood-history-row" data-date="${l.date}">
        <span class="mood-history-emoji">${l.emoji}</span>
        <span class="mood-history-date">${formatDateArabic(l.date, { weekday: false })}</span>
        ${l.note ? `<span class="mood-history-note">${escapeHtml(l.note)}</span>` : ''}
      </button>`).join('');
    listEl.querySelectorAll('.mood-history-row').forEach(row => {
      row.addEventListener('click', () => openDayDetail(row.dataset.date));
    });
  }

  function renderFilters() {
    const row = document.getElementById('mood-filter-row');
    row.innerHTML = `
      <button class="chip ${!activeFilter ? 'active' : ''}" data-filter="">الكل</button>
      ${distinctEmojis.map(e => `<button class="chip ${activeFilter === e ? 'active' : ''}" data-filter="${e}">${e}</button>`).join('')}
    `;
    row.querySelectorAll('.chip').forEach(chip => {
      chip.addEventListener('click', () => {
        activeFilter = chip.dataset.filter || null;
        renderFilters();
        renderList();
      });
    });
  }

  renderFilters();
  renderList();
}

// ---------- Yearly stats provider ----------

async function moodYearlyProvider(year) {
  const all = await db.moodLogs.toArray();
  const prefix = String(year);
  const yearLogs = all.filter(l => l.date.startsWith(prefix));
  if (yearLogs.length === 0) return null;
  const counts = {};
  yearLogs.forEach(l => { counts[l.emoji] = (counts[l.emoji] || 0) + 1; });
  const rows = Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .map(([emoji, n]) => `<div class="yearly-row"><span>${emoji}</span><span>${n} يوم</span></div>`)
    .join('');
  return { title: 'المزاج', html: rows, count: yearLogs.length };
}
