// tasks.js — two deliberately different lists:
//   Fixed Tasks: a recurring daily checklist (same items every day, reset
//                daily, optional reminder time). Genuinely 2-state
//                (done / not done) — there's no "relapse" button here,
//                so unlike Habits this stays boolean-shaped on purpose.
//   Custom Todos: a plain one-off to-do list with an optional due date.

// ===================== Fixed Tasks =====================

async function createFixedTask(title, reminderTime) {
  const all = await db.fixedTasks.toArray();
  await db.fixedTasks.add({
    title, reminderTime: reminderTime || null,
    archived: false, order: all.length, createdAt: Date.now()
  });
}

async function getActiveFixedTasks() {
  const all = await db.fixedTasks.toArray();
  return all.filter(t => !t.archived).sort((a, b) => a.order - b.order);
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

function fixedTaskRowHtml(task, done, editable) {
  return `
    <label class="task-row ${done ? 'done' : ''}">
      <input type="checkbox" data-task-id="${task.id}" ${done ? 'checked' : ''} ${editable ? '' : 'disabled'}>
      <span class="task-title">${escapeHtml(task.title)}</span>
      ${task.reminderTime ? `<span class="task-reminder">🔔 ${task.reminderTime}</span>` : ''}
    </label>`;
}

async function getFixedTasksDoneSet(tasks, dateStr) {
  const set = new Set();
  for (const t of tasks) {
    if (await isFixedTaskDone(t.id, dateStr)) set.add(t.id);
  }
  return set;
}

async function renderFixedTaskList(container, dateStr, { editable, limit, onChange } = {}) {
  const tasks = await getActiveFixedTasks();
  const shown = limit ? tasks.slice(0, limit) : tasks;
  if (shown.length === 0) {
    container.innerHTML = `<div class="empty-state"><p>ما في مهام ثابتة بعد.</p><p class="empty-state-sub">مثلاً: الفيتامينات، أو ترتيب السرير.</p></div>`;
    return;
  }
  const rows = await Promise.all(shown.map(async t => fixedTaskRowHtml(t, await isFixedTaskDone(t.id, dateStr), editable)));
  container.innerHTML = rows.join('');
  container.querySelectorAll('input[type=checkbox]').forEach(cb => {
    cb.addEventListener('change', async () => {
      if (cb.disabled) return;
      await toggleFixedTask(Number(cb.dataset.taskId), dateStr);
      await renderFixedTaskList(container, dateStr, { editable, limit, onChange });
      if (onChange) onChange();
    });
  });
}

function openAddFixedTaskModal(onAdded) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal">
      <h2 class="modal-title">مهمة ثابتة جديدة</h2>
      <label class="field-label">اسم المهمة</label>
      <input class="text-input" id="new-task-title" placeholder="مثلاً: الفيتامينات" autofocus>
      <label class="field-label">تذكير (اختياري)</label>
      <input class="text-input" type="time" id="new-task-time">
      <div class="modal-actions">
        <button class="btn btn-text" id="new-task-cancel">إلغاء</button>
        <button class="btn btn-primary" id="new-task-save">إضافة</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  document.getElementById('new-task-cancel').addEventListener('click', () => overlay.remove());
  document.getElementById('new-task-save').addEventListener('click', async () => {
    const title = document.getElementById('new-task-title').value.trim();
    if (!title) return;
    const time = document.getElementById('new-task-time').value || null;
    await createFixedTask(title, time);
    overlay.remove();
    if (onAdded) onAdded();
  });
}

// ===================== Custom Todos =====================

async function addTodo(title, dueDate) {
  await db.customTodos.add({ title, dueDate: dueDate || null, done: false, doneAt: null, createdAt: Date.now() });
}

async function toggleTodo(id) {
  const t = await db.customTodos.get(id);
  await db.customTodos.update(id, { done: !t.done, doneAt: !t.done ? Date.now() : null });
}

async function getTodosForDate(dateStr) {
  const all = await db.customTodos.toArray();
  return all.filter(t => t.dueDate === dateStr);
}

function todoRowHtml(todo) {
  return `
    <label class="task-row ${todo.done ? 'done' : ''}">
      <input type="checkbox" data-todo-id="${todo.id}" ${todo.done ? 'checked' : ''}>
      <span class="task-title">${escapeHtml(todo.title)}</span>
      ${todo.dueDate ? `<span class="task-reminder">📅 ${formatDateArabic(todo.dueDate, { weekday: false })}</span>` : ''}
    </label>`;
}

async function renderTodoList(container, { limit, onlyOpen } = {}) {
  let all = await db.customTodos.toArray();
  all.sort((a, b) => (a.done - b.done) || (b.createdAt - a.createdAt));
  if (onlyOpen) all = all.filter(t => !t.done);
  const shown = limit ? all.slice(0, limit) : all;
  if (shown.length === 0) {
    container.innerHTML = `<div class="empty-state"><p>ما في مهام حالياً. قائمتك فاضية! ✨</p></div>`;
    return;
  }
  container.innerHTML = shown.map(todoRowHtml).join('');
  container.querySelectorAll('input[type=checkbox]').forEach(cb => {
    cb.addEventListener('change', async () => {
      await toggleTodo(Number(cb.dataset.todoId));
      await renderTodoList(container, { limit, onlyOpen });
    });
  });
}

function openAddTodoModal(onAdded) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal">
      <h2 class="modal-title">مهمة جديدة</h2>
      <label class="field-label">العنوان</label>
      <input class="text-input" id="new-todo-title" placeholder="اكتبي المهمة هنا" autofocus>
      <label class="field-label">تاريخ الاستحقاق (اختياري)</label>
      <input class="text-input" type="date" id="new-todo-date">
      <div class="modal-actions">
        <button class="btn btn-text" id="new-todo-cancel">إلغاء</button>
        <button class="btn btn-primary" id="new-todo-save">إضافة</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  document.getElementById('new-todo-cancel').addEventListener('click', () => overlay.remove());
  document.getElementById('new-todo-save').addEventListener('click', async () => {
    const title = document.getElementById('new-todo-title').value.trim();
    if (!title) return;
    const date = document.getElementById('new-todo-date').value || null;
    await addTodo(title, date);
    overlay.remove();
    if (onAdded) onAdded();
  });
}

// ===================== full Tasks page =====================

async function renderTasksPage(params, view) {
  view.innerHTML = `
    <div class="page-header">
      <button class="icon-btn" id="tasks-back">→</button>
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
    const tasks = await getActiveFixedTasks();
    const doneSet = await getFixedTasksDoneSet(tasks, todayStr());
    scheduleTodayReminders(tasks, (id) => doneSet.has(id));
  }

  const fixedListEl = document.getElementById('fixed-tasks-list');
  await renderFixedTaskList(fixedListEl, todayStr(), { editable: true, onChange: rescheduleReminders });
  document.getElementById('add-fixed-task-btn').addEventListener('click', () => {
    openAddFixedTaskModal(async () => {
      await renderFixedTaskList(fixedListEl, todayStr(), { editable: true, onChange: rescheduleReminders });
      rescheduleReminders();
    });
  });

  const todoListEl = document.getElementById('custom-todos-list');
  await renderTodoList(todoListEl, {});
  document.getElementById('add-todo-btn').addEventListener('click', () => {
    openAddTodoModal(() => renderTodoList(todoListEl, {}));
  });
}

// ===================== Day Detail providers =====================

async function fixedTasksDayProvider(dateStr) {
  const tasks = await getActiveFixedTasks();
  if (tasks.length === 0) return null;
  const editable = !isFutureDate(dateStr);
  const node = document.createElement('div');
  const rows = await Promise.all(tasks.map(async t => fixedTaskRowHtml(t, await isFixedTaskDone(t.id, dateStr), editable)));
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
  node.innerHTML = todos.map(todoRowHtml).join('');
  node.querySelectorAll('input[type=checkbox]').forEach(cb => {
    cb.addEventListener('change', async () => {
      await toggleTodo(Number(cb.dataset.todoId));
      const fresh = await todosDayProvider(dateStr);
      node.replaceWith(fresh.node);
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
