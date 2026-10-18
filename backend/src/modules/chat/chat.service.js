import { HttpError } from '../../lib/http-error.js';
import { buildDirectory, parseId, parseMentions, validateListQuery, validateMessage, MAX_AFTER, MAX_MENTIONS } from '../../lib/chat.js';

const validationError = (errors) => new HttpError(400, 'VALIDATION_ERROR', 'Please fix the highlighted fields.', errors);
const requireActor = (actor) => {
  if (!actor || (actor.role !== 'admin' && actor.role !== 'bde')) throw new HttpError(403, 'FORBIDDEN', 'You do not have access to the team chat.');
};
const utcText = (ms) => new Date(ms).toISOString().slice(0, 19).replace('T', ' ');

export function createChatService({ repo, now = () => Date.now() }) {
  // Turns database rows into the API shape. The sender is the row's sender; "mine" and "mentionsMe" are worked out for THIS viewer.
  function shape(rows, mentionRows, viewer, cursors) {
    const byMessage = new Map();
    for (const m of mentionRows) {
      const list = byMessage.get(Number(m.message_id)) || [];
      list.push({ start: m.start_pos, end: m.end_pos, userId: Number(m.user_id), name: m.name });
      byMessage.set(Number(m.message_id), list);
    }
    return rows.map((r) => {
      const id = Number(r.id); const senderId = Number(r.sender_id);
      const mentions = byMessage.get(id) || [];
      const msg = {
        id, kind: r.kind, body: r.body, createdAt: r.created_at,
        sender: { id: senderId, name: r.sender_name, role: r.sender_role },
        mine: senderId === viewer.id, mentions, mentionsMe: mentions.some((m) => m.userId === viewer.id)
      };
      if (cursors && r.kind === 'announcement') { // only admins get this, and only for announcements: how many people have read it
        const others = cursors.filter((c) => c.userId !== senderId);
        msg.readBy = { count: others.filter((c) => c.cursor >= id).length, total: others.length };
      }
      return msg;
    });
  }
  async function present(rows, viewer) {
    const mentionRows = await repo.mentionsFor(rows.map((r) => Number(r.id)));
    const needReaders = viewer.role === 'admin' && rows.some((r) => r.kind === 'announcement');
    return shape(rows, mentionRows, viewer, needReaders ? await repo.activeCursors() : null);
  }
  async function unreadState(viewer) {
    const [cursor, latestId] = await Promise.all([repo.readCursor(viewer.id), repo.latestId()]);
    const counts = await repo.unreadCounts(viewer.id, cursor);
    return { lastReadMessageId: cursor, latestId, unread: counts };
  }

  return {
    // People you can mention. Names and handles only: never employee IDs (they are login names) and never roles.
    async members(actor) {
      requireActor(actor);
      return { members: buildDirectory(await repo.activeUsers()) };
    },

    // Sends one message. The sender is ALWAYS the logged-in user. Repeating the same clientRequestId returns the original message.
    async send(actor, body) {
      requireActor(actor);
      const check = validateMessage(body);
      if (!check.ok) throw validationError(check.errors);
      const v = check.value;
      if (v.kind === 'announcement' && actor.role !== 'admin') throw new HttpError(403, 'FORBIDDEN', 'Only an admin can post an announcement.');

      const sameRequest = async (row) => {
        if (row.body !== v.body || row.kind !== v.kind) throw new HttpError(409, 'REQUEST_ID_REUSED', 'This request id was already used for a different message. Please try again.');
        return { message: (await present([row], actor))[0], duplicate: true };
      };
      const earlier = await repo.findByRequestId(actor.id, v.clientRequestId);
      if (earlier) return sameRequest(earlier);

      const directory = buildDirectory(await repo.activeUsers());
      const { mentions, tooMany } = parseMentions(v.body, directory);
      if (tooMany) throw validationError({ body: `A message can mention at most ${MAX_MENTIONS} people.` });

      let id;
      try {
        id = await repo.insertMessage({ senderId: actor.id, kind: v.kind, body: v.body, clientRequestId: v.clientRequestId, createdAt: utcText(now()), mentions });
      } catch (err) {
        if (err && err.code === 'ER_DUP_ENTRY') { // two copies of the same send arrived together; the other one won
          const winner = await repo.findByRequestId(actor.id, v.clientRequestId);
          if (winner) return sameRequest(winner);
        }
        throw err;
      }
      const [row] = await repo.byIds([id]);
      return { message: (await present([row], actor))[0], duplicate: false };
    },

    // Reads messages. Default: the newest page. ?before=ID: older. ?after=ID: everything newer (what the screen polls for).
    async list(actor, query) {
      requireActor(actor);
      const check = validateListQuery(query || {});
      if (!check.ok) throw validationError(check.errors);
      const { kind, afterId, beforeId, limit } = check.value;
      let rows; let hasMore = false; let more = false;
      if (afterId !== null) {
        rows = await repo.page({ kind, afterId, beforeId: null, limit: MAX_AFTER });
        more = rows.length === MAX_AFTER; // there may be even more: the screen asks again straight away
      } else {
        const got = await repo.page({ kind, afterId: null, beforeId, limit: limit + 1 });
        hasMore = got.length > limit;
        rows = got.slice(0, limit).reverse(); // newest first from SQL -> oldest first for display
      }
      return { messages: await present(rows, actor), hasMore, more, ...(await unreadState(actor)) };
    },

    // Light poll for the menu badge.
    async unread(actor) {
      requireActor(actor);
      return unreadState(actor);
    },

    // "I have read everything up to this message." The cursor only moves forward and can never pass the newest message.
    async markRead(actor, body) {
      requireActor(actor);
      const upTo = parseId(body && body.upTo);
      if (upTo === null) throw validationError({ upTo: 'upTo must be a message id.' });
      const [cursor, latestId] = await Promise.all([repo.readCursor(actor.id), repo.latestId()]);
      const target = Math.min(upTo, latestId);
      if (target > cursor) await repo.advanceCursor(actor.id, target, utcText(now()));
      return unreadState(actor);
    }
  };
}
