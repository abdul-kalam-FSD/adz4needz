// Pure helpers for the Team Chat page (unit-tested; no React, no network).
export const CHAT_BODY_MAX = 2000;

export function validateChatDraft(text) {
  const t = String(text ?? '').trim();
  if (t === '') return { ok: false, error: 'Write a message first.' };
  if (t.length > CHAT_BODY_MAX) return { ok: false, error: `A message can be at most ${CHAT_BODY_MAX} characters.` };
  return { ok: true, value: t };
}

// One id per send attempt; the page keeps it until the server confirms, so a retry can never post the message twice.
export function newRequestId() {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  const h = (n) => Array.from({ length: n }, () => Math.floor(Math.random() * 16).toString(16)).join('');
  return `${h(8)}-${h(4)}-4${h(3)}-8${h(3)}-${h(12)}`;
}

// Splits a message into plain and @mention parts. Only IDs the SERVER linked to the message (message.mentions) are highlighted,
// so "@NOBODY" or an inactive employee stays plain text. Matching is case-insensitive and ignores trailing punctuation.
export function splitMentions(body, mentions) {
  const text = String(body ?? '');
  const known = new Map((mentions || []).map((m) => [String(m.employeeId).toLowerCase(), m]));
  if (!known.size) return [{ text }];
  const out = []; let last = 0; let m;
  const re = /(^|[\s(\[{])@([A-Za-z0-9][A-Za-z0-9._-]{0,31})/g;
  while ((m = re.exec(text)) !== null) {
    const id = m[2].replace(/[._-]+$/, '');
    const person = known.get(id.toLowerCase());
    if (!person) continue;
    const start = m.index + m[1].length;
    if (start > last) out.push({ text: text.slice(last, start) });
    out.push({ text: '@' + id, mention: person });
    last = start + 1 + id.length;
    re.lastIndex = last;
  }
  if (last < text.length) out.push({ text: text.slice(last) });
  return out;
}

// Suggestions while typing: the text ends with "@par" (start or after whitespace) -> up to 6 active people whose employee ID or name starts with "par".
export function mentionSuggestions(draft, people, max = 6) {
  const m = /(^|\s)@([A-Za-z0-9._-]{0,32})$/.exec(String(draft ?? ''));
  if (!m) return [];
  const q = m[2].toLowerCase();
  return (people || []).filter((p) => p.employeeId.toLowerCase().startsWith(q) || p.name.toLowerCase().startsWith(q)).slice(0, max);
}
export function applyMention(draft, person) {
  return String(draft ?? '').replace(/(^|\s)@([A-Za-z0-9._-]{0,32})$/, (_, lead) => `${lead}@${person.employeeId} `);
}

// existing / incoming: arrays of messages (any order). The server's latest page replaces the newest window of what is shown
// (so removed messages disappear), older pages already loaded are kept. Result is oldest -> newest, unique by id.
export function mergeLatest(existing, incoming) {
  const inc = [...(incoming || [])].sort((a, b) => a.id - b.id);
  if (!inc.length) return [];
  const floor = inc[0].id;
  const kept = (existing || []).filter((m) => m.id < floor);
  return [...kept].sort((a, b) => a.id - b.id).concat(inc);
}

// createdAt is "YYYY-MM-DD HH:MM:SS" in UTC (the API's plain DATETIME strings). tz is injectable for tests.
export function formatChatTime(createdAt, { timeZone } = {}) {
  const d = new Date(String(createdAt).replace(' ', 'T') + 'Z');
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true, ...(timeZone ? { timeZone } : {}) });
}
