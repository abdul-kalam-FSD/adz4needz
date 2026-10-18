import { HttpError } from '../lib/http-error.js';

// JSON-only requests: a cross-site HTML form cannot send application/json, which (together with
// SameSite=Lax cookies) blocks cross-site request forgery for this API.
export function requireJsonBody(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const type = String(req.headers['content-type'] || '').toLowerCase();
  if (!type.startsWith('application/json')) {
    return next(new HttpError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Requests must be sent as application/json.'));
  }
  next();
}

export function notFound(req, res, next) {
  next(new HttpError(404, 'NOT_FOUND', 'Resource not found.'));
}

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: { code: err.code, message: err.message, fields: err.fields, details: err.details } });
  }
  if (err && err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: { code: 'INVALID_JSON', message: 'Request body is not valid JSON.' } });
  }
  if (err && err.type === 'entity.too.large') {
    return res.status(413).json({ error: { code: 'PAYLOAD_TOO_LARGE', message: 'Request body is too large.' } });
  }
  console.error('Unhandled error:', err && err.stack ? err.stack : err); // server log only
  res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Something went wrong. Please try again.' } });
}
