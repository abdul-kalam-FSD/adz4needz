// First-admin bootstrap. Used ONLY by scripts/bootstrap-admin.js, which an operator runs in a shell on the server (it needs the server's
// .env database credentials). There is deliberately NO HTTP route, no setup page and no "is there an admin?" endpoint: a public visitor
// has no way to create, or even to learn about the absence of, an administrator.
//
// Safety rules enforced here:
//  - it creates an administrator ONLY while the users table holds no admin at all; once any admin exists it refuses (ADMIN_EXISTS);
//  - the "no admin yet" test and the insert are ONE statement (INSERT ... SELECT ... WHERE NOT EXISTS), not a check followed by a write;
//  - the details are validated with the same rules as every other account (employee ID pattern, name, password length 10 to 200);
//  - the password is hashed with the project's scrypt helper and is never returned, logged or put in an error.
import { hashPassword } from './password.js';
import { validateNewEmployee } from './validate-employee.js';

export class BootstrapError extends Error {
  constructor(code, message, fields) {
    super(message);
    this.name = 'BootstrapError';
    this.code = code; // INVALID_INPUT | ADMIN_EXISTS | EMPLOYEE_ID_EXISTS
    this.fields = fields || {};
  }
}

export async function bootstrapFirstAdmin({ db, employeeId, name, password, hash = hashPassword }) {
  const v = validateNewEmployee({ employeeId, name, password });
  if (!v.ok) throw new BootstrapError('INVALID_INPUT', 'Please fix the details below.', v.errors);

  // Friendly early answer (no password hashing is spent when an admin already exists). The INSERT below repeats the test atomically.
  const existing = await db.query("SELECT 1 AS ok FROM users WHERE role = 'admin' LIMIT 1");
  if (Array.isArray(existing) && existing.length > 0) throw new BootstrapError('ADMIN_EXISTS', 'An administrator account already exists. Nothing was changed.');

  const passwordHash = await hash(password);
  let result;
  try {
    result = await db.query(
      "INSERT INTO users (employee_id, name, password_hash, role, is_active, created_at) " +
      "SELECT ?, ?, ?, 'admin', 1, UTC_TIMESTAMP() FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM users WHERE role = 'admin')",
      [v.value.employeeId, v.value.name, passwordHash]
    );
  } catch (err) {
    if (err && err.code === 'ER_DUP_ENTRY') throw new BootstrapError('EMPLOYEE_ID_EXISTS', `Employee ID ${v.value.employeeId} is already in use by another account.`, { employeeId: 'This employee ID is already in use.' });
    throw err;
  }
  if (!result || Number(result.affectedRows) !== 1) throw new BootstrapError('ADMIN_EXISTS', 'An administrator account already exists. Nothing was changed.');
  return { id: Number(result.insertId), employeeId: v.value.employeeId, name: v.value.name, role: 'admin' };
}
