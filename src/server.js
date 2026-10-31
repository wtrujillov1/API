import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { createApp } from './app.js';

const dbPath = resolve(process.env.DATABASE_PATH || './data/tasks.sqlite');
const production = process.env.NODE_ENV === 'production';
let sessionSecret = process.env.SESSION_SECRET;
if (!sessionSecret) {
  if (production) throw new Error('Configura SESSION_SECRET (mínimo 32 caracteres) en producción.');
  const secretPath = resolve(dirname(dbPath), '.session-secret');
  mkdirSync(dirname(secretPath), { recursive: true });
  try { sessionSecret = readFileSync(secretPath, 'utf8').trim(); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    sessionSecret = randomBytes(48).toString('hex');
    writeFileSync(secretPath, sessionSecret, { mode: 0o600, flag: 'wx' });
  }
}
const host = process.env.HOST || '127.0.0.1';
const port = Number(process.env.PORT || 3000);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT debe estar entre 1 y 65535.');
const runtime = createApp({ dbPath, sessionSecret, production, trustProxy: process.env.TRUST_PROXY === '1' });
const server = runtime.app.listen(port, host, () => console.log(`API de tareas escuchando en ${host}:${port}`));
server.on('error', error => { console.error('No se pudo iniciar el servidor:', error.message); runtime.close(); process.exitCode = 1; });
let stopping = false;
function stop() {
  if (stopping) return;
  stopping = true;
  runtime.closeStreams();
  server.close(() => runtime.close());
  server.closeIdleConnections();
  const timeout = setTimeout(() => { server.closeAllConnections(); }, 5000);
  timeout.unref();
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
