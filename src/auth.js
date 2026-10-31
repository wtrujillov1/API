import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { HttpError } from './errors.js';

const scrypt = promisify(scryptCallback);

export async function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const hash = await scrypt(password, salt, 64);
  return { salt, passwordHash: hash.toString('hex') };
}

export async function verifyPassword(password, user) {
  // También calcula scrypt para usuarios inexistentes y evita una salida inmediata.
  const hash = await scrypt(password, user?.salt ?? '00000000000000000000000000000000', 64);
  return Boolean(user) && timingSafeEqual(hash, Buffer.from(user.password_hash, 'hex'));
}

export const regenerate = req => new Promise((resolve, reject) => req.session.regenerate(error => error ? reject(error) : resolve()));
export const saveSession = req => new Promise((resolve, reject) => req.session.save(error => error ? reject(error) : resolve()));

export function loginLimiter() {
  const buckets = new Map();
  const windowMs = 15 * 60 * 1000;
  return (req, res, next) => {
    const now = Date.now();
    for (const [key, bucket] of buckets) if (bucket.reset <= now) buckets.delete(key);
    const key = req.ip;
    const bucket = buckets.get(key) ?? { count: 0, reset: now + windowMs };
    bucket.count += 1;
    buckets.set(key, bucket);
    if (bucket.count > 30) {
      res.set('Retry-After', String(Math.ceil((bucket.reset - now) / 1000)));
      return next(new HttpError(429, 'RATE_LIMITED', 'Demasiados intentos. Espera unos minutos.'));
    }
    next();
  };
}
