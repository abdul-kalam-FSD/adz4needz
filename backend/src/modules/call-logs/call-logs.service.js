import { HttpError } from '../../lib/http-error.js';
import { isRealDate } from '../../lib/validate-daily-report.js';
import { clockParts, validateCallLog, summarizeEvents, summarizeByUser, conversionRate, OUTCOME_STATUS_NAME } from '../../lib/call-log.js';

const isBde = (actor) => actor && actor.role === 'bde';
const validationError = (errors) => new HttpError(400, 'VALIDATION_ERROR', 'Please fix the highlighted fields.', errors);
const MAX_ENTRIES = 30; // newest calls shown (and undoable) on the BDE's Call desk

function parseId(idText) {
  if (typeof idText !== 'string' || !/^[1-9]\d{0,17}$/.test(idText)) throw new HttpError(400, 'VALIDATION_ERROR', 'Invalid call id.');
  return idText;
}
function isDuplicateKey(err) { return err && err.code === 'ER_DUP_ENTRY'; }
function isDeadlock(err) { return err && err.code === 'ER_LOCK_DEADLOCK'; }
const MAX_ATTEMPTS = 3;

export function createCallLogService({ repo, adminRepo, now = () => Date.now(), offsetMinutes = 330 }) {
  const clock = () => clockParts(now(), offsetMinutes);

  function requestedDate(date, fallback) {
    if (date === undefined || date === '') return fallback;
    if (!isRealDate(date)) throw validationError({ date: 'Choose a valid date.' });
    return date;
  }

  return {
    // Records ONE call. Repeating the same clientRequestId (double-click, retry) returns the original call with duplicate: true.
    async record(actor, body) {
      if (!isBde(actor)) throw new HttpError(403, 'FORBIDDEN', 'Only a BDE can record calls.');
      const result = validateCallLog(body);
      if (!result.ok) throw validationError(result.errors);
      const v = result.value;
      const { callDate, calledAt } = clock();

      if (v.followUpDate && v.followUpDate < callDate) throw validationError({ followUpDate: 'Follow-up date cannot be in the past.' });

      const sameRequest = (row) => {
        if (String(row.lead_id) !== v.leadId || row.outcome !== v.outcome) {
          throw new HttpError(409, 'REQUEST_ID_REUSED', 'This request id was already used for a different call. Please try again.');
        }
        return { call: repo.toLog(row), duplicate: true, leadStatusUpdated: null };
      };
      const earlier = await repo.findByRequestId(actor.id, v.clientRequestId);
      if (earlier) return sameRequest(earlier);

      const lead = await repo.findOwnLead(v.leadId, actor.id); // someone else's lead looks the same as a missing one
      if (!lead) throw new HttpError(404, 'NOT_FOUND', 'Lead not found.');

      const statusId = await repo.findStatusIdByName(OUTCOME_STATUS_NAME[v.outcome]);
      let id;
      for (let attempt = 1; ; attempt++) {
        try {
          id = await repo.insertWithLeadUpdate({
            userId: actor.id, leadId: v.leadId, outcome: v.outcome, callDate, calledAt, clientRequestId: v.clientRequestId,
            statusId, followUpDate: v.followUpDate
          });
          break;
        } catch (err) {
          const retryable = isDuplicateKey(err) || isDeadlock(err);
          if (!retryable) throw err;
          const winner = await repo.findByRequestId(actor.id, v.clientRequestId); // another copy of this click was saved first
          if (winner) return sameRequest(winner);
          if (isDuplicateKey(err) || attempt >= MAX_ATTEMPTS) throw err; // a duplicate key with no winner is not expected: do not hide it
          // deadlock and nothing saved yet: the database rolled this attempt back completely, so trying again is safe
        }
      }
      const saved = await repo.findOwn(id, actor.id);
      return { call: repo.toLog(saved), duplicate: false, leadStatusUpdated: statusId !== null && statusId !== undefined };
    },

    // Undo a mistaken click: same day only, own calls only. The row is kept but no longer counted. Repeating it is harmless.
    // The lead's status is NOT reverted (the status may have been edited since); record the right outcome to correct it.
    async undo(actor, idText) {
      if (!isBde(actor)) throw new HttpError(403, 'FORBIDDEN', 'Only a BDE can undo calls.');
      const id = parseId(idText);
      const row = await repo.findOwn(id, actor.id);
      if (!row) throw new HttpError(404, 'NOT_FOUND', 'Call not found.');
      if (row.voided_at) return { call: repo.toLog(row), alreadyUndone: true };
      const { callDate, calledAt } = clock();
      if (row.call_date !== callDate) throw new HttpError(409, 'CANNOT_UNDO', "Only today's calls can be undone.");
      await repo.markVoided(id, actor.id, calledAt);
      return { call: repo.toLog(await repo.findOwn(id, actor.id)), alreadyUndone: false };
    },

    // The BDE's own day: statistics plus the newest calls (each with whether it can still be undone).
    async dailySummary(actor, date) {
      if (!isBde(actor)) throw new HttpError(403, 'FORBIDDEN', 'Only a BDE has a call desk.');
      const today = clock().callDate;
      const day = requestedDate(date, today);
      const events = await repo.eventsForUserDate(actor.id, day);
      return {
        date: day, today,
        stats: summarizeEvents(events),
        entries: [...events].reverse().slice(0, MAX_ENTRIES).map((e) => ({
          id: String(e.id), leadId: String(e.lead_id), candidateName: e.candidate_name, outcome: e.outcome, calledAt: e.called_at, canUndo: day === today
        }))
      };
    },

    // Admin: one row per BDE for one day. The call log is the source when it has any calls for that BDE and day; otherwise the
    // manual Daily Calling Report is used; the two are NEVER added together. The manual figures stay visible for comparison.
    async adminDailyStats(date) {
      if (!isRealDate(date)) throw validationError({ date: 'Date is required and must be a real date.' });
      const [people, events] = await Promise.all([adminRepo.overviewForDate(date), repo.eventsForDate(date)]);
      const byUser = summarizeByUser(events);
      const totals = { bdeCount: people.length, callsRecorded: 0, manualOnly: 0, noActivity: 0, totalCalls: 0, interested: 0, notInterested: 0, followUpRequired: 0, noResponse: 0, interestedLeads: 0, conversionRate: null };
      const bdes = people.map((p) => {
        const hasManual = p.report_id !== null && p.report_id !== undefined;
        const manualReport = hasManual ? { totalCalls: p.total_calls, interested: p.interested, notInterested: p.not_interested, followUpRequired: p.follow_up_required, noResponse: p.no_response } : null;
        const s = byUser.get(String(p.id));
        const base = { id: p.id, employeeId: p.employee_id, name: p.name, isActive: Boolean(p.is_active), manualReport };
        let row;
        if (s) {
          row = { ...base, status: 'calls_recorded', source: 'call_log', totalCalls: s.totalCalls, interested: s.outcomes.interested, notInterested: s.outcomes.notInterested,
            followUpRequired: s.outcomes.followUp, noResponse: s.outcomes.noResponse, interestedLeads: s.interestedLeads, uniqueLeadsCalled: s.uniqueLeadsCalled,
            repeatCalls: s.repeatCalls, conversionRate: s.conversionRate, lastActivityAt: s.lastActivityAt };
          totals.callsRecorded += 1;
        } else if (hasManual) {
          // The manual form has no per-lead data, so its "interested" is used as the lead count (best available; see the docs).
          row = { ...base, status: 'manual_report', source: 'manual', totalCalls: p.total_calls, interested: p.interested, notInterested: p.not_interested,
            followUpRequired: p.follow_up_required, noResponse: p.no_response, interestedLeads: p.interested, uniqueLeadsCalled: null,
            repeatCalls: null, conversionRate: conversionRate(p.interested, p.total_calls), lastActivityAt: null };
          totals.manualOnly += 1;
        } else {
          row = { ...base, status: 'no_activity', source: 'none', totalCalls: null, interested: null, notInterested: null, followUpRequired: null, noResponse: null,
            interestedLeads: null, uniqueLeadsCalled: null, repeatCalls: null, conversionRate: null, lastActivityAt: null };
          totals.noActivity += 1;
        }
        if (row.source !== 'none') {
          totals.totalCalls += row.totalCalls; totals.interested += row.interested; totals.notInterested += row.notInterested;
          totals.followUpRequired += row.followUpRequired; totals.noResponse += row.noResponse; totals.interestedLeads += row.interestedLeads;
        }
        return row;
      });
      totals.conversionRate = conversionRate(totals.interestedLeads, totals.totalCalls);
      return { date, totals, bdes };
    }
  };
}
