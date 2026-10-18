import { serializeCookie, parseCookies } from '../../lib/cookies.js';

export function createAuthHandlers({ authService, config }) {
  const maxAgeSeconds = config.sessionTtlHours * 3600;
  return {
    async login(req, res) {
      const body = req.body && typeof req.body === 'object' ? req.body : {};
      // portal is optional ('admin' | 'employee'); the service validates it. It can only narrow who may sign in, never grant a role.
      const { token, user } = await authService.login(body.employeeId, body.password, body.portal);
      res.setHeader('Set-Cookie', serializeCookie(config.cookieName, token, { maxAgeSeconds, secure: config.cookieSecure }));
      res.status(200).json({ user });
    },
    async logout(req, res) {
      const token = parseCookies(req.headers.cookie)[config.cookieName];
      await authService.logout(token);
      res.setHeader('Set-Cookie', serializeCookie(config.cookieName, '', { maxAgeSeconds: 0, secure: config.cookieSecure }));
      res.status(204).end();
    },
    async me(req, res) {
      res.status(200).json({ user: req.user });
    }
  };
}
