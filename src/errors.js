export class HttpError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const notFound = () => new HttpError(404, 'NOT_FOUND', 'No se encontró el recurso.');
export const conflict = () => new HttpError(409, 'VERSION_CONFLICT', 'La tarea cambió. Actualiza la lista antes de volver a intentarlo.');
