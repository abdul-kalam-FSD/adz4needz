import { parseCookies } from '../lib/cookies.js';
import { HttpError } from '../lib/http-error.js';

// Finds the logged-in user from the session cookie. Never trusts a user id sent by the browser.
export function createAuthenticate({ authService, cookieName }) {
  return async function authenticate(req, res, next) {
    try {
      const token = parseCookies(req.headers.cookie)[cookieName];
      const user = await authService.getUserForSession(token);
      if (!user) return next(new HttpError(401, 'UNAUTHENTICATED', 'Please log in to continue.'));
      req.user = user;
      next();
    } catch (err) {
      next(err);
    }
  };
}

export function authorize(...roles) {
  return function authorizeRole(req, res, next) {
    if (!req.user || !roles.includes(req.user.role)) {
      return next(new HttpError(403, 'FORBIDDEN', 'You do not have access to this resource.'));
    }
    next();
  };
}
