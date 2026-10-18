// Pure rules for the team chat (no database, no clock). Everything here is unit-tested.
import { randomUUID } from 'node:crypto';

export const CHAT_KINDS = ['message', 'announcement'];
export const MAX_BODY_CHARS = 2000;
export const MAX_MENTIONS = 20;
export const MAX_PAGE = 100;
export const DEFAULT_PAGE = 50;
export const MAX_AFTER = 200; // most messages returned by one "what is new" poll

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Control characters other than newline and tab (NUL, escape codes, bidi-hiding tricks are NOT covered here: bidi controls are allowed text).
// eslint-disable-next-line no-control-regex
const BAD_CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;

export const newRequestId = () => randomUUID();

// A positive integer id from a query string or JSON (number or digit string). Returns null when it is not one.
export function parseId(v) {
  if (typeof v === 'number') return Number.isSafeInteger(v) && v > 0 ? v : null;
  if (typeof v === 'string' && /^[1-9]\d{0,15}$/.test(v)) return Number(v);
  return null;
}

// Validates a message to send. The text is stored as typed (trimmed, line breaks normalised): it is never changed to HTML here or later;
// it is escaped when displayed. Returns { ok, errors, value: { body, kind, clientRequestId } }.
export function validateMessage(input) {
  const errors = {}; const value = {};
  if (input === null || typeof input !== 'object' || Array.isArray(input)) return { ok: false, errors: { _form: 'Request body must be a JSON object.' }, value };
  if (typeof input.body !== 'string') errors.body = 'Write a message.';
  else {
    const body = input.body.replace(/\r\n?/g, '\n').trim();
    if (body === '') errors.body = 'Write a message.';
    else if (BAD_CONTROL.test(body)) errors.body = 'The message contains characters that are not allowed.';
    else if ([...body].length > MAX_BODY_CHARS) errors.body = `A message can have at most ${MAX_BODY_CHARS} characters.`;
    else value.body = body;
  }
  if (input.kind === undefined || input.kind === null) value.kind = 'message';
  else if (typeof input.kind === 'string' && CHAT_KINDS.includes(input.kind)) value.kind = input.kind;
  else errors.kind = 'Kind must be "message" or "announcement".';
  if (typeof input.clientRequestId === 'string' && UUID.test(input.clientRequestId)) value.clientRequestId = input.clientRequestId.toLowerCase();
  else errors.clientRequestId = 'A request id (UUID) is required so a repeated click does not send the message twice.';
  return { ok: Object.keys(errors).length === 0, errors, value };
}

// ---- mentions ----------------------------------------------------------------------------------------------------------------
// A person is mentioned by a HANDLE derived from their display name ("Asha Verma" -> @asha.verma), never by their employee ID: the employee
// ID is also the login name and must not be listed to every colleague. Handles use letters, combining marks, digits, dot, dash and underscore.
// Combining marks (\p{M}) are part of a handle: Tamil, Hindi and many other scripts write vowel signs as marks.
const HANDLE_CHARS = /[^\p{L}\p{N}\p{M}._-]/gu;
const MAX_HANDLE = 32;
export function baseHandle(name) {
  let h = String(name ?? '').normalize('NFKC').toLowerCase().trim().replace(/\s+/g, '.').replace(HANDLE_CHARS, '').replace(/\.{2,}/g, '.').replace(/^[._-]+|[._-]+$/g, '');
  h = [...h].slice(0, MAX_HANDLE).join('').replace(/[._-]+$/g, '');
  return h;
}
// users: [{ id, name }] (active people only). The person with the lowest id keeps the plain handle; later people with the same handle get
// "-<id>" added, so existing handles stay stable when someone new joins. Returns [{ id, name, handle }] in id order.
export function buildDirectory(users) {
  const sorted = [...users].sort((a, b) => Number(a.id) - Number(b.id));
  const taken = new Set(); const out = [];
  for (const u of sorted) {
    let handle = baseHandle(u.name) || `user${u.id}`;
    if (taken.has(handle)) handle = `${handle.slice(0, MAX_HANDLE - String(u.id).length - 1)}-${u.id}`;
    while (taken.has(handle)) handle += 'x'; // cannot normally happen; keeps handles unique no matter what
    taken.add(handle);
    out.push({ id: Number(u.id), name: u.name, handle });
  }
  return out;
}

// Finds the "@handle" mentions in an already-validated body. Strict: the text after @ must equal one active person's handle (case-insensitive),
// optionally followed by sentence punctuation (. - _ are trimmed off the end, so "thanks @asha.verma." works). Returns
// [{ start, end, userId }] where start/end are string offsets of the whole "@handle" text (end exclusive), plus tooMany when over the limit.
export function parseMentions(body, directory) {
  const byHandle = new Map(directory.map((d) => [d.handle.toLowerCase(), d]));
  const found = [];
  const re = /(?<![\p{L}\p{N}\p{M}._-])@([\p{L}\p{N}][\p{L}\p{N}\p{M}._-]*)/gu;
  for (const m of body.matchAll(re)) {
    let cand = m[1];
    let person = byHandle.get(cand.toLowerCase());
    while (!person && /[._-]$/.test(cand)) { cand = cand.slice(0, -1); person = byHandle.get(cand.toLowerCase()); }
    if (person) found.push({ start: m.index, end: m.index + 1 + cand.length, userId: person.id });
  }
  return { mentions: found.slice(0, MAX_MENTIONS), tooMany: found.length > MAX_MENTIONS };
}

// Query-string options for reading messages. Returns { ok, errors, value: { kind, afterId, beforeId, limit } }.
export function validateListQuery(q) {
  const errors = {}; const value = { kind: 'all', afterId: null, beforeId: null, limit: DEFAULT_PAGE };
  const given = (name) => q[name] !== undefined && q[name] !== '';
  for (const name of ['kind', 'after', 'before', 'limit']) if (Array.isArray(q[name]) || (q[name] !== undefined && typeof q[name] !== 'string')) errors[name] = `${name} must be given once, as text.`; // ?a=1&a=2 is refused, not guessed at
  if (!errors.kind && given('kind')) { if (q.kind === 'all' || q.kind === 'announcement') value.kind = q.kind; else errors.kind = 'kind must be "all" or "announcement".'; }
  if (!errors.after && given('after')) { value.afterId = parseId(q.after); if (value.afterId === null) errors.after = 'after must be a message id.'; }
  if (!errors.before && given('before')) { value.beforeId = parseId(q.before); if (value.beforeId === null) errors.before = 'before must be a message id.'; }
  if (value.afterId !== null && value.beforeId !== null) errors.before = 'Use either after or before, not both.';
  if (!errors.limit && given('limit')) {
    const n = parseId(q.limit);
    if (n === null || n > MAX_PAGE) errors.limit = `limit must be between 1 and ${MAX_PAGE}.`; else value.limit = n;
  }
  return { ok: Object.keys(errors).length === 0, errors, value };
}

// Unread rules: a message is unread for a user when it is newer than their cursor and was not sent by them.
export const isUnread = (message, userId, cursor) => message.id > cursor && message.senderId !== userId;
