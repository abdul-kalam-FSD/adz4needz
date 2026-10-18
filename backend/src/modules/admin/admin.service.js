import { HttpError } from '../../lib/http-error.js';
import { isRealDate } from '../../lib/validate-daily-report.js';

const toBde = (r) => ({ id: r.id, employeeId: r.employee_id, name: r.name, isActive: Boolean(r.is_active) });

export function createAdminService({ adminRepo, reportRepo }) {
  return {
    async listBdes() {
      return (await adminRepo.listBdes()).map(toBde);
    },

    // The date comes from the browser (the admin's own "today"), so the server needs no timezone guess.
    async dailyOverview(date) {
      if (!isRealDate(date)) {
        throw new HttpError(400, 'VALIDATION_ERROR', 'Choose a valid date.', { date: 'Date is required and must be a real date.' });
      }
      const rows = await adminRepo.overviewForDate(date);
      const totals = { bdeCount: rows.length, reportsSubmitted: 0, totalCalls: 0, interested: 0, notInterested: 0, followUpRequired: 0, noResponse: 0 };
      const bdes = rows.map((r) => {
        const submitted = r.report_id !== null && r.report_id !== undefined;
        if (submitted) {
          totals.reportsSubmitted += 1;
          totals.totalCalls += r.total_calls;
          totals.interested += r.interested;
          totals.notInterested += r.not_interested;
          totals.followUpRequired += r.follow_up_required;
          totals.noResponse += r.no_response;
        }
        return {
          ...toBde(r),
          submitted,
          totalCalls: submitted ? r.total_calls : null,
          interested: submitted ? r.interested : null,
          notInterested: submitted ? r.not_interested : null,
          followUpRequired: submitted ? r.follow_up_required : null,
          noResponse: submitted ? r.no_response : null
        };
      });
      return { date, totals, bdes };
    },

    async bdeDetail(idText, limit) {
      if (typeof idText !== 'string' || !/^\d{1,18}$/.test(idText)) {
        throw new HttpError(400, 'VALIDATION_ERROR', 'Invalid BDE id.');
      }
      const bde = await adminRepo.findBde(idText);
      if (!bde) throw new HttpError(404, 'NOT_FOUND', 'BDE not found.');
      const reports = await reportRepo.listByUser(bde.id, limit);
      return { bde: toBde(bde), reports };
    }
  };
}
