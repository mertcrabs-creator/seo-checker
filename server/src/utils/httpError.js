export class HttpError extends Error {
  constructor(status, message, code, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
    this.expose = true;
  }
}

export const badRequest = (msg = 'Geçersiz istek', details) => new HttpError(400, msg, 'BAD_REQUEST', details);
export const unauthorized = (msg = 'Oturum geçersiz') => new HttpError(401, msg, 'UNAUTHORIZED');
export const forbidden = (msg = 'Bu işlem için yetkiniz yok') => new HttpError(403, msg, 'FORBIDDEN');
export const notFound = (msg = 'Kayıt bulunamadı') => new HttpError(404, msg, 'NOT_FOUND');
export const conflict = (msg = 'Çakışma') => new HttpError(409, msg, 'CONFLICT');
