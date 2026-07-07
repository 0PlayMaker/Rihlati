// streaks.js — one streak engine, reused by every streak-based feature.
//
// Semantics (documented carefully since streak math is exactly the kind
// of thing that grows subtle bugs):
//  - `doneDates` is an array of 'YYYY-MM-DD' strings where the thing was
//    marked done. Anything not in this list is either "missed" or
//    "unmarked" — the caller decides which dates even count as
//    candidates (e.g. Habits only cares about dates <= today).
//  - `pauses` is a list of {startDate, endDate} ranges (endDate === null
//    means an open/ongoing pause). A paused day is skipped entirely: it
//    neither breaks nor extends the streak, as if that day didn't exist.
//  - Walking backward from today: a past day with no log and not paused
//    is an implicit miss and ends the streak. Today with no log yet is
//    "pending" (today isn't over), so it does not break the streak.

function isDatePaused(dateStr, pauses) {
  return pauses.some(p => dateStr >= p.startDate && (p.endDate === null || p.endDate === undefined || dateStr <= p.endDate));
}

function computeCurrentStreak(doneDates, pauses = [], today = todayStr()) {
  const doneSet = new Set(doneDates);
  let current = 0;
  let cursor = today;
  let isToday = true;

  // Safety cap: never walk back more than ~10 years of days. Protects
  // against an accidental infinite loop if bad data ever sneaks in.
  for (let i = 0; i < 3660; i++) {
    if (isDatePaused(cursor, pauses)) {
      cursor = addDays(cursor, -1);
      isToday = false;
      continue;
    }
    if (doneSet.has(cursor)) {
      current += 1;
      cursor = addDays(cursor, -1);
      isToday = false;
      continue;
    }
    if (isToday) {
      // Today, nothing logged yet — still pending, keep looking from yesterday.
      cursor = addDays(cursor, -1);
      isToday = false;
      continue;
    }
    break; // past day, no log, not paused -> the streak ends here
  }
  return current;
}

function computeLongestStreak(doneDates, pauses = []) {
  if (doneDates.length === 0) return 0;
  const doneSet = new Set(doneDates);
  const sorted = [...doneDates].sort();
  const last = todayStr();
  let longest = 0;
  let running = 0;
  let cursor = sorted[0];

  for (let i = 0; i < 3660 && cursor <= last; i++) {
    if (isDatePaused(cursor, pauses)) {
      // paused days hold the streak in place — neither break nor extend it
      cursor = addDays(cursor, 1);
      continue;
    }
    if (doneSet.has(cursor)) {
      running += 1;
      if (running > longest) longest = running;
    } else {
      running = 0;
    }
    cursor = addDays(cursor, 1);
  }
  return longest;
}
