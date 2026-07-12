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

// What actually drove the mood. Logging "sad" tells you nothing six months
// later; "sad · لم أنم · ضغط عمل" is something you can learn from. All
// optional — the fast path is still one tap on an emoji and done.
const MOOD_TAGS = [
  { key: 'sleep', emoji: '😴', label: 'النوم' },
  { key: 'work', emoji: '💼', label: 'العمل' },
  { key: 'family', emoji: '👨‍👩‍👧', label: 'العائلة' },
  { key: 'health', emoji: '🤒', label: 'صحتي' },
  { key: 'period', emoji: '🌸', label: 'الدورة' },
  { key: 'social', emoji: '🫂', label: 'الناس' },
  { key: 'money', emoji: '💰', label: 'المال' },
  { key: 'worship', emoji: '🤲', label: 'روحانيتي' },
  { key: 'weather', emoji: '🌧️', label: 'الجو' },
  { key: 'self', emoji: '🪞', label: 'نفسي' }
];
const MOOD_INTENSITY_LABELS = ['خفيف', 'واضح', 'قوي', 'شديد', 'طاغٍ'];

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
async function setMood(date, emoji, note, extra = {}) {
  const existing = await getMoodLog(date);
  const fields = {
    emoji,
    note: note || '',
    // Preserve what's already there when a caller doesn't pass it —
    // otherwise picking a new emoji would silently wipe her tags.
    tags: extra.tags ?? existing?.tags ?? [],
    intensity: extra.intensity ?? existing?.intensity ?? 3
  };
  if (existing) await db.moodLogs.update(existing.id, fields);
  else await db.moodLogs.add({ date, ...fields, createdAt: Date.now() });
}
async function clearMood(date) {
  await db.moodLogs.where('date').equals(date).delete();
}

async function renderMoodWidget(container, dateStr, { onSaved, editable = true } = {}) {
  if (!container) return;
  const existing = await getMoodLog(dateStr);
  const currentEmoji = existing ? existing.emoji : null;
  const currentNote = existing ? existing.note : '';
  const currentTags = existing?.tags || [];
  const currentIntensity = existing?.intensity ?? 3;
  const isPreset = MOOD_PRESETS.some(p => p.emoji === currentEmoji);
  const hasMood = !!currentEmoji;

  container.innerHTML = `
    <div class="mood-emoji-row">
      ${MOOD_PRESETS.map(p => `
        <button class="mood-emoji-btn ${currentEmoji === p.emoji ? 'active' : ''}" data-emoji="${p.emoji}" aria-label="${p.label}" ${editable ? '' : 'disabled'}>
          <span class="mood-emoji-face">${p.emoji}</span>
          <span class="mood-emoji-label">${p.label}</span>
        </button>
      `).join('')}
      <button class="mood-emoji-btn mood-emoji-custom ${currentEmoji && !isPreset ? 'active' : ''}" data-action="custom" ${editable ? '' : 'disabled'}>
        <span class="mood-emoji-face">${currentEmoji && !isPreset ? currentEmoji : '＋'}</span>
        <span class="mood-emoji-label">غير ذلك</span>
      </button>
    </div>

    ${(editable && hasMood) ? `
      <div class="mood-detail">
        <div class="mood-intensity-row">
          <label class="field-label">الشدّة: <span class="mood-intensity-label" id="mood-int-label-${dateStr}">${MOOD_INTENSITY_LABELS[currentIntensity - 1]}</span></label>
          <input type="range" class="mood-intensity" id="mood-int-${dateStr}" min="1" max="5" value="${currentIntensity}">
        </div>

        <label class="field-label">ما الذي أثّر فيه؟ (اختياري)</label>
        <div class="mood-tag-row">
          ${MOOD_TAGS.map(t => `
            <button class="mood-tag ${currentTags.includes(t.key) ? 'active' : ''}" data-tag="${t.key}">
              ${t.emoji} ${t.label}
            </button>`).join('')}
        </div>
      </div>` : ''}

    ${editable
      ? `<textarea class="mood-note-input" id="mood-note-${dateStr}" placeholder="${hasMood ? 'اكتبي عن يومك (اختياري)' : 'اختاري شعوراً أولاً'}">${escapeHtml(currentNote)}</textarea>`
      : `${currentTags.length ? `<div class="mood-tag-row mood-tag-readonly">${currentTags.map(k => {
            const t = MOOD_TAGS.find(x => x.key === k);
            return t ? `<span class="mood-tag">${t.emoji} ${t.label}</span>` : '';
          }).join('')}</div>` : ''}
        ${currentNote ? `<p class="mood-note-readonly">${escapeHtml(currentNote)}</p>` : ''}`}
  `;

  if (!editable) return;

  const noteEl = container.querySelector(`#mood-note-${dateStr}`);

  // Saving keeps every field the record already had — picking a new emoji
  // must not silently wipe the tags and intensity she just set.
  async function save(emoji, patch = {}) {
    const cur = await getMoodLog(dateStr);
    await setMood(dateStr, emoji, patch.note ?? (noteEl?.value ?? cur?.note ?? ''), {
      tags: patch.tags ?? cur?.tags ?? [],
      intensity: patch.intensity ?? cur?.intensity ?? 3
    });
  }

  container.querySelectorAll('.mood-emoji-btn[data-emoji]').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (btn.dataset.emoji === currentEmoji) await clearMood(dateStr);
      else await save(btn.dataset.emoji);
      if (navigator.vibrate) navigator.vibrate(12);
      await renderMoodWidget(container, dateStr, { onSaved, editable });
      if (onSaved) onSaved();
    });
  });

  container.querySelector('[data-action="custom"]').addEventListener('click', async () => {
    const input = prompt('اكتبي إيموجي مخصص:');
    if (!input) return;
    await save(input.trim());
    await renderMoodWidget(container, dateStr, { onSaved, editable });
    if (onSaved) onSaved();
  });

  const intEl = container.querySelector(`#mood-int-${dateStr}`);
  if (intEl) {
    const label = container.querySelector(`#mood-int-label-${dateStr}`);
    intEl.addEventListener('input', () => { label.textContent = MOOD_INTENSITY_LABELS[Number(intEl.value) - 1]; });
    intEl.addEventListener('change', async () => {
      await save(currentEmoji, { intensity: Number(intEl.value) });
      if (onSaved) onSaved();
    });
  }

  container.querySelectorAll('.mood-tag[data-tag]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const cur = await getMoodLog(dateStr);
      const tags = new Set(cur?.tags || []);
      const k = btn.dataset.tag;
      if (tags.has(k)) tags.delete(k); else tags.add(k);
      btn.classList.toggle('active');
      await save(currentEmoji, { tags: [...tags] });
      if (onSaved) onSaved();
    });
  });

  if (noteEl) noteEl.addEventListener('blur', async () => {
    const current = await getMoodLog(dateStr);
    if (!current) return; // no emoji chosen yet — nothing to attach a note to
    await save(current.emoji, { note: noteEl.value });
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
      <button class="icon-btn" aria-label="رجوع" id="mood-history-back">→</button>
      <h1>المزاج</h1>
    </div>
    <div class="card">
      <h2 class="card-title">كيف تشعرين اليوم؟</h2>
      <div id="mood-today-widget"></div>
    </div>
    <div class="card" id="mood-insight-card"></div>
    <div class="card">
      <h2 class="card-title">السجل</h2>
      <div class="mood-filter-row" id="mood-filter-row"></div>
      <div id="mood-history-list"></div>
    </div>
  `;
  document.getElementById('mood-history-back').addEventListener('click', () => history.back());

  async function refreshPage() {
    await renderMoodWidget(document.getElementById('mood-today-widget'), todayStr(), {
      editable: true,
      onSaved: () => renderInsight()
    });
    await renderInsight();
  }

  // What the log is actually FOR. A list of past emoji is a diary of
  // feelings; the pattern underneath is the part you can act on.
  async function renderInsight() {
    const el = document.getElementById('mood-insight-card');
    if (!el) return;
    const logs = await db.moodLogs.toArray();
    if (logs.length < 5) {
      el.style.display = 'none';
      return;
    }
    el.style.display = '';
    const last30 = logs.filter(l => l.date >= addDays(todayStr(), -29));
    const heavy = last30.filter(l => ['😢', '😣', '🌑'].includes(l.emoji));
    const good = last30.filter(l => ['😊'].includes(l.emoji));

    const heavyTags = {};
    heavy.forEach(l => (l.tags || []).forEach(t => { heavyTags[t] = (heavyTags[t] || 0) + 1; }));
    const top = Object.entries(heavyTags).sort((a, b) => b[1] - a[1])[0];
    const tag = top ? MOOD_TAGS.find(x => x.key === top[0]) : null;

    const streak = computeCurrentStreak(logs.map(l => l.date), []);

    el.innerHTML = `
      <h2 class="card-title">📊 آخر ٣٠ يوماً</h2>
      <div class="diary-stat-row">
        <div class="diary-stat">
          <span class="diary-stat-num">${toArabicNumeral(last30.length)}</span>
          <span class="diary-stat-label">يوم سجّلتِ</span>
        </div>
        <div class="diary-stat">
          <span class="diary-stat-num">😊 ${toArabicNumeral(good.length)}</span>
          <span class="diary-stat-label">أيام جميلة</span>
        </div>
        <div class="diary-stat">
          <span class="diary-stat-num">🌑 ${toArabicNumeral(heavy.length)}</span>
          <span class="diary-stat-label">أيام ثقيلة</span>
        </div>
        <div class="diary-stat">
          <span class="diary-stat-num">${streak > 0 ? '🔥' + toArabicNumeral(streak) : '—'}</span>
          <span class="diary-stat-label">تتابع</span>
        </div>
      </div>
      ${tag && top[1] >= 2 ? `
        <p class="mood-insight-line">
          🔎 في أيامك الثقيلة، أكثر ما تكرّر: <strong>${tag.emoji} ${tag.label}</strong>
          (${toArabicNumeral(top[1])} من ${toArabicNumeral(heavy.length)})
        </p>` : ''}`;
  }
  await refreshPage();

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
    .map(([emoji, n]) => `<div class="yearly-row"><span>${emoji}</span><span>${toArabicNumeral(n)} يوم</span></div>`)
    .join('');

  // WHY, not just what. A list of emoji counts tells you what you felt;
  // the tags tell you what kept driving it, and that's the only part
  // you can actually do something about.
  const tagCounts = {};
  yearLogs.forEach(l => (l.tags || []).forEach(t => { tagCounts[t] = (tagCounts[t] || 0) + 1; }));
  const tagRows = Object.entries(tagCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([k, n]) => {
      const t = MOOD_TAGS.find(x => x.key === k);
      return t ? `<div class="yearly-row"><span>${t.emoji} ${t.label}</span><span>${toArabicNumeral(n)} مرة</span></div>` : '';
    }).join('');

  // Which factor shows up most on the heavy days specifically — a
  // different question from which shows up most overall.
  const heavy = yearLogs.filter(l => ['😢', '😣', '🌑'].includes(l.emoji));
  const heavyTags = {};
  heavy.forEach(l => (l.tags || []).forEach(t => { heavyTags[t] = (heavyTags[t] || 0) + 1; }));
  const topHeavy = Object.entries(heavyTags).sort((a, b) => b[1] - a[1])[0];
  const heavyTag = topHeavy ? MOOD_TAGS.find(x => x.key === topHeavy[0]) : null;

  const withIntensity = yearLogs.filter(l => typeof l.intensity === 'number');
  const avgIntensity = withIntensity.length
    ? (withIntensity.reduce((s, l) => s + l.intensity, 0) / withIntensity.length)
    : null;

  const html = `
    <div class="yearly-row"><span>أيام سجّلتِ مزاجك</span><span>${toArabicNumeral(yearLogs.length)} يوم</span></div>
    ${avgIntensity ? `<div class="yearly-row"><span>متوسط الشدّة</span><span>${MOOD_INTENSITY_LABELS[Math.round(avgIntensity) - 1]}</span></div>` : ''}
    ${heavyTag ? `<div class="yearly-row"><span>الأكثر حضوراً في أيامك الثقيلة</span><span>${heavyTag.emoji} ${heavyTag.label}</span></div>` : ''}
    ${rows}
    ${tagRows ? `
      <details class="yearly-pain-details">
        <summary>ما الذي أثّر في مزاجك</summary>
        ${tagRows}
      </details>` : ''}
  `;
  return { title: 'المزاج', html, count: yearLogs.length };
}
