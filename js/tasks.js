// tasks.js — two deliberately different lists:
//   Fixed Tasks: a recurring daily checklist (same items every day, reset
//                daily, optional reminder time). Genuinely 2-state
//                (done / not done) — there's no "relapse" button here,
//                so unlike Habits this stays boolean-shaped on purpose.
//   Custom Todos: a plain one-off to-do list with an optional due date.
// Edit/delete only show when showManage is true (main pages, not Day
// Detail) — editing a task's title isn't a per-date action, same
// reasoning as habits.js.

// ===================== Fixed Tasks =====================

async function createFixedTask(title, reminderTime, trackedOnHome = true) {
  const all = await db.fixedTasks.toArray();
  return db.fixedTasks.add({
    title, reminderTime: reminderTime || null, trackedOnHome: !!trackedOnHome,
    archived: false, order: all.length, createdAt: Date.now()
  });
}
async function updateFixedTask(id, { title, reminderTime, trackedOnHome }) {
  const patch = { title, reminderTime: reminderTime || null };
  if (trackedOnHome !== undefined) patch.trackedOnHome = !!trackedOnHome;
  await db.fixedTasks.update(id, patch);
}

async function getActiveFixedTasks() {
  const all = await db.fixedTasks.toArray();
  return all.filter(t => !t.archived).sort((a, b) => a.order - b.order);
}

// Only the tasks she chose to count feed the Home ring. Some daily tasks
// are worth having on the list but not worth having drag the day's score
// down when skipped (a "nice if I get to it" task), and a ring that counts
// those is a ring that lies about how the day actually went.
// Absent field = tracked, so every existing task keeps counting as before.
function isFixedTaskTracked(task) {
  return task.trackedOnHome !== false;
}
async function getTrackedFixedTasks() {
  return (await getActiveFixedTasks()).filter(isFixedTaskTracked);
}

async function archiveFixedTask(id) {
  await db.fixedTasks.update(id, { archived: true });
}

async function isFixedTaskDone(taskId, date) {
  const row = await getLog(db.fixedTaskLogs, 'taskId', taskId, date);
  return !!row;
}

async function toggleFixedTask(taskId, date) {
  const row = await getLog(db.fixedTaskLogs, 'taskId', taskId, date);
  if (row) await db.fixedTaskLogs.delete(row.id);
  else await upsertLog(db.fixedTaskLogs, 'taskId', taskId, date, {});
}

function fixedTaskRowHtml(task, done, editable, showManage) {
  return `
    <div class="task-row-wrap">
      <label class="task-row ${done ? 'done' : ''}">
        <input type="checkbox" data-task-id="${task.id}" ${done ? 'checked' : ''} ${editable ? '' : 'disabled'}>
        <span class="task-title">${escapeHtml(task.title)}</span>
        ${task.reminderTime ? `<span class="task-reminder">🔔 ${task.reminderTime}</span>` : ''}
      </label>
      ${showManage ? kebabMenuHtml(String(task.id), [
        { key: 'edit', label: 'تعديل' },
        { key: 'delete', label: 'حذف', danger: true }
      ]) : ''}
    </div>`;
}

async function getFixedTasksDoneSet(tasks, dateStr) {
  const set = new Set();
  for (const t of tasks) {
    if (await isFixedTaskDone(t.id, dateStr)) set.add(t.id);
  }
  return set;
}

async function renderFixedTaskList(container, dateStr, { editable, limit, onChange, showManage } = {}) {
  if (!container) return; // page was replaced mid-render
  const tasks = await getActiveFixedTasks();
  const shown = limit ? tasks.slice(0, limit) : tasks;
  if (shown.length === 0) {
    container.innerHTML = `<div class="empty-state"><p>ما في مهام ثابتة بعد.</p><p class="empty-state-sub">مثلاً: الفيتامينات، أو ترتيب السرير.</p></div>`;
    return;
  }
  const rows = await Promise.all(shown.map(async t => fixedTaskRowHtml(t, await isFixedTaskDone(t.id, dateStr), editable, showManage)));
  container.innerHTML = rows.join('');

  async function refresh() {
    await renderFixedTaskList(container, dateStr, { editable, limit, onChange, showManage });
    if (onChange) onChange();
  }

  container.querySelectorAll('input[type=checkbox]').forEach(cb => {
    cb.addEventListener('change', async () => {
      if (cb.disabled) return;
      await toggleFixedTask(Number(cb.dataset.taskId), dateStr);
      await refresh();
    });
  });
  wireKebabMenus(container, async (rowId, action) => {
    const taskId = Number(rowId);
    if (action === 'edit') {
      openFixedTaskModal({ existingId: taskId, onSaved: refresh });
    } else if (action === 'delete') {
      const task = shown.find(t => t.id === taskId);
      if (!confirm(`حذف "${task.title}"؟`)) return;
      await archiveFixedTask(taskId);
      await refresh();
    }
  });
}

function openFixedTaskModal({ existingId, onSaved } = {}) {
  let existing = null;
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal">
      <h2 class="modal-title" id="task-modal-title">مهمة ثابتة جديدة</h2>
      <label class="field-label">اسم المهمة</label>
      <input class="text-input" id="new-task-title" placeholder="مثلاً: الفيتامينات" autofocus>
      <label class="field-label">تذكير (اختياري)</label>
      <input class="text-input" type="time" id="new-task-time">
      <label class="checkbox-row">
        <input type="checkbox" id="new-task-tracked" checked>
        <span>⭕ احتسابها في دائرة الرئيسية</span>
      </label>
      <p class="settings-note">إن كانت مهمة لا يهم إن فاتتك يوماً، أزيلي التحديد — تبقى في قائمتك لكن لا تُنقص دائرتك.</p>
      <div class="modal-actions">
        ${existingId ? `<button class="btn btn-danger btn-sm" id="task-delete-btn">حذف</button>` : ''}
        <button class="btn btn-text" id="new-task-cancel">إلغاء</button>
        <button class="btn btn-primary" id="new-task-save">${existingId ? 'حفظ' : 'إضافة'}</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  async function applyExisting() {
    if (!existingId) return;
    existing = (await db.fixedTasks.toArray()).find(t => t.id === existingId);
    if (!existing) return;
    document.getElementById('task-modal-title').textContent = 'تعديل المهمة';
    document.getElementById('new-task-title').value = existing.title;
    document.getElementById('new-task-time').value = existing.reminderTime || '';
    document.getElementById('new-task-tracked').checked = isFixedTaskTracked(existing);
  }

  document.getElementById('new-task-cancel').addEventListener('click', () => overlay.remove());
  const deleteBtn = document.getElementById('task-delete-btn');
  if (deleteBtn) deleteBtn.addEventListener('click', async () => {
    if (!confirm('حذف هذه المهمة؟')) return;
    await archiveFixedTask(existingId);
    overlay.remove();
    if (onSaved) onSaved();
  });
  document.getElementById('new-task-save').addEventListener('click', async () => {
    const title = document.getElementById('new-task-title').value.trim();
    if (!title) return;
    const time = document.getElementById('new-task-time').value || null;
    const trackedOnHome = document.getElementById('new-task-tracked').checked;
    if (existingId) await updateFixedTask(existingId, { title, reminderTime: time, trackedOnHome });
    else await createFixedTask(title, time, trackedOnHome);
    overlay.remove();
    if (onSaved) onSaved();
  });

  applyExisting();
}

// ===================== Custom Todos =====================

async function addTodo(title, dueDate, deleteWhenDone = false) {
  await db.customTodos.add({ title, dueDate: dueDate || null, deleteWhenDone: !!deleteWhenDone, done: false, doneAt: null, createdAt: Date.now() });
}
async function updateTodo(id, { title, dueDate, deleteWhenDone }) {
  const patch = { title, dueDate: dueDate || null };
  if (deleteWhenDone !== undefined) patch.deleteWhenDone = !!deleteWhenDone;
  await db.customTodos.update(id, patch);
}
async function deleteTodo(id) {
  await db.customTodos.delete(id);
}

// Ticking a "delete when done" todo removes it outright instead of
// leaving it struck-through forever. Some todos exist only to be crossed
// off ("call the pharmacy") and keeping them around just grows a
// graveyard she has to clean up by hand. Returns whether it was deleted,
// so the caller can toast appropriately.
async function toggleTodo(id) {
  const t = await db.customTodos.get(id);
  if (!t) return { deleted: false };
  const willBeDone = !t.done;
  if (willBeDone && t.deleteWhenDone) {
    await db.customTodos.delete(id);
    return { deleted: true, title: t.title };
  }
  await db.customTodos.update(id, { done: willBeDone, doneAt: willBeDone ? Date.now() : null });
  return { deleted: false };
}

async function getTodosForDate(dateStr) {
  const all = await db.customTodos.toArray();
  return all.filter(t => t.dueDate === dateStr);
}

function todoRowHtml(todo, showManage) {
  return `
    <div class="task-row-wrap">
      <label class="task-row ${todo.done ? 'done' : ''}">
        <input type="checkbox" data-todo-id="${todo.id}" ${todo.done ? 'checked' : ''}>
        <span class="task-title">${escapeHtml(todo.title)}</span>
        ${todo.deleteWhenDone ? `<span class="todo-burn-badge" title="ستُحذف عند إتمامها">🔥</span>` : ''}
        ${todo.dueDate ? `<span class="task-reminder">📅 ${formatDateArabic(todo.dueDate, { weekday: false })}</span>` : ''}
      </label>
      ${showManage ? kebabMenuHtml(String(todo.id), [
        { key: 'edit', label: 'تعديل' },
        { key: 'delete', label: 'حذف', danger: true }
      ]) : ''}
    </div>`;
}

async function renderTodoList(container, { limit, onlyOpen, showManage } = {}) {
  if (!container) return; // page was replaced mid-render
  let all = await db.customTodos.toArray();
  all.sort((a, b) => (a.done - b.done) || (b.createdAt - a.createdAt));
  if (onlyOpen) all = all.filter(t => !t.done);
  const shown = limit ? all.slice(0, limit) : all;
  if (shown.length === 0) {
    container.innerHTML = `<div class="empty-state"><p>ما في مهام حالياً. قائمتك فاضية! ✨</p></div>`;
    return;
  }
  container.innerHTML = shown.map(t => todoRowHtml(t, showManage)).join('');

  async function refresh() {
    await renderTodoList(container, { limit, onlyOpen, showManage });
  }

  container.querySelectorAll('input[type=checkbox]').forEach(cb => {
    cb.addEventListener('change', async () => {
      const res = await toggleTodo(Number(cb.dataset.todoId));
      if (res.deleted) toast(`🔥 تمّت وحُذفت: ${res.title}`);
      await refresh();
    });
  });
  wireKebabMenus(container, async (rowId, action) => {
    const todoId = Number(rowId);
    if (action === 'edit') {
      openTodoModal({ existingId: todoId, onSaved: refresh });
    } else if (action === 'delete') {
      if (!confirm('حذف هذه المهمة؟')) return;
      await deleteTodo(todoId);
      await refresh();
    }
  });
}

function openTodoModal({ existingId, onSaved } = {}) {
  let existing = null;
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal">
      <h2 class="modal-title" id="todo-modal-title">مهمة جديدة</h2>
      <label class="field-label">العنوان</label>
      <input class="text-input" id="new-todo-title" placeholder="اكتبي المهمة هنا" autofocus>
      <label class="field-label">تاريخ الاستحقاق (اختياري)</label>
      <input class="text-input" type="date" id="new-todo-date">
      <label class="checkbox-row">
        <input type="checkbox" id="new-todo-burn">
        <span>🔥 حذفها تلقائياً عند إتمامها</span>
      </label>
      <p class="settings-note">للمهام العابرة التي لا داعي لبقائها في القائمة بعد إنجازها.</p>
      <div class="modal-actions">
        ${existingId ? `<button class="btn btn-danger btn-sm" id="todo-delete-btn">حذف</button>` : ''}
        <button class="btn btn-text" id="new-todo-cancel">إلغاء</button>
        <button class="btn btn-primary" id="new-todo-save">${existingId ? 'حفظ' : 'إضافة'}</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  async function applyExisting() {
    if (!existingId) return;
    existing = (await db.customTodos.toArray()).find(t => t.id === existingId);
    if (!existing) return;
    document.getElementById('todo-modal-title').textContent = 'تعديل المهمة';
    document.getElementById('new-todo-title').value = existing.title;
    document.getElementById('new-todo-date').value = existing.dueDate || '';
    document.getElementById('new-todo-burn').checked = !!existing.deleteWhenDone;
  }

  document.getElementById('new-todo-cancel').addEventListener('click', () => overlay.remove());
  const deleteBtn = document.getElementById('todo-delete-btn');
  if (deleteBtn) deleteBtn.addEventListener('click', async () => {
    if (!confirm('حذف هذه المهمة؟')) return;
    await deleteTodo(existingId);
    overlay.remove();
    if (onSaved) onSaved();
  });
  document.getElementById('new-todo-save').addEventListener('click', async () => {
    const title = document.getElementById('new-todo-title').value.trim();
    if (!title) return;
    const date = document.getElementById('new-todo-date').value || null;
    const deleteWhenDone = document.getElementById('new-todo-burn').checked;
    if (existingId) await updateTodo(existingId, { title, dueDate: date, deleteWhenDone });
    else await addTodo(title, date, deleteWhenDone);
    overlay.remove();
    if (onSaved) onSaved();
  });

  applyExisting();
}

// ===================== full Tasks page =====================

async function renderTasksPage(params, view) {
  view.innerHTML = `
    <div class="page-header">
      <button class="icon-btn" aria-label="رجوع" id="tasks-back">→</button>
      <h1>المهام</h1>
    </div>
    <div class="card">
      <h2 class="card-title">مهامي اليومية</h2>
      <div id="fixed-tasks-list"></div>
      <button class="btn btn-secondary btn-block" id="add-fixed-task-btn">+ مهمة ثابتة جديدة</button>
    </div>
    <div class="card">
      <h2 class="card-title">قائمة المهام</h2>
      <div id="custom-todos-list"></div>
      <button class="btn btn-secondary btn-block" id="add-todo-btn">+ مهمة جديدة</button>
    </div>
  `;
  document.getElementById('tasks-back').addEventListener('click', () => history.back());

  async function rescheduleReminders() {
    await scheduleAllTodayReminders();
  }

  const fixedListEl = document.getElementById('fixed-tasks-list');
  await renderFixedTaskList(fixedListEl, todayStr(), { editable: true, showManage: true, onChange: rescheduleReminders });
  document.getElementById('add-fixed-task-btn').addEventListener('click', () => {
    openFixedTaskModal({
      onSaved: async () => {
        await renderFixedTaskList(fixedListEl, todayStr(), { editable: true, showManage: true, onChange: rescheduleReminders });
        rescheduleReminders();
      }
    });
  });

  const todoListEl = document.getElementById('custom-todos-list');
  await renderTodoList(todoListEl, { showManage: true });
  document.getElementById('add-todo-btn').addEventListener('click', () => {
    openTodoModal({ onSaved: () => renderTodoList(todoListEl, { showManage: true }) });
  });
}

// ===================== Day Detail providers =====================
// No edit/delete here on purpose — same reasoning as habits.js.

async function fixedTasksDayProvider(dateStr) {
  const tasks = await getActiveFixedTasks();
  if (tasks.length === 0) return null;
  const editable = !isFutureDate(dateStr);
  const node = document.createElement('div');
  const rows = await Promise.all(tasks.map(async t => fixedTaskRowHtml(t, await isFixedTaskDone(t.id, dateStr), editable, false)));
  node.innerHTML = rows.join('');
  node.querySelectorAll('input[type=checkbox]').forEach(cb => {
    cb.addEventListener('change', async () => {
      if (cb.disabled) return;
      await toggleFixedTask(Number(cb.dataset.taskId), dateStr);
      const fresh = await fixedTasksDayProvider(dateStr);
      node.replaceWith(fresh.node);
    });
  });
  return { title: 'المهام اليومية', node };
}

async function todosDayProvider(dateStr) {
  const todos = await getTodosForDate(dateStr);
  if (todos.length === 0) return null;
  const node = document.createElement('div');
  node.innerHTML = todos.map(t => todoRowHtml(t, false)).join('');
  node.querySelectorAll('input[type=checkbox]').forEach(cb => {
    cb.addEventListener('change', async () => {
      const res = await toggleTodo(Number(cb.dataset.todoId));
      if (res.deleted) toast(`🔥 تمّت وحُذفت: ${res.title}`);
      const fresh = await todosDayProvider(dateStr);
      // A "delete when done" todo can remove the LAST todo for this day,
      // in which case the provider correctly returns null — reading .node
      // off it would throw, so swap in an empty state instead.
      if (fresh && fresh.node) node.replaceWith(fresh.node);
      else node.innerHTML = `<p class="empty-state-sub">لا مهام لهذا اليوم.</p>`;
    });
  });
  return { title: 'قائمة المهام', node };
}

// ---------- Yearly stats providers ----------

async function tasksYearlyProvider(year) {
  const tasks = await getActiveFixedTasks();
  if (tasks.length === 0) return null;
  const prefix = String(year);
  let total = 0;
  const rows = await Promise.all(tasks.map(async t => {
    const logs = await db.fixedTaskLogs.where('taskId').equals(t.id).toArray();
    const count = logs.filter(l => l.date.startsWith(prefix)).length;
    total += count;
    return count > 0 ? `<div class="yearly-row"><span>${escapeHtml(t.title)}</span><span>${count} ✅</span></div>` : '';
  }));
  if (total === 0) return null;
  return { title: 'المهام اليومية', html: rows.join(''), count: total };
}

async function todosYearlyProvider(year) {
  const all = await db.customTodos.toArray();
  const doneThisYear = all.filter(t => t.done && t.doneAt && new Date(t.doneAt).getFullYear() === year);
  if (doneThisYear.length === 0) return null;
  return { title: 'قائمة المهام', html: `<div class="yearly-row"><span>مهام منجزة</span><span>${doneThisYear.length}</span></div>`, count: doneThisYear.length };
}
