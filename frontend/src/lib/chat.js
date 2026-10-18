// Pure helpers for the team chat screen (no React, no network), so the rules can be unit-tested.
import { formatCallTime } from './call-desk.js';

export const MAX_CHARS = 2000;   // same limit as the server (lib/chat.js there)
export const POLL_CHAT_MS = 5000;   // while the chat page is open and visible
export const POLL_BADGE_MS = 30000; // the menu badge, on every page

// "5" / "99+" / "" for the menu badge.
export const unreadLabel = (n) => (!n || n < 1 ? '' : n > 99 ? '99+' : String(n));
export const characterCount = (text) => [...String(text)].length; // characters as people count them (an emoji is one), like the server

// Seconds between polls: the normal delay, doubled after each failure, never more than a minute.
export function nextPollDelay(baseMs, failures, maxMs = 60000) {
  const f = Math.max(0, Math.min(Number.isFinite(failures) ? failures : 0, 10));
  return Math.min(maxMs, baseMs * 2 ** f);
}

// ---- showing a message safely ---------------------------------------------------------------------------------------------
// The body is plain text and is ALWAYS rendered as text (React escapes it), never as HTML. Mentions come from the SERVER with exact
// positions; a mention whose position does not fit the text, overlaps another, or does not start with "@" is ignored and shown as plain text.
export function messageSegments(body, mentions) {
  const text = String(body ?? '');
  const ok = (Array.isArray(mentions) ? mentions : [])
    .filter((m) => m && Number.isInteger(m.start) && Number.isInteger(m.end) && m.start >= 0 && m.end > m.start && m.end <= text.length && text[m.start] === '@')
    .sort((a, b) => a.start - b.start);
  const out = []; let at = 0;
  for (const m of ok) {
    if (m.start < at) continue; // overlaps the previous one
    if (m.start > at) out.push({ type: 'text', text: text.slice(at, m.start) });
    out.push({ type: 'mention', text: text.slice(m.start, m.end), userId: m.userId, name: m.name });
    at = m.end;
  }
  if (at < text.length) out.push({ type: 'text', text: text.slice(at) });
  return out;
}

// ---- times and the thread ----------------------------------------------------------------------------------------------------
const pad = (n) => String(n).padStart(2, '0');
const localKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseUtc = (createdAt) => new Date(String(createdAt).replace(' ', 'T') + 'Z');
export const formatMessageTime = (createdAt) => formatCallTime(createdAt);
export function dayLabel(createdAt, now = new Date()) {
  const d = parseUtc(createdAt); if (Number.isNaN(d.getTime())) return '';
  const y = new Date(now); y.setDate(y.getDate() - 1);
  if (localKey(d) === localKey(now)) return 'Today';
  if (localKey(d) === localKey(y)) return 'Yesterday';
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}
// Turns messages into what is drawn: day headings, a "New messages" line before the first unread message, and the messages. Messages must
// be oldest first. lastReadId is the cursor when the page was opened (0 = nothing read); your own messages are never "new".
export function buildThread(messages, lastReadId, now = new Date()) {
  const items = []; let day = null; let dividerDone = false;
  for (const m of messages) {
    const key = Number.isNaN(parseUtc(m.createdAt).getTime()) ? 'unknown' : localKey(parseUtc(m.createdAt));
    if (key !== day) { day = key; items.push({ type: 'day', key: 'day-' + key, label: dayLabel(m.createdAt, now) }); }
    if (!dividerDone && m.id > lastReadId && !m.mine) { items.push({ type: 'new', key: 'new-divider' }); dividerDone = true; }
    items.push({ type: 'message', key: 'm-' + m.id, message: m });
  }
  return items;
}

// New messages from a poll or from your own send, merged into the list: no duplicates (by id), always oldest first.
export function mergeMessages(existing, incoming) {
  const byId = new Map(existing.map((m) => [m.id, m]));
  for (const m of incoming) byId.set(m.id, m);
  return [...byId.values()].sort((a, b) => a.id - b.id);
}

// Mark messages as read only when the person can actually see the newest ones: the "all messages" view, the tab is showing, they are at the
// bottom, and there is something newer than what the server already knows.
export function shouldMarkRead({ view, tabVisible, atBottom, newestSeenId, lastReadId }) {
  return view === 'all' && tabVisible === true && atBottom === true && Number.isInteger(newestSeenId) && newestSeenId > lastReadId;
}

// ---- @mention autocomplete in the writing box ---------------------------------------------------------------------------------
// If the caret is right after "@something" (the @ at the start or after whitespace), returns { start, query }; otherwise null.
export function mentionQueryAt(text, caret) {
  const before = String(text).slice(0, caret);
  const m = /(^|\s)@([^\s@]*)$/u.exec(before);
  return m ? { start: before.length - m[2].length - 1, query: m[2] } : null;
}
// Best matches first: handle or name starts with the query, then contains it. At most `limit`.
export function filterMembers(members, query, limit = 6) {
  const q = String(query).toLowerCase();
  const score = (m) => {
    const h = m.handle.toLowerCase(); const n = m.name.toLowerCase();
    if (q === '') return 2;
    if (h.startsWith(q) || n.startsWith(q) || n.split(/\s+/).some((w) => w.startsWith(q))) return 0;
    if (h.includes(q) || n.includes(q)) return 1;
    return -1;
  };
  return members.map((m) => ({ m, s: score(m) })).filter((x) => x.s >= 0).sort((a, b) => a.s - b.s || a.m.name.localeCompare(b.m.name)).slice(0, limit).map((x) => x.m);
}
// Replaces "@query" (starting at `start`, ending at the caret) with "@handle " and says where the caret goes.
export function insertMention(text, caret, start, member) {
  const insert = `@${member.handle} `;
  return { text: text.slice(0, start) + insert + text.slice(caret), caret: start + insert.length };
}

// ---- sending without double posts ----------------------------------------------------------------------------------------------
// Same idea as the Call desk: every attempt carries a request id. If a send failed in a way where the message may or may not have been
// stored (no connection, server error), pressing Send again re-sends the SAME id, so the server cannot post it twice. A different text or kind,
// or a clear refusal by the server, starts fresh. While a send is running, further sends are ignored.
export function beginSend(state, text, kind, makeId) {
  if (state.pending) return { state, attempt: null };
  const reuse = state.retry && state.retry.text === text && state.retry.kind === kind ? state.retry.requestId : null;
  const requestId = reuse || makeId();
  return { state: { pending: true, error: null, retry: { text, kind, requestId } }, attempt: { requestId, body: text, kind } };
}
export const sendSucceeded = () => ({ pending: false, error: null, retry: null });
export function sendFailed(state, error) {
  const definitive = error && error.status >= 400 && error.status < 500 && error.status !== 408 && error.status !== 429;
  return { pending: false, error: (error && error.message) || 'The message was not sent. Please try again.', retry: definitive ? null : state.retry };
}
export const initialSendState = () => ({ pending: false, error: null, retry: null });
