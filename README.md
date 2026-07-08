# رحلتي — Phases 1-5 (complete)

Fully local PWA. No server, no accounts, no sync. Data lives in IndexedDB
on whichever device it's opened on.

## Deploy (any one of these, all free)
1. **Netlify**: drag the whole `rahlati` folder onto app.netlify.com/drop
2. **Vercel**: `vercel` CLI in this folder, or drag-drop via the dashboard
3. **GitHub Pages**: push this folder to a repo, enable Pages on it

Must be served over HTTPS (or localhost) — service worker and install-to-
home-screen won't work over a plain `file://` open.

## Test locally before deploying
```
python3 -m http.server 8000
```
then open `http://localhost:8000` on the same computer.

## What's in Phase 1
- Local DB (Dexie/IndexedDB), fully offline after first load
- Calendar (month view + tap-a-day detail sheet)
- Habits: ❤️ done / 💔 missed / ↩️ undo, with streaks
- Fixed daily tasks (recurring checklist + reminder time)
- Custom to-dos (one-off, optional due date)
- Profile + rotating welcome message + optional PIN lock
- Backup/restore to a single .zip (Settings page)

## What's in Phase 2 (Worship)
- Fard (5 daily prayers): same ❤️/💔/↩️ + streak as Habits, reused via
  `js/ui-shared.js` — one component, two features
- 🌸 pause button: stop the fard streak during her period, resume after
  without losing it (`streakPauses`, `streakType: 'fard'`)
- Sunnah rawatib + adhkar-after-prayer (simple per-prayer checkboxes)
- Morning/evening adhkar
- Custom adhkar: name once, tap +1 or type an exact count per day
- Worship overview ring on the Worship page + a live stat on Home's
  quick-action card

## What's in Phase 3 (Mood + Period)
- One `moodLogs` table — 5 preset emojis + a custom one, optional note.
  Reused by Period now; Body+Mood (Phase 5) reuses the same table and
  widget rather than getting its own
- Mood History: filter by emoji, tap a day to reopen Day Detail — reuses
  the existing sheet instead of building a second detail view
- Period tracker: episodes (start/end), median-based prediction (not
  mean — resists one outlier cycle skewing the estimate), a range-shaded
  calendar, editable history list
- Starting/ending a period auto-triggers Worship's fard pause (both call
  the same idempotent `startFardPause`/`endFardPause` the manual 🌸
  button uses) — no need to tell the app the same thing twice
- Calendar dots on Home now come from a registry every phase feeds
  (`registerActivityProvider`) instead of a hardcoded table list —
  Worship's data was missing from the dots entirely before this fix

## What's in Phase 4 (Food)
- Photo is optional per meal (camera can fail, or she's out and doesn't
  want to stop and shoot it) — not forced just because it was listed first
- 5 meal types she specified: فطور، غداء، سناك، عشاء، تحلية صحية
- Photos compressed to 1200px/JPEG80 before storage (profile picture
  stays smaller — 256px — since it's only ever a small avatar)
- Daily calorie total is derived from that day's entries, never stored
  as its own field
- Backup: photos can't go in JSON, so each is written as its own file
  in the zip (`photos/food-{id}.jpg`) and the JSON just records which
  food entries have one — same zip, no second export mechanism

## What's in Phase 5 (Body + Goals)
- Weight log + a hand-rolled SVG line chart (no charting library —
  consistent with the ring/calendar, and one less dependency)
- BMI shown as a factual reference range with its limits stated, not a
  target — her own optional target weight is a separate number she sets
- Body measurements: flexible, she names her own (same "define once, log
  values over time" shape as custom adhkar)
- Goals: current/target/unit stored, progress always derived — never a
  stored percentage. Goals without a clean number just get a checkbox
- Mood widget is the exact same component from Phase 3, not rebuilt

## Also added this round
- **Water**: lives inside `food.js` (intake tracking, not its own
  top-level feature) — tap +0.25L or set an exact amount, adjustable
  daily target
- **Habits split into good/bad**: a "bad" habit (one she's quitting)
  flips what ❤️/💔 mean — ❤️ = abstained, 💔 = slipped — using the same
  `threeStateRowHtml` component with just different button labels.
  Existing habits with no `type` field default to 'good'
- **Yearly Overview**: a third registry (`registerYearlyStatsProvider`),
  same pattern as day providers and activity dots — every feature
  contributes its own card. Reachable from a button at the bottom of Home

## Bug fixes + additions after first real-world use
Three real bugs, found from actual usage, not just review:
- `waterLogs` was used throughout the app but never declared in the
  schema — an undeclared Dexie table throws on access, which broke the
  Food page, Yearly Overview, AND Home's calendar all at once (each hit
  it inside an unguarded `Promise.all`). Fixed, and all three registries
  (day/activity/yearly providers) now use `Promise.allSettled` so one
  broken provider can never take down an unrelated page again.
- Setup wizard step 2's buttons passed `step3` directly to
  `addEventListener`, so the click event itself became step3's
  `mismatchError` argument — truthy, so it always rendered, showing
  literal "[object PointerEvent]" text on the PIN screen every time.
  Fixed by wrapping in arrow functions.
- Age/sex/height moved to Settings (was inline on the Weight page).
- Small secondary buttons (edit height, save target) and the back arrow
  unified to one lighter `.link-btn`/`.icon-btn` style instead of mixed
  heavier button chrome.
- Sunnah, adhkar-after-prayer, daily adhkar, and custom adhkar all show
  streak/succeeded/failed now, not just fard. Fard, Habits (good/bad),
  and custom adhkar show it per-item; sunnah/adhkar-after/daily-adhkar
  show it as one aggregate line per section (too cramped per-chip).
- Goals: added a percentage-slider type alongside numeric and checkbox.
  Home's Goals card now shows a done/in-progress/not-started breakdown,
  not just a count.
- Bottom nav bar: 7 shortcuts, toggleable and choosable from Settings.

## File map
- `index.html` — shell, loads every script in dependency order
- `js/db.js` — schema + date helpers (read this first)
- `js/streaks.js` — the one streak engine, reused by every phase
- `js/calendar.js` — the day-provider registry every future phase plugs into
- `js/habits.js`, `js/tasks.js` — feature modules
- `js/profile.js` — setup wizard, PIN, settings page
- `js/backup.js` — export/import
- `js/app.js` — boots everything, renders Home
- `sw.js` — offline cache (bump `CACHE_NAME` if you add/rename files later)

## Adding new features from here
All 5 planned phases are in. For anything new: new tables go in a new
`db.version(6).stores({...})` block in `db.js` — never edit an existing
version block once real data exists. New Day Detail sections: a
`xDayProvider(dateStr)` returning `{title, node}` or `null`, registered
with `registerDayProvider`. New calendar dots: `registerActivityProvider`.
New yearly cards: `registerYearlyStatsProvider`. Nothing else needs to
change.
