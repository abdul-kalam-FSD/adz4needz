// In-memory stand-in for the call-log repository. It mirrors the SQL rules the real one relies on (ownership of the lead, the unique
// key on (user_id, client_request_id), voiding, and the lead update that happens together with the insert) so the service logic can be
// tested without MySQL. It is NOT MySQL: the real SQL is covered by tests-integration/call-logs.db.test.js, which needs a database.
import { createCallLogRepository } from '../../src/modules/call-logs/call-logs.repository.js';

export function fakeCallLogRepo({ leads, statuses } = {}) {
  const state = {
    leads: leads || [
      { id: 1, user_id: 10, candidate_name: 'Anu', lead_status_id: 1, follow_up_date: null },
      { id: 2, user_id: 10, candidate_name: 'Babu', lead_status_id: 1, follow_up_date: '2026-10-01' },
      { id: 3, user_id: 11, candidate_name: 'Chitra', lead_status_id: 1, follow_up_date: null }
    ],
    statuses: statuses || [{ id: 1, name: 'New', is_active: 1 }, { id: 2, name: 'Interested', is_active: 1 }, { id: 3, name: 'Follow-up Required', is_active: 1 },
      { id: 4, name: 'No Response / Not Reachable', is_active: 1 }, { id: 5, name: 'Not Interested', is_active: 1 }],
    logs: [], nextId: 1, inserts: 0, failNextInsertWith: null, racingWinner: null
  };
  const real = createCallLogRepository({ query: async () => { throw new Error('fake: no db'); } }); // only for toLog
  return {
    state, toLog: real.toLog,
    findOwnLead: async (leadId, userId) => state.leads.find((l) => String(l.id) === String(leadId) && l.user_id === userId) || null,
    findStatusIdByName: async (name) => (state.statuses.find((s) => s.name === name && s.is_active) || {}).id ?? null,
    findByRequestId: async (userId, rid) => state.logs.find((r) => r.user_id === userId && r.client_request_id === rid) || null,
    findOwn: async (id, userId) => state.logs.find((r) => String(r.id) === String(id) && r.user_id === userId) || null,
    insertWithLeadUpdate: async (a) => {
      if (state.failNextInsertWith) { const e = state.failNextInsertWith; state.failNextInsertWith = null; if (state.racingWinner) state.logs.push(state.racingWinner); throw e; }
      if (state.logs.some((r) => r.user_id === a.userId && r.client_request_id === a.clientRequestId)) { const e = new Error('dup'); e.code = 'ER_DUP_ENTRY'; throw e; }
      const lead = state.leads.find((l) => String(l.id) === String(a.leadId) && l.user_id === a.userId);
      if (!lead) throw new Error('fk: lead is not owned by the user'); // the composite foreign key
      const id = state.nextId++; state.inserts++;
      state.logs.push({ id, user_id: a.userId, lead_id: Number(a.leadId), outcome: a.outcome, call_date: a.callDate, called_at: a.calledAt, client_request_id: a.clientRequestId, voided_at: null });
      if (a.statusId !== null && a.statusId !== undefined) { lead.lead_status_id = a.statusId; if (a.followUpDate) lead.follow_up_date = a.followUpDate; }
      return id;
    },
    markVoided: async (id, userId, at) => { const r = state.logs.find((x) => String(x.id) === String(id) && x.user_id === userId && !x.voided_at); if (!r) return 0; r.voided_at = at; return 1; },
    eventsForUserDate: async (userId, day) => state.logs.filter((r) => r.user_id === userId && r.call_date === day && !r.voided_at)
      .map((r) => ({ ...r, candidate_name: state.leads.find((l) => l.id === r.lead_id).candidate_name })).sort((a, b) => (a.called_at < b.called_at ? -1 : a.called_at > b.called_at ? 1 : a.id - b.id)),
    eventsForDate: async (day) => state.logs.filter((r) => r.call_date === day && !r.voided_at).sort((a, b) => (a.called_at < b.called_at ? -1 : a.called_at > b.called_at ? 1 : a.id - b.id))
  };
}
