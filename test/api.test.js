import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createApp } from '../src/app.js';

const secret = 'test-only-secret-at-least-thirty-two-characters';
const password = 'example-password-123';

async function start(dbPath) {
  const instance = createApp({ dbPath, sessionSecret: secret });
  const server = instance.app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const baseURL = `http://127.0.0.1:${server.address().port}`;
  let closed = false;
  return {
    baseURL,
    db: instance.db,
    async request(resource, { method = 'GET', body, cookie, headers = {} } = {}) {
      return fetch(baseURL + resource, {
        method,
        headers: {
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
          ...(cookie ? { Cookie: cookie } : {}),
          ...headers,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(5000),
      });
    },
    async close() {
      if (closed) return;
      closed = true;
      await new Promise((resolve, reject) => {
        server.close(error => error ? reject(error) : resolve());
        server.closeAllConnections();
      });
      await instance.close();
    },
  };
}

async function fixture(t) {
  const directory = await mkdtemp(path.join(tmpdir(), 'tasks-api-test-'));
  const dbPath = path.join(directory, 'tasks.sqlite');
  const running = await start(dbPath);
  t.after(async () => {
    await running.close();
    await rm(directory, { recursive: true, force: true });
  });
  return { ...running, dbPath };
}

async function register(api, username = 'alice') {
  const response = await api.request('/api/auth/register', {
    method: 'POST', body: { username, password },
  });
  assert.equal(response.status, 201);
  const json = await response.json();
  assert.equal(json.data.username, username);
  assert.ok(json.data.id);
  assert.equal('password' in json.data, false);
  assert.equal('passwordHash' in json.data, false);
  const setCookie = response.headers.get('set-cookie');
  assert.ok(setCookie, 'registration must establish a session');
  return { cookie: setCookie.split(';')[0], user: json.data };
}

async function errorResponse(response, status) {
  assert.equal(response.status, status);
  assert.match(response.headers.get('content-type'), /application\/json/);
  const json = await response.json();
  assert.equal(typeof json.error?.code, 'string');
  assert.equal(typeof json.error?.message, 'string');
  return json.error;
}

async function createTask(api, cookie, body = { title: 'Preparar entrega' }) {
  const response = await api.request('/api/tasks', { method: 'POST', cookie, body });
  assert.equal(response.status, 201);
  return (await response.json()).data;
}

test('health verifies the running API and protected routes reject anonymous requests', async t => {
  const api = await fixture(t);
  const response = await api.request('/api/health');
  assert.equal(response.status, 200);
  assert.equal((await response.json()).data.status, 'ok');
  for (const endpoint of ['/api/auth/me', '/api/tasks', '/api/events']) {
    await errorResponse(await api.request(endpoint), 401);
  }
});

test('registration, duplicate account, login and logout use persisted sessions', async t => {
  const api = await fixture(t);
  const account = await register(api);
  const current = await api.request('/api/auth/me', { cookie: account.cookie });
  assert.equal(current.status, 200);
  assert.equal((await current.json()).data.id, account.user.id);
  await errorResponse(await api.request('/api/auth/register', {
    method: 'POST', body: { username: 'alice', password },
  }), 409);
  await errorResponse(await api.request('/api/auth/login', {
    method: 'POST', body: { username: 'alice', password: 'incorrect-password' },
  }), 401);
  const login = await api.request('/api/auth/login', {
    method: 'POST', body: { username: 'alice', password },
  });
  assert.equal(login.status, 200);
  assert.equal((await login.json()).data.id, account.user.id);
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const logout = await api.request('/api/auth/logout', { method: 'POST', cookie });
  assert.equal(logout.status, 204);
  assert.equal(await logout.text(), '');
  await errorResponse(await api.request('/api/auth/me', { cookie }), 401);
});

test('CRUD returns canonical tasks and prevents stale writes and deletes', async t => {
  const api = await fixture(t);
  const { cookie } = await register(api);
  const task = await createTask(api, cookie, { title: '  Documentar API  ', description: 'Ejemplos de uso' });
  assert.equal(task.title, 'Documentar API');
  assert.equal(task.description, 'Ejemplos de uso');
  assert.equal(task.status, 'pending');
  assert.equal(task.version, 1);
  assert.match(task.id, /^[0-9a-f-]{36}$/i);
  assert.ok(Number.isFinite(Date.parse(task.createdAt)));
  assert.ok(Number.isFinite(Date.parse(task.updatedAt)));
  const list = await api.request('/api/tasks', { cookie });
  assert.equal(list.status, 200);
  assert.deepEqual((await list.json()).data, [task]);
  const updatedResponse = await api.request(`/api/tasks/${task.id}`, {
    method: 'PATCH', cookie, body: { status: 'completed', version: 1 },
  });
  assert.equal(updatedResponse.status, 200);
  const updated = (await updatedResponse.json()).data;
  assert.equal(updated.status, 'completed');
  assert.equal(updated.version, 2);
  assert.equal(updated.createdAt, task.createdAt);
  await errorResponse(await api.request(`/api/tasks/${task.id}`, {
    method: 'PATCH', cookie, body: { title: 'Stale write', version: 1 },
  }), 409);
  await errorResponse(await api.request(`/api/tasks/${task.id}?version=1`, {
    method: 'DELETE', cookie,
  }), 409);
  const deleted = await api.request(`/api/tasks/${task.id}?version=2`, { method: 'DELETE', cookie });
  assert.equal(deleted.status, 204);
  assert.equal(await deleted.text(), '');
  assert.deepEqual((await (await api.request('/api/tasks', { cookie })).json()).data, []);
  await errorResponse(await api.request(`/api/tasks/${task.id}?version=2`, {
    method: 'DELETE', cookie,
  }), 404);
});

test('invalid credentials, malformed JSON and invalid tasks use uniform errors', async t => {
  const api = await fixture(t);
  for (const body of [
    { username: 'ab', password },
    { username: 'bad name', password },
    { username: 'alice', password: 'short' },
  ]) {
    await errorResponse(await api.request('/api/auth/register', { method: 'POST', body }), 400);
  }
  const { cookie } = await register(api);
  for (const body of [
    {}, { title: '' }, { title: '   ' }, { title: 12 },
    { title: 'x'.repeat(121) },
    { title: 'Valid', description: 'x'.repeat(2001) },
    { title: 'Valid', status: 'unknown' },
    { title: '\u0000' },
    { title: 'Valid', description: 'Text\u0000after null' },
  ]) {
    await errorResponse(await api.request('/api/tasks', { method: 'POST', cookie, body }), 400);
  }
  const task = await createTask(api, cookie);
  for (const body of [{ title: 'Missing version' }, { status: 'unknown', version: 1 }, { title: 'Valid', version: 0 }]) {
    await errorResponse(await api.request(`/api/tasks/${task.id}`, { method: 'PATCH', cookie, body }), 400);
  }
  await errorResponse(await api.request(`/api/tasks/${task.id}`, { method: 'DELETE', cookie }), 400);
  const malformed = await fetch(api.baseURL + '/api/tasks', {
    method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' },
    body: '{"title":', signal: AbortSignal.timeout(5000),
  });
  await errorResponse(malformed, 400);
});

test('users cannot list, modify or delete another user’s tasks', async t => {
  const api = await fixture(t);
  const alice = await register(api, 'alice');
  const bob = await register(api, 'bob');
  const task = await createTask(api, alice.cookie);
  assert.deepEqual((await (await api.request('/api/tasks', { cookie: bob.cookie })).json()).data, []);
  await errorResponse(await api.request(`/api/tasks/${task.id}`, {
    method: 'PATCH', cookie: bob.cookie, body: { title: 'Changed by Bob', version: 1 },
  }), 404);
  await errorResponse(await api.request(`/api/tasks/${task.id}?version=1`, {
    method: 'DELETE', cookie: bob.cookie,
  }), 404);
  const own = (await (await api.request('/api/tasks', { cookie: alice.cookie })).json()).data;
  assert.equal(own.length, 1);
  assert.equal(own[0].title, task.title);
});

test('SQL metacharacters are stored as data and do not modify database structure', async t => {
  const api = await fixture(t);
  const { cookie } = await register(api);
  const title = "O'Reilly'); DROP TABLE tasks; --";
  const task = await createTask(api, cookie, { title });
  assert.equal(task.title, title);
  const second = await createTask(api, cookie, { title: 'Tabla intacta' });
  const listed = (await (await api.request('/api/tasks', { cookie })).json()).data;
  assert.equal(listed.length, 2);
  assert.ok(listed.some(item => item.id === second.id));
});

test('tasks and session remain available after closing and reopening the application', async t => {
  const api = await fixture(t);
  const { cookie, user } = await register(api);
  const task = await createTask(api, cookie);
  await api.close();
  const reopened = await start(api.dbPath);
  try {
    const me = await reopened.request('/api/auth/me', { cookie });
    assert.equal(me.status, 200);
    assert.equal((await me.json()).data.id, user.id);
    const list = await reopened.request('/api/tasks', { cookie });
    assert.equal(list.status, 200);
    assert.deepEqual((await list.json()).data, [task]);
  } finally {
    await reopened.close();
  }
});

async function openEvents(api, cookie) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new Error('SSE event timeout')), 7000);
  let reader;
  try {
    const response = await fetch(api.baseURL + '/api/events', {
      headers: { Cookie: cookie }, signal: controller.signal,
    });
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /text\/event-stream/);
    reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    return {
      async next(wanted) {
        while (true) {
          let separator = buffer.indexOf('\n\n');
          while (separator !== -1) {
            const block = buffer.slice(0, separator);
            buffer = buffer.slice(separator + 2);
            const lines = block.split('\n');
            const type = lines.find(line => line.startsWith('event:'))?.slice(6).trim();
            const data = lines.filter(line => line.startsWith('data:')).map(line => line.slice(5).trim()).join('\n');
            if (type === wanted) return JSON.parse(data);
            separator = buffer.indexOf('\n\n');
          }
          const chunk = await reader.read();
          assert.equal(chunk.done, false, `stream ended before ${wanted}`);
          buffer += decoder.decode(chunk.value, { stream: true }).replace(/\r\n/g, '\n');
        }
      },
      async ended() {
        let trailing = buffer;
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) return trailing;
          trailing += decoder.decode(chunk.value, { stream: true });
        }
      },
      async close() {
        clearTimeout(timeout);
        controller.abort();
        try { await reader.cancel(); } catch { /* aborted connection is already closed */ }
      },
    };
  } catch (error) {
    clearTimeout(timeout);
    controller.abort();
    throw error;
  }
}

test('authenticated SSE delivers private creation, update and deletion notifications', { timeout: 12000 }, async t => {
  const api = await fixture(t);
  const { cookie } = await register(api);
  const other = await register(api, 'bob');
  const events = await openEvents(api, cookie);
  try {
    assert.equal((await events.next('ready')).data.connected, true);
    await createTask(api, other.cookie, { title: 'Private Bob task' });
    const task = await createTask(api, cookie);
    assert.equal((await events.next('task.created')).data.id, task.id);
    const response = await api.request(`/api/tasks/${task.id}`, {
      method: 'PATCH', cookie, body: { status: 'in_progress', version: 1 },
    });
    assert.equal(response.status, 200);
    const updated = (await events.next('task.updated')).data;
    assert.equal(updated.id, task.id);
    assert.equal(updated.status, 'in_progress');
    assert.equal(updated.version, 2);
    const deletion = await api.request(`/api/tasks/${task.id}?version=2`, { method: 'DELETE', cookie });
    assert.equal(deletion.status, 204);
    assert.equal((await events.next('task.deleted')).data.id, task.id);
  } finally {
    await events.close();
  }
});


test('simultaneous updates of one version produce one success and one conflict', async t => {
  const api = await fixture(t);
  const { cookie } = await register(api);
  const task = await createTask(api, cookie);
  const responses = await Promise.all(['First edit', 'Second edit'].map(title => api.request(`/api/tasks/${task.id}`, {
    method: 'PATCH', cookie, body: { title, version: 1 },
  })));
  assert.deepEqual(responses.map(response => response.status).sort(), [200, 409]);
  const read = await api.request(`/api/tasks/${task.id}`, { cookie });
  assert.equal(read.status, 200);
  const saved = (await read.json()).data;
  assert.equal(saved.version, 2);
  assert.ok(['First edit', 'Second edit'].includes(saved.title));
});

test('invalid HTTP bodies, foreign origins and invalid URL encoding are client errors', async t => {
  const api = await fixture(t);
  const { cookie } = await register(api);
  const raw = async (headers, body) => fetch(api.baseURL + '/api/tasks', {
    method: 'POST', headers: { Cookie: cookie, ...headers }, body,
    signal: AbortSignal.timeout(5000),
  });
  await errorResponse(await raw({ 'Content-Type': 'text/plain' }, 'title=test'), 415);
  await errorResponse(await raw({ 'Content-Type': 'application/json; charset=iso-8859-1' }, '{}'), 415);
  await errorResponse(await raw({ 'Content-Type': 'application/json', 'Content-Encoding': 'unknown' }, '{}'), 415);
  await errorResponse(await raw({ 'Content-Type': 'application/json', 'Content-Encoding': 'gzip' }, 'invalid gzip'), 400);
  await errorResponse(await raw({ 'Content-Type': 'application/json' }, JSON.stringify({ title: 'x'.repeat(17000) })), 413);
  await errorResponse(await api.request('/api/tasks', {
    method: 'POST', cookie, headers: { Origin: 'https://foreign.example' }, body: { title: 'CSRF attempt' },
  }), 403);
  await errorResponse(await api.request('/api/tasks/%E0%A4%A', { cookie }), 400);
});

test('expired session cookies cannot access protected data', async t => {
  const api = await fixture(t);
  const { cookie } = await register(api);
  await createTask(api, cookie);
  api.db.prepare('UPDATE sessions SET expires_at = ?').run(Date.now() - 1);
  await errorResponse(await api.request('/api/auth/me', { cookie }), 401);
  await errorResponse(await api.request('/api/tasks', { cookie }), 401);
});

test('logout closes the existing SSE connection immediately', { timeout: 12000 }, async t => {
  const api = await fixture(t);
  const { cookie } = await register(api);
  const events = await openEvents(api, cookie);
  try {
    await events.next('ready');
    assert.equal((await api.request('/api/auth/logout', { method: 'POST', cookie })).status, 204);
    assert.equal(await events.ended(), '');
  } finally {
    await events.close();
  }
});

test('SSE rechecks session expiry before sending a task notification', { timeout: 12000 }, async t => {
  const api = await fixture(t);
  const { cookie } = await register(api);
  const events = await openEvents(api, cookie);
  try {
    await events.next('ready');
    const fresh = await api.request('/api/auth/login', { method: 'POST', body: { username: 'alice', password } });
    assert.equal(fresh.status, 200);
    const freshCookie = fresh.headers.get('set-cookie').split(';')[0];
    const oldSid = decodeURIComponent(cookie.slice(cookie.indexOf('=') + 1)).slice(2).split('.')[0];
    assert.equal(api.db.prepare('UPDATE sessions SET expires_at = ? WHERE sid = ?').run(Date.now() - 1, oldSid).changes, 1);
    await createTask(api, freshCookie);
    assert.equal(await events.ended(), '', 'expired stream must terminate without disclosing a new event');
  } finally {
    await events.close();
  }
});
