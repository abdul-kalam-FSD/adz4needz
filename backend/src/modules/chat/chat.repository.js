// SQL for the team chat. Every statement is parameterised; the only values placed into SQL text are the validated integer LIMIT and a
// count-sized list of "?" placeholders. Not run against a real MySQL in the authoring sandbox (none was available).
const MSG_SELECT = `SELECT c.id, c.sender_id, c.kind, c.body, c.created_at, u.name AS sender_name, u.role AS sender_role
                      FROM chat_messages c JOIN users u ON u.id = c.sender_id`;
const marks = (n) => Array.from({ length: n }, () => '?').join(', ');
const safeLimit = (v) => { const n = Number(v); if (!Number.isInteger(n) || n < 1 || n > 1000) throw new Error('invalid limit'); return n; };

export function createChatRepository(db) {
  return {
    // Everyone who can take part in the chat and be mentioned: active accounts.
    async activeUsers() {
      return db.query('SELECT id, name FROM users WHERE is_active = 1 ORDER BY id ASC');
    },
    async findByRequestId(senderId, clientRequestId) {
      const rows = await db.query(`${MSG_SELECT} WHERE c.sender_id = ? AND c.client_request_id = ? LIMIT 1`, [senderId, clientRequestId]);
      return rows[0] || null;
    },
    // The message and its mentions are written together or not at all. Returns the new message id.
    async insertMessage({ senderId, kind, body, clientRequestId, createdAt, mentions }) {
      return db.transaction(async (tx) => {
        const res = await tx.query(
          'INSERT INTO chat_messages (sender_id, kind, body, client_request_id, created_at) VALUES (?, ?, ?, ?, ?)',
          [senderId, kind, body, clientRequestId, createdAt]);
        const id = Number(res.insertId);
        for (const m of mentions) {
          await tx.query('INSERT INTO chat_mentions (message_id, start_pos, end_pos, user_id) VALUES (?, ?, ?, ?)', [id, m.start, m.end, m.userId]);
        }
        return id;
      });
    },
    // One page of messages. afterId -> newer than it, oldest first; otherwise newest first (the service reverses for display).
    async page({ kind, afterId, beforeId, limit }) {
      const where = []; const params = [];
      if (kind === 'announcement') where.push("c.kind = 'announcement'");
      if (afterId !== null && afterId !== undefined) { where.push('c.id > ?'); params.push(afterId); }
      if (beforeId !== null && beforeId !== undefined) { where.push('c.id < ?'); params.push(beforeId); }
      return db.query(`${MSG_SELECT}${where.length ? ' WHERE ' + where.join(' AND ') : ''} ORDER BY c.id ${afterId !== null && afterId !== undefined ? 'ASC' : 'DESC'} LIMIT ${safeLimit(limit)}`, params);
    },
    async byIds(ids) {
      if (ids.length === 0) return [];
      return db.query(`${MSG_SELECT} WHERE c.id IN (${marks(ids.length)}) ORDER BY c.id ASC`, ids);
    },
    async mentionsFor(messageIds) {
      if (messageIds.length === 0) return [];
      return db.query(
        `SELECT m.message_id, m.start_pos, m.end_pos, m.user_id, u.name
           FROM chat_mentions m JOIN users u ON u.id = m.user_id
          WHERE m.message_id IN (${marks(messageIds.length)}) ORDER BY m.message_id ASC, m.start_pos ASC`, messageIds);
    },
    async latestId() {
      const rows = await db.query('SELECT COALESCE(MAX(id), 0) AS latest FROM chat_messages');
      return Number(rows[0].latest);
    },
    // A user with no row has read nothing (cursor 0).
    async readCursor(userId) {
      const rows = await db.query('SELECT last_read_message_id AS cursor_id FROM chat_reads WHERE user_id = ? LIMIT 1', [userId]);
      return rows[0] ? Number(rows[0].cursor_id) : 0;
    },
    // Moves the cursor forward only (GREATEST); two statements instead of one upsert so no deprecated syntax is needed.
    async advanceCursor(userId, upTo, nowText) {
      await db.query('INSERT IGNORE INTO chat_reads (user_id, last_read_message_id, updated_at) VALUES (?, 0, ?)', [userId, nowText]);
      await db.query('UPDATE chat_reads SET last_read_message_id = GREATEST(last_read_message_id, ?), updated_at = ? WHERE user_id = ?', [upTo, nowText, userId]);
    },
    // Unread for one user: newer than their cursor and not sent by them. COUNT(CASE..) (not SUM) so the driver returns numbers.
    async unreadCounts(userId, cursor) {
      const a = await db.query(
        `SELECT COUNT(*) AS unread, COUNT(CASE WHEN kind = 'announcement' THEN 1 END) AS announcements
           FROM chat_messages WHERE id > ? AND sender_id <> ?`, [cursor, userId]);
      const b = await db.query(
        `SELECT COUNT(DISTINCT m.message_id) AS mentions
           FROM chat_mentions m JOIN chat_messages c ON c.id = m.message_id
          WHERE m.user_id = ? AND m.message_id > ? AND c.sender_id <> ?`, [userId, cursor, userId]);
      return { unread: Number(a[0].unread), announcements: Number(a[0].announcements), mentions: Number(b[0].mentions) };
    },
    // Every active person's read cursor, for the admin's "read by N of M" on announcements.
    async activeCursors() {
      const rows = await db.query(
        `SELECT u.id AS user_id, COALESCE(r.last_read_message_id, 0) AS cursor_id
           FROM users u LEFT JOIN chat_reads r ON r.user_id = u.id WHERE u.is_active = 1`);
      return rows.map((r) => ({ userId: Number(r.user_id), cursor: Number(r.cursor_id) }));
    }
  };
}
