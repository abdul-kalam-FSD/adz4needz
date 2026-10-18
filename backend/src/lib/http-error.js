export class HttpError extends Error {
  constructor(status, code, message, fields, details) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
    this.fields = fields;
    this.details = details;
  }
}

// Express 4 does not catch errors from async handlers by itself.
export const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);
