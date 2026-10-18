// An in-memory stand-in that understands EXACTLY the statements used by auth.repository.js and users.repository.js.
// Every statement runs atomically and is visible to later statements immediately (autocommit semantics).
// Any other SQL throws, so a change in the real SQL cannot silently bypass the scenario tests.
// This is NOT MySQL: it checks the ordering logic of the real repositories and services, not InnoDB behaviour.
const norm = (sql) => sql.replace(/\s+/g, ' ').trim();

export function createFakeSqlDb({ users }) {
  const state = { users: new Map(users.map((u) => [u.id, { ...u }])), sessions: [] };
  const byId = (id) => state.users.get(id);
  const del = (pred) => { const before = state.sessions.length; state.sessions = state.sessions.filter((s) => !pred(s)); return { affectedRows: before - state.sessions.length }; };
  return {
    state,
    async query(sql, params = []) {
      const s = norm(sql);
      if (s === 'SELECT id, employee_id, name, password_hash, role, is_active FROM users WHERE employee_id = ? LIMIT 1') {
        const u = [...state.users.values()].find((x) => x.employee_id === params[0]);
        return u ? [{ ...u }] : [];
      }
      if (s.startsWith('INSERT INTO sessions (user_id, token_hash, expires_at, created_at) VALUES')) {
        state.sessions.push({ user_id: params[0], token_hash: params[1] });
        return { affectedRows: 1 };
      }
      if (s === 'SELECT 1 AS ok FROM users WHERE id = ? AND is_active = 1 AND BINARY password_hash = ? LIMIT 1') {
        const u = byId(params[0]);
        return u && u.is_active === 1 && u.password_hash === params[1] ? [{ ok: 1 }] : []; // === is byte-for-byte, like BINARY
      }
      if (s === 'DELETE FROM sessions WHERE token_hash = ?') return del((x) => x.token_hash === params[0]);
      if (s === 'DELETE FROM sessions WHERE user_id = ? AND expires_at <= UTC_TIMESTAMP()') return { affectedRows: 0 };
      if (s === 'DELETE FROM sessions WHERE user_id = ? AND token_hash <> ?') return del((x) => x.user_id === params[0] && x.token_hash !== params[1]);
      if (s === 'SELECT password_hash FROM users WHERE id = ? LIMIT 1') { const u = byId(params[0]); return u ? [{ password_hash: u.password_hash }] : []; }
      if (s === 'UPDATE users SET password_hash = ? WHERE id = ? AND BINARY password_hash = ?') {
        const u = byId(params[1]);
        if (!u || u.password_hash !== params[2]) return { affectedRows: 0 };
        u.password_hash = params[0]; return { affectedRows: 1 };
      }
      if (s.startsWith('SELECT u.id, u.employee_id, u.name, u.role FROM sessions s JOIN users u')) {
        const sess = state.sessions.find((x) => x.token_hash === params[0]);
        const u = sess && byId(sess.user_id);
        return u && u.is_active === 1 ? [{ id: u.id, employee_id: u.employee_id, name: u.name, role: u.role }] : [];
      }
      throw new Error('fake db: unsupported SQL: ' + s);
    }
  };
}
