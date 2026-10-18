import { parseCookies } from '../../lib/cookies.js';

// Profile of the logged-in user only. The user always comes from the session (req.user), never from the request.
export function createUserHandlers({ userService, config }) {
  return {
    async profile(req, res) { res.status(200).json({ profile: await userService.getProfile(req.user) }); },
    async updateProfile(req, res) { res.status(200).json({ profile: await userService.updateProfile(req.user, req.body) }); },
    async changePassword(req, res) {
      // The caller's own session token (from the cookie) tells the service which session to keep.
      const token = parseCookies(req.headers.cookie)[config.cookieName];
      await userService.changePassword(req.user, token, req.body);
      res.status(200).json({ changed: true, message: 'Your password was changed. Sessions that were already open on your other devices were signed out.' });
    }
  };
}
