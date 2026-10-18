import { HttpError } from '../../lib/http-error.js';
import { validateDailyReport } from '../../lib/validate-daily-report.js';

export function createDailyReportService({ repo }) {
  return {
    // userId always comes from the login session, never from the request body.
    async submit(userId, body) {
      const result = validateDailyReport(body);
      if (!result.ok) {
        throw new HttpError(400, 'VALIDATION_ERROR', 'Please fix the highlighted fields.', result.errors);
      }
      try {
        await repo.insert(userId, result.value);
      } catch (err) {
        if (err && err.code === 'ER_DUP_ENTRY') {
          throw new HttpError(409, 'DUPLICATE_REPORT', 'A report for this date already exists.', {
            reportDate: 'A report for this date already exists.'
          });
        }
        throw err;
      }
      return repo.findByUserAndDate(userId, result.value.reportDate);
    },

    async listOwn(userId, limit) {
      return repo.listByUser(userId, limit);
    }
  };
}
