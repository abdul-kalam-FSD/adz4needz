// Quick client-side feedback for "create BDE account". The server validates again (backend/src/lib/validate-employee.js).
export const EMPLOYEE_ID_RE = /^[A-Za-z0-9._-]{1,32}$/;
export const PASSWORD_MIN = 10;
export const PASSWORD_MAX = 200;

export function validateEmployeeForm({ employeeId, name, password, confirmPassword }) {
  const errors = {};
  const id = String(employeeId ?? '').trim();
  if (!EMPLOYEE_ID_RE.test(id)) errors.employeeId = 'Employee ID must be 1 to 32 letters, digits, dots, dashes or underscores (no spaces).';
  const n = String(name ?? '').trim();
  if (n === '' || n.length > 120) errors.name = 'Enter the full name (up to 120 characters).';
  const pw = String(password ?? '');
  if (pw.length < PASSWORD_MIN || pw.length > PASSWORD_MAX) errors.password = `Password must be ${PASSWORD_MIN} to ${PASSWORD_MAX} characters.`;
  else if (pw.trim() === '') errors.password = 'Password cannot be only spaces.';
  else if (id && pw.toLowerCase() === id.toLowerCase()) errors.password = 'Password must not be the same as the employee ID.';
  if (!errors.password && pw !== String(confirmPassword ?? '')) errors.confirmPassword = 'The two passwords do not match.';
  return { ok: Object.keys(errors).length === 0, errors, value: { employeeId: id, name: n, password: pw } };
}
