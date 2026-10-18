// Decides the heading shown above the server's own message after a failed password change, so the screen never
// contradicts the backend. The message text itself always comes from the server (it says what is and is not known).
// Keep in step with the error codes in backend/src/modules/users/users.service.js (a backend test checks this).

const NOT_CHANGED = 'Password not changed.';
const NOT_CONFIRMED = 'Password change not confirmed.';

export function describePasswordFailure(err) {
  const code = err && err.code;
  const status = err && err.status;
  // The server says the password WAS changed.
  if (code === 'SESSIONS_NOT_FULLY_CLOSED') return { lead: 'Password changed, but other sessions may still be open.', hint: '' };
  // The server says it cannot tell whether the password changed.
  if (code === 'PASSWORD_UPDATE_UNCONFIRMED') return { lead: NOT_CONFIRMED, hint: '' };
  // The server says nothing was changed by this request.
  if (['SESSION_INVALIDATION_FAILED', 'PASSWORD_UPDATE_FAILED', 'PASSWORD_CHANGED_CONCURRENTLY', 'VALIDATION_ERROR', 'TOO_MANY_ATTEMPTS', 'UNSUPPORTED_MEDIA_TYPE', 'UNAUTHENTICATED'].includes(code)) {
    return { lead: NOT_CHANGED, hint: '' };
  }
  if (status === 401) return { lead: NOT_CHANGED, hint: '' };
  // Network failure or an unknown server error: we cannot tell what happened.
  return { lead: NOT_CONFIRMED, hint: ' If you are not sure, log out and log in with your new password first; if that fails, use your old password.' };
}

// After a rejected attempt: a plain 400 keeps the new-password fields (only the current password is cleared);
// anything else clears every password field so no typed password stays on screen.
export function fieldsToClear(err) {
  return err && err.status === 400 && err.fields && Object.keys(err.fields).length ? ['currentPassword'] : ['currentPassword', 'newPassword', 'confirmPassword'];
}
