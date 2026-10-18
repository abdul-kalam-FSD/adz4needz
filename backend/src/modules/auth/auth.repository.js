// All SQL for users/sessions lives here. `db.query(sql, params)` is always parameterized.
export function createAuthRepository(db) {
  return {
    async findUserByEmployeeId(employeeId) {
      const rows = await db.query(
        'SELECT id, employee_id, name, password_hash, role, is_active FROM users WHERE employee_id = ? LIMIT 1',
        [employeeId]
      );
      return rows[0] || null;
    },
    // Creates the session, then checks that the password it was created with is STILL the current one.
    // Returns true (session kept) or false (the password or the account changed while this login was in progress:
    // the session is removed again and the caller must refuse the login).
    //
    // Why insert first and check afterwards: a password change deletes the user's other sessions AFTER it has written
    // the new hash. A login that verified the old password and inserted its session after that clean-up would
    // otherwise keep a valid session. Because this check runs after the insert has committed, either
    //   - the password change had not committed yet when we re-read it: then its final clean-up starts after our
    //     insert committed and deletes this session, or
    //   - it had committed: we see the new hash here and remove the session ourselves.
    // This only relies on each statement being committed on its own (autocommit) and on a committed row being visible to
    // statements that start later. The auth and users modules always use the plain db.query path, so each of their statements
    // commits on its own; they never use the payments module's transaction helper (a source guard in
    // tests/auth.login-race.test.js checks this). It does not depend on the server's transaction isolation level or on any
    // locking behaviour.
    async createSession({ userId, tokenHash, ttlHours, passwordHash }) {
      if (typeof passwordHash !== 'string' || passwordHash === '') {
        throw new TypeError('createSession needs the password hash that was just verified');
      }
      await db.query(
        'INSERT INTO sessions (user_id, token_hash, expires_at, created_at) VALUES (?, ?, DATE_ADD(UTC_TIMESTAMP(), INTERVAL ? HOUR), UTC_TIMESTAMP())',
        [userId, tokenHash, ttlHours]
      );
      // The token was never returned to anyone, so a session that cannot be removed here is unusable; never mask the real outcome.
      const discard = async () => { try { await db.query('DELETE FROM sessions WHERE token_hash = ?', [tokenHash]); } catch { /* best effort */ } };
      let current;
      try {
        // BINARY: byte-for-byte comparison (the default collation is case-insensitive). Also refuses a user deactivated meanwhile.
        const rows = await db.query(
          'SELECT 1 AS ok FROM users WHERE id = ? AND is_active = 1 AND BINARY password_hash = ? LIMIT 1',
          [userId, passwordHash]
        );
        current = Array.isArray(rows) && rows.length === 1; // anything unexpected counts as "not current": fail closed
      } catch (err) {
        await discard();
        throw err;
      }
      if (!current) { await discard(); return false; }
      return true;
    },
    async findActiveSessionUser(tokenHash) {
      const rows = await db.query(
        `SELECT u.id, u.employee_id, u.name, u.role
           FROM sessions s JOIN users u ON u.id = s.user_id
          WHERE s.token_hash = ? AND s.expires_at > UTC_TIMESTAMP() AND u.is_active = 1
          LIMIT 1`,
        [tokenHash]
      );
      return rows[0] || null;
    },
    async deleteSessionByHash(tokenHash) {
      await db.query('DELETE FROM sessions WHERE token_hash = ?', [tokenHash]);
    },
    async deleteExpiredSessionsForUser(userId) {
      await db.query('DELETE FROM sessions WHERE user_id = ? AND expires_at <= UTC_TIMESTAMP()', [userId]);
    }
  };
}
