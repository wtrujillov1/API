'use strict';

const $ = (selector) => document.querySelector(selector);
const labels = { pending: 'Pendiente', in_progress: 'En curso', completed: 'Completada' };
const dateFormat = new Intl.DateTimeFormat('es', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
let tasks = [];
let currentUser = null;
let registering = false;
let activeFilter = 'all';
let events = null;
let editingTask = null;
let refreshGeneration = 0;

function notify(message, isError = false) {
  const notice = $('#notice');
  notice.textContent = message;
  notice.classList.toggle('error', isError);
  notice.hidden = !message;
  const editNotice = $('#edit-notice');
  editNotice.textContent = isError ? message : '';
  editNotice.hidden = !isError || !message;
}

async function request(path, options = {}) {
  const response = await fetch(path, {
    credentials: 'same-origin',
    ...options,
    headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers },
  });
  const payload = response.status === 204 ? null : await response.json();
  if (!response.ok) {
    const error = new Error(payload?.error?.message || 'No se pudo completar la solicitud.');
    error.status = response.status;
    error.code = payload?.error?.code;
    if (response.status === 401 && currentUser) showAuth();
    throw error;
  }
  return payload?.data;
}

function showAuth() {
  currentUser = null;
  refreshGeneration += 1;
  tasks = [];
  events?.close();
  events = null;
  $('#edit-dialog').close();
  $('#auth-view').hidden = false;
  $('#workspace-view').hidden = true;
  $('#account').hidden = true;
  $('#auth-password').value = '';
}

async function showWorkspace(user) {
  currentUser = user;
  $('#username').textContent = user.username;
  $('#auth-view').hidden = true;
  $('#workspace-view').hidden = false;
  $('#account').hidden = false;
  $('#auth-password').value = '';
  notify('');
  await refreshTasks();
  if (currentUser) connectEvents();
}

async function refreshTasks() {
  const generation = ++refreshGeneration;
  const data = await request('/api/tasks');
  if (generation !== refreshGeneration || !currentUser) return;
  tasks = data;
  renderTasks();
}

function setConnection(message, connected = false) {
  $('#connection').textContent = message;
  $('#connection').classList.toggle('connected', connected);
}

function connectEvents() {
  events?.close();
  setConnection('Conectando…');
  events = new EventSource('/api/events');
  events.addEventListener('ready', () => {
    setConnection('En tiempo real', true);
    // Refresh on every connection, including reconnects after a missed event.
    refreshTasks().catch(handleError);
  });
  for (const eventName of ['task.created', 'task.updated', 'task.deleted']) {
    events.addEventListener(eventName, () => refreshTasks().catch(handleError));
  }
  events.onerror = async () => {
    setConnection('Reconectando…');
    try {
      await request('/api/auth/me');
    } catch (error) {
      if (error.status === 401) notify('Tu sesión terminó. Inicia sesión de nuevo.', true);
    }
  };
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function renderTasks() {
  const list = $('#task-list');
  list.replaceChildren();
  $('#task-count').textContent = String(tasks.length);
  const visible = tasks.filter((task) => activeFilter === 'all' || task.status === activeFilter);
  $('#empty-state').hidden = visible.length !== 0;
  for (const task of visible) {
    const card = element('article', `task-card ${task.status}`);
    const top = element('div', 'task-top');
    top.append(element('h3', '', task.title), element('span', `task-badge ${task.status}`, labels[task.status] || task.status));
    card.append(top);
    if (task.description) card.append(element('p', 'task-description', task.description));
    const bottom = element('div', 'task-bottom');
    const date = new Date(task.updatedAt);
    bottom.append(element('span', 'task-meta', `${Number.isNaN(date.getTime()) ? '' : dateFormat.format(date)} · v${task.version}`));
    const actions = element('div', 'task-actions');
    const edit = element('button', '', 'Editar');
    edit.type = 'button';
    edit.setAttribute('aria-label', `Editar ${task.title}`);
    edit.addEventListener('click', () => openEditor(task));
    const remove = element('button', 'delete', 'Eliminar');
    remove.type = 'button';
    remove.setAttribute('aria-label', `Eliminar ${task.title}`);
    remove.addEventListener('click', () => deleteTask(task, remove));
    actions.append(edit, remove);
    bottom.append(actions);
    card.append(bottom);
    list.append(card);
  }
}

function openEditor(task) {
  editingTask = { ...task };
  $('#edit-notice').hidden = true;
  $('#edit-task-title').value = task.title;
  $('#edit-description').value = task.description;
  $('#edit-status').value = task.status;
  $('#edit-dialog').showModal();
}

async function handleError(error) {
  if (error.status === 409 && error.code === 'VERSION_CONFLICT') {
    notify('Hay cambios de otra pestaña. Actualizamos la lista; cierra la edición y abre la versión más reciente antes de intentarlo de nuevo.', true);
    if (currentUser) {
      try { await refreshTasks(); } catch { /* Preserve the original conflict message. */ }
    }
    return;
  }
  notify(error.message || 'No se pudo conectar con el servidor. Inténtalo de nuevo.', true);
}

async function withBusy(form, action) {
  const button = form.querySelector('button[type="submit"]');
  button.disabled = true;
  try { await action(); } catch (error) { await handleError(error); }
  finally { button.disabled = false; }
}

async function deleteTask(task, button) {
  if (!window.confirm(`¿Eliminar la tarea «${task.title}»? Esta acción no se puede deshacer.`)) return;
  button.disabled = true;
  try {
    await request(`/api/tasks/${encodeURIComponent(task.id)}?version=${encodeURIComponent(task.version)}`, { method: 'DELETE' });
    await refreshTasks();
    notify('Tarea eliminada.');
  } catch (error) { await handleError(error); }
  finally { button.disabled = false; }
}

$('#auth-switch').addEventListener('click', () => {
  registering = !registering;
  $('#auth-title').textContent = registering ? 'Hazlo tuyo.' : 'Empieza por aquí.';
  $('#auth-description').textContent = registering ? 'Crea una cuenta para organizar tus pendientes.' : 'Inicia sesión para continuar con tus tareas.';
  $('#auth-submit').textContent = registering ? 'Crear mi espacio ↗' : 'Entrar a mi espacio ↗';
  $('#auth-switch-label').textContent = registering ? '¿Ya tienes una cuenta?' : '¿Es tu primera visita?';
  $('#auth-switch').textContent = registering ? 'Iniciar sesión' : 'Crear una cuenta';
  $('#auth-password').autocomplete = registering ? 'new-password' : 'current-password';
  notify('');
});

$('#auth-form').addEventListener('submit', (event) => {
  event.preventDefault();
  withBusy(event.currentTarget, async () => {
    const user = await request(`/api/auth/${registering ? 'register' : 'login'}`, {
      method: 'POST', body: JSON.stringify({ username: $('#auth-username').value.trim(), password: $('#auth-password').value }),
    });
    await showWorkspace(user);
  });
});

$('#logout').addEventListener('click', async () => {
  try {
    await request('/api/auth/logout', { method: 'POST' });
    showAuth();
    notify('Sesión cerrada. Tus tareas siguen guardadas.');
  } catch (error) { await handleError(error); }
});

$('#create-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  withBusy(form, async () => {
    await request('/api/tasks', { method: 'POST', body: JSON.stringify({ title: $('#new-title').value.trim(), description: $('#new-description').value.trim(), status: $('#new-status').value }) });
    form.reset();
    await refreshTasks();
    notify('Una nueva tarea, un paso más.');
    $('#new-title').focus();
  });
});

$('#edit-form').addEventListener('submit', (event) => {
  event.preventDefault();
  withBusy(event.currentTarget, async () => {
    await request(`/api/tasks/${encodeURIComponent(editingTask.id)}`, { method: 'PATCH', body: JSON.stringify({ title: $('#edit-task-title').value.trim(), description: $('#edit-description').value.trim(), status: $('#edit-status').value, version: editingTask.version }) });
    $('#edit-dialog').close();
    await refreshTasks();
    notify('Cambios guardados.');
  });
});

$('#close-edit').addEventListener('click', () => $('#edit-dialog').close());
$('#refresh').addEventListener('click', () => refreshTasks().then(() => notify('Lista actualizada.')).catch(handleError));
for (const filter of document.querySelectorAll('[data-filter]')) {
  filter.addEventListener('click', () => {
    activeFilter = filter.dataset.filter;
    for (const button of document.querySelectorAll('[data-filter]')) {
      const active = button === filter;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    }
    renderTasks();
  });
}

request('/api/auth/me').then(showWorkspace).catch((error) => {
  showAuth();
  if (error.status !== 401) handleError(error);
});
