// backup.js — the only way any of her data ever leaves this device, and
// only when she explicitly taps the button. Restore is a full replace,
// not a merge — simpler, and avoids duplicate/ID-collision bugs that a
// smarter merge would risk.
//
// Data-driven on purpose: with ~40 tables now, spelling each one out by
// hand in four separate places (export list, clear list, restore list,
// transaction table list) is exactly how a table goes missing silently
// — it already happened twice (Worship's tables, then waterLogs), both
// caught only by accident. SIMPLE_TABLES/PHOTO_TABLES are now the only
// place a new table needs to be added; everything below loops over them.

const SIMPLE_TABLES = [
  'habits', 'habitLogs', 'fixedTasks', 'fixedTaskLogs', 'customTodos', 'streakPauses',
  'prayerLogs', 'sunnahLogs', 'adhkarAfterLogs', 'dailyAdhkarLogs', 'customAdhkar', 'customAdhkarLogs',
  'moodLogs', 'periodLogs', 'periodReadings', 'foodLogs', 'chewSessions', 'customReminders', 'waterLogs', 'weightLogs', 'bodyMeasurements', 'bodyMeasurementLogs',
  'goals', 'diaryEntries',
  'economyTransactions', 'shoppingLists', 'shoppingListItems',
  'edibles', 'edibleWishlist', 'things', 'thingsWishlist',
  'recipes', 'exercises', 'exerciseLogs', 'standaloneSunnahLogs', 'wirdSettings', 'wirdLogs',
  'courses', 'courseTodos', 'studySessions', 'courseMaterials', 'dailyAdhkarItems', 'dailyAdhkarItemLogs', 'sleepLogs', 'qadaPrayers', 'qadaFasting', 'habitEvents', 'dailyCareRoutines', 'dailyCareLogs'
];

// Tables holding blobs, each keyed by a foreign id — can't go in JSON,
// so each becomes its own file in the zip instead.
const PHOTO_TABLES = [
  { table: 'foodPhotos', keyField: 'foodLogId', prefix: 'food' },
  { table: 'diaryPhotos', keyField: 'entryId', prefix: 'diary' },
  { table: 'ediblePhotos', keyField: 'edibleId', prefix: 'edible' },
  { table: 'edibleWishlistPhotos', keyField: 'wishlistId', prefix: 'edible-wish' },
  { table: 'thingPhotos', keyField: 'thingId', prefix: 'thing' },
  { table: 'thingsWishlistPhotos', keyField: 'wishlistId', prefix: 'things-wish' },
  { table: 'recipePhotos', keyField: 'recipeId', prefix: 'recipe' },
  { table: 'exercisePhotos', keyField: 'exerciseId', prefix: 'exercise' },
  { table: 'courseMaterialPhotos', keyField: 'materialId', prefix: 'material' },
  { table: 'sleepDreamPhotos', keyField: 'sleepLogId', prefix: 'sleep' },
  { table: 'dailyCareRoutinePhotos', keyField: 'routineId', prefix: 'care' }
];

async function exportBackup() {
  const zip = new JSZip();

  const [profile, settings, simpleData, photoData] = await Promise.all([
    db.profile.get(1),
    db.settings.get(1),
    Promise.all(SIMPLE_TABLES.map(t => db[t].toArray())),
    Promise.all(PHOTO_TABLES.map(p => db[p.table].toArray()))
  ]);

  const data = { version: 2, exportedAt: new Date().toISOString(), settings: settings || null, profile: null };
  SIMPLE_TABLES.forEach((t, i) => { data[t] = simpleData[i]; });

  PHOTO_TABLES.forEach((p, i) => {
    const rows = photoData[i];
    data[p.table + 'Ids'] = rows.map(r => r[p.keyField]);
    rows.forEach(r => zip.file(`photos/${p.prefix}-${r[p.keyField]}.jpg`, r.photoBlob));
  });

  if (profile) {
    const { pictureBlob, ...rest } = profile;
    data.profile = { ...rest, hasPicture: !!pictureBlob };
    if (pictureBlob) zip.file('photos/profile.jpg', pictureBlob);
  }

  zip.file('data.json', JSON.stringify(data, null, 2));
  const blob = await zip.generateAsync({ type: 'blob' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `rahlati-backup-${todayStr()}.zip`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  toast('تم تنزيل النسخة الاحتياطية 🌸');
}

const BACKUP_FORMAT_VERSION = 2;

// Read a backup WITHOUT touching the database, so she can see what's in it
// before deciding. The old flow cleared everything the instant a file was
// chosen: pick the wrong zip and it was simply gone.
async function inspectBackup(file) {
  const zip = await JSZip.loadAsync(file);
  const dataFile = zip.file('data.json');
  if (!dataFile) throw new Error('هذا ليس ملف نسخة احتياطية صالحاً (data.json مفقود)');
  const data = JSON.parse(await dataFile.async('string'));

  if (typeof data.version !== 'number') {
    throw new Error('ملف النسخة تالف أو غير مكتمل');
  }
  if (data.version > BACKUP_FORMAT_VERSION) {
    throw new Error(`هذه النسخة من إصدار أحدث من التطبيق (v${data.version}). حدّثي التطبيق أولاً.`);
  }

  // Count what's actually inside, so the confirmation says something real.
  const counts = {};
  let total = 0;
  for (const t of SIMPLE_TABLES) {
    const n = data[t]?.length || 0;
    if (n > 0) { counts[t] = n; total += n; }
  }
  let photoCount = 0;
  for (const p of PHOTO_TABLES) photoCount += (data[p.table + 'Ids']?.length || 0);
  if (zip.file('photos/profile.jpg')) photoCount += 1;

  return {
    zip, data,
    version: data.version,
    exportedAt: data.exportedAt ? new Date(data.exportedAt) : null,
    profileName: data.profile?.name || null,
    totalRows: total,
    photoCount,
    counts
  };
}

// Apply an already-inspected backup. Split from inspectBackup on purpose:
// nothing destructive happens until she has seen what she's about to
// replace her data with.
async function applyBackup(inspected) {
  const { zip, data } = inspected;

  let pictureBlob = null;
  const picFile = zip.file('photos/profile.jpg');
  if (picFile) pictureBlob = await picFile.async('blob');

  const allTableNames = ['profile', 'settings', ...SIMPLE_TABLES, ...PHOTO_TABLES.map(p => p.table)];
  const allTables = allTableNames.map(t => db[t]);

  await db.transaction('rw', allTables, async () => {
    await Promise.all(allTableNames.map(t => db[t].clear()));

    for (const t of SIMPLE_TABLES) {
      if (data[t]?.length) await db[t].bulkAdd(data[t]);
    }

    for (const p of PHOTO_TABLES) {
      const ids = data[p.table + 'Ids'];
      if (!ids?.length) continue;
      for (const id of ids) {
        const photoFile = zip.file(`photos/${p.prefix}-${id}.jpg`);
        if (!photoFile) continue;
        const photoBlobForRow = await photoFile.async('blob');
        await db[p.table].put({ [p.keyField]: id, photoBlob: photoBlobForRow });
      }
    }

    if (data.profile) {
      const { hasPicture, ...rest } = data.profile;
      await db.profile.put({ ...rest, id: 1, pictureBlob });
    }
    if (data.settings) {
      await db.settings.put({ ...data.settings, id: 1 });
    }
  });
}

// Kept for callers that genuinely want the one-shot behaviour.
async function importBackup(file) {
  const inspected = await inspectBackup(file);
  await applyBackup(inspected);
}

// A human-readable summary of what a table holds, for the restore preview.
const BACKUP_TABLE_LABELS = {
  habits: 'عادة', habitLogs: 'سجل عادة', habitEvents: 'حدث عادة',
  fixedTasks: 'مهمة ثابتة', customTodos: 'مهمة',
  prayerLogs: 'صلاة', moodLogs: 'مزاج', periodLogs: 'دورة', periodReadings: 'قراءة دورة',
  foodLogs: 'وجبة', waterLogs: 'ماء', weightLogs: 'وزن',
  diaryEntries: 'يومية', economyTransactions: 'معاملة',
  recipes: 'وصفة', exercises: 'تمرين', exerciseLogs: 'سجل تمرين',
  courses: 'دورة تعلّم', studySessions: 'جلسة تركيز',
  sleepLogs: 'نومة', goals: 'هدف', chewSessions: 'جلسة مضغ',
  customAdhkar: 'ذكر', wirdLogs: 'ورد', dailyCareRoutines: 'روتين'
};

function summariseBackup(inspected) {
  const rows = Object.entries(inspected.counts)
    .filter(([t]) => BACKUP_TABLE_LABELS[t])
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([t, n]) => `${toArabicNumeral(n)} ${BACKUP_TABLE_LABELS[t]}`);
  return rows;
}
