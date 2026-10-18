// Pure rules for the call log (no database, no clock of its own). Everything here is unit-tested.
import { isRealDate } from './validate-daily-report.js';

export const CALL_OUTCOMES = ['interested', 'not_interested', 'follow_up', 'no_response'];

// The lead status a recorded outcome moves the lead to. Statuses are DATA (migration 004 says the TL may rename them), so the
// lookup is by name and the service reports whether it found one; a missing status never blocks recording the call itself.
export const OUTCOME_STATUS_NAME = {
  interested: 'Interested',
  not_interested: 'Not Interested',
  follow_up: 'Follow-up Required',
  no_response: 'No Response / Not Reachable'
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// The BDE's working date and the UTC timestamp, both taken from ONE instant so they can never disagree.
export function clockParts(nowMs, offsetMinutes) {
  return {
    callDate: new Date(nowMs + offsetMinutes * 60000).toISOString().slice(0, 10),
    calledAt: new Date(nowMs).toISOString().slice(0, 19).replace('T', ' ')
  };
}

export function validateCallLog(body) {
  const errors = {};
  const value = {};
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, errors: { _form: 'Request body must be a JSON object.' }, value };
  }
  const rawLead = body.leadId;
  if (typeof rawLead === 'number' && Number.isSafeInteger(rawLead) && rawLead > 0) value.leadId = String(rawLead);
  else if (typeof rawLead === 'string' && /^[1-9]\d{0,17}$/.test(rawLead)) value.leadId = rawLead;
  else errors.leadId = 'Choose a lead.';

  if (typeof body.outcome === 'string' && CALL_OUTCOMES.includes(body.outcome)) value.outcome = body.outcome;
  else errors.outcome = 'Outcome must be one of: ' + CALL_OUTCOMES.join(', ') + '.';

  if (typeof body.clientRequestId === 'string' && UUID.test(body.clientRequestId)) value.clientRequestId = body.clientRequestId.toLowerCase();
  else errors.clientRequestId = 'A request id (UUID) is required so a repeated click is not counted twice.';

  value.followUpDate = null;
  if (body.followUpDate !== undefined && body.followUpDate !== null && body.followUpDate !== '') {
    if (value.outcome !== undefined && value.outcome !== 'follow_up') errors.followUpDate = 'A follow-up date can only be set together with the Follow-up outcome.';
    else if (!isRealDate(body.followUpDate)) errors.followUpDate = 'Follow-up date is not a valid date.';
    else value.followUpDate = body.followUpDate;
  }
  return { ok: Object.keys(errors).length === 0, errors, value };
}

// THE conversion definition, used by the daily call desk, the admin daily table, the monthly report, My Month and both exports:
//   conversion = interested leads / total calls, as a percentage rounded half-up to ONE decimal (integer arithmetic, no float drift).
// null (not 0) when there were no calls. conversionRate is the same number as a fraction (16.7% -> 0.167), so every screen shows the same digits.
export function conversionPercent(interestedLeads, totalCalls) {
  const i = Number(interestedLeads) || 0; const t = Number(totalCalls) || 0;
  if (t <= 0) return null;
  return Math.floor((2000 * i + t) / (2 * t)) / 10;
}
export function conversionRate(interestedLeads, totalCalls) {
  const i = Number(interestedLeads) || 0; const t = Number(totalCalls) || 0;
  if (t <= 0) return null;
  return Math.floor((2000 * i + t) / (2 * t)) / 1000;
}

const byTime = (a, b) => (a.called_at < b.called_at ? -1 : a.called_at > b.called_at ? 1 : Number(a.id) - Number(b.id));

// Statistics for ONE BDE on ONE day from their NON-VOIDED call events. Counting rules (the TL has not defined these; see
// docs/call-log-assumptions.md):
//   totalCalls        = number of events. Every call counts, including repeated calls to the same lead.
//   uniqueLeadsCalled = number of different leads called; repeatCalls = totalCalls - uniqueLeadsCalled.
//   outcomes          = events per outcome (so they always add up to totalCalls).
//   interestedLeads   = number of different leads whose LATEST call of the day ended as "interested".
//                       A lead who said interested and later not interested counts as not interested; a lead is never counted twice.
//   conversionRate    = interestedLeads / totalCalls, see conversionRate() above (the TL's example: 30 calls -> 5 leads).
export function summarizeEvents(events) {
  const sorted = [...events].sort(byTime);
  const outcomes = { interested: 0, notInterested: 0, followUp: 0, noResponse: 0 };
  const key = { interested: 'interested', not_interested: 'notInterested', follow_up: 'followUp', no_response: 'noResponse' };
  const latest = new Map();
  for (const e of sorted) {
    outcomes[key[e.outcome]] += 1;
    latest.set(String(e.lead_id), e.outcome);
  }
  const totalCalls = sorted.length;
  const interestedLeads = [...latest.values()].filter((o) => o === 'interested').length;
  return {
    totalCalls,
    uniqueLeadsCalled: latest.size,
    repeatCalls: totalCalls - latest.size,
    outcomes,
    interestedLeads,
    conversionRate: conversionRate(interestedLeads, totalCalls),
    lastActivityAt: totalCalls === 0 ? null : sorted[sorted.length - 1].called_at
  };
}

export function summarizeByUser(events) {
  const groups = new Map();
  for (const e of events) {
    const k = String(e.user_id);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(e);
  }
  return new Map([...groups].map(([k, list]) => [k, summarizeEvents(list)]));
}
