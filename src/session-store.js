import session from 'express-session';

export class SQLiteSessionStore extends session.Store {
  constructor(db) {
    super();
    this.db = db;
    this.timer = setInterval(() => db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(Date.now()), 60_000);
    this.timer.unref();
  }

  get(sid, callback) {
    try {
      const row = this.db.prepare('SELECT data FROM sessions WHERE sid = ? AND expires_at > ?').get(sid, Date.now());
      callback(null, row ? JSON.parse(row.data) : null);
    } catch (error) { callback(error); }
  }

  set(sid, data, callback = () => {}) {
    try {
      const expiry = data.cookie.expires ? new Date(data.cookie.expires).getTime() : Date.now() + 8 * 60 * 60 * 1000;
      this.db.prepare('INSERT INTO sessions(sid, data, expires_at) VALUES (?, ?, ?) ON CONFLICT(sid) DO UPDATE SET data = excluded.data, expires_at = excluded.expires_at')
        .run(sid, JSON.stringify(data), expiry);
      callback(null);
    } catch (error) { callback(error); }
  }

  destroy(sid, callback = () => {}) {
    try {
      this.db.prepare('DELETE FROM sessions WHERE sid = ?').run(sid);
      callback(null);
    } catch (error) { callback(error); }
  }

  close() { clearInterval(this.timer); }
}
