// In-memory stand-in for the chat repository. It mirrors the rules the real SQL relies on (unique key on (sender, request id), the message and
// its mentions saved together, a read cursor that only moves forward, unread = newer than the cursor and not mine) but is written
// independently of the service, so a service mistake shows up as a failing test. It is NOT MySQL: the real SQL is covered by
// tests-integration/chat.db.test.js, which needs a database.
export function fakeChatRepo({ users } = {}) {
  const state = {
    users: users || [
      { id: 1, name: 'Admin One', role: 'admin', is_active: 1 }, { id: 10, name: 'Asha Verma', role: 'bde', is_active: 1 },
      { id: 11, name: 'Ravi Kumar', role: 'bde', is_active: 1 }, { id: 12, name: 'Old Timer', role: 'bde', is_active: 0 }
    ],
    messages: [], mentions: [], reads: new Map(), nextId: 1, inserts: 0, failNextInsertWith: null, racingWinner: null
  };
  const user = (id) => state.users.find((u) => u.id === id);
  const row = (m) => ({ id: m.id, sender_id: m.sender_id, kind: m.kind, body: m.body, created_at: m.created_at, sender_name: user(m.sender_id).name, sender_role: user(m.sender_id).role });
  return {
    state,
    activeUsers: async () => state.users.filter((u) => u.is_active).map((u) => ({ id: u.id, name: u.name })),
    findByRequestId: async (senderId, rid) => { const m = state.messages.find((x) => x.sender_id === senderId && x.client_request_id === rid); return m ? row(m) : null; },
    insertMessage: async (a) => {
      if (state.failNextInsertWith) { const e = state.failNextInsertWith; state.failNextInsertWith = null; if (state.racingWinner) state.messages.push(state.racingWinner); throw e; }
      if (state.messages.some((x) => x.sender_id === a.senderId && x.client_request_id === a.clientRequestId)) { const e = new Error('dup'); e.code = 'ER_DUP_ENTRY'; throw e; }
      const id = state.nextId++; state.inserts++;
      state.messages.push({ id, sender_id: a.senderId, kind: a.kind, body: a.body, client_request_id: a.clientRequestId, created_at: a.createdAt });
      for (const m of a.mentions) state.mentions.push({ message_id: id, start_pos: m.start, end_pos: m.end, user_id: m.userId });
      return id;
    },
    page: async ({ kind, afterId, beforeId, limit }) => {
      let list = state.messages.filter((m) => (kind === 'announcement' ? m.kind === 'announcement' : true) && (afterId == null || m.id > afterId) && (beforeId == null || m.id < beforeId));
      list = afterId != null ? list.sort((a, b) => a.id - b.id) : list.sort((a, b) => b.id - a.id);
      return list.slice(0, limit).map(row);
    },
    byIds: async (ids) => state.messages.filter((m) => ids.includes(m.id)).sort((a, b) => a.id - b.id).map(row),
    mentionsFor: async (ids) => state.mentions.filter((m) => ids.includes(m.message_id)).sort((a, b) => a.message_id - b.message_id || a.start_pos - b.start_pos).map((m) => ({ ...m, name: user(m.user_id).name })),
    latestId: async () => state.messages.reduce((mx, m) => Math.max(mx, m.id), 0),
    readCursor: async (userId) => state.reads.get(userId) || 0,
    advanceCursor: async (userId, upTo) => { state.reads.set(userId, Math.max(state.reads.get(userId) || 0, upTo)); },
    unreadCounts: async (userId, cursor) => {
      const unread = state.messages.filter((m) => m.id > cursor && m.sender_id !== userId);
      const mentioned = new Set(state.mentions.filter((x) => x.user_id === userId && unread.some((m) => m.id === x.message_id)).map((x) => x.message_id));
      return { unread: unread.length, announcements: unread.filter((m) => m.kind === 'announcement').length, mentions: mentioned.size };
    },
    activeCursors: async () => state.users.filter((u) => u.is_active).map((u) => ({ userId: u.id, cursor: state.reads.get(u.id) || 0 }))
  };
}
