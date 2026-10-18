import { randomInt } from 'node:crypto';
import { HttpError } from '../../lib/http-error.js';
import { hashPassword } from '../../lib/password.js';
import { validateNewEmployee } from '../../lib/validate-employee.js';

// No look-alike characters (0/O, 1/l/I) so a password read aloud or copied by hand survives. 14 characters from 54 symbols.
const TEMP_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
export function generateTempPassword(length = 14, pick = randomInt) {
  let out = '';
  for (let i = 0; i < length; i += 1) out += TEMP_ALPHABET[pick(TEMP_ALPHABET.length)];
  return out;
}
const toEmployee = (r) => ({ id: Number(r.id), employeeId: r.employee_id, name: r.name, phone: r.phone || null, email: r.email || null, isActive: Boolean(r.is_active), createdAt: r.created_at });
const requireAdmin = (actor, what) => { if (!actor || actor.role !== 'admin') throw new HttpError(403, 'FORBIDDEN', `Only an admin can ${what}.`); };
const parseId = (t) => { const s = typeof t === 'number' ? String(t) : t; if (typeof s !== 'string' || !/^[1-9]\d{0,17}$/.test(s)) throw new HttpError(400, 'VALIDATION_ERROR', 'Invalid employee id.'); return s; };

export function createEmployeeService({ repo, hash = hashPassword, makePassword = generateTempPassword }) {
  return {
    // Admin: every BDE account (active and inactive). No password data is ever selected.
    async list(actor) {
      requireAdmin(actor, 'view employee accounts');
      return (await repo.listBdes()).map(toEmployee);
    },

    // Admin switches a BDE account off or on. Only role 'bde' rows can be touched (the repository filters on role). Off = cannot sign in and
    // every open session is removed; no business record of that BDE is changed or deleted.
    async setActive(actor, idText, isActive) {
      requireAdmin(actor, 'change employee accounts');
      const id = parseId(idText);
      if (typeof isActive !== 'boolean') throw new HttpError(400, 'VALIDATION_ERROR', 'isActive must be true or false.', { isActive: 'Send true or false.' });
      const found = await repo.findBde(id);
      if (!found) throw new HttpError(404, 'NOT_FOUND', 'BDE not found.');
      if (Boolean(found.is_active) !== isActive) await repo.setActive(id, isActive);
      return toEmployee({ ...found, is_active: isActive ? 1 : 0 });
    },

    // Admin sets a new random temporary password. It is returned ONCE in this response (so the admin can hand it over) and is stored only as a
    // hash. All sessions of that BDE are removed so the old password and any stolen session stop working immediately.
    async resetPassword(actor, idText) {
      requireAdmin(actor, 'reset passwords');
      const id = parseId(idText);
      const found = await repo.findBde(id);
      if (!found) throw new HttpError(404, 'NOT_FOUND', 'BDE not found.');
      const temporaryPassword = makePassword();
      await repo.setPassword(id, await hash(temporaryPassword));
      return { employee: toEmployee(found), temporaryPassword };
    },

    // Admin creates a BDE account. The password is hashed here and never stored, logged or returned.
    async createBde(actor, body) {
      if (!actor || actor.role !== 'admin') throw new HttpError(403, 'FORBIDDEN', 'Only an admin can create employee accounts.');
      const v = validateNewEmployee(body);
      if (!v.ok) throw new HttpError(400, 'VALIDATION_ERROR', 'Please fix the highlighted fields.', v.errors);
      const res = await repo.insertBde({ employeeId: v.value.employeeId, name: v.value.name, passwordHash: await hash(body.password) });
      if (res.duplicate) throw new HttpError(409, 'EMPLOYEE_ID_EXISTS', `Employee ID ${v.value.employeeId} is already in use.`, { employeeId: 'This employee ID is already in use.' });
      return { id: res.id, employeeId: v.value.employeeId, name: v.value.name, role: 'bde', isActive: true };
    }
  };
}
