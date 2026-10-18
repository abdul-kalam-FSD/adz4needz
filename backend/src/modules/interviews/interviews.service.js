import { HttpError } from '../../lib/http-error.js';
import { validateInterview } from '../../lib/validate-interview.js';
import { parseInterviewQuery, parseOverviewQuery } from '../../lib/interview-query.js';
import { parseSummaryQuery } from '../../lib/lead-query.js';

const isBde = (actor) => actor && actor.role === 'bde';
const isAdmin = (actor) => actor && actor.role === 'admin';

function requireViewer(actor) {
  if (!isBde(actor) && !isAdmin(actor)) throw new HttpError(403, 'FORBIDDEN', 'You do not have access to this resource.');
}
function requireBde(actor) {
  // Admin screens are read-only in this phase: only the owning BDE creates or edits interviews.
  if (!isBde(actor)) throw new HttpError(403, 'FORBIDDEN', 'Only the BDE who owns the lead can create or change its interviews.');
}
function requireAdmin(actor) {
  if (!isAdmin(actor)) throw new HttpError(403, 'FORBIDDEN', 'You do not have access to this resource.');
}
// BDE -> always their own id. Admin -> null (whole team).
const scopeFor = (actor) => (isBde(actor) ? actor.id : null);

// 'today' | 'upcoming' | 'needs_update' (date passed but attendance still Pending) | null
export function interviewState(scheduledAt, attendance, today) {
  if (!scheduledAt || !today) return null;
  const date = scheduledAt.slice(0, 10);
  if (date === today) return 'today';
  if (date > today) return 'upcoming';
  return attendance === 'pending' ? 'needs_update' : null;
}

function toInterview(r, { actor, today }) {
  const interview = {
    id: r.id,
    lead: { id: r.lead_id, candidateName: r.candidate_name, courseOrInternship: r.course_or_internship, phone: r.phone, email: r.email },
    scheduledAt: String(r.scheduled_at).replace(' ', 'T').slice(0, 16), // YYYY-MM-DDTHH:MM, wall-clock as entered
    attendance: r.attendance,
    outcome: r.outcome,
    interestedInJoining: r.interested_in_joining === null || r.interested_in_joining === undefined ? null : Boolean(r.interested_in_joining),
    paymentConfirmed: Boolean(r.payment_confirmed),
    state: interviewState(String(r.scheduled_at), r.attendance, today),
    createdAt: r.created_at,
    updatedAt: r.updated_at
  };
  if (isAdmin(actor)) interview.bde = { id: r.user_id, employeeId: r.bde_employee_id, name: r.bde_name };
  return interview;
}

const validationError = (errors) => new HttpError(400, 'VALIDATION_ERROR', 'Please fix the highlighted fields.', errors);

function parseId(idText) {
  if (typeof idText !== 'string' || !/^[1-9]\d{0,17}$/.test(idText)) throw new HttpError(400, 'VALIDATION_ERROR', 'Invalid interview id.');
  return idText;
}

export function createInterviewService({ repo }) {
  return {
    async list(actor, query) {
      requireViewer(actor);
      const parsed = parseInterviewQuery(query, { admin: isAdmin(actor) });
      if (!parsed.ok) throw validationError(parsed.errors);
      const filters = parsed.value;
      const { rows, total } = await repo.search({ scopeUserId: scopeFor(actor), filters });
      return { interviews: rows.map((r) => toInterview(r, { actor, today: filters.today })), total, page: filters.page, pageSize: filters.pageSize };
    },

    async summary(actor, query) {
      requireViewer(actor);
      const parsed = parseSummaryQuery(query);
      if (!parsed.ok) throw validationError(parsed.errors);
      return { counts: await repo.summary({ scopeUserId: scopeFor(actor), today: parsed.value.today }) };
    },

    // Admin only: one row per BDE plus team totals.
    async overview(actor, query) {
      requireAdmin(actor);
      const parsed = parseOverviewQuery(query);
      if (!parsed.ok) throw validationError(parsed.errors);
      const rows = await repo.overview(parsed.value);
      const totals = { scheduled: 0, attended: 0, didNotAttend: 0, attendancePending: 0, selected: 0, notSelected: 0, interestedInJoining: 0, paymentConfirmed: 0 };
      const bdes = rows.map((r) => {
        const row = {
          id: r.id, employeeId: r.employee_id, name: r.name, isActive: Boolean(r.is_active),
          scheduled: Number(r.scheduled), attended: Number(r.attended), didNotAttend: Number(r.did_not_attend),
          attendancePending: Number(r.attendance_pending), selected: Number(r.selected), notSelected: Number(r.not_selected),
          interestedInJoining: Number(r.interested_in_joining), paymentConfirmed: Number(r.payment_confirmed)
        };
        for (const k of Object.keys(totals)) totals[k] += row[k];
        return row;
      });
      return { range: parsed.value, totals, bdes };
    },

    async get(actor, idText, query = {}) {
      requireViewer(actor);
      const id = parseId(idText);
      const row = await repo.findById(id, scopeFor(actor)); // a BDE asking for someone else's interview gets 404, not 403
      if (!row) throw new HttpError(404, 'NOT_FOUND', 'Interview not found.');
      const today = parseSummaryQuery(query).ok ? query.today : null;
      return toInterview(row, { actor, today });
    },

    async create(actor, body) {
      requireBde(actor);
      const result = validateInterview(body, { forCreate: true });
      if (!result.ok) throw validationError(result.errors);
      const v = result.value;
      // Missing lead and another BDE's lead give the same answer, so lead ids cannot be probed.
      const lead = await repo.findOwnLead(v.leadId, actor.id);
      if (!lead) throw new HttpError(404, 'NOT_FOUND', 'Lead not found.');
      const id = await repo.insert(lead.id, actor.id, v); // owner always comes from the session, never from the body
      return toInterview(await repo.findById(id, actor.id), { actor, today: null });
    },

    async update(actor, idText, body) {
      requireBde(actor);
      const id = parseId(idText);
      const existing = await repo.findById(id, actor.id);
      if (!existing) throw new HttpError(404, 'NOT_FOUND', 'Interview not found.');
      const result = validateInterview(body, { forCreate: false });
      if (!result.ok) throw validationError(result.errors);
      await repo.update(id, actor.id, result.value);
      return toInterview(await repo.findById(id, actor.id), { actor, today: null });
    }
  };
}
