import { HttpError } from '../../lib/http-error.js';
import { buildMonthlyReport, parseMonth, validateTargets } from '../../lib/monthly-report.js';
import { parseRange } from '../../lib/report-range.js';
import { PDF_MIME, XLSX_MIME, exportFileName, renderPdf, renderXlsx } from '../../lib/monthly-report-export.js';

const requireRole = (actor, role) => { if (!actor || actor.role !== role) throw new HttpError(403, 'FORBIDDEN', role === 'admin' ? 'Only an admin can do this.' : 'Only a BDE can do this.'); };
const currentMonth = (now) => now().toISOString().slice(0, 7); // UTC month; the screen always sends an explicit month

function resolveMonth(text, now) {
  const m = parseMonth(text === undefined || text === '' ? currentMonth(now) : text);
  if (!m) throw new HttpError(400, 'VALIDATION_ERROR', 'Choose a month in the form YYYY-MM (2020 or later).', { month: 'Invalid month.' });
  return m;
}

// A month text 'YYYY-MM' OR an explicit from/to range. Range wins when from or to is present.
function resolvePeriod({ month, from, to }, now) {
  if (from !== undefined || to !== undefined) {
    const r = parseRange(from, to);
    if (!r.ok) throw new HttpError(400, 'VALIDATION_ERROR', 'Choose a valid date range.', r.errors);
    return r.value;
  }
  return resolveMonth(month, now);
}

export function createMonthlyReportService({ repo, now = () => new Date(), exporter = { xlsx: renderXlsx, pdf: renderPdf } }) {
  return {
    // Admin: the whole team.
    async teamReport(actor, monthText) {
      requireRole(actor, 'admin');
      const m = resolveMonth(monthText, now);
      return buildMonthlyReport(m, await repo.monthlyRows(m, null));
    },

    // Admin: any date range (Day / Week / Month / Custom on the screen). Same query path as the monthly report, so the figures follow the
    // same calling-source rule and cannot disagree with it. No targets (those are monthly).
    async rangeReport(actor, from, to) {
      requireRole(actor, 'admin');
      const p = resolvePeriod({ from, to }, now);
      return buildMonthlyReport(p, await repo.monthlyRows(p, null));
    },

    // BDE: only the caller's own row (the id comes from the session, never from the request).
    async ownReport(actor, monthText) {
      requireRole(actor, 'bde');
      const m = resolveMonth(monthText, now);
      return buildMonthlyReport(m, await repo.monthlyRows(m, actor.id));
    },

    // Admin downloads the team report as a real file. Same data as the screen (one query path), so the file and the page cannot disagree.
    async exportReport(actor, monthText, format, range = {}) {
      requireRole(actor, 'admin');
      if (format !== 'xlsx' && format !== 'pdf') throw new HttpError(400, 'VALIDATION_ERROR', 'Unknown export format.');
      const m = resolvePeriod({ month: monthText, from: range.from, to: range.to }, now);
      const report = buildMonthlyReport(m, await repo.monthlyRows(m, null));
      const generatedAt = now().toISOString();
      const buffer = format === 'xlsx' ? await exporter.xlsx(report, { generatedAt }) : await exporter.pdf(report, { generatedAt });
      return { buffer, fileName: exportFileName(report, format), mime: format === 'xlsx' ? XLSX_MIME : PDF_MIME };
    },

    // Admin sets (or clears, by sending blanks) one BDE's targets for one month.
    async setTargets(actor, body) {
      requireRole(actor, 'admin');
      if (body === null || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, 'VALIDATION_ERROR', 'Request body must be a JSON object.');
      const m = parseMonth(body.month);
      const fields = {};
      if (!m) fields.month = 'Choose a month in the form YYYY-MM (2020 or later).';
      const idText = typeof body.bdeId === 'number' ? String(body.bdeId) : body.bdeId;
      if (typeof idText !== 'string' || !/^[1-9]\d{0,17}$/.test(idText)) fields.bdeId = 'Choose a BDE.';
      const t = validateTargets(body);
      Object.assign(fields, t.errors);
      if (Object.keys(fields).length) throw new HttpError(400, 'VALIDATION_ERROR', 'Please fix the highlighted fields.', fields);
      const bde = await repo.findBde(idText);
      if (!bde) throw new HttpError(404, 'NOT_FOUND', 'BDE not found.');
      await repo.upsertTarget({ userId: bde.id, monthStart: m.start, targets: t.value, setBy: actor.id });
      const report = buildMonthlyReport(m, await repo.monthlyRows(m, bde.id));
      return report.bdes[0] || null;
    }
  };
}
