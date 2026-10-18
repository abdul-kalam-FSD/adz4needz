// All SQL for the Profile module lives here. `db.query(sql, params)` is always parameterized.
// Write helpers return mysql2's affectedRows, or null when the driver result does not look like a write result,
// so the service can refuse to treat an unexpected answer as success.
const affected = (r) => (r && typeof r.affectedRows === 'number' ? r.affectedRows : null);

export function createUserRepository(db) {
  return {
    // Public columns only. password_hash is NOT selected here.
    async findProfileById(userId) {
      const rows = await db.query(
        'SELECT id, employee_id, name, role, phone, email, created_at FROM users WHERE id = ? LIMIT 1',
        [userId]
      );
      return rows[0] || null;
    },
    // The only query that reads the hash. Used by the service to verify the current password; never returned to a client.
    async findPasswordHashById(userId) {
      const rows = await db.query('SELECT password_hash FROM users WHERE id = ? LIMIT 1', [userId]);
      return rows[0] ? rows[0].password_hash : null;
    },
    // Fixed column list: the request can never choose which columns are written.
    async updateContact(userId, { phone, email }) {
      return affected(await db.query('UPDATE users SET phone = ?, email = ? WHERE id = ?', [phone, email, userId]));
    },
    // Compare-and-set: only replaces the hash that was verified a moment ago. If anything changed the password in
    // between (another request, an admin), no row matches and this returns 0 instead of silently overwriting it.
    // BINARY: the hash is compared byte for byte (the default collation is case-insensitive).
    // A new hash always differs from the old one (random salt), so 1 = "changed" and 0 = "no row matched" regardless of
    // whether the driver reports matched or changed rows.
    async updatePasswordHash(userId, newPasswordHash, expectedPasswordHash) {
      if (typeof expectedPasswordHash !== 'string' || expectedPasswordHash === '') {
        throw new TypeError('updatePasswordHash needs the verified current hash (it is never an unconditional update)');
      }
      return affected(await db.query(
        'UPDATE users SET password_hash = ? WHERE id = ? AND BINARY password_hash = ?',
        [newPasswordHash, userId, expectedPasswordHash]
      ));
    },
    // Deletes every session of this user except the one whose token hash is given (the caller's own session).
    async deleteOtherSessions(userId, keepTokenHash) {
      return affected(await db.query('DELETE FROM sessions WHERE user_id = ? AND token_hash <> ?', [userId, keepTokenHash]));
    }
  };
}
