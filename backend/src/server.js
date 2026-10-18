import { loadConfig } from './config/env.js';
import { createDb } from './db/pool.js';
import { createApp } from './app.js';
import { createAuthRepository } from './modules/auth/auth.repository.js';
import { createAuthService } from './modules/auth/auth.service.js';
import { createDailyReportRepository } from './modules/daily-reports/daily-reports.repository.js';
import { createDailyReportService } from './modules/daily-reports/daily-reports.service.js';
import { createAdminRepository } from './modules/admin/admin.repository.js';
import { createAdminService } from './modules/admin/admin.service.js';
import { createLeadRepository } from './modules/leads/leads.repository.js';
import { createLeadService } from './modules/leads/leads.service.js';
import { createInterviewRepository } from './modules/interviews/interviews.repository.js';
import { createInterviewService } from './modules/interviews/interviews.service.js';
import { createPaymentRepository } from './modules/payments/payments.repository.js';
import { createPaymentService } from './modules/payments/payments.service.js';
import { createReceiptStorage } from './lib/receipt-storage.js';
import { createUserRepository } from './modules/users/users.repository.js';
import { createUserService } from './modules/users/users.service.js';
import { createImportRepository } from './modules/imports/imports.repository.js';
import { createImportService } from './modules/imports/imports.service.js';
import { createEmployeeRepository } from './modules/employees/employees.repository.js';
import { createEmployeeService } from './modules/employees/employees.service.js';
import { createAssignmentRepository } from './modules/assignments/assignments.repository.js';
import { createAssignmentService } from './modules/assignments/assignments.service.js';
import { createActivityRepository } from './modules/activity/activity.repository.js';
import { createActivityService } from './modules/activity/activity.service.js';
import { createLeadSheetRepository } from './modules/lead-sheets/lead-sheets.repository.js';
import { createLeadSheetService } from './modules/lead-sheets/lead-sheets.service.js';
import { createCallLogRepository } from './modules/call-logs/call-logs.repository.js';
import { createCallLogService } from './modules/call-logs/call-logs.service.js';
import { createChatRepository } from './modules/chat/chat.repository.js';
import { createChatService } from './modules/chat/chat.service.js';
import { createMonthlyReportRepository } from './modules/monthly-reports/monthly-reports.repository.js';
import { createMonthlyReportService } from './modules/monthly-reports/monthly-reports.service.js';

let config;
try {
  config = loadConfig();
} catch (err) {
  console.error('Configuration error:', err.message);
  process.exit(1);
}

const db = createDb(config.db);
try {
  await db.query('SELECT 1');
} catch (err) {
  console.error('Cannot connect to MySQL (check DB_* values in .env and that MySQL is running):', err.code || err.message);
  process.exit(1);
}

const authService = createAuthService({ repo: createAuthRepository(db), ttlHours: config.sessionTtlHours });
const reportRepo = createDailyReportRepository(db);
const reportService = createDailyReportService({ repo: reportRepo });
const adminRepo = createAdminRepository(db);
const adminService = createAdminService({ adminRepo, reportRepo });
const leadService = createLeadService({ repo: createLeadRepository(db) });
const interviewService = createInterviewService({ repo: createInterviewRepository(db) });

// Receipt files live on disk, outside any web-served folder. Fail early (not at the first upload) if the folder is unusable.
const storage = createReceiptStorage({ dir: config.receiptStorageDir });
try {
  await storage.init();
} catch (err) {
  console.error('Cannot create or open the receipt folder (check RECEIPT_STORAGE_DIR and its permissions):', err.code || err.message);
  process.exit(1);
}
if (config.nodeEnv === 'production' && config.receiptDirIsDefault) {
  console.warn('WARNING: RECEIPT_STORAGE_DIR is not set; receipts are stored inside the application folder. Set it to an absolute path outside the application folder (see docs/payments-and-uploads.md).');
}
const paymentService = createPaymentService({ repo: createPaymentRepository(db), storage, maxBytes: config.receiptMaxBytes });
const userService = createUserService({ repo: createUserRepository(db) });
const importService = createImportService({ repo: createImportRepository(db) });
const employeeService = createEmployeeService({ repo: createEmployeeRepository(db) });
const monthlyReportService = createMonthlyReportService({ repo: createMonthlyReportRepository(db) });
const callLogService = createCallLogService({ repo: createCallLogRepository(db), adminRepo, offsetMinutes: config.reportUtcOffsetMinutes });
const chatService = createChatService({ repo: createChatRepository(db) });
const assignmentService = createAssignmentService({ repo: createAssignmentRepository(db) });
const activityService = createActivityService({ repo: createActivityRepository(db) });
const leadSheetService = createLeadSheetService({ repo: createLeadSheetRepository(db) });
const app = createApp({ config, authService, reportService, adminService, leadService, paymentService, interviewService, userService, importService, monthlyReportService, employeeService, callLogService, chatService, assignmentService, activityService, leadSheetService, checkDb: () => db.query('SELECT 1') });

const server = app.listen(config.port, () => console.log(`API listening on port ${config.port}`));

function shutdown(signal) {
  console.log(`${signal} received, shutting down`);
  server.close(async () => {
    await db.close();
    process.exit(0);
  });
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
