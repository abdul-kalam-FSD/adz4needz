import { HttpError } from '../../lib/http-error.js';
import { addDays } from '../../lib/dates.js';
import { validateLead } from '../../lib/validate-lead.js';
import { parseLeadQuery, parseSummaryQuery, UPCOMING_DAYS } from '../../lib/lead-query.js';

const isBde = (actor) => actor && actor.role === 'bde';
const isAdmin = (actor) => actor && actor.role === 'admin';
const sameId = (a, b) => Number(a) === Number(b);

function requireViewer(actor) {
  if (!isBde(actor) && !isAdmin(actor)) throw new HttpError(403, 'FORBIDDEN', 'You do not have access to this resource.');
}
function requireBde(actor) {
  // Admin screens are read-only in this phase: only the owning BDE creates or edits leads.
  if (!isBde(actor)) throw new HttpError(403, 'FORBIDDEN', 'Only the BDE who owns a lead can create or change it.');
}
// BDE -> always their own id. Admin -> null (whole team).
const scopeFor = (actor) => (isBde(actor) ? actor.id : null);

// 'overdue' | 'today' | 'upcoming' | 'later' | null (no date, no "today" given, or the status closes follow-ups)
export function followUpState(date, today, closesFollowUp) {
  if (!date || !today || Number(closesFollowUp) === 1) return null;
  if (date < today) return 'overdue';
  if (date === today) return 'today';
  return date <= addDays(today, UPCOMING_DAYS) ? 'upcoming' : 'later';
}

function toLead(r, { actor, today }) {
  const lead = {
    id: r.id,
    candidateName: r.candidate_name,
    phone: r.phone,
    email: r.email,
    courseOrInternship: r.course_or_internship,
    status: { id: r.lead_status_id, name: r.status_name },
    followUpDate: r.follow_up_date,
    nextAction: r.next_action,
    followUpState: followUpState(r.follow_up_date, today, r.closes_follow_up),
    createdAt: r.created_at,
    updatedAt: r.updated_at
  };
  if (isAdmin(actor)) lead.bde = { id: r.user_id, employeeId: r.bde_employee_id, name: r.bde_name };
  return lead;
}

const validationError = (errors) => new HttpError(400, 'VALIDATION_ERROR', 'Please fix the highlighted fields.', errors);

function parseId(idText) {
  if (typeof idText !== 'string' || !/^[1-9]\d{0,17}$/.test(idText)) throw new HttpError(400, 'VALIDATION_ERROR', 'Invalid lead id.');
  return idText;
}

export function createLeadService({ repo }) {
  // Possible duplicates: details only for the caller's OWN leads; other BDEs' leads are reported as a count only.
  async function checkDuplicates(actor, v, excludeId) {
    const rows = await repo.findDuplicates({ phoneKey: v.phoneKey, emailKey: v.emailKey, excludeId });
    if (!rows.length || v.confirmDuplicate) return;
    const own = rows.filter((d) => sameId(d.user_id, actor.id)).map((d) => ({
      id: d.id, candidateName: d.candidate_name, phone: d.phone, email: d.email,
      courseOrInternship: d.course_or_internship, statusName: d.status_name, followUpDate: d.follow_up_date
    }));
    const otherBdeMatches = rows.length - own.length;
    throw new HttpError(409, 'POSSIBLE_DUPLICATE',
      'A lead with the same phone or email already exists. Check it before saving. Nothing has been merged.',
      undefined, { own, otherBdeMatches });
  }

  async function assertStatusUsable(statusId, currentStatusId) {
    if (currentStatusId !== undefined && sameId(statusId, currentStatusId)) return; // unchanged status is always allowed
    const status = await repo.findStatus(statusId);
    if (!status || !status.is_active) throw validationError({ leadStatusId: 'Choose a valid lead status.' });
  }

  return {
    async listStatuses(actor) {
      requireViewer(actor);
      return (await repo.listStatuses()).map((s) => ({ id: s.id, name: s.name, closesFollowUp: Boolean(s.closes_follow_up) }));
    },

    async list(actor, query) {
      requireViewer(actor);
      const parsed = parseLeadQuery(query, { admin: isAdmin(actor) });
      if (!parsed.ok) throw validationError(parsed.errors);
      const filters = parsed.value;
      const { rows, total } = await repo.search({ scopeUserId: scopeFor(actor), filters });
      return {
        leads: rows.map((r) => toLead(r, { actor, today: filters.today })),
        total, page: filters.page, pageSize: filters.pageSize, upcomingDays: UPCOMING_DAYS
      };
    },

    async followUpSummary(actor, query) {
      requireViewer(actor);
      const parsed = parseSummaryQuery(query);
      if (!parsed.ok) throw validationError(parsed.errors);
      const counts = await repo.followUpSummary({ scopeUserId: scopeFor(actor), today: parsed.value.today });
      return { counts, upcomingDays: UPCOMING_DAYS };
    },

    async get(actor, idText, query = {}) {
      requireViewer(actor);
      const id = parseId(idText);
      const row = await repo.findById(id, scopeFor(actor)); // a BDE asking for someone else's lead gets 404, not 403
      if (!row) throw new HttpError(404, 'NOT_FOUND', 'Lead not found.');
      const today = parseSummaryQuery(query).ok ? query.today : null;
      return toLead(row, { actor, today });
    },

    async create(actor, body) {
      requireBde(actor);
      const result = validateLead(body);
      if (!result.ok) throw validationError(result.errors);
      const v = result.value;
      await assertStatusUsable(v.leadStatusId);
      await checkDuplicates(actor, v, undefined);
      const id = await repo.insert(actor.id, v); // owner always comes from the session, never from the body
      return toLead(await repo.findById(id, actor.id), { actor, today: null });
    },

    async update(actor, idText, body) {
      requireBde(actor);
      const id = parseId(idText);
      const existing = await repo.findById(id, actor.id);
      if (!existing) throw new HttpError(404, 'NOT_FOUND', 'Lead not found.');
      const result = validateLead(body);
      if (!result.ok) throw validationError(result.errors);
      const v = result.value;
      await assertStatusUsable(v.leadStatusId, existing.lead_status_id);
      if (v.phoneKey !== existing.phone_key || v.emailKey !== existing.email_key) await checkDuplicates(actor, v, id);
      await repo.update(id, actor.id, v);
      return toLead(await repo.findById(id, actor.id), { actor, today: null });
    },

    // One-click status change from the lead list: only the status changes (nothing else on the lead is touched).
    // BDE only, own leads only (someone else's lead is a 404), and the new status must be active.
    async setStatus(actor, idText, body) {
      requireBde(actor);
      const id = parseId(idText);
      const existing = await repo.findById(id, actor.id);
      if (!existing) throw new HttpError(404, 'NOT_FOUND', 'Lead not found.');
      const raw = body && body.leadStatusId;
      const ok = (typeof raw === 'number' && Number.isInteger(raw) && raw > 0) || (typeof raw === 'string' && /^[1-9]\d{0,8}$/.test(raw.trim()));
      if (!ok) throw validationError({ leadStatusId: 'Choose a valid lead status.' });
      const statusId = Number(raw);
      await assertStatusUsable(statusId, existing.lead_status_id);
      if (!sameId(statusId, existing.lead_status_id)) await repo.setStatus(id, actor.id, statusId);
      return toLead(await repo.findById(id, actor.id), { actor, today: null });
    }
  };
}
