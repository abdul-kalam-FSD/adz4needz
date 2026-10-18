// Pure rules for the login screen. The server checks everything again; these only give fast, specific feedback before a request is sent.
export const MAX_LOGIN_ID_LENGTH = 64;   // same limit as the server (auth.service.js)
export const MAX_PASSWORD_LENGTH = 200;  // same limit as the server (password.js)

// Returns { ok, errors: { employeeId?, password? }, value: { employeeId } } (employeeId trimmed; the password is never changed or trimmed).
// Sign-in is by EMPLOYEE ID only: an email address is explained, not sent (emails are optional and not unique in this system).
export function validateLogin({ employeeId, password }) {
  const errors = {};
  const id = typeof employeeId === 'string' ? employeeId.trim() : '';
  if (id === '') errors.employeeId = 'Enter your employee ID.';
  else if (id.includes('@')) errors.employeeId = 'Sign in with your employee ID, not your email address.';
  else if (id.length > MAX_LOGIN_ID_LENGTH) errors.employeeId = `Employee ID is too long (${MAX_LOGIN_ID_LENGTH} characters at most).`;
  else if (/[\s\u0000-\u001F\u007F]/.test(id)) errors.employeeId = 'An employee ID has no spaces.';
  if (typeof password !== 'string' || password === '') errors.password = 'Enter your password.';
  else if (password.length > MAX_PASSWORD_LENGTH) errors.password = `Password is too long (${MAX_PASSWORD_LENGTH} characters at most).`;
  return { ok: Object.keys(errors).length === 0, errors, value: { employeeId: id } };
}

// Turns a failed login request into one plain sentence and a kind the screen can react to. Never echoes the server's internals.
// portal is optional ('admin' on the Admin Sign In tab): the server answers a BDE's correct password on that tab with the same 401 as a wrong
// password, so the wording covers both without saying which one it was.
export function loginFailure(err, portal) {
  const status = err && typeof err.status === 'number' ? err.status : -1;
  if (status === 0) return { kind: 'network', message: 'Could not reach the server. Check your connection and try again.' };
  if (status === 401 && portal === 'admin') return { kind: 'credentials', message: 'Employee ID or password is incorrect, or this is not an administrator account. Check them and try again.' };
  if (status === 401) return { kind: 'credentials', message: 'Employee ID or password is incorrect. Check them and try again.' };
  if (status === 429) return { kind: 'rate', message: 'Too many sign-in attempts. Please wait a few minutes and try again.' };
  if (status === 400) return { kind: 'validation', message: (err.message && String(err.message)) || 'Enter your employee ID and password.' };
  if (status >= 500) return { kind: 'server', message: 'The server had a problem. Please try again in a moment.' };
  return { kind: 'unknown', message: 'Could not sign you in. Please try again.' };
}

// Where to go after signing in. Only a path inside this app is accepted (never a full URL, never the login page itself).
export function safeDestination(from) {
  if (typeof from !== 'string' || from === '') return '/';
  if (!from.startsWith('/') || from.startsWith('//') || from.startsWith('/login') || /[\\\r\n\u0000]/.test(from)) return '/';
  return from;
}

// Notices shown above the form after the app sent the person back to the login screen.
export const LOGIN_NOTICES = {
  signed_out: { tone: 'success', text: 'You have been signed out.' },
  expired: { tone: 'info', text: 'Your session has ended, so please sign in again. Anything you had not saved may need to be entered again.' }
};

// ---- Sign-in modes (Employee Sign In / Admin Sign In / Create BDE Account) -------------------------------------------------------------
// The mode lives in the address (?as=admin, ?as=admin&task=create-bde) so a reload or a shared link keeps it. Nothing in the address grants
// anything: the server decides who may sign in, and only an administrator can reach the account form or the API behind it.
export const CREATE_BDE_PATH = '/admin/employees';

export function parseLoginView(search) {
  const p = new URLSearchParams(typeof search === 'string' ? search : '');
  const admin = p.get('as') === 'admin';
  return { portal: admin ? 'admin' : 'employee', createBde: admin && p.get('task') === 'create-bde' };
}

// The query string (with the leading ?, or '' for the default Employee Sign In) for a mode.
export function loginViewSearch({ portal, createBde } = {}) {
  if (portal !== 'admin') return '';
  return createBde ? '?as=admin&task=create-bde' : '?as=admin';
}

// Where to go after a successful sign-in. The create-account path is a fixed in-app path; everything else keeps the existing safe rules.
export function loginDestination({ createBde, notice, from }) {
  if (createBde) return CREATE_BDE_PATH;
  return safeDestination(notice === 'signed_out' ? null : from);
}
