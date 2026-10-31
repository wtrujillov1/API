import { HttpError } from './errors.js';

function invalid(message) {
  throw new HttpError(400, 'VALIDATION_ERROR', message);
}

function object(body, allowed) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) invalid('Se requiere un objeto JSON.');
  if (Object.keys(body).some(key => !allowed.includes(key))) invalid('Hay campos desconocidos.');
}

export function credentials(body) {
  object(body, ['username', 'password']);
  const username = typeof body.username === 'string' ? body.username.trim() : '';
  if (!/^[A-Za-z0-9_]{3,40}$/.test(username)) invalid('El usuario debe tener entre 3 y 40 letras, números o guiones bajos.');
  if (typeof body.password !== 'string' || body.password.length < 8 || body.password.length > 128) {
    invalid('La contraseña debe tener entre 8 y 128 caracteres.');
  }
  return { username, password: body.password };
}

export function taskInput(body, patch = false) {
  object(body, patch ? ['title', 'description', 'status', 'version'] : ['title', 'description', 'status']);
  const result = {};
  if (!patch || Object.hasOwn(body, 'title')) {
    if (typeof body.title !== 'string' || !body.title.trim() || body.title.includes('\0') || body.title.trim().length > 120) invalid('El título debe tener entre 1 y 120 caracteres, sin caracteres nulos.');
    result.title = body.title.trim();
  }
  if (!patch || Object.hasOwn(body, 'description')) {
    const description = body.description === undefined ? '' : body.description;
    if (typeof description !== 'string' || description.includes('\0') || description.length > 2000) invalid('La descripción debe ser texto de hasta 2000 caracteres, sin caracteres nulos.');
    result.description = description;
  }
  if (!patch || Object.hasOwn(body, 'status')) {
    const status = body.status === undefined ? 'pending' : body.status;
    if (!['pending', 'in_progress', 'completed'].includes(status)) invalid('El estado no es válido.');
    result.status = status;
  }
  if (patch) {
    if (!Number.isSafeInteger(body.version) || body.version < 1) invalid('Se requiere una versión entera positiva.');
    if (!Object.keys(result).length) invalid('Indica al menos un campo para actualizar.');
    result.version = body.version;
  }
  return result;
}

export function deletionVersion(value) {
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value))) invalid('Se requiere el parámetro version entero positivo.');
  return Number(value);
}
