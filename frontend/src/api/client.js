import { statusUpdatePayload } from '../lib/lead-status.js';
// Thin wrapper around fetch. The login session lives in an HttpOnly cookie that the browser
// sends automatically, so no token is ever stored or handled in JavaScript.
export class ApiError extends Error {
  constructor(status, code, message, fields, details) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.fields = fields || {};
    this.details = details || null;
  }
}

// Expired or revoked session. The server answers 401 with code UNAUTHENTICATED on any protected call; the AuthProvider registers a handler
// that clears the user so the app returns to the login screen with an explanation. Login attempts (INVALID_CREDENTIALS) and the startup
// check (/auth/me) are deliberately NOT treated as an expiry. Plain download links are browser navigations and cannot be intercepted here.
let unauthorizedHandler = null;
export function setUnauthorizedHandler(fn) { unauthorizedHandler = typeof fn === 'function' ? fn : null; }
function sessionExpiryCheck(status, code, path) {
  if (status === 401 && code === 'UNAUTHENTICATED' && unauthorizedHandler && !String(path).startsWith('/auth/')) unauthorizedHandler();
}

async function request(method, path, body) {
  let res;
  try {
    res = await fetch('/api' + path, {
      method,
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: method === 'GET' ? undefined : JSON.stringify(body ?? {})
    });
  } catch {
    throw new ApiError(0, 'NETWORK', 'Could not reach the server. Check your connection and try again.');
  }
  let data = null;
  if (res.status !== 204) {
    try { data = await res.json(); } catch { /* not JSON */ }
  }
  if (!res.ok) {
    const e = data && data.error;
    sessionExpiryCheck(res.status, e && e.code, path);
    throw new ApiError(res.status, (e && e.code) || 'ERROR', (e && e.message) || 'Something went wrong. Please try again.', e && e.fields, e && e.details);
  }
  return data;
}

export const api = {
  // portal is optional: 'admin' for the Admin Sign In tab (the server then only lets an administrator account in). Without it the request is
  // byte-for-byte the one the Employee Sign In has always sent.
  login: (employeeId, password, portal) => request('POST', '/auth/login', portal ? { employeeId, password, portal } : { employeeId, password }),
  logout: () => request('POST', '/auth/logout'),
  me: () => request('GET', '/auth/me'),
  createDailyReport: (payload) => request('POST', '/daily-reports', payload),
  listDailyReports: () => request('GET', '/daily-reports'),
  // Call desk (BDE: one call per click, own leads only). Admin: per-BDE statistics for one day (read-only)
  recordCall: (payload) => request('POST', '/call-logs', payload),
  undoCall: (id) => request('POST', '/call-logs/' + encodeURIComponent(id) + '/undo'),
  callSummary: (date) => request('GET', '/call-logs/summary' + (date ? '?date=' + encodeURIComponent(date) : '')),
  adminCallStats: (date) => request('GET', '/admin/call-stats?date=' + encodeURIComponent(date)),
  // Team chat: one shared conversation for every logged-in user. Polling, no WebSockets.
  chatMembers: () => request('GET', '/chat/members'),
  chatMessages: (query) => request('GET', '/chat/messages' + (query ? '?' + query : '')),
  chatUnread: () => request('GET', '/chat/unread'),
  chatSend: (payload) => request('POST', '/chat/messages', payload),
  chatRead: (upTo) => request('POST', '/chat/read', { upTo }),
  // Admin (read-only)
  adminDailyOverview: (date) => request('GET', '/admin/daily-overview?date=' + encodeURIComponent(date)),
  adminListBdes: () => request('GET', '/admin/bdes'),
  adminBdeDetail: (id) => request('GET', '/admin/bdes/' + encodeURIComponent(id)),
  // Leads (BDE: own leads only) and the read-only admin view
  leadStatuses: () => request('GET', '/lead-statuses'),
  listLeads: (qs) => request('GET', '/leads?' + qs),
  leadSummary: (today) => request('GET', '/leads/summary?today=' + encodeURIComponent(today)),
  getLead: (id) => request('GET', '/leads/' + encodeURIComponent(id)),
  createLead: (payload) => request('POST', '/leads', payload),
  updateLead: (id, payload) => request('PUT', '/leads/' + encodeURIComponent(id), payload),
  // One-click status change: ONE request to the status-only endpoint (the server changes only the status, so nothing else can be blanked
  // or overwritten by a stale copy of the lead).
  setLeadStatus: (id, leadStatusId) => request('PATCH', '/leads/' + encodeURIComponent(id) + '/status', { leadStatusId: Number(leadStatusId) }),
  adminListLeads: (qs) => request('GET', '/admin/leads?' + qs),
  adminLeadSummary: (today) => request('GET', '/admin/leads/summary?today=' + encodeURIComponent(today)),
  // Interviews (BDE: own leads' interviews only) and the read-only admin view
  listInterviews: (qs) => request('GET', '/interviews?' + qs),
  interviewSummary: (today) => request('GET', '/interviews/summary?today=' + encodeURIComponent(today)),
  getInterview: (id) => request('GET', '/interviews/' + encodeURIComponent(id)),
  createInterview: (payload) => request('POST', '/interviews', payload),
  updateInterview: (id, payload) => request('PUT', '/interviews/' + encodeURIComponent(id), payload),
  adminListInterviews: (qs) => request('GET', '/admin/interviews?' + qs),
  adminInterviewSummary: (today) => request('GET', '/admin/interviews/summary?today=' + encodeURIComponent(today)),
  adminInterviewOverview: (qs) => request('GET', '/admin/interviews/overview?' + qs),
  // Payments (BDE: own leads only) and the read-only admin view
  listPayments: (qs) => request('GET', '/payments?' + qs),
  paymentSummary: (qs) => request('GET', '/payments/summary?' + qs),
  getPayment: (id) => request('GET', '/payments/' + encodeURIComponent(id)),
  createPayment: (payload) => request('POST', '/payments', payload),
  updatePayment: (id, payload) => request('PUT', '/payments/' + encodeURIComponent(id), payload),
  addInstalment: (paymentId, payload) => request('POST', '/payments/' + encodeURIComponent(paymentId) + '/instalments', payload),
  updateInstalment: (id, payload) => request('PUT', '/payment-instalments/' + encodeURIComponent(id), payload),
  adminListPayments: (qs) => request('GET', '/admin/payments?' + qs),
  adminGetPayment: (id) => request('GET', '/admin/payments/' + encodeURIComponent(id)),
  adminPaymentOverview: (qs) => request('GET', '/admin/payments/overview?' + qs),
  // Admin lead import (Excel/CSV): upload -> preview -> re-map -> confirm
  adminImportOptions: () => request('GET', '/admin/imports/options'),
  adminListImports: () => request('GET', '/admin/imports'),
  adminGetImport: (id) => request('GET', '/admin/imports/' + encodeURIComponent(id)),
  adminImportRows: (id, qs) => request('GET', '/admin/imports/' + encodeURIComponent(id) + '/rows?' + qs),
  adminUpdateImport: (id, payload) => request('PATCH', '/admin/imports/' + encodeURIComponent(id), payload),
  adminCommitImport: (id) => request('POST', '/admin/imports/' + encodeURIComponent(id) + '/commit', { confirm: true }),
  adminCancelImport: (id) => request('POST', '/admin/imports/' + encodeURIComponent(id) + '/cancel'),
  adminCreateEmployee: (payload) => request('POST', '/admin/employees', payload),
  adminReviewReceipt: (id, payload) => request('PUT', '/admin/receipt-reviews/' + encodeURIComponent(id), payload),
  // Monthly report + targets (admin: whole team and target setting; BDE: own figures only)
  adminRangeReport: (from, to) => request('GET', '/admin/reports/range?from=' + encodeURIComponent(from) + '&to=' + encodeURIComponent(to)),
  adminListEmployees: () => request('GET', '/admin/employees'),
  adminSetEmployeeActive: (id, isActive) => request('PUT', '/admin/employees/' + encodeURIComponent(id) + '/active', { isActive }),
  adminResetPassword: (id) => request('POST', '/admin/employees/' + encodeURIComponent(id) + '/reset-password', {}),
  adminAssignOverview: (date) => request('GET', '/admin/assignments?date=' + encodeURIComponent(date)),
  adminAssignLeads: (payload) => request('POST', '/admin/assignments', payload),
  adminActivity: (qs) => request('GET', '/admin/activity?' + qs),
  adminMonthlyReport: (month) => request('GET', '/admin/reports/monthly?month=' + encodeURIComponent(month)),
  adminSetTargets: (payload) => request('PUT', '/admin/reports/targets', payload),
  monthlyReport: (month) => request('GET', '/reports/monthly?month=' + encodeURIComponent(month)),
  // Profile (any logged-in user, own record only)
  getProfile: () => request('GET', '/profile'),
  updateProfile: (payload) => request('PATCH', '/profile', payload),
  changePassword: (payload) => request('POST', '/profile/password', payload)
};

// Proof files are opened through these authenticated URLs (the browser sends the session cookie). They are never public.
export const receiptUrl = (id, admin) => (admin ? '/api/admin' : '/api') + '/payment-receipts/' + encodeURIComponent(id) + '/file';

// Receipt upload: the request body is the file itself (not JSON). The type header is one of image/jpeg, image/png or
// application/pdf; the server checks the real file content, not this header.
export async function uploadReceipt(instalmentId, file, { confirmDuplicate = false } = {}) {
  let res;
  try {
    res = await fetch(`/api/payment-instalments/${encodeURIComponent(instalmentId)}/receipts?name=${encodeURIComponent(file.name)}${confirmDuplicate ? '&confirmDuplicate=1' : ''}`, {
      method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': file.type }, body: file
    });
  } catch {
    throw new ApiError(0, 'NETWORK', 'Could not reach the server. Check your connection and try again.');
  }
  let data = null;
  try { data = await res.json(); } catch { /* not JSON */ }
  if (!res.ok) {
    const e = data && data.error;
    sessionExpiryCheck(res.status, e && e.code, '/upload');
    throw new ApiError(res.status, (e && e.code) || 'ERROR', (e && e.message) || 'Upload failed. Please try again.', e && e.fields, e && e.details);
  }
  return data;
}

// Authenticated download of the rows that failed validation (opened in the same tab; the session cookie is sent).
export const importInvalidCsvUrl = (id) => '/api/admin/imports/' + encodeURIComponent(id) + '/invalid-rows.csv';

// Lead import upload: the body is the file itself (.xlsx or .csv), not JSON. The server checks the real file content.
export async function uploadImportFile(file, { defaultBdeId, defaultCourse } = {}) {
  const qs = new URLSearchParams({ name: file.name });
  if (defaultBdeId) qs.set('defaultBdeId', String(defaultBdeId));
  if (defaultCourse) qs.set('defaultCourse', defaultCourse);
  const type = file.type || (/\.csv$/i.test(file.name) ? 'text/csv' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  let res;
  try {
    res = await fetch('/api/admin/imports?' + qs.toString(), { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': type }, body: file });
  } catch {
    throw new ApiError(0, 'NETWORK', 'Could not reach the server. Check your connection and try again.');
  }
  let data = null;
  try { data = await res.json(); } catch { /* not JSON */ }
  if (!res.ok) {
    const e = data && data.error;
    sessionExpiryCheck(res.status, e && e.code, '/upload');
    throw new ApiError(res.status, (e && e.code) || 'ERROR', (e && e.message) || 'Upload failed. Please try again.', e && e.fields, e && e.details);
  }
  return data;
}

// Monthly report downloads (admin). Plain authenticated GET links: the browser sends the session cookie and saves the file.
export const monthlyExportUrl = (month, format) => '/api/admin/reports/monthly.' + (format === 'pdf' ? 'pdf' : 'xlsx') + '?month=' + encodeURIComponent(month);

// Lead sheet (admin). Upload sends the file itself as the body, like the lead import; mode is 'preview' (writes nothing) or 'apply'.
export async function uploadLeadSheet(file, mode) {
  if (mode !== 'preview' && mode !== 'apply') throw new Error('mode must be preview or apply');
  const type = file.type || (/\.csv$/i.test(file.name) ? 'text/csv' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  let res;
  try {
    res = await fetch('/api/admin/lead-sheet/' + mode, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': type }, body: file });
  } catch {
    throw new ApiError(0, 'NETWORK', 'Could not reach the server. Check your connection and try again.');
  }
  let data = null;
  try { data = await res.json(); } catch { /* not JSON */ }
  if (!res.ok) {
    const e = data && data.error;
    sessionExpiryCheck(res.status, e && e.code, '/upload');
    throw new ApiError(res.status, (e && e.code) || 'ERROR', (e && e.message) || 'Upload failed. Please try again.', e && e.fields, e && e.details);
  }
  return data;
}
export const leadSheetDownloadUrl = (bdeId) => '/api/admin/lead-sheet/download.xlsx' + (bdeId ? '?bdeId=' + encodeURIComponent(bdeId) : '');
// Range report downloads (same endpoints as the monthly files; from/to instead of month).
export const rangeExportUrl = (from, to, format) => '/api/admin/reports/monthly.' + (format === 'pdf' ? 'pdf' : 'xlsx') + '?from=' + encodeURIComponent(from) + '&to=' + encodeURIComponent(to);
