// db.js — رحلتي's local database (IndexedDB, via Dexie)
//
// Everything here lives on this one device only. There is no server and
// nothing is ever uploaded. The only way data leaves the device is the
// Backup export the person triggers themselves (see backup.js).
//
// ── Design rules we're keeping consistent across every phase ──────────
// 1. Every log-style entry carries an explicit `date` string ('YYYY-MM-DD').
//    This is the day the entry is FOR, chosen by the person — NOT the same
//    thing as when the row was written. Keeping these separate is what
//    makes backdated / corrected entries (editing yesterday from the
//    calendar) work safely. `date` is what everything queries by.
// 2. We index only what we actually need to look up by (a compound
//    [foreignId+date] key for upserts, or a plain foreign key for
//    "all logs for this habit"). Booleans and nullable fields are
//    deliberately left un-indexed — IndexedDB doesn't reliably index
//    boolean or null values, and at personal-habit-tracker scale
//    (dozens of rows, not thousands), filtering in JS after `.toArray()`
//    is simpler and just as fast.
// 3. A 3rd "unmarked" state, where relevant, is represented by the
//    ABSENCE of a row — not a boolean column. Only where a real 3rd
//    state exists in the feature (Habits: done/missed/unmarked). Fixed
//    Tasks are a genuine 2-state checkbox, so they stay 2-state.
// 4. Schema policy: once a table might hold real data, its existing
//    fields are never renamed or restructured — only new tables or new
//    optional fields get added in later db.version(N) blocks. This is
//    the same reason the backup file carries its own `version` number.

const db = new Dexie('rahlati');

// Shown at the bottom of Settings. Bumped on every shipped change so a
// stale-deployment or stuck-service-worker problem is instantly visible
// (if Settings shows an old version number, the new files never actually
// reached the phone, or the service worker hasn't picked them up yet —
// that's a deploy/cache problem, not a code problem).
const APP_VERSION = 'v56 · ١٧ يوليو ٢٠٢٦';

db.version(1).stores({
  // Singleton row (id always 1) — who she is.
  profile: 'id',

  // Singleton row (id always 1) — app preferences, kept separate from
  // `profile` on purpose so this doesn't get scattered as more prefs
  // (theme, backup reminders, etc.) show up in later phases.
  settings: 'id',

  // Habits: long-term tracked behaviors with streaks + relapse.
  habits: '++id',
  habitLogs: '++id, &[habitId+date], habitId',

  // Fixed daily tasks: a recurring checklist, reset each day.
  fixedTasks: '++id',
  fixedTaskLogs: '++id, &[taskId+date], taskId',

  // One-off custom to-dos.
  customTodos: '++id',

  // Generic pause ranges for any streak-based feature. Habits don't use
  // this in Phase 1 (not asked for) — this exists now so Worship's
  // period-pause button in Phase 2 has a home without a schema change.
  streakPauses: '++id, streakType'
});

// ---------- Phase 2 (Worship) — new tables only, v1 untouched ----------
db.version(2).stores({
  // Fard (the 5 daily prayers): same 3-state shape as habitLogs
  // (done/missed/unmarked-by-absence) — normalized as {date, prayerName,
  // status} instead of 5 boolean columns, so this reuses the exact same
  // streak engine and row component as Habits.
  prayerLogs: '++id, &[prayerName+date], prayerName',

  // Sunnah rawatib and adhkar-after-prayer: genuine 2-state checkboxes
  // (no "missed" button exists for these), same reasoning as Fixed
  // Tasks in Phase 1 — presence of a row = done.
  sunnahLogs: '++id, &[prayerName+date], prayerName',
  adhkarAfterLogs: '++id, &[prayerName+date], prayerName',

  // Morning/evening adhkar — same 2-state shape, keyed by kind instead
  // of prayerName.
  dailyAdhkarLogs: '++id, &[kind+date], kind',

  // Custom adhkar: a name defined once, a numeric count logged per day.
  customAdhkar: '++id',
  customAdhkarLogs: '++id, &[adhkarId+date], adhkarId'
});

const PRAYER_NAMES = ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha'];
const PRAYER_LABELS = { fajr: 'الفجر', dhuhr: 'الظهر', asr: 'العصر', maghrib: 'المغرب', isha: 'العشاء' };

// ---------- Phase 3 (Mood + Period) — new tables only ----------
db.version(3).stores({
  // One row per day, shared by the Period page now and Body+Mood later —
  // same table, same "same element reflects on the main calendar" she
  // asked for. Not a [foreignKey+date] shape since there's no foreign
  // key here, just `date` itself, so this gets its own small get/set
  // instead of the generic upsertLog helper.
  moodLogs: '++id, &date',

  // Period "episodes", not a per-day log — a handful of rows total
  // (roughly one per cycle), each {startDate, endDate|null}. No index
  // beyond the primary key; the table stays small enough to just
  // .toArray() and work with in JS.
  periodLogs: '++id'
});

// ---------- Phase 4 (Food) — new tables only ----------
db.version(4).stores({
  foodLogs: '++id',
  // Strict 1:1 with foodLogs (one photo per meal, or none) — the
  // photo's key IS the foodLogId, no separate auto-id needed.
  foodPhotos: 'foodLogId'
});

const MEAL_TYPES = [
  { key: 'breakfast', label: 'فطور', icon: '🍳' },
  { key: 'lunch', label: 'غداء', icon: '🍛' },
  { key: 'snack', label: 'سناك', icon: '🍿' },
  { key: 'dinner', label: 'عشاء', icon: '🍽️' },
  { key: 'dessert', label: 'تحلية صحية', icon: '🍓' }
];
function mealTypeLabel(key) { return MEAL_TYPES.find(m => m.key === key)?.label || key; }
function mealTypeIcon(key) { return MEAL_TYPES.find(m => m.key === key)?.icon || '🍽️'; }

// Bottom nav — shared between app.js (renders it) and profile.js
// (renders the Settings checklist that controls which items show).
const BOTTOM_BAR_ITEMS = [
  { key: 'home', label: 'الرئيسية', icon: '🏠', path: '/home' },
  { key: 'food', label: 'الطعام', icon: '🍽️', path: '/food' },
  { key: 'body', label: 'الصحة', icon: '⚖️', path: '/body' },
  { key: 'worship', label: 'العبادة', icon: '🕌', path: '/worship' },
  { key: 'habits', label: 'العادات', icon: '🌱', path: '/habits' },
  { key: 'period', label: 'الدورة', icon: '🌙', path: '/period' },
  { key: 'goals', label: 'الأهداف', icon: '🎯', path: '/goals' },
  { key: 'diary', label: 'يومياتي', icon: '📔', path: '/diary' },
  { key: 'economy', label: 'الاقتصاد', icon: '💰', path: '/economy' },
  { key: 'study', label: 'التعلم', icon: '🎓', path: '/study' }
];

// ---------- Phase 5 (Body + Goals) — new tables only ----------
// heightCm / targetWeightKg live as plain fields on the existing
// `settings` row — Dexie only needs a version bump for new tables or
// new INDEXES, not for arbitrary extra properties on an object, so no
// version(6) is needed just for those two fields.
db.version(5).stores({
  weightLogs: '++id, &date',
  bodyMeasurements: '++id',
  bodyMeasurementLogs: '++id, &[measurementId+date], measurementId',
  // current/target/unit, never a stored percentage — same rule as
  // everywhere else that shows progress.
  goals: '++id',
  // Was referenced throughout food.js/app.js/backup.js but never
  // actually declared here — an undeclared Dexie table throws on
  // access, which broke three unrelated-looking things at once because
  // each one hit it inside an unguarded Promise.all().
  waterLogs: '++id, &date'
});

// ---------- Phase 6 (Diary) — new tables only ----------
db.version(6).stores({
  diaryEntries: '++id, &date',
  // Strict 1:1 with diaryEntries, same pattern as foodPhotos.
  diaryPhotos: 'entryId'
});

// ---------- Phase 7 (Economy) — new tables only ----------
// Balance is never stored directly — it's always the sum of
// economyTransactions, same "derive, don't store" rule as everywhere
// else (habit streaks, goal progress, food calorie totals). Setting
// "the balance" to a number just adds a reconciliation transaction for
// the difference, so the history always explains itself.
db.version(7).stores({
  economyTransactions: '++id',
  shoppingLists: '++id',
  shoppingListItems: '++id, listId',
  edibles: '++id',
  ediblePhotos: 'edibleId',
  edibleWishlist: '++id',
  edibleWishlistPhotos: 'wishlistId',
  things: '++id',
  thingPhotos: 'thingId',
  thingsWishlist: '++id',
  thingsWishlistPhotos: 'wishlistId'
});

// ---------- Phase 8 (Recipe book) — new tables only ----------
db.version(8).stores({
  recipes: '++id',
  recipePhotos: 'recipeId'
});

// ---------- Phase 9 (Training) — new tables only ----------
// Same shape as custom adhkar: a numeric per-day log, presence = done,
// so it reuses computeImplicitStats for streak/succeeded/failed without
// inventing a new pattern.
db.version(9).stores({
  exercises: '++id',
  exercisePhotos: 'exerciseId',
  exerciseLogs: '++id, &[exerciseId+date], exerciseId'
});

// ---------- Phase 10 — standalone sunnah prayers (not tied to a fard) ----------
// Deliberately a separate table from dailyAdhkarLogs — Duha is a SALAH
// (prayer), not adhkar (remembrance/recitation), and conflating them
// would misrepresent both even though the storage shape is identical.
// Also separate from sunnahLogs, which is specifically sunnah rawatib
// paired with one of the 5 fard prayers — Duha stands on its own.
// 'kind' starts with just 'duha' but leaves room for Witr, Tahajjud, etc.
db.version(10).stores({
  standaloneSunnahLogs: '++id, &[kind+date], kind'
});

// ---------- Phase 11 — Wird (daily Quran reading plan) ----------
// One active plan at a time (id fixed at 1), not a list — she asked for
// "a daily wird" (singular). The plan row holds ONLY the plan itself
// (dailyAmount + unit). Progress and khatm count are NOT stored: they
// are derived from wirdLogs, which records both pagesAdded and whether
// that specific day's completion triggered a khatm — enough to replay
// the whole history exactly, including cycles that wrapped past zero.
// (An earlier version cached progressPages/khatmCount on the plan and
// mutated them on each log/undo; that cache could drift out of sync
// with the very log that's supposed to explain it, so it's gone. Same
// "don't store what you can compute" rule as the balance and streaks.)
db.version(11).stores({
  wirdSettings: '++id',
  wirdLogs: '++id, &date'
});

// ---------- Phase 12 — التعلم (Study/Learning) ----------
// Pomodoro's work/break minutes live as plain fields on the existing
// settings row, not a new table — it's just two numbers, no version
// bump needed for that part.
db.version(12).stores({
  courses: '++id',
  courseTodos: '++id, courseId',
  courseMaterials: '++id, courseId',
  courseMaterialPhotos: 'materialId'
});

// ---------- Phase 13 — morning/evening adhkar as a real reading list ----------
// dailyAdhkarLogs (done/not per kind+date) already existed and stays
// exactly as-is — this just adds the actual TEXT entries she reads
// through, so "mark as done" means something (she's tapping it after
// actually reading her list, from a dedicated page, not blind).
db.version(13).stores({
  dailyAdhkarItems: '++id, kind'
});

// ---------- Phase 14 — النوم (sleep tracking) ----------
// 'date' is the night the session STARTED on — "how did I sleep last
// night" naturally means the night that began yesterday evening, which
// is how every mainstream sleep tracker attributes a session, so Day
// Detail/Yearly Overview line up with how she'd actually think about it.
db.version(14).stores({
  sleepLogs: '++id, date',
  sleepDreamPhotos: 'sleepLogId'
});

// ---------- Phase 15 — القضاء (makeup prayers + fasting) ----------
// Standing counters, not daily logs — a "remaining" count that only
// ever decreases as she catches up, the opposite direction from custom
// adhkar's count-up. No date indexing needed since these aren't
// attached to any specific day.
db.version(15).stores({
  qadaPrayers: '++id',
  qadaFasting: '++id'
});

// ---------- Phase 16 — habit events (زلة vs انتكاسة) ----------
// A real append-only event log, not a day-unique flag — she can log
// more than one mishap in a day and each counts, which the old
// one-status-per-day habitLogs row couldn't represent. Two event
// types share one table since they're the same shape, just filtered
// differently: 'mishap' (حدثت زلة / فاتني اليوم) only increments a
// counter; 'relapse' (انتكاسة) does that AND is what the live clock's
// reference point is now computed from — every event has a precise
// timestamp, so the clock no longer needs the old day-boundary
// approximation for "today" at all.
db.version(16).stores({
  habitEvents: '++id, habitId'
});

// ---------- Phase 17 — العناية اليومية (daily care routines) ----------
// Each routine item is its own thing to check off daily (and its own
// streak), grouped under 'morning' or 'evening' — a level more
// detailed than dailyAdhkarItems, which only tracks one combined
// done/not-done per time-of-day rather than per item.
db.version(17).stores({
  dailyCareRoutines: '++id, kind',
  dailyCareRoutinePhotos: 'routineId',
  dailyCareLogs: '++id, &[routineId+date], routineId'
});

// ---------- Phase 18 — period symptom readings ----------
// Individual timestamped readings (blood/pain/cramp each 0-10), NOT
// daily aggregates — so pain can be plotted point-by-point across a
// day to reveal time-of-day patterns, and daily averages / whole-
// period scores are always COMPUTED from these on the fly, never
// stored. `dateStr` for day grouping, `timestamp` for intra-day
// ordering and the scatter plot. periodId links a reading to the
// specific period it belongs to (nullable — a reading can be logged
// outside a tracked period, e.g. premenstrual cramps).
db.version(18).stores({
  periodReadings: '++id, dateStr, periodId'
});

// ---------- Phase 19 — per-item adhkar counters (مسبحة) ----------
// Each morning/evening dhikr item now gets its OWN daily count, so a
// dhikr with "repeat 33x" can actually be counted rather than just
// read-and-ticked. Same shape as customAdhkarLogs (one row per item per
// day, unique so a double-tap can't fork it into two rows).
//
// Everything else added this phase (trackedOnHome on fixed tasks,
// deleteWhenDone on todos, hiddenFromHome on habits, benefit/goalCount
// on adhkar) are plain unindexed fields on tables that already exist —
// Dexie stores those without needing a version bump, and every reader
// treats "missing" as the sensible default, so old rows keep working.
db.version(19).stores({
  dailyAdhkarItemLogs: '++id, &[itemId+date], itemId'
});

// ---------- Phase 20 — study sessions ----------
// The pomodoro used to run and then throw the result away: you could
// focus for three hours and the app would remember nothing. Each
// completed FOCUS phase is now logged (break phases aren't — they're
// not study), optionally attributed to a course, which is what makes
// focus totals, a study streak, per-course time, and the yearly view
// possible at all. Not day-unique: several sessions a day is the norm.
db.version(20).stores({
  studySessions: '++id, date, courseId'
});

// ---------- Phase 21 — chewing sessions (وضع المضغ) ----------
// Slow, deliberate eating: chew for N seconds, swallow, rest, repeat,
// until the meal's target duration is up. The point is that satiety
// signals take ~20 minutes to arrive, so a meal inhaled in five minutes
// is one you finish still hungry.
//
// Logged per meal (foodLogId, nullable — she might want to pace a meal
// she never bothered to log) so it's a habit she can SEE herself
// building, not a gimmick used once. Everything about how the session
// actually went — bites, seconds, whether she finished — is recorded;
// nothing about it is derived from settings that might change later.
db.version(21).stores({
  chewSessions: '++id, date, foodLogId'
});

// ---------- Phase 22 — custom reminders ----------
// The six built-in categories can't cover medication, an appointment, or
// manually-entered prayer times — which are exactly the things a reminder
// is FOR. `days` is an array of weekday numbers (0=Sunday), so a weekday-
// only reminder doesn't go off on a Saturday morning.
db.version(22).stores({
  customReminders: '++id'
});

// ---------- Phase 23 — economy accounts + categories ----------
// Accounts (مدخرات / راتب / مصروف …) are a real table: each transaction
// can now belong to one, so \"how much is in savings\" is answerable
// separately from \"how much do I have overall\". Balance per account is
// still DERIVED (sum of that account's transactions), same rule as the
// global balance — nothing caches a number that could drift from the
// history that explains it.
//
// `accountId`, `category` and `subcategory` on economyTransactions are
// plain optional fields (Dexie stores extra properties without a schema
// change) — every reader treats \"missing\" as the sensible default
// (no account / uncategorised), so every transaction made before this
// phase keeps working untouched.
//
// Macros (protein/carbs/fat) and mealWeightG on foodLogs, and dayGoal on
// habits, are the same kind of plain optional field added this phase for
// Diet mode and habit day-goals respectively — no version bump needed
// for those, only for the new accounts TABLE.
db.version(23).stores({
  economyAccounts: '++id'
});

// v55: daily-counter habits. One row per habit per day holds that day's
// tally (she taps +1 as she goes). Compound key [habitId+date] means the
// increment is a single get/put with no risk of duplicate rows. This is
// separate from habitEvents (mishap/relapse) and habitLogs (done/missed)
// because a counter is a different question — "how many times today",
// not "did I / did I slip".
db.version(24).stores({
  habitCounts: '[habitId+date], habitId, date'
});

// The spending taxonomy she asked for: a flat list of top-level
// categories, a few of which carry sub-categories. `null` sub means the
// category is used on its own. Kept as data (not hard-coded into the
// modal) so the yearly view, the day view and the picker all read the
// exact same source.
const ECONOMY_CATEGORIES = [
  { key: 'food',      label: 'طعام',        icon: '🍎', subs: [
    { key: 'snacks',  label: 'سناكات',   icon: '🍿' },
    { key: 'sweets',  label: 'حلويات',   icon: '🍰' },
    { key: 'meat',    label: 'لحوم',     icon: '🥩' },
    { key: 'veggies', label: 'خضار وفواكه', icon: '🥗' },
    { key: 'diet',    label: 'دايت',     icon: '🥑' },
    { key: 'drinks',  label: 'مشروبات',  icon: '🥤' },
    { key: 'dining',  label: 'مطاعم',    icon: '🍽️' },
    { key: 'grocery', label: 'بقالة',    icon: '🛒' }
  ] },
  { key: 'commute',   label: 'مواصلات',    icon: '🚌', subs: null },
  { key: 'health',    label: 'صحة',        icon: '💊', subs: [
    { key: 'meds',    label: 'أدوية',    icon: '💊' },
    { key: 'clinic',  label: 'عيادة',    icon: '🩺' },
    { key: 'supplements', label: 'مكمّلات', icon: '🌿' }
  ] },
  { key: 'skincare',  label: 'عناية بالبشرة', icon: '🧴', subs: null },
  { key: 'makeup',    label: 'مكياج',      icon: '💄', subs: null },
  { key: 'clothing',  label: 'ملابس',      icon: '👗', subs: [
    { key: 'clothes', label: 'ملابس',    icon: '👕' },
    { key: 'shoes',   label: 'أحذية',    icon: '👟' },
    { key: 'bags',    label: 'حقائب',    icon: '👜' },
    { key: 'accessories', label: 'إكسسوارات', icon: '💍' }
  ] },
  { key: 'tools',     label: 'أدوات',      icon: '🔧', subs: null },
  { key: 'home',      label: 'المنزل',     icon: '🏠', subs: null },
  { key: 'bills',     label: 'فواتير',     icon: '🧾', subs: null },
  { key: 'gifts',     label: 'هدايا',      icon: '🎁', subs: null },
  { key: 'fun',       label: 'ترفيه',      icon: '🎉', subs: null },
  { key: 'other',     label: 'أخرى',       icon: '📦', subs: null }
];

function economyCategory(key) { return ECONOMY_CATEGORIES.find(c => c.key === key) || null; }
function economyCategoryLabel(key) { const c = economyCategory(key); return c ? c.label : ''; }
function economyCategoryIcon(key) { const c = economyCategory(key); return c ? c.icon : '📦'; }
function economySubLabel(catKey, subKey) {
  const c = economyCategory(catKey);
  if (!c || !c.subs) return '';
  const s = c.subs.find(x => x.key === subKey);
  return s ? s.label : '';
}
function economySubIcon(catKey, subKey) {
  const c = economyCategory(catKey);
  if (!c || !c.subs) return '';
  const s = c.subs.find(x => x.key === subKey);
  return s ? s.icon : '';
}
// A single label for a transaction's category + optional sub, used
// everywhere a row is drawn.
function economyCategoryFullLabel(category, subcategory) {
  if (!category) return '';
  const catIcon = economyCategoryIcon(category);
  const catLabel = economyCategoryLabel(category);
  if (subcategory) {
    const subLabel = economySubLabel(category, subcategory);
    if (subLabel) return `${catIcon} ${catLabel} · ${subLabel}`;
  }
  return `${catIcon} ${catLabel}`;
}

// ---------- food composition tags (for the meal builder + diet mode) ----------
// What a meal is MADE OF, as multi-select tags across categories. Stored
// on foodLogs.foodTags as [{cat, sub, sweet?}] — sweet only applies to
// drinks. Diet mode treats each of these as a tag it can correlate with
// weight, so the taxonomy is intentionally about food *type* (which the
// body responds to) rather than dish names (which it doesn't).
const FOOD_TAG_CATEGORIES = [
  { key: 'flour', label: 'نشويات', icon: '🌾', subs: [
    { key: 'pasta', label: 'باستا', icon: '🍝' },
    { key: 'bread', label: 'خبز', icon: '🍞' },
    { key: 'pastry', label: 'معجنات', icon: '🥐' },
    { key: 'toast', label: 'توست', icon: '🍞' },
    { key: 'cereal', label: 'حبوب/رقائق', icon: '🥣' }
  ] },
  { key: 'protein', label: 'بروتين', icon: '🍗', subs: [
    { key: 'fish', label: 'سمك', icon: '🐟' },
    { key: 'redmeat', label: 'لحم أحمر', icon: '🥩' },
    { key: 'chicken', label: 'دجاج', icon: '🍗' },
    { key: 'eggs', label: 'بيض', icon: '🥚' },
    { key: 'dairy', label: 'أجبان/ألبان', icon: '🧀' }
  ] },
  { key: 'starch', label: 'نشا/كارب', icon: '🍚', subs: [
    { key: 'rice', label: 'رز', icon: '🍚' },
    { key: 'potato', label: 'بطاطا', icon: '🥔' },
    { key: 'legumes', label: 'بقوليات', icon: '🫘' },
    { key: 'corn', label: 'ذرة', icon: '🌽' }
  ] },
  { key: 'sugar', label: 'سكريات', icon: '🍭', subs: [
    { key: 'fruit', label: 'فواكه', icon: '🍎' },
    { key: 'dates', label: 'تمر', icon: '🌴' },
    { key: 'sweets', label: 'حلويات', icon: '🍰' },
    { key: 'chocolate', label: 'شوكولاتة', icon: '🍫' },
    { key: 'honey', label: 'عسل', icon: '🍯' }
  ] },
  { key: 'fiber', label: 'ألياف', icon: '🥬', subs: [
    { key: 'salad', label: 'سلطة', icon: '🥗' },
    { key: 'veggies', label: 'خضار', icon: '🥦' },
    { key: 'flaxseed', label: 'بذر كتّان', icon: '🌱' },
    { key: 'oats', label: 'شوفان', icon: '🌾' }
  ] },
  { key: 'dietfood', label: 'طعام دايت', icon: '🥑', subs: [
    { key: 'eggpudding', label: 'بودنغ البيض', icon: '🍮' },
    { key: 'dietcake', label: 'كيك دايت', icon: '🍰' },
    { key: 'flaxbread', label: 'خبز بذر الكتّان', icon: '🍞' },
    { key: 'other', label: 'أخرى', icon: '🥄' }
  ] },
  { key: 'drink', label: 'مشروبات', icon: '🥤', subs: [
    { key: 'water', label: 'ماء', icon: '💧' },
    { key: 'milk', label: 'حليب', icon: '🥛' },
    { key: 'coffee', label: 'قهوة', icon: '☕' },
    { key: 'coffeemilk', label: 'قهوة بحليب', icon: '☕' },
    { key: 'tea', label: 'شاي', icon: '🍵' },
    { key: 'dietsoda', label: 'صودا دايت', icon: '🥤' },
    { key: 'juice', label: 'عصير', icon: '🧃' }
  ] }
];
// Sweetness modifier for drinks only.
const DRINK_SWEET_OPTIONS = [
  { key: 'sugar', label: 'بسكر', icon: '🍬' },
  { key: 'none', label: 'بدون سكر', icon: '🚫' },
  { key: 'sweetener', label: 'محلّي', icon: '🧪' }
];
function foodTagCategory(key) { return FOOD_TAG_CATEGORIES.find(c => c.key === key) || null; }
function foodTagSub(catKey, subKey) {
  const cat = foodTagCategory(catKey);
  return cat?.subs?.find(s => s.key === subKey) || null;
}
function drinkSweetLabel(key) { return DRINK_SWEET_OPTIONS.find(o => o.key === key)?.label || ''; }
// One tag rendered as "🐟 سمك" (+ "· بسكر" for a sweetened drink).
function foodTagLabel(tag) {
  const cat = foodTagCategory(tag.cat);
  const sub = foodTagSub(tag.cat, tag.sub);
  if (!cat || !sub) return '';
  let out = `${sub.icon} ${sub.label}`;
  if (tag.cat === 'drink' && tag.sweet && tag.sweet !== 'none') out += ` · ${drinkSweetLabel(tag.sweet)}`;
  return out;
}
// A stable identity string so the same selection dedupes and matches
// across meals — used as the key in diet correlation.
function foodTagKey(tag) {
  return tag.cat === 'drink' && tag.sweet ? `${tag.cat}:${tag.sub}:${tag.sweet}` : `${tag.cat}:${tag.sub}`;
}
// Expand one meal's tags into the SET of correlation keys it contributes:
// the specific sub (protein:fish), the parent category (protein), and for
// sweetened drinks a cross-cutting "added-sugar" signal — so the analysis
// can find patterns at whichever granularity is real.
function foodTagAnalysisKeys(tags) {
  const keys = new Set();
  for (const t of (tags || [])) {
    if (!t || !t.cat || !t.sub) continue;
    keys.add(t.cat);
    keys.add(`${t.cat}:${t.sub}`);
    if (t.cat === 'drink' && t.sweet === 'sugar') keys.add('addedsugar');
    if (t.cat === 'sugar') keys.add('addedsugar');
  }
  return keys;
}
// Human label for an analysis key (category, sub, or the synthetic ones).
function foodAnalysisKeyLabel(key) {
  if (key === 'addedsugar') return '🍬 سكر مضاف';
  if (key.includes(':')) {
    const [c, s] = key.split(':');
    const sub = foodTagSub(c, s);
    return sub ? `${sub.icon} ${sub.label}` : key;
  }
  const cat = foodTagCategory(key);
  return cat ? `${cat.icon} ${cat.label}` : key;
}

// ---------- date helpers (used everywhere) ----------

function todayStr(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function addDays(dateStr, delta) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + delta);
  return todayStr(dt);
}

// parseFloat/parseInt only understand Western digits (0-9) — typing
// Arabic-Indic numerals (١٢٣) into any numeric field would silently
// parse as NaN without this first.
function normalizeArabicNumerals(str) {
  if (!str) return str;
  const arabicDigits = '٠١٢٣٤٥٦٧٨٩';
  return String(str).replace(/[٠-٩]/g, d => arabicDigits.indexOf(d));
}

// The ONE way to read a number out of an input in this app.
//
// This is an Arabic-first app, so someone typing on an Arabic keyboard
// produces Arabic-Indic digits (١٢٣) — which raw parseFloat/parseInt
// turn into NaN, silently. Every numeric field must normalize first.
// Returns null (never NaN) for empty/invalid input so callers can
// distinguish "she left it blank" from "she typed something bad",
// which `|| 0` and `|| 25` fallbacks could never do.
//
// opts: { int, min, max } — int floors to a whole number; min/max clamp.
function parseNumericInput(value, { int = false, min = null, max = null } = {}) {
  const raw = (value ?? '').toString().trim();
  if (raw === '') return null;
  const n = int
    ? parseInt(normalizeArabicNumerals(raw), 10)
    : parseFloat(normalizeArabicNumerals(raw));
  if (!Number.isFinite(n)) return null;
  let out = n;
  if (min !== null) out = Math.max(min, out);
  if (max !== null) out = Math.min(max, out);
  return out;
}

// Convenience: read straight from an element id.
function readNumericField(id, opts) {
  const el = document.getElementById(id);
  return parseNumericInput(el ? el.value : '', opts);
}

function daysBetween(dateStrA, dateStrB) {
  const [ay, am, ad] = dateStrA.split('-').map(Number);
  const [by, bm, bd] = dateStrB.split('-').map(Number);
  const a = new Date(ay, am - 1, ad);
  const b = new Date(by, bm - 1, bd);
  return Math.round((b - a) / 86400000);
}

function isFutureDate(dateStr) {
  return dateStr > todayStr();
}

const ARABIC_MONTHS = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
const ARABIC_WEEKDAYS = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
const ARABIC_WEEKDAYS_SHORT = ['أحد', 'اثنين', 'ثلاثاء', 'أربعاء', 'خميس', 'جمعة', 'سبت'];

function formatDateArabic(dateStr, { weekday = true } = {}) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  const parts = [];
  if (weekday) parts.push(ARABIC_WEEKDAYS[dt.getDay()] + '،');
  parts.push(String(d));
  parts.push(ARABIC_MONTHS[m - 1]);
  parts.push(String(y));
  return parts.join(' ');
}

// Small helper used anywhere we drop user-entered text into innerHTML,
// so a stray "<" or "&" in a habit name can't break the page layout.
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str ?? '';
  return div.innerHTML;
}

// ---------- generic upsert-by-compound-key helper ----------
// Both habitLogs and fixedTaskLogs use the same [foreignId+date] shape,
// so one helper covers both instead of duplicating the same 6 lines twice.

async function upsertLog(table, foreignKeyName, foreignId, date, extraFields) {
  const existing = await table.where('[' + foreignKeyName + '+date]').equals([foreignId, date]).first();
  const row = { [foreignKeyName]: foreignId, date, loggedAt: Date.now(), ...extraFields };
  if (existing) {
    await table.update(existing.id, row);
    return existing.id;
  }
  return await table.add(row);
}

async function deleteLog(table, foreignKeyName, foreignId, date) {
  await table.where('[' + foreignKeyName + '+date]').equals([foreignId, date]).delete();
}

async function getLog(table, foreignKeyName, foreignId, date) {
  return await table.where('[' + foreignKeyName + '+date]').equals([foreignId, date]).first();
}
