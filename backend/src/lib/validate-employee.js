// Validation for "admin creates a BDE account". Rules match scripts/create-user.js (employee ID pattern, name length, password length).
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from './password.js';

export const EMPLOYEE_ID_RE = /^[A-Za-z0-9._-]{1,32}$/;
const CONTROL = /[\u0000-\u001F\u007F]/;
export const ALLOWED_FIELDS = ['employeeId', 'name', 'password'];

// body: { employeeId, name, password }. Any other field (for example role or isActive) is rejected, never ignored, so a client cannot
// try to create an admin through this endpoint. Returns { ok, errors, value } where value has the trimmed employeeId and name.
export function validateNewEmployee(body) {
  const errors = {};
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return { ok: false, errors: { _form: 'Request body must be a JSON object.' }, value: null };
  for (const k of Object.keys(body)) if (!ALLOWED_FIELDS.includes(k)) errors[k] = 'This field cannot be set here.';
  const employeeId = typeof body.employeeId === 'string' ? body.employeeId.trim() : '';
  if (!EMPLOYEE_ID_RE.test(employeeId)) errors.employeeId = 'Employee ID must be 1 to 32 letters, digits, dots, dashes or underscores (no spaces).';
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (name === '' || name.length > 120 || CONTROL.test(name)) errors.name = 'Enter the full name (up to 120 characters, plain text).';
  const pw = body.password;
  if (typeof pw !== 'string' || pw.length < MIN_PASSWORD_LENGTH || pw.length > MAX_PASSWORD_LENGTH) errors.password = `Password must be ${MIN_PASSWORD_LENGTH} to ${MAX_PASSWORD_LENGTH} characters.`;
  else if (pw.trim() === '') errors.password = 'Password cannot be only spaces.';
  else if (employeeId && pw.toLowerCase() === employeeId.toLowerCase()) errors.password = 'Password must not be the same as the employee ID.';
  return { ok: Object.keys(errors).length === 0, errors, value: { employeeId, name } };
}
