// backup.js — the only way any of her data ever leaves this device, and
// only when she explicitly taps the button. Restore is a full replace,
// not a merge — simpler, and avoids duplicate/ID-collision bugs that a
// smarter merge would risk. The exported `version` number is what would
// let a future phase migrate an old backup if a table's shape ever has
// to change (policy: it shouldn't, going forward — see db.js).

async function exportBackup() {
  const zip = new JSZip();
  const [
    profile, settings, habits, habitLogs, fixedTasks, fixedTaskLogs, customTodos, streakPauses,
    prayerLogs, sunnahLogs, adhkarAfterLogs, dailyAdhkarLogs, customAdhkar, customAdhkarLogs,
    moodLogs, periodLogs, foodLogs, foodPhotos, waterLogs, weightLogs, bodyMeasurements,
    bodyMeasurementLogs, goals, diaryEntries, diaryPhotos
  ] = await Promise.all([
    db.profile.get(1), db.settings.get(1), db.habits.toArray(), db.habitLogs.toArray(),
    db.fixedTasks.toArray(), db.fixedTaskLogs.toArray(), db.customTodos.toArray(), db.streakPauses.toArray(),
    db.prayerLogs.toArray(), db.sunnahLogs.toArray(), db.adhkarAfterLogs.toArray(), db.dailyAdhkarLogs.toArray(),
    db.customAdhkar.toArray(), db.customAdhkarLogs.toArray(),
    db.moodLogs.toArray(), db.periodLogs.toArray(), db.foodLogs.toArray(), db.foodPhotos.toArray(),
    db.waterLogs.toArray(), db.weightLogs.toArray(), db.bodyMeasurements.toArray(),
    db.bodyMeasurementLogs.toArray(), db.goals.toArray(), db.diaryEntries.toArray(), db.diaryPhotos.toArray()
  ]);

  const data = {
    version: 1,
    exportedAt: new Date().toISOString(),
    settings: settings || null,
    profile: null,
    habits, habitLogs, fixedTasks, fixedTaskLogs, customTodos, streakPauses,
    prayerLogs, sunnahLogs, adhkarAfterLogs, dailyAdhkarLogs, customAdhkar, customAdhkarLogs,
    moodLogs, periodLogs, foodLogs,
    foodPhotoIds: foodPhotos.map(p => p.foodLogId),
    waterLogs, weightLogs, bodyMeasurements, bodyMeasurementLogs, goals,
    diaryEntries,
    diaryPhotoIds: diaryPhotos.map(p => p.entryId)
  };

  foodPhotos.forEach(p => zip.file(`photos/food-${p.foodLogId}.jpg`, p.photoBlob));
  diaryPhotos.forEach(p => zip.file(`photos/diary-${p.entryId}.jpg`, p.photoBlob));

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

async function importBackup(file) {
  const zip = await JSZip.loadAsync(file);
  const dataFile = zip.file('data.json');
  if (!dataFile) throw new Error('data.json not found in backup zip');
  const data = JSON.parse(await dataFile.async('string'));

  let pictureBlob = null;
  const picFile = zip.file('photos/profile.jpg');
  if (picFile) pictureBlob = await picFile.async('blob');

  await db.transaction('rw',
    db.profile, db.settings, db.habits, db.habitLogs, db.fixedTasks, db.fixedTaskLogs, db.customTodos, db.streakPauses,
    db.prayerLogs, db.sunnahLogs, db.adhkarAfterLogs, db.dailyAdhkarLogs, db.customAdhkar, db.customAdhkarLogs,
    db.moodLogs, db.periodLogs, db.foodLogs, db.foodPhotos,
    db.waterLogs, db.weightLogs, db.bodyMeasurements, db.bodyMeasurementLogs, db.goals,
    db.diaryEntries, db.diaryPhotos,
    async () => {
      await Promise.all([
        db.profile.clear(), db.settings.clear(), db.habits.clear(), db.habitLogs.clear(),
        db.fixedTasks.clear(), db.fixedTaskLogs.clear(), db.customTodos.clear(), db.streakPauses.clear(),
        db.prayerLogs.clear(), db.sunnahLogs.clear(), db.adhkarAfterLogs.clear(), db.dailyAdhkarLogs.clear(),
        db.customAdhkar.clear(), db.customAdhkarLogs.clear(), db.moodLogs.clear(), db.periodLogs.clear(),
        db.foodLogs.clear(), db.foodPhotos.clear(),
        db.waterLogs.clear(), db.weightLogs.clear(), db.bodyMeasurements.clear(),
        db.bodyMeasurementLogs.clear(), db.goals.clear(),
        db.diaryEntries.clear(), db.diaryPhotos.clear()
      ]);
      if (data.habits?.length) await db.habits.bulkAdd(data.habits);
      if (data.habitLogs?.length) await db.habitLogs.bulkAdd(data.habitLogs);
      if (data.fixedTasks?.length) await db.fixedTasks.bulkAdd(data.fixedTasks);
      if (data.fixedTaskLogs?.length) await db.fixedTaskLogs.bulkAdd(data.fixedTaskLogs);
      if (data.customTodos?.length) await db.customTodos.bulkAdd(data.customTodos);
      if (data.streakPauses?.length) await db.streakPauses.bulkAdd(data.streakPauses);
      if (data.prayerLogs?.length) await db.prayerLogs.bulkAdd(data.prayerLogs);
      if (data.sunnahLogs?.length) await db.sunnahLogs.bulkAdd(data.sunnahLogs);
      if (data.adhkarAfterLogs?.length) await db.adhkarAfterLogs.bulkAdd(data.adhkarAfterLogs);
      if (data.dailyAdhkarLogs?.length) await db.dailyAdhkarLogs.bulkAdd(data.dailyAdhkarLogs);
      if (data.customAdhkar?.length) await db.customAdhkar.bulkAdd(data.customAdhkar);
      if (data.customAdhkarLogs?.length) await db.customAdhkarLogs.bulkAdd(data.customAdhkarLogs);
      if (data.moodLogs?.length) await db.moodLogs.bulkAdd(data.moodLogs);
      if (data.periodLogs?.length) await db.periodLogs.bulkAdd(data.periodLogs);
      if (data.foodLogs?.length) await db.foodLogs.bulkAdd(data.foodLogs);
      if (data.waterLogs?.length) await db.waterLogs.bulkAdd(data.waterLogs);
      if (data.weightLogs?.length) await db.weightLogs.bulkAdd(data.weightLogs);
      if (data.bodyMeasurements?.length) await db.bodyMeasurements.bulkAdd(data.bodyMeasurements);
      if (data.bodyMeasurementLogs?.length) await db.bodyMeasurementLogs.bulkAdd(data.bodyMeasurementLogs);
      if (data.goals?.length) await db.goals.bulkAdd(data.goals);
      if (data.diaryEntries?.length) await db.diaryEntries.bulkAdd(data.diaryEntries);
      if (data.foodPhotoIds?.length) {
        for (const foodLogId of data.foodPhotoIds) {
          const photoFile = zip.file(`photos/food-${foodLogId}.jpg`);
          if (photoFile) {
            const photoBlobFood = await photoFile.async('blob');
            await db.foodPhotos.put({ foodLogId, photoBlob: photoBlobFood });
          }
        }
      }
      if (data.diaryPhotoIds?.length) {
        for (const entryId of data.diaryPhotoIds) {
          const photoFile = zip.file(`photos/diary-${entryId}.jpg`);
          if (photoFile) {
            const photoBlobDiary = await photoFile.async('blob');
            await db.diaryPhotos.put({ entryId, photoBlob: photoBlobDiary });
          }
        }
      }
      if (data.profile) {
        const { hasPicture, ...rest } = data.profile;
        await db.profile.put({ ...rest, id: 1, pictureBlob });
      }
      if (data.settings) {
        await db.settings.put({ ...data.settings, id: 1 });
      }
    }
  );
}
