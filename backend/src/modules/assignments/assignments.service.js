import { HttpError } from '../../lib/http-error.js';
import { isRealDate } from '../../lib/validate-daily-report.js';

export const MAX_MOVE = 5000;
const requireAdmin = (actor) => { if (!actor || actor.role !== 'admin') throw new HttpError(403, 'FORBIDDEN', 'Only an admin can assign leads.'); };
const idText = (v) => (typeof v === 'number' ? String(v) : v);
const validId = (v) => typeof v === 'string' && /^[1-9]\d{0,17}$/.test(v);

// Pure helper (also used by the screen's "suggest" button): spread `total` leads over BDEs so that the BDEs with the fewest open leads
// receive the most. It never gives a BDE more than the others plus one. Deterministic: ties are broken by BDE id.
// bdes: [{ id, openLeads }] -> [{ id, count }] (only entries with count > 0), sums to min(total, ...)=total.
export function suggestSplit(total, bdes) {
  if (!Number.isInteger(total) || total < 1 || bdes.length === 0) return [];
  const load = bdes.map((b) => ({ id: String(b.id), level: Number(b.openLeads) || 0, count: 0 }));
  for (let i = 0; i < total; i += 1) {
    load.sort((a, b) => (a.level + a.count) - (b.level + b.count) || (BigInt(a.id) < BigInt(b.id) ? -1 : 1));
    load[0].count += 1;
  }
  return load.filter((x) => x.count > 0).sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : 1)).map((x) => ({ id: x.id, count: x.count }));
}

export function createAssignmentService({ repo }) {
  return {
    async overview(actor, today) {
      requireAdmin(actor);
      if (!isRealDate(today)) throw new HttpError(400, 'VALIDATION_ERROR', 'Choose a valid date.', { date: 'Date is required and must be a real date.' });
      const rows = await repo.workload(today);
      return {
        date: today,
        bdes: rows.map((r) => ({ id: Number(r.id), employeeId: r.employee_id, name: r.name, openLeads: Number(r.open_leads), overdue: Number(r.overdue), reassignable: Number(r.reassignable), callsToday: Number(r.calls_today) })),
        basis: 'Open = leads whose status does not close the follow-up. Reassignable = leads with no call, interview or payment recorded yet (anything else stays with its BDE).'
      };
    },

    // body: { fromBdeId, allocations: [{ toBdeId, count }] }. All-or-nothing: if the source BDE has fewer reassignable leads than requested,
    // or the lead set changes while moving, NOTHING is moved.
    async assign(actor, body) {
      requireAdmin(actor);
      if (body === null || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, 'VALIDATION_ERROR', 'Request body must be a JSON object.');
      const fields = {};
      const from = idText(body.fromBdeId);
      if (!validId(from)) fields.fromBdeId = 'Choose the BDE the leads come from.';
      const list = Array.isArray(body.allocations) ? body.allocations : null;
      if (!list || list.length === 0) fields.allocations = 'Choose at least one BDE and a number of leads.';
      else if (list.length > 100) fields.allocations = 'Too many BDEs in one request.';
      const allocations = []; const seen = new Set(); let total = 0;
      for (const a of list || []) {
        const to = a && typeof a === 'object' ? idText(a.toBdeId) : null;
        const count = a && typeof a === 'object' ? a.count : null;
        if (!validId(to)) { fields.allocations = 'Every row needs a valid BDE.'; break; }
        if (!Number.isInteger(count) || count < 1) { fields.allocations = 'Every number of leads must be a whole number of at least 1.'; break; }
        if (seen.has(to)) { fields.allocations = 'Each BDE can appear only once.'; break; }
        if (to === from) { fields.allocations = 'The leads cannot be given back to the BDE they come from.'; break; }
        seen.add(to); total += count; allocations.push({ toBdeId: to, count });
      }
      if (total > MAX_MOVE) fields.allocations = `At most ${MAX_MOVE} leads can be moved at once.`;
      if (Object.keys(fields).length) throw new HttpError(400, 'VALIDATION_ERROR', 'Please fix the highlighted fields.', fields);

      const source = await repo.findBde(from);
      if (!source) throw new HttpError(404, 'NOT_FOUND', 'The BDE the leads come from was not found.');
      const targets = [];
      for (const a of allocations) {
        const t = await repo.findBde(a.toBdeId);
        if (!t) throw new HttpError(404, 'NOT_FOUND', 'A receiving BDE was not found.');
        if (!t.is_active) throw new HttpError(409, 'BDE_INACTIVE', `${t.name} is switched off and cannot receive leads.`);
        targets.push(t);
      }
      const ids = await repo.reassignableIds(from, total);
      if (ids.length < total) {
        throw new HttpError(409, 'NOT_ENOUGH_LEADS', `${source.name} has only ${ids.length} lead${ids.length === 1 ? '' : 's'} that can be reassigned (no call, interview or payment yet). Nothing was moved.`, { allocations: `Only ${ids.length} can be moved.` }, { available: ids.length });
      }
      let cursor = 0;
      const plan = allocations.map((a) => { const leadIds = ids.slice(cursor, cursor + a.count); cursor += a.count; return { toUserId: a.toBdeId, leadIds }; });
      try {
        const r = await repo.moveLeads({ fromUserId: from, allocations: plan });
        return { moved: r.moved, from: { id: Number(source.id), name: source.name }, to: allocations.map((a, i) => ({ id: Number(a.toBdeId), name: targets[i].name, count: a.count })) };
      } catch (err) {
        if (err && err.code === 'LEADS_CHANGED') throw new HttpError(409, 'LEADS_CHANGED', 'Some leads changed while they were being assigned. Nothing was moved; please try again.');
        throw err;
      }
    }
  };
}
