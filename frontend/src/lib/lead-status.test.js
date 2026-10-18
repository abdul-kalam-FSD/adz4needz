import test from 'node:test';
import assert from 'node:assert/strict';
import { followUpStateFor, statusOptions, withNewStatus, changeStatus, statusUpdatePayload } from './lead-status.js';

const statuses = [{ id: 1, name: 'New', closesFollowUp: false }, { id: 2, name: 'Interested', closesFollowUp: false }, { id: 5, name: 'Not Interested', closesFollowUp: true }];
const lead = (o = {}) => ({ id: 10, candidateName: 'Priya', status: { id: 1, name: 'New' }, followUpDate: '2026-10-10', followUpState: 'overdue', nextAction: 'Call', updatedAt: 'a', ...o });

test('followUpStateFor mirrors the server rule', () => {
  assert.equal(followUpStateFor('2026-10-10', '2026-10-13', false, 7), 'overdue');
  assert.equal(followUpStateFor('2026-10-13', '2026-10-13', false, 7), 'today');
  assert.equal(followUpStateFor('2026-10-20', '2026-10-13', false, 7), 'upcoming');
  assert.equal(followUpStateFor('2026-10-21', '2026-10-13', false, 7), 'later');
  assert.equal(followUpStateFor('2026-10-10', '2026-10-13', true, 7), null, 'closed status: no follow-up state');
  assert.equal(followUpStateFor(null, '2026-10-13', false, 7), null);
});

test('statusOptions keeps the lead\'s retired status selectable-as-current', () => {
  assert.equal(statusOptions(statuses, { id: 2, name: 'Interested' }), statuses);
  const o = statusOptions(statuses, { id: 9, name: 'Retired' });
  assert.equal(o.length, 4); assert.equal(o[3].retired, true);
});

test('withNewStatus changes only the one lead\'s status and its follow-up badge', () => {
  const list = [lead(), lead({ id: 11, candidateName: 'Ravi' })];
  const out = withNewStatus(list, 10, { status: { id: 5, name: 'Not Interested' }, updatedAt: 'b' }, statuses, '2026-10-13', 7);
  assert.equal(out[0].status.name, 'Not Interested'); assert.equal(out[0].followUpState, null); assert.equal(out[0].updatedAt, 'b');
  assert.equal(out[0].candidateName, 'Priya'); assert.equal(out[0].nextAction, 'Call'); assert.equal(out[0].followUpDate, '2026-10-10');
  assert.equal(out[1], list[1], 'other leads are the same objects');
  const back = withNewStatus(out, 10, { status: { id: 2, name: 'Interested' }, updatedAt: 'c' }, statuses, '2026-10-13', 7);
  assert.equal(back[0].followUpState, 'overdue', 'reopening a lead brings the badge back');
});

test('changeStatus: success returns the server lead and sends the numeric id', async () => {
  const sent = [];
  const r = await changeStatus({ lead: lead(), statusId: '2', inFlight: new Set(), send: async (id, s) => { sent.push([id, s]); return { lead: { status: { id: 2, name: 'Interested' } } }; } });
  assert.equal(r.ok, true); assert.deepEqual(sent, [[10, 2]]); assert.equal(r.lead.status.name, 'Interested');
});

test('changeStatus: a failed request is ok:false with the server message, never a success', async () => {
  const inFlight = new Set();
  const r = await changeStatus({ lead: lead(), statusId: 2, inFlight, send: async () => { const e = new Error('Lead not found.'); e.status = 404; throw e; } });
  assert.deepEqual(r, { ok: false, message: 'Lead not found.' });
  assert.equal(inFlight.size, 0, 'the lock is released after a failure');
  const f = await changeStatus({ lead: lead(), statusId: 2, inFlight, send: async () => { const e = new Error('x'); e.fields = { leadStatusId: 'Choose a valid lead status.' }; throw e; } });
  assert.equal(f.message, 'Choose a valid lead status.');
  const w = await changeStatus({ lead: lead(), statusId: 2, inFlight, send: async () => { throw {}; } });
  assert.equal(w.ok, false); assert.ok(w.message.length > 0);
});

test('changeStatus: an unexpected success body is not treated as success', async () => {
  for (const body of [undefined, {}, { lead: {} }]) assert.equal((await changeStatus({ lead: lead(), statusId: 2, inFlight: new Set(), send: async () => body })).ok, false);
});

test('changeStatus: duplicate submissions are refused while one is running; unchanged status sends nothing', async () => {
  const inFlight = new Set(); let calls = 0; let release;
  const send = () => { calls++; return new Promise((res) => { release = () => res({ lead: { status: { id: 2, name: 'Interested' } } }); }); };
  const first = changeStatus({ lead: lead(), statusId: 2, inFlight, send });
  assert.deepEqual(await changeStatus({ lead: lead(), statusId: 5, inFlight, send }), { skipped: true });
  assert.equal(calls, 1); assert.equal(inFlight.has(10), true);
  release(); assert.equal((await first).ok, true); assert.equal(inFlight.has(10), false);
  assert.deepEqual(await changeStatus({ lead: lead(), statusId: 1, inFlight, send }), { skipped: true });
  assert.equal(calls, 1);
  // a different lead is not blocked
  const other = changeStatus({ lead: lead({ id: 11 }), statusId: 2, inFlight, send }); assert.equal(calls, 2); release(); await other;
});

test('wiring (text): the client uses the status-only endpoint (one PATCH /leads/:id/status request); only the BDE list gets the dropdown', async () => {
  const { readFileSync } = await import('node:fs');
  const client = readFileSync(new URL('../api/client.js', import.meta.url), 'utf8');
  assert.match(client, /setLeadStatus: \(id, leadStatusId\) => request\('PATCH', '\/leads\/' \+ encodeURIComponent\(id\) \+ '\/status', \{ leadStatusId: Number\(leadStatusId\) \}\)/);
  assert.doesNotMatch(client, /setLeadStatus: async/, 'no read-then-write of the whole lead any more');
  const app = readFileSync(new URL('../../../backend/src/app.js', import.meta.url), 'utf8');
  assert.match(app, /api\.put\('\/leads\/:id'/);
  assert.match(app, /api\.patch\('\/leads\/:id\/status', authenticate, authorize\('bde'\), asyncHandler\(leads\.setStatus\)\)/, 'the server really offers the endpoint the client calls');
  const view = readFileSync(new URL('../components/LeadsListView.jsx', import.meta.url), 'utf8');
  assert.match(view, /api\.setLeadStatus\(id, statusId\)/); assert.match(view, /\{admin \? l\.status\.name : \(/, 'admin view stays read-only');
  assert.match(view, /disabled=\{busyIds\.includes\(l\.id\)\}/);
});

test('statusUpdatePayload re-sends the lead unchanged except for the status (the whole-lead PUT must not blank other fields)', () => {
  const p = statusUpdatePayload({ candidateName: 'Priya', phone: null, email: 'p@x.in', courseOrInternship: 'Java', status: { id: 1 }, followUpDate: null, nextAction: null }, '5');
  assert.deepEqual(p, { candidateName: 'Priya', phone: '', email: 'p@x.in', courseOrInternship: 'Java', leadStatusId: 5, followUpDate: '', nextAction: '', confirmDuplicate: false });
});

test('changeStatus: permission and invalid-status rejections are reported, never shown as success', async () => {
  for (const [status, msg] of [[403, 'Only BDEs can do this.'], [404, 'Lead not found.'], [401, 'Please sign in again.']]) {
    const r = await changeStatus({ lead: lead(), statusId: 2, inFlight: new Set(), send: async () => { const e = new Error(msg); e.status = status; throw e; } });
    assert.deepEqual(r, { ok: false, message: msg });
  }
  const bad = await changeStatus({ lead: lead(), statusId: 999, inFlight: new Set(), send: async () => { const e = new Error('Please correct the highlighted fields.'); e.status = 400; e.fields = { leadStatusId: 'Choose a valid lead status.' }; throw e; } });
  assert.deepEqual(bad, { ok: false, message: 'Choose a valid lead status.' });
});
