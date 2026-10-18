// Pure helpers for the Call desk (no React, no network), so the click rules can be unit-tested.
export const OUTCOMES = [
  { key: 'interested', label: 'Interested', tone: 'yes' },
  { key: 'not_interested', label: 'Not interested', tone: 'no' },
  { key: 'follow_up', label: 'Follow-up', tone: 'follow' },
  { key: 'no_response', label: 'No response', tone: 'none' }
];
export const outcomeLabel = (key) => (OUTCOMES.find((o) => o.key === key) || { label: key }).label;

// 0.1667 -> "16.7%". null means "no calls", shown as a dash and never as 0%.
export const formatPercent = (rate) => (rate === null || rate === undefined ? '—' : (Math.round(rate * 1000) / 10).toFixed(1) + '%');

// Random request id (UUID v4). One per click attempt; the server uses it to ignore a repeated delivery of the same click.
export function newRequestId(cryptoObj = globalThis.crypto) {
  if (cryptoObj && typeof cryptoObj.randomUUID === 'function') return cryptoObj.randomUUID();
  if (cryptoObj && typeof cryptoObj.getRandomValues === 'function') {
    const b = cryptoObj.getRandomValues(new Uint8Array(16));
    b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
    const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  }
  throw new Error('This browser cannot create a safe request id, so calls cannot be recorded here.');
}

// "2026-10-13 05:00:00" (UTC, as the API sends it) -> local time such as "10:30 am".
export function formatCallTime(calledAt) {
  const d = new Date(String(calledAt).replace(' ', 'T') + 'Z');
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
}

// ---- per-lead click state --------------------------------------------------------------------------------------------------
// rows: { [leadId]: { pending, error, retry: { outcome, followUpDate, requestId } | null, last: {...} | null } }
// Rule 1: while a click for a lead is being saved, further clicks for that lead are ignored (blocks double-clicks).
// Rule 2: if a save FAILED in a way where the call may or may not have been stored (no connection, server error), clicking the same
//         button again re-sends the SAME request id, so the server cannot count it twice. A different button gets a new id.
// Rule 3: only a real success from the server marks the row as saved. Nothing is counted or shown as saved before that.
export function beginAttempt(rows, leadId, outcome, followUpDate, makeId = newRequestId) {
  const cur = rows[leadId];
  if (cur && cur.pending) return { rows, attempt: null };
  const date = followUpDate || '';
  const reuse = cur && cur.retry && cur.retry.outcome === outcome && cur.retry.followUpDate === date ? cur.retry.requestId : null;
  const requestId = reuse || makeId();
  return {
    rows: { ...rows, [leadId]: { ...(cur || { last: null }), pending: true, error: null, retry: { outcome, followUpDate: date, requestId } } },
    attempt: { requestId, outcome, followUpDate: date || null }
  };
}
export function succeedAttempt(rows, leadId, result) {
  return { ...rows, [leadId]: { pending: false, error: null, retry: null, last: { outcome: result.call.outcome, duplicate: Boolean(result.duplicate), leadStatusUpdated: result.leadStatusUpdated, calledAt: result.call.calledAt } } };
}
export function failAttempt(rows, leadId, error) {
  const cur = rows[leadId] || { last: null };
  const definitive = error && error.status >= 400 && error.status < 500 && error.status !== 408 && error.status !== 429; // the server clearly refused it
  return { ...rows, [leadId]: { ...cur, pending: false, error: (error && error.message) || 'Could not save this call. Please try again.', retry: definitive ? null : cur.retry } };
}

// The line shown next to a lead after a successful save.
export function describeSaved(last) {
  if (!last) return '';
  const base = last.duplicate ? `Already saved: ${outcomeLabel(last.outcome)} (the repeated click was ignored)` : `Saved: ${outcomeLabel(last.outcome)}`;
  const time = last.calledAt ? formatCallTime(last.calledAt) : '';
  const warn = last.leadStatusUpdated === false ? '. The lead status was not changed (no matching status).' : '';
  return base + (time ? ' at ' + time : '') + warn;
}

// ---- lead list refresh ----------------------------------------------------------------------------------------------------
// After a call is recorded (or undone) the lead list is re-read in the BACKGROUND. While that runs the rows already on screen stay
// mounted, so keyboard focus and scroll position are not lost, and a failed refresh keeps the rows and reports the problem instead of
// replacing them with an error. A normal load (first visit, new filter, new page) still shows "Loading leads..." as before.
// list: { state: 'loading' | 'refreshing' | 'ready' | 'error', data, message, refreshError }
export function beginListLoad(list, { background = false } = {}) {
  if (background && list && list.data) return { ...list, state: 'refreshing', refreshError: '' };
  return { ...(list || {}), state: 'loading', refreshError: '' };
}
export const finishListLoad = (data) => ({ state: 'ready', data, message: '', refreshError: '' });
export function failListLoad(list, message, { background = false } = {}) {
  if (background && list && list.data) return { ...list, state: 'ready', refreshError: message || 'Could not refresh the lead list.' };
  return { state: 'error', data: null, message, refreshError: '' };
}
// True while rows should be drawn (also during a background refresh).
export const listShowsRows = (list) => Boolean(list && list.data && (list.state === 'ready' || list.state === 'refreshing'));
