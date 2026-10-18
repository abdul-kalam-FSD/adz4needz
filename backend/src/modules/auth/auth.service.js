import { HttpError } from '../../lib/http-error.js';
import { hashPassword, verifyPassword, MAX_PASSWORD_LENGTH } from '../../lib/password.js';
import { generateToken, hashToken } from '../../lib/session-token.js';

const toPublicUser = (row) => ({ id: row.id, employeeId: row.employee_id, name: row.name, role: row.role });
// The longest identifier worth looking up. Real employee IDs are at most 32 characters (validate-employee.js); a longer value cannot match any
// account, so it is refused before a database lookup or a password hash is spent on it.
export const MAX_LOGIN_ID_LENGTH = 64;
const invalid = () => new HttpError(401, 'INVALID_CREDENTIALS', 'Employee ID or password is incorrect.');
// Which sign-in screen the person used. Optional: a request without it behaves exactly as before (any active account may sign in).
// 'admin' = the Admin Sign In tab: only an administrator account may get a session through it. 'employee' = the Employee Sign In tab
// (same as no value; admins are not locked out of it). The role is NEVER taken from the client: it only narrows who may sign in here.
export const LOGIN_PORTALS = ['admin', 'employee'];

export function createAuthService({ repo, ttlHours }) {
  // Used so a login for an unknown ID takes about as long as a real one.
  let dummyHashPromise;
  const dummyHash = () => (dummyHashPromise ||= hashPassword('not-a-real-password'));

  return {
    async login(employeeId, password, portal) {
      if (typeof employeeId !== 'string' || typeof password !== 'string' ||
          employeeId.trim() === '' || employeeId.trim().length > MAX_LOGIN_ID_LENGTH || password === '' || password.length > MAX_PASSWORD_LENGTH) {
        throw new HttpError(400, 'VALIDATION_ERROR', 'Enter your employee ID and password.');
      }
      if (portal !== undefined && portal !== null && !LOGIN_PORTALS.includes(portal)) {
        throw new HttpError(400, 'VALIDATION_ERROR', 'Enter your employee ID and password.'); // unknown sign-in screen: refused before any lookup
      }
      const user = await repo.findUserByEmployeeId(employeeId.trim());
      if (!user || !user.is_active) {
        await verifyPassword(password, await dummyHash());
        throw invalid(); // same message for unknown ID, inactive user and wrong password
      }
      if (!(await verifyPassword(password, user.password_hash))) throw invalid();
      // Admin Sign In: a correct password for a non-admin account is refused with the SAME generic error (no role is revealed) and,
      // above all, BEFORE any session exists, so a BDE can never obtain a session through the admin screen.
      if (portal === 'admin' && user.role !== 'admin') throw invalid();

      const token = generateToken();
      // passwordHash = the hash this login just verified against. The repository refuses (false) when it is no longer
      // the current one, i.e. the password was changed while this login was in progress. Same generic error as any failed login.
      const created = await repo.createSession({ userId: user.id, tokenHash: hashToken(token), ttlHours, passwordHash: user.password_hash });
      if (created === false) throw invalid();
      await repo.deleteExpiredSessionsForUser(user.id);
      return { token, user: toPublicUser(user) };
    },

    async logout(token) {
      if (token) await repo.deleteSessionByHash(hashToken(token));
    },

    async getUserForSession(token) {
      if (typeof token !== 'string' || token === '') return null;
      const row = await repo.findActiveSessionUser(hashToken(token));
      return row ? toPublicUser(row) : null;
    }
  };
}
