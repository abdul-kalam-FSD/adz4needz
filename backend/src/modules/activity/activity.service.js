import { HttpError } from '../../lib/http-error.js';
import { isRealDate } from '../../lib/validate-daily-report.js';
import { addDays } from '../../lib/dates.js';
import { ACTIVITY_KINDS, DEFAULT_FEED_LIMIT, MAX_FEED_DAYS, MAX_FEED_LIMIT, describeEvent } from '../../lib/activity-events.js';

export function createActivityService({ repo }) {
  return {
    // Admin only. from/to are inclusive dates (the admin's own calendar days; stored times are UTC, as on every other screen).
    async feed(actor, q = {}) {
      if (!actor || actor.role !== 'admin') throw new HttpError(403, 'FORBIDDEN', 'Only an admin can view the activity feed.');
      const errors = {};
      if (!isRealDate(q.from)) errors.from = 'Choose a valid start date.';
      if (!isRealDate(q.to)) errors.to = 'Choose a valid end date.';
      if (!errors.from && !errors.to) {
        if (q.to < q.from) errors.to = 'The end date must not be before the start date.';
        else if (addDays(q.from, MAX_FEED_DAYS - 1) < q.to) errors.to = `Choose at most ${MAX_FEED_DAYS} days.`;
      }
      const kind = q.kind === undefined || q.kind === '' ? null : q.kind;
      if (kind !== null && !ACTIVITY_KINDS.includes(kind)) errors.kind = 'Unknown activity type.';
      const actorId = q.actorId === undefined || q.actorId === '' ? null : q.actorId;
      if (actorId !== null && !/^[1-9]\d{0,17}$/.test(String(actorId))) errors.actorId = 'Choose a valid person.';
      let limit = DEFAULT_FEED_LIMIT;
      if (q.limit !== undefined && q.limit !== '') {
        const n = Number(q.limit);
        if (!Number.isInteger(n) || n < 1 || n > MAX_FEED_LIMIT) errors.limit = `Limit must be a whole number from 1 to ${MAX_FEED_LIMIT}.`; else limit = n;
      }
      if (Object.keys(errors).length) throw new HttpError(400, 'VALIDATION_ERROR', 'Please fix the highlighted fields.', errors);
      const rows = await repo.feed({ fromTs: `${q.from} 00:00:00`, toTs: `${addDays(q.to, 1)} 00:00:00`, kind, actorId: actorId === null ? null : String(actorId), limit });
      return {
        from: q.from, to: q.to, limit, truncated: rows.length === limit,
        events: rows.map((r) => ({ at: r.at, kind: r.kind, actor: { id: Number(r.actor_id), name: r.actor_name, employeeId: r.actor_employee_id, role: r.actor_role }, ...describeEvent(r) })),
        basis: 'Built from records the application already keeps (calls, leads, interviews, payments, receipts, imports, new accounts, daily reports). Times are UTC. Sign-ins, password resets, switching accounts on or off, and lead reassignment are not recorded anywhere yet, so they cannot appear here.'
      };
    }
  };
}
