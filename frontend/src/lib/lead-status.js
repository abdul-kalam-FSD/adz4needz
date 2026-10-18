// Pure logic for the one-click status control in the BDE lead list (no React, no network of its own), so it can be unit tested.
import { addDays } from './dates.js';

// Same rule as the server (leads.service.js followUpState): closed statuses have no follow-up state.
export function followUpStateFor(date, today, closesFollowUp, upcomingDays) {
  if (!date || !today || closesFollowUp) return null;
  if (date < today) return 'overdue';
  if (date === today) return 'today';
  return date <= addDays(today, upcomingDays) ? 'upcoming' : 'later';
}

// The options shown in a lead's status dropdown: every active status, plus the lead's current one if it has since been retired.
export function statusOptions(statuses, current) {
  return statuses.some((s) => s.id === current.id) ? statuses : [...statuses, { id: current.id, name: current.name, closesFollowUp: false, retired: true }];
}

// Replaces only the status (and the follow-up badge that depends on it) of one lead in the list. Everything else stays as shown.
export function withNewStatus(leads, leadId, updated, statuses, today, upcomingDays) {
  const status = statuses.find((s) => s.id === updated.status.id);
  return leads.map((l) => (l.id !== leadId ? l : {
    ...l,
    status: { id: updated.status.id, name: updated.status.name },
    updatedAt: updated.updatedAt,
    followUpState: followUpStateFor(l.followUpDate, today, status ? status.closesFollowUp : false, upcomingDays)
  }));
}

// Runs one status change. `inFlight` is a Set of lead ids with a request already running: a second change for the same lead is
// refused (skipped) until the first finishes. `send(leadId, statusId)` performs the request. Never throws.
//   -> { skipped: true } | { ok: true, lead } | { ok: false, message }
export async function changeStatus({ lead, statusId, inFlight, send }) {
  if (inFlight.has(lead.id)) return { skipped: true };
  if (Number(statusId) === Number(lead.status.id)) return { skipped: true };
  inFlight.add(lead.id);
  try {
    const res = await send(lead.id, Number(statusId));
    if (!res || !res.lead || !res.lead.status) return { ok: false, message: 'The server sent an unexpected answer. The status was not confirmed; reload the list to check.' };
    return { ok: true, lead: res.lead };
  } catch (err) {
    return { ok: false, message: (err && err.fields && err.fields.leadStatusId) || (err && err.message) || 'Could not change the status. Please try again.' };
  } finally {
    inFlight.delete(lead.id);
  }
}

// The backend has no status-only endpoint: a lead is changed with PUT /leads/:id, which takes the whole lead (same body the edit form
// sends) and validates the status itself. So a status change re-sends the lead's current values with only leadStatusId replaced.
export function statusUpdatePayload(lead, leadStatusId) {
  return {
    candidateName: lead.candidateName,
    phone: lead.phone || '',
    email: lead.email || '',
    courseOrInternship: lead.courseOrInternship,
    leadStatusId: Number(leadStatusId),
    followUpDate: lead.followUpDate || '',
    nextAction: lead.nextAction || '',
    confirmDuplicate: false
  };
}
