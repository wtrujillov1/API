import express from 'express';
import session from 'express-session';
import { fileURLToPath } from 'node:url';
import { openDatabase } from './database.js';
import { repositories } from './repositories.js';
import { SQLiteSessionStore } from './session-store.js';
import { credentials, taskInput, deletionVersion } from './validation.js';
import { hashPassword, verifyPassword, regenerate, saveSession, loginLimiter } from './auth.js';
import { HttpError, notFound } from './errors.js';
import { eventHub } from './events.js';

export function createApp({ dbPath = ':memory:', sessionSecret, logger = console, production = false, trustProxy = false } = {}) {
  if (typeof sessionSecret !== 'string' || sessionSecret.length < 32) throw new Error('SESSION_SECRET debe tener al menos 32 caracteres.');
  const db = openDatabase(dbPath);
  const repo = repositories(db);
  const store = new SQLiteSessionStore(db);
  const events = eventHub(store);
  const app = express();
  app.disable('x-powered-by');
  if (trustProxy) app.set('trust proxy', 1);
  app.use((req, res, next) => {
    res.set({ 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'same-origin',
      'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'" });
    if (req.path.startsWith('/api/')) res.set('Cache-Control', 'no-store');
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      const origin = req.get('origin');
      if (origin && origin !== `${req.protocol}://${req.get('host')}`) return next(new HttpError(403, 'FORBIDDEN_ORIGIN', 'El origen de la petición no está permitido.'));
      if ((req.headers['transfer-encoding'] || Number(req.headers['content-length']) > 0) && !req.is('application/json')) {
        return next(new HttpError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Envía el cuerpo como application/json.'));
      }
    }
    next();
  });
  app.use(express.json({ limit: '16kb' }));
  app.get('/api/health', (req, res) => {
    db.prepare('SELECT 1').get();
    res.json({ data: { status: 'ok' } });
  });
  app.use('/api', session({ name: 'tasks.sid', secret: sessionSecret, store, resave: false, saveUninitialized: false,
    cookie: { httpOnly: true, sameSite: 'strict', secure: production, maxAge: 8 * 60 * 60 * 1000 } }));
  const limiter = loginLimiter();
  app.post('/api/auth/register', limiter, async (req, res) => {
    const input = credentials(req.body);
    const password = await hashPassword(input.password);
    let user;
    try { user = repo.users.create({ username: input.username, ...password }); }
    catch (error) {
      if (error.errcode === 2067) throw new HttpError(409, 'USERNAME_TAKEN', 'El nombre de usuario ya está registrado.');
      throw error;
    }
    await regenerate(req);
    req.session.userId = user.id;
    await saveSession(req);
    res.status(201).json({ data: user });
  });
  app.post('/api/auth/login', limiter, async (req, res) => {
    const input = credentials(req.body);
    const user = repo.users.byName(input.username);
    if (!await verifyPassword(input.password, user)) throw new HttpError(401, 'INVALID_CREDENTIALS', 'Usuario o contraseña incorrectos.');
    const oldSid = req.sessionID;
    await regenerate(req);
    events.logout(oldSid);
    req.session.userId = user.id;
    await saveSession(req);
    res.json({ data: { id: user.id, username: user.username } });
  });
  function authenticated(req, res, next) {
    const user = req.session.userId && repo.users.byId(req.session.userId);
    if (!user) return next(new HttpError(401, 'UNAUTHORIZED', 'Inicia sesión para continuar.'));
    req.user = user;
    next();
  }
  app.get('/api/auth/me', authenticated, (req, res) => res.json({ data: req.user }));
  app.post('/api/auth/logout', authenticated, async (req, res) => {
    const sid = req.sessionID;
    await new Promise((resolve, reject) => req.session.destroy(error => error ? reject(error) : resolve()));
    events.logout(sid);
    res.clearCookie('tasks.sid', { httpOnly: true, sameSite: 'strict', secure: production });
    res.status(204).end();
  });
  app.get('/api/events', authenticated, (req, res) => events.connect(req, res));
  app.use('/api/tasks', authenticated);
  app.get('/api/tasks', (req, res) => res.json({ data: repo.tasks.list(req.user.id) }));
  app.get('/api/tasks/:id', (req, res) => res.json({ data: repo.tasks.get(req.params.id, req.user.id) }));
  app.post('/api/tasks', async (req, res) => {
    const data = repo.tasks.create(req.user.id, taskInput(req.body));
    await events.publish(req.user.id, 'task.created', data);
    res.location(`/api/tasks/${data.id}`).status(201).json({ data });
  });
  app.patch('/api/tasks/:id', async (req, res) => {
    const data = repo.tasks.update(req.params.id, req.user.id, taskInput(req.body, true));
    await events.publish(req.user.id, 'task.updated', data);
    res.json({ data });
  });
  app.delete('/api/tasks/:id', async (req, res) => {
    const data = repo.tasks.delete(req.params.id, req.user.id, deletionVersion(req.query.version));
    await events.publish(req.user.id, 'task.deleted', data);
    res.status(204).end();
  });
  app.use(express.static(fileURLToPath(new URL('../public', import.meta.url))));
  app.use((req, res, next) => next(notFound()));
  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    let normalized = error;
    if (error.type === 'entity.parse.failed') normalized = new HttpError(400, 'INVALID_JSON', 'El JSON no es válido.');
    else if ((error.status === 400 && error.expose === true) || (error instanceof URIError && error.status === 400)) normalized = new HttpError(400, 'INVALID_REQUEST', 'El cuerpo o la dirección de la petición no son válidos.');
    else if (error.type === 'entity.too.large') normalized = new HttpError(413, 'PAYLOAD_TOO_LARGE', 'El cuerpo supera el límite de 16 KB.');
    else if (['charset.unsupported', 'encoding.unsupported'].includes(error.type)) normalized = new HttpError(415, 'UNSUPPORTED_MEDIA_TYPE', 'La codificación del cuerpo no está admitida.');
    else if (error.code === 'ERR_SQLITE_ERROR' && [5, 6].includes(error.errcode)) normalized = new HttpError(503, 'DATABASE_BUSY', 'La base de datos está ocupada. Vuelve a intentarlo.');
    if (!(normalized instanceof HttpError)) {
      logger.error('Error interno:', error);
      normalized = new HttpError(500, 'INTERNAL_ERROR', 'Ocurrió un error interno.');
    }
    const body = { code: normalized.code, message: normalized.message };
    if (normalized.details) body.details = normalized.details;
    res.status(normalized.status).json({ error: body });
  });
  let closed = false;
  return { app, db, closeStreams: () => events.close(), close() { if (closed) return; closed = true; events.close(); store.close(); db.close(); } };
}
