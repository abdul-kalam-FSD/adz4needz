// Pure validation + @mention parsing for Team Chat (unit-tested without a database).
export const CHAT_LIMITS = { body: 2000, maxMentions: 10, pageDefault: 30, pageMax: 100 };
export const CHAT_KINDS = ['chat', 'announcement'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CONTROL_EXCEPT_NEWLINE_TAB = /[\u0000-\u0008\u000B-\u001F\u007F]/;

// A mention is "@EMPLOYEE_ID" at the start of the text or after whitespace/an opening bracket. The ID characters are the ones an
// employee ID may contain (letters, digits, dot, dash, underscore; max 32). Trailing . _ - are punctuation, not part of the ID.
// Returns unique lower-case IDs in order of appearance, at most CHAT_LIMITS.maxMentions. Whether an ID belongs to a real, active
// employee is decided by the service; unknown IDs simply stay plain text.
export function extractMentionIds(text) {
  const out = [];
  const re = /(^|[\s(\[{])@([A-Za-z0-9][A-Za-z0-9._-]{0,31})/g;
  let m;
  while ((m = re.exec(String(text ?? ''))) !== null) {
    const id = m[2].replace(/[._-]+$/, '').toLowerCase();
    if (id !== '' && !out.includes(id)) out.push(id);
    if (out.length >= CHAT_LIMITS.maxMentions) break;
  }
  return out;
}

// body: { body, kind?, clientRequestId }. Returns { ok, errors, value }. kind defaults to 'chat'.
export function validateChatMessage(body) {
  const errors = {}; const value = {};
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return { ok: false, errors: { _form: 'Request body must be a JSON object.' }, value };
  if (typeof body.body !== 'string' || body.body.trim() === '') errors.body = 'Write a message first.';
  else if (CONTROL_EXCEPT_NEWLINE_TAB.test(body.body)) errors.body = 'The message contains invalid characters.';
  else if (body.body.trim().length > CHAT_LIMITS.body) errors.body = `A message can be at most ${CHAT_LIMITS.body} characters.`;
  else value.body = body.body.trim();
  if (body.kind === undefined || body.kind === null || body.kind === '') value.kind = 'chat';
  else if (CHAT_KINDS.includes(body.kind)) value.kind = body.kind;
  else errors.kind = 'Kind must be "chat" or "announcement".';
  if (typeof body.clientRequestId === 'string' && UUID.test(body.clientRequestId)) value.clientRequestId = body.clientRequestId.toLowerCase();
  else errors.clientRequestId = 'Missing or invalid request id.';
  return { ok: Object.keys(errors).length === 0, errors, value };
}

// Paging for the list endpoints: ?limit=1..100 (default 30), ?before=<message id>, ?kind=chat|announcement.
export function parseChatQuery(q = {}) {
  const errors = {}; const value = { limit: CHAT_LIMITS.pageDefault, beforeId: null, kind: null };
  if (q.limit !== undefined && q.limit !== '') {
    if (!/^\d{1,3}$/.test(String(q.limit)) || Number(q.limit) < 1 || Number(q.limit) > CHAT_LIMITS.pageMax) errors.limit = 'Limit must be a number from 1 to 100.';
    else value.limit = Number(q.limit);
  }
  if (q.before !== undefined && q.before !== '') {
    if (!/^[1-9]\d{0,17}$/.test(String(q.before))) errors.before = 'Invalid cursor.'; else value.beforeId = String(q.before);
  }
  if (q.kind !== undefined && q.kind !== '') {
    if (!CHAT_KINDS.includes(q.kind)) errors.kind = 'Kind must be "chat" or "announcement".'; else value.kind = q.kind;
  }
  return { ok: Object.keys(errors).length === 0, errors, value };
}
