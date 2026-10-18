// Server-side validation for the Profile module (the real one; the frontend has a mirror copy for quick feedback).
// Only phone and email can be edited here. name, employee ID and role are NOT editable by the user, and any
// other field in the request is rejected (never silently ignored) so a client cannot try to smuggle one in.
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from './password.js';

export const PROFILE_LIMITS = { phone: 20, email: 254 };
const CONTROL = /[\u0000-\u001F\u007F]/;
const PROFILE_FIELDS = ['phone', 'email'];
const PASSWORD_FIELDS = ['currentPassword', 'newPassword'];

const isPlainObject = (b) => b !== null && typeof b === 'object' && !Array.isArray(b);
const blank = (v) => v === undefined || v === null || (typeof v === 'string' && v.trim() === '');
const has = (body, key) => Object.prototype.hasOwnProperty.call(body, key);
const notObject = () => ({ ok: false, errors: { _form: 'Request body must be a JSON object.' }, value: {} });

// Update contact details. A field that is present is replaced; null or blank clears it; a missing field is unchanged.
export function validateProfileUpdate(body) {
  if (!isPlainObject(body)) return notObject();
  const errors = {};
  const value = {};
  if (Object.keys(body).some((k) => !PROFILE_FIELDS.includes(k))) {
    errors._form = 'Only phone and email can be updated.';
  } else if (!PROFILE_FIELDS.some((k) => has(body, k))) {
    errors._form = 'Provide a phone number, an email address, or both.';
  }

  if (has(body, 'phone')) {
    if (blank(body.phone)) value.phone = null;
    else {
      const phone = typeof body.phone === 'string' ? body.phone.trim() : '';
      const digits = phone.replace(/\D/g, '');
      if (!/^[0-9+\-().\s]{1,20}$/.test(phone) || digits.length < 7 || digits.length > 15) {
        errors.phone = 'Enter a valid phone number (7 to 15 digits).';
      } else value.phone = phone;
    }
  }
  if (has(body, 'email')) {
    if (blank(body.email)) value.email = null;
    else {
      const email = typeof body.email === 'string' ? body.email.trim() : '';
      if (email.length > PROFILE_LIMITS.email || CONTROL.test(email) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        errors.email = 'Enter a valid email address.';
      } else value.email = email;
    }
  }
  return { ok: Object.keys(errors).length === 0, errors, value: Object.keys(errors).length ? {} : value };
}

// Change password. Passwords are never trimmed or echoed back in any message.
export function validatePasswordChange(body) {
  if (!isPlainObject(body)) return notObject();
  const errors = {};
  if (Object.keys(body).some((k) => !PASSWORD_FIELDS.includes(k))) errors._form = 'Only the current password and the new password can be sent.';

  const { currentPassword, newPassword } = body;
  if (typeof currentPassword !== 'string' || currentPassword === '' || currentPassword.length > MAX_PASSWORD_LENGTH) {
    errors.currentPassword = 'Enter your current password.';
  }
  if (typeof newPassword !== 'string' || newPassword.length < MIN_PASSWORD_LENGTH) {
    errors.newPassword = `New password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
  } else if (newPassword.length > MAX_PASSWORD_LENGTH) {
    errors.newPassword = `New password must be at most ${MAX_PASSWORD_LENGTH} characters.`;
  }
  if (!errors.currentPassword && !errors.newPassword && currentPassword === newPassword) {
    errors.newPassword = 'New password must be different from your current password.';
  }
  const ok = Object.keys(errors).length === 0;
  return { ok, errors, value: ok ? { currentPassword, newPassword } : {} };
}
