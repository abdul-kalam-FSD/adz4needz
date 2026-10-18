import express from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { asyncHandler } from './lib/http-error.js';
import { createAuthenticate, authorize } from './middleware/authenticate.js';
import { errorHandler, notFound, requireJsonBody } from './middleware/error-handler.js';
import { createAuthHandlers } from './modules/auth/auth.handlers.js';
import { createDailyReportHandlers } from './modules/daily-reports/daily-reports.handlers.js';
import { createAdminHandlers } from './modules/admin/admin.handlers.js';
import { createLeadHandlers } from './modules/leads/leads.handlers.js';
import { createInterviewHandlers } from './modules/interviews/interviews.handlers.js';
import { createPaymentHandlers } from './modules/payments/payments.handlers.js';
import { ALLOWED_RECEIPT_MIME } from './lib/receipt-file.js';
import { createUserHandlers } from './modules/users/users.handlers.js';
import { createImportHandlers } from './modules/imports/imports.handlers.js';
import { createEmployeeHandlers } from './modules/employees/employees.handlers.js';
import { createCallLogHandlers } from './modules/call-logs/call-logs.handlers.js';
import { createChatHandlers } from './modules/chat/chat.handlers.js';
import { createAssignmentHandlers } from './modules/assignments/assignments.handlers.js';
import { createActivityHandlers } from './modules/activity/activity.handlers.js';
import { createLeadSheetHandlers } from './modules/lead-sheets/lead-sheets.handlers.js';
import { createMonthlyReportHandlers } from './modules/monthly-reports/monthly-reports.handlers.js';
import { ALLOWED_IMPORT_MIME } from './lib/import-file-reader.js';

export function createApp({ config, authService, reportService, adminService, leadService, paymentService, interviewService, userService, importService, monthlyReportService, employeeService, callLogService, chatService, assignmentService, activityService, leadSheetService, checkDb }) {
  const app = express();
  app.disable('x-powered-by');
  if (config.trustProxy) app.set('trust proxy', 1);
  app.use(helmet());
  app.use(express.json({ limit: '10kb' }));

  const authenticate = createAuthenticate({ authService, cookieName: config.cookieName });
  const auth = createAuthHandlers({ authService, config });
  const reports = createDailyReportHandlers({ reportService });
  const admin = createAdminHandlers({ adminService });
  const leads = createLeadHandlers({ leadService });
  const interviews = createInterviewHandlers({ interviewService });
  const payments = createPaymentHandlers({ paymentService });
  const users = createUserHandlers({ userService, config });
  const imports = createImportHandlers({ importService });
  const monthly = createMonthlyReportHandlers({ monthlyReportService });
  const employees = createEmployeeHandlers({ employeeService });
  const callLogs = createCallLogHandlers({ callLogService });
  const chat = createChatHandlers({ chatService });
  const assignments = createAssignmentHandlers({ assignmentService });
  const activity = createActivityHandlers({ activityService });
  const leadSheets = createLeadSheetHandlers({ leadSheetService });

  const api = express.Router();
  // Receipt upload (the ONLY non-JSON write route). The body is the raw file; express.raw parses it only for the three
  // allowed content types, up to the configured size (larger -> 413). These types are not "simple" cross-site content
  // types, so a browser sends a CORS pre-flight first and this API answers none: the same CSRF protection as the JSON guard
  // below (plus SameSite=Lax cookies). Registered before the JSON guard on purpose; every other write still needs JSON.
  const receiptBody = express.raw({ type: ALLOWED_RECEIPT_MIME, limit: config.receiptMaxBytes });
  api.post('/payment-instalments/:id/receipts', authenticate, authorize('bde'), receiptBody, asyncHandler(payments.uploadReceipt));

  // Lead import upload (admin only; the second non-JSON write route). Same CSRF reasoning as the receipt upload above: these content
  // types need a CORS pre-flight, which this API never answers. text/plain and form types are NOT accepted. The file CONTENT is
  // sniffed again in import-file-reader.js, the declared type is not trusted.
  const importBody = express.raw({ type: ALLOWED_IMPORT_MIME, limit: config.importMaxBytes });
  api.post('/admin/imports', authenticate, authorize('admin'), importBody, asyncHandler(imports.upload));

  // Lead sheet upload (admin only; the third non-JSON write route). Same CSRF reasoning as the import upload above. Preview writes nothing; apply writes.
  api.post('/admin/lead-sheet/preview', authenticate, authorize('admin'), importBody, asyncHandler(leadSheets.preview));
  api.post('/admin/lead-sheet/apply', authenticate, authorize('admin'), importBody, asyncHandler(leadSheets.apply));

  api.use(requireJsonBody);

  api.get('/health', (req, res) => res.json({ status: 'ok' }));
  api.get('/health/db', asyncHandler(async (req, res) => {
    await checkDb();
    res.json({ status: 'ok', database: 'connected' });
  }));

  const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: config.loginRateLimitMax,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: { code: 'TOO_MANY_ATTEMPTS', message: 'Too many login attempts. Try again later.' } }
  });
  api.post('/auth/login', loginLimiter, asyncHandler(auth.login));
  api.post('/auth/logout', asyncHandler(auth.logout));
  api.get('/auth/me', authenticate, asyncHandler(auth.me));

  // Profile: any logged-in user, their own record only (the id comes from the session, never from the URL or body).
  // Changing a password needs the current password, so a stolen session must not allow unlimited guessing: limit per user.
  const passwordChangeLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: config.loginRateLimitMax,
    keyGenerator: (req) => 'user:' + req.user.id,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: { code: 'TOO_MANY_ATTEMPTS', message: 'Too many password change attempts. Try again later.' } }
  });
  api.get('/profile', authenticate, asyncHandler(users.profile));
  api.patch('/profile', authenticate, asyncHandler(users.updateProfile));
  api.post('/profile/password', authenticate, passwordChangeLimiter, asyncHandler(users.changePassword));

  // BDE-only for now. Admin views of BDE reports come in a later phase.
  api.post('/daily-reports', authenticate, authorize('bde'), asyncHandler(reports.create));
  api.get('/daily-reports', authenticate, authorize('bde'), asyncHandler(reports.list));

  // Monthly report: a BDE sees only their own figures and targets; the team view and target setting are admin-only (see /admin/reports below).
  api.get('/reports/monthly', authenticate, authorize('bde'), asyncHandler(monthly.own));

  // Leads: a BDE manages only their own leads (ownership is enforced again inside the service and the SQL).
  api.get('/lead-statuses', authenticate, asyncHandler(leads.statuses));
  api.get('/leads/summary', authenticate, authorize('bde'), asyncHandler(leads.summary));
  api.get('/leads', authenticate, authorize('bde'), asyncHandler(leads.list));
  api.post('/leads', authenticate, authorize('bde'), asyncHandler(leads.create));
  api.get('/leads/:id', authenticate, authorize('bde'), asyncHandler(leads.get));
  api.put('/leads/:id', authenticate, authorize('bde'), asyncHandler(leads.update));
  api.patch('/leads/:id/status', authenticate, authorize('bde'), asyncHandler(leads.setStatus));

  // Call desk: a BDE records one call outcome per click (own leads only; ownership is enforced in the service and by a composite foreign key).
  // A repeated request id is answered with the original call (nothing is counted twice). Undo is same-day and own-calls only.
  api.get('/call-logs/summary', authenticate, authorize('bde'), asyncHandler(callLogs.summary));
  api.post('/call-logs', authenticate, authorize('bde'), asyncHandler(callLogs.record));
  api.post('/call-logs/:id/undo', authenticate, authorize('bde'), asyncHandler(callLogs.undo));

  // Team chat: ONE shared conversation for every logged-in user (admin or BDE). Polling, no WebSockets. The sender is always the session user;
  // announcements are admin-only (checked in the service); mentions are found by the server. Sending is rate-limited per user.
  const chatSendLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: config.chatSendRateLimitMax,
    keyGenerator: (req) => 'user:' + req.user.id,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: { code: 'TOO_MANY_MESSAGES', message: 'You are sending messages too quickly. Please wait a moment.' } }
  });
  api.get('/chat/members', authenticate, authorize('admin', 'bde'), asyncHandler(chat.members));
  api.get('/chat/messages', authenticate, authorize('admin', 'bde'), asyncHandler(chat.list));
  api.get('/chat/unread', authenticate, authorize('admin', 'bde'), asyncHandler(chat.unread));
  api.post('/chat/messages', authenticate, authorize('admin', 'bde'), chatSendLimiter, asyncHandler(chat.send));
  api.post('/chat/read', authenticate, authorize('admin', 'bde'), asyncHandler(chat.read));

  // Interviews: a BDE creates/edits interviews only for their own leads (ownership is enforced in the service and the SQL).
  api.get('/interviews/summary', authenticate, authorize('bde'), asyncHandler(interviews.summary));
  api.get('/interviews', authenticate, authorize('bde'), asyncHandler(interviews.list));
  api.post('/interviews', authenticate, authorize('bde'), asyncHandler(interviews.create));
  api.get('/interviews/:id', authenticate, authorize('bde'), asyncHandler(interviews.get));
  api.put('/interviews/:id', authenticate, authorize('bde'), asyncHandler(interviews.update));

  // Payments: a BDE manages payments only for their own leads (ownership is enforced in the service and the SQL).
  api.get('/payments/summary', authenticate, authorize('bde'), asyncHandler(payments.summary));
  api.get('/payments', authenticate, authorize('bde'), asyncHandler(payments.list));
  api.post('/payments', authenticate, authorize('bde'), asyncHandler(payments.create));
  api.get('/payments/:id', authenticate, authorize('bde'), asyncHandler(payments.get));
  api.put('/payments/:id', authenticate, authorize('bde'), asyncHandler(payments.update));
  api.post('/payments/:id/instalments', authenticate, authorize('bde'), asyncHandler(payments.addInstalment));
  api.put('/payment-instalments/:id', authenticate, authorize('bde'), asyncHandler(payments.updateInstalment));
  api.get('/payment-receipts/:id/file', authenticate, authorize('bde'), asyncHandler(payments.receiptFile));

  // Admin screens: read-only. Every route below requires a logged-in ADMIN.
  const adminRouter = express.Router();
  adminRouter.get('/bdes', asyncHandler(admin.listBdes));
  adminRouter.get('/daily-overview', asyncHandler(admin.dailyOverview));
  adminRouter.get('/bdes/:id', asyncHandler(admin.bdeDetail));
  adminRouter.get('/leads/summary', asyncHandler(leads.summary));
  adminRouter.get('/leads', asyncHandler(leads.list));
  adminRouter.get('/leads/:id', asyncHandler(leads.get));
  adminRouter.get('/interviews/overview', asyncHandler(interviews.overview));
  adminRouter.get('/interviews/summary', asyncHandler(interviews.summary));
  adminRouter.get('/interviews', asyncHandler(interviews.list));
  adminRouter.get('/interviews/:id', asyncHandler(interviews.get));
  adminRouter.get('/payments/overview', asyncHandler(payments.overview));
  adminRouter.get('/payments', asyncHandler(payments.list));
  adminRouter.get('/payments/:id', asyncHandler(payments.get));
  adminRouter.get('/payment-receipts/:id/file', asyncHandler(payments.receiptFile));
  // Admin import workflow. A SEPARATE router on purpose: the read-only adminRouter above keeps its "no write routes" guarantee.
  const importRouter = express.Router();
  importRouter.get('/options', asyncHandler(imports.options));
  importRouter.get('/', asyncHandler(imports.list));
  importRouter.get('/:id', asyncHandler(imports.get));
  importRouter.get('/:id/rows', asyncHandler(imports.rows));
  importRouter.get('/:id/invalid-rows.csv', asyncHandler(imports.invalidCsv));
  importRouter.patch('/:id', asyncHandler(imports.update));
  importRouter.post('/:id/commit', asyncHandler(imports.commit));
  importRouter.post('/:id/cancel', asyncHandler(imports.cancel));
  // Monthly team report + targets. Separate router for the same reason as imports: adminRouter stays read-only.
  const reportsAdminRouter = express.Router();
  reportsAdminRouter.get('/monthly', asyncHandler(monthly.team));
  reportsAdminRouter.get('/range', asyncHandler(monthly.range));
  reportsAdminRouter.get('/monthly.xlsx', asyncHandler(monthly.exportAs('xlsx')));
  reportsAdminRouter.get('/monthly.pdf', asyncHandler(monthly.exportAs('pdf')));
  reportsAdminRouter.put('/targets', asyncHandler(monthly.setTargets));
  // Admin approves/rejects payment proofs. Separate admin-write router (adminRouter stays read-only).
  const receiptReviewRouter = express.Router();
  receiptReviewRouter.put('/:id', asyncHandler(payments.reviewReceipt));
  // Admin per-BDE call statistics for one day. Read-only; a separate router so adminRouter's pinned route list stays unchanged.
  const callStatsRouter = express.Router();
  callStatsRouter.get('/', asyncHandler(callLogs.adminStats));
  api.use('/admin/call-stats', authenticate, authorize('admin'), callStatsRouter);
  // Assign leads (admin). Overview is read-only; the one write moves only leads that have no call, interview or payment, in one transaction.
  const assignmentsRouter = express.Router();
  assignmentsRouter.get('/', asyncHandler(assignments.overview));
  assignmentsRouter.post('/', asyncHandler(assignments.assign));
  api.use('/admin/assignments', authenticate, authorize('admin'), assignmentsRouter);
  // Activity feed (admin, read-only, derived from existing records).
  const activityRouter = express.Router();
  activityRouter.get('/', asyncHandler(activity.feed));
  api.use('/admin/activity', authenticate, authorize('admin'), activityRouter);
  // Lead sheet download (admin, read-only). The two upload routes are registered above, before the JSON guard.
  const leadSheetRouter = express.Router();
  leadSheetRouter.get('/download.xlsx', asyncHandler(leadSheets.download));
  api.use('/admin/lead-sheet', authenticate, authorize('admin'), leadSheetRouter);
  api.use('/admin/receipt-reviews', authenticate, authorize('admin'), receiptReviewRouter);
  // Admin creates BDE accounts (BDE role only; admin accounts stay CLI-only). Separate router, adminRouter stays read-only.
  const employeesRouter = express.Router();
  employeesRouter.post('/', asyncHandler(employees.create));
  employeesRouter.get('/', asyncHandler(employees.list));
  employeesRouter.put('/:id/active', asyncHandler(employees.setActive));
  employeesRouter.post('/:id/reset-password', asyncHandler(employees.resetPassword));
  api.use('/admin/employees', authenticate, authorize('admin'), employeesRouter);
  api.use('/admin/reports', authenticate, authorize('admin'), reportsAdminRouter);
  api.use('/admin/imports', authenticate, authorize('admin'), importRouter);
  api.use('/admin', authenticate, authorize('admin'), adminRouter);

  app.use('/api', api);
  app.use(notFound);
  app.use(errorHandler);
  return app;
}
