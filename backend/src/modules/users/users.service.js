import { HttpError } from '../../lib/http-error.js';
import { hashPassword, verifyPassword } from '../../lib/password.js';
import { hashToken } from '../../lib/session-token.js';
import { validateProfileUpdate, validatePasswordChange } from '../../lib/validate-profile.js';

// Explicit column mapping: password_hash (or anything else in the row) can never leak into a response.
const toProfile = (row) => ({
  id: row.id, employeeId: row.employee_id, name: row.name, role: row.role,
  phone: row.phone ?? null, email: row.email ?? null, createdAt: row.created_at
});
const validationError = (errors) => new HttpError(400, 'VALIDATION_ERROR', 'Please fix the highlighted fields.', errors);
const unauthenticated = () => new HttpError(401, 'UNAUTHENTICATED', 'Please log in to continue.');
// Server log only, and only an error code: never the password, token, hash or the driver's message.
const logFailure = (step, err) => console.error(`change-password: ${step} failed (${(err && err.code) || (err && err.name) || 'error'})`);

// A database error that came back FROM the server (it carries an SQLSTATE and the connection is still usable) means the
// statement was refused and rolled back. Anything else (connection lost, timeout, odd driver result) leaves the outcome
// UNKNOWN: the server may have committed the change before the answer was lost. Unknown is the safe default.
const isServerRejection = (err) => !!err && typeof err.sqlState === 'string' && err.sqlState !== '' && err.fatal !== true;

// Messages say only what is known. "was NOT changed" is used only when we never sent the update or the server refused it.
const MSG = {
  invalidation: 'Your password was NOT changed, because your other sessions could not be signed out. Please try again.',
  rejected: 'Your password was not changed: the database refused the update. Your other sessions may already have been signed out. Please try again.',
  unconfirmed: 'We could not confirm whether your password was changed, because the database connection failed while saving it. Log out and log in again: try your NEW password first, and if that does not work, your OLD password. Then change your password again if you still want to.',
  concurrent: 'Your password was changed by another request while this one was being processed, so this request did not change it. If you were signed out, log in with the password from the request that succeeded.',
  notClosed: 'Your password WAS changed, but we could not confirm that your other sessions were signed out. Log out, log in with your new password, and change your password once more to sign other devices out.'
};

export function createUserService({ repo }) {
  async function getProfile(user) {
    const row = await repo.findProfileById(user.id); // always the authenticated user's id, never one from the request
    if (!row) throw new HttpError(404, 'NOT_FOUND', 'Profile not found.');
    return toProfile(row);
  }

  async function updateProfile(user, body) {
    const result = validateProfileUpdate(body);
    if (!result.ok) throw validationError(result.errors);
    const current = await repo.findProfileById(user.id);
    if (!current) throw new HttpError(404, 'NOT_FOUND', 'Profile not found.');
    const next = {
      phone: 'phone' in result.value ? result.value.phone : (current.phone ?? null),
      email: 'email' in result.value ? result.value.email : (current.email ?? null)
    };
    const n = await repo.updateContact(user.id, next);
    if (n === null) throw new HttpError(500, 'INTERNAL_ERROR', 'Something went wrong. Please try again.');
    return getProfile(user);
  }

  // Order matters (see docs/profile-assumptions.md):
  //   1. verify the current password, hash the new one (nothing has changed yet, so any failure here is harmless)
  //   2. sign out the user's OTHER sessions   -> if this fails we stop BEFORE sending the password update
  //   3. compare-and-set the password hash    -> only succeeds if the hash is still the one verified in step 1
  //        1 row  : changed
  //        0 rows : something else changed it first; this request changed nothing (409)
  //        server refused it : not changed (500 PASSWORD_UPDATE_FAILED)
  //        anything else (connection lost, odd result): UNKNOWN whether it committed. Best-effort cleanup, honest error.
  //   4. sign out other sessions again        -> narrows (does not eliminate) the window for a login that was already in flight
  // These are deliberately separate statements run through the plain db.query path (each commits on its own), not one database
  // transaction, even though the payments module has a transaction helper: see docs/profile-assumptions.md.
  async function changePassword(user, currentToken, body) {
    const result = validatePasswordChange(body);
    if (!result.ok) throw validationError(result.errors);
    // Without the caller's own session we could not keep it, and we would sign the caller out too.
    if (typeof currentToken !== 'string' || currentToken === '') throw unauthenticated();

    const storedHash = await repo.findPasswordHashById(user.id);
    if (!storedHash) throw unauthenticated();
    const { currentPassword, newPassword } = result.value;
    if (!(await verifyPassword(currentPassword, storedHash))) {
      throw new HttpError(400, 'VALIDATION_ERROR', 'Please fix the highlighted fields.', { currentPassword: 'Current password is incorrect.' });
    }
    const newHash = await hashPassword(newPassword);
    const keepHash = hashToken(currentToken);

    let first;
    try { first = await repo.deleteOtherSessions(user.id, keepHash); } catch (err) { logFailure('first session cleanup', err); first = null; }
    if (first === null) throw new HttpError(500, 'SESSION_INVALIDATION_FAILED', MSG.invalidation);

    let outcome; // 'applied' | 'conflict' | 'rejected' | 'unknown'
    try {
      const n = await repo.updatePasswordHash(user.id, newHash, storedHash);
      outcome = n === 1 ? 'applied' : n === 0 ? 'conflict' : 'unknown';
    } catch (err) {
      logFailure('password update', err);
      outcome = isServerRejection(err) ? 'rejected' : 'unknown';
    }
    if (outcome === 'conflict') throw new HttpError(409, 'PASSWORD_CHANGED_CONCURRENTLY', MSG.concurrent);
    if (outcome === 'rejected') throw new HttpError(500, 'PASSWORD_UPDATE_FAILED', MSG.rejected);
    if (outcome === 'unknown') {
      // The update may have committed. Do the clean-up anyway: if the password did NOT change it only signs out the
      // other sessions (harmless); if it DID change, it removes sessions that could otherwise outlive the old password.
      try { await repo.deleteOtherSessions(user.id, keepHash); } catch (err) { logFailure('cleanup after unconfirmed update', err); }
      throw new HttpError(500, 'PASSWORD_UPDATE_UNCONFIRMED', MSG.unconfirmed);
    }

    let second;
    try { second = await repo.deleteOtherSessions(user.id, keepHash); } catch (err) { logFailure('final session cleanup', err); second = null; }
    if (second === null) throw new HttpError(500, 'SESSIONS_NOT_FULLY_CLOSED', MSG.notClosed);
    return { changed: true };
  }

  return { getProfile, updateProfile, changePassword };
}
