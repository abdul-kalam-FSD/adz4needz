// Creates BDE accounts only. role is a constant in the SQL, never a parameter. Not run against a real MySQL in the authoring sandbox.
export function createEmployeeRepository(db) {
  return {
    async listBdes() {
      return db.query("SELECT id, employee_id, name, phone, email, is_active, created_at FROM users WHERE role = 'bde' ORDER BY name ASC, id ASC");
    },
    async findBde(id) {
      const rows = await db.query("SELECT id, employee_id, name, phone, email, is_active, created_at FROM users WHERE id = ? AND role = 'bde' LIMIT 1", [id]);
      return rows[0] || null;
    },
    // role is a constant in the SQL: an admin row can never be switched off or re-passworded through these two methods.
    async setActive(id, isActive) {
      await db.query("UPDATE users SET is_active = ? WHERE id = ? AND role = 'bde'", [isActive ? 1 : 0, id]);
      if (!isActive) await db.query('DELETE FROM sessions WHERE user_id = ?', [id]);
    },
    async setPassword(id, passwordHash) {
      await db.query("UPDATE users SET password_hash = ? WHERE id = ? AND role = 'bde'", [passwordHash, id]);
      await db.query('DELETE FROM sessions WHERE user_id = ?', [id]);
    },
    // Returns { id } or { duplicate: true } when the employee ID is taken (the column is unique; MySQL compares case-insensitively).
    async insertBde({ employeeId, name, passwordHash }) {
      try {
        const r = await db.query(
          "INSERT INTO users (employee_id, name, password_hash, role, is_active, created_at) VALUES (?, ?, ?, 'bde', 1, UTC_TIMESTAMP())",
          [employeeId, name, passwordHash]);
        return { id: Number(r.insertId) };
      } catch (err) {
        if (err && err.code === 'ER_DUP_ENTRY') return { duplicate: true };
        throw err;
      }
    }
  };
}
