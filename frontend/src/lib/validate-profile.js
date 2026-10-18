// Quick browser-side feedback for the Profile screen. The server repeats every check and is the real authority.
// Mirrors backend/src/lib/validate-profile.js (same rules, same messages).
export const PROFILE_LIMITS = { phone: 20, email: 254 };
export const PASSWORD_LIMITS = { min: 10, max: 200 };
const CONTROL = /[\u0000-\u001F\u007F]/;
const blank = (v) => v === undefined || v === null || (typeof v === 'string' && v.trim() === '');

// Contact form: both fields are always sent (blank = clear that field).
export function validateContactForm({ phone, email }) {
  const errors = {};
  const value = { phone: null, email: null };
  if (!blank(phone)) {
    const p = String(phone).trim();
    const digits = p.replace(/\D/g, '');
    if (!/^[0-9+\-().\s]{1,20}$/.test(p) || digits.length < 7 || digits.length > 15) errors.phone = 'Enter a valid phone number (7 to 15 digits).';
    else value.phone = p;
  }
  if (!blank(email)) {
    const e = String(email).trim();
    if (e.length > PROFILE_LIMITS.email || CONTROL.test(e) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) errors.email = 'Enter a valid email address.';
    else value.email = e;
  }
  const ok = Object.keys(errors).length === 0;
  return { ok, errors, value: ok ? value : {} };
}

// Password form. confirmPassword is checked here only and is never sent to the server.
export function validatePasswordForm({ currentPassword, newPassword, confirmPassword }) {
  const errors = {};
  if (typeof currentPassword !== 'string' || currentPassword === '') errors.currentPassword = 'Enter your current password.';
  if (typeof newPassword !== 'string' || newPassword.length < PASSWORD_LIMITS.min) errors.newPassword = `New password must be at least ${PASSWORD_LIMITS.min} characters.`;
  else if (newPassword.length > PASSWORD_LIMITS.max) errors.newPassword = `New password must be at most ${PASSWORD_LIMITS.max} characters.`;
  else if (currentPassword === newPassword) errors.newPassword = 'New password must be different from your current password.';
  if (!errors.newPassword && newPassword !== confirmPassword) errors.confirmPassword = 'The two new passwords do not match.';
  const ok = Object.keys(errors).length === 0;
  return { ok, errors, value: ok ? { currentPassword, newPassword } : {} };
}
