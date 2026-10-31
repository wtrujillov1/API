import { randomUUID } from 'node:crypto';
import { conflict, notFound } from './errors.js';

function task(row) {
  if (!row) return null;
  return { id: row.id, title: row.title, description: row.description, status: row.status,
    version: row.version, createdAt: row.created_at, updatedAt: row.updated_at };
}

export function repositories(db) {
  const getTask = db.prepare('SELECT * FROM tasks WHERE id = ? AND user_id = ?');
  return {
    users: {
      byName: name => db.prepare('SELECT * FROM users WHERE username = ?').get(name),
      byId: id => db.prepare('SELECT id, username FROM users WHERE id = ?').get(id),
      create({ username, passwordHash, salt }) {
        const user = { id: randomUUID(), username };
        db.prepare('INSERT INTO users(id, username, password_hash, salt, created_at) VALUES (?, ?, ?, ?, ?)')
          .run(user.id, username, passwordHash, salt, new Date().toISOString());
        return user;
      },
    },
    tasks: {
      list: userId => db.prepare('SELECT * FROM tasks WHERE user_id = ? ORDER BY created_at DESC, id').all(userId).map(task),
      get(id, userId) {
        const found = task(getTask.get(id, userId));
        if (!found) throw notFound();
        return found;
      },
      create(userId, input) {
        const id = randomUUID();
        const now = new Date().toISOString();
        db.prepare('INSERT INTO tasks(id, user_id, title, description, status, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?)')
          .run(id, userId, input.title, input.description, input.status, now, now);
        return task(getTask.get(id, userId));
      },
      update(id, userId, input) {
        const current = this.get(id, userId);
        const updated = { ...current, ...input };
        const result = db.prepare('UPDATE tasks SET title = ?, description = ?, status = ?, version = version + 1, updated_at = ? WHERE id = ? AND user_id = ? AND version = ?')
          .run(updated.title, updated.description, updated.status, new Date().toISOString(), id, userId, input.version);
        if (!result.changes) throw conflict();
        return task(getTask.get(id, userId));
      },
      delete(id, userId, version) {
        this.get(id, userId);
        const result = db.prepare('DELETE FROM tasks WHERE id = ? AND user_id = ? AND version = ?').run(id, userId, version);
        if (!result.changes) throw conflict();
        return { id, version };
      },
    },
  };
}
