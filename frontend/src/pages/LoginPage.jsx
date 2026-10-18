import { useEffect, useRef, useState } from 'react';
import { Navigate, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext.jsx';
import { CREATE_BDE_PATH, LOGIN_NOTICES, loginDestination, loginFailure, loginViewSearch, parseLoginView, validateLogin } from '../lib/validate-login.js';

function EyeIcon({ off }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" />
      <circle cx="12" cy="12" r="3" />
      {off && <path d="M3 3l18 18" />}
    </svg>
  );
}

// Sign-in screen: brand panel + form panel. Real authentication (POST /api/auth/login, HttpOnly session cookie); the server decides who
// may sign in and where they may go. Sign-in is by employee ID only.
// Two tabs: Employee Sign In (the original form and request, unchanged) and Admin Sign In (the same form, sent with portal 'admin' so the
// server only lets an administrator account in). "Create BDE Account" is NOT a public form: it is a path on the Admin tab that signs an
// administrator in and then opens Admin > Employees, whose API only an authenticated admin can call. There is no public registration.
const TABS = [
  { portal: 'employee', label: 'Employee Sign In' },
  { portal: 'admin', label: 'Admin Sign In' }
];
const COPY = {
  employee: { title: 'Welcome back!', lead: 'Sign in with your employee ID to continue where you left off.', submit: 'Sign in', idPlaceholder: 'For example EMP001', doc: 'Sign in' },
  admin: { title: 'Admin sign in', lead: 'Administrators sign in here to manage the team, reports and accounts.', submit: 'Sign in as admin', idPlaceholder: 'Your admin employee ID', doc: 'Admin sign in' },
  createBde: { title: 'Create a BDE account', lead: 'Only administrators can create BDE accounts. Sign in with your admin ID and you will go straight to the account form.', submit: 'Sign in to create an account', idPlaceholder: 'Your admin employee ID', doc: 'Create BDE account' }
};

export default function LoginPage() {
  const { user, login, notice, clearNotice } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const { portal, createBde } = parseLoginView(searchParams.toString());
  const copy = createBde ? COPY.createBde : COPY[portal];
  const [employeeId, setEmployeeId] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [capsOn, setCapsOn] = useState(false);
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const busy = useRef(false); // set synchronously, so a fast second Enter or click can never start a second request
  const idRef = useRef(null);
  const passwordRef = useRef(null);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { document.title = copy.doc + ' · ADZ4NEEDZ BDE Team Management'; }, [copy.doc]);

  // Already signed in: an admin who followed the create-account link goes straight to the form; everyone else goes home as before.
  if (user) return <Navigate to={createBde && user.role === 'admin' ? CREATE_BDE_PATH : '/'} replace />;

  // Switching tabs keeps what was typed in the ID box, but never carries a password or an old error across.
  function switchView(next) {
    if (submitting) return;
    const search = loginViewSearch(next);
    setSearchParams(search ? new URLSearchParams(search) : {}, { replace: true });
    setPassword(''); setShowPassword(false); setErrors({}); setFormError('');
  }
  function onTabKeyDown(e, index) {
    const last = TABS.length - 1;
    const to = e.key === 'ArrowRight' ? (index === last ? 0 : index + 1) : e.key === 'ArrowLeft' ? (index === 0 ? last : index - 1) : e.key === 'Home' ? 0 : e.key === 'End' ? last : null;
    if (to === null) return;
    e.preventDefault();
    switchView({ portal: TABS[to].portal });
    document.getElementById('login-tab-' + TABS[to].portal)?.focus();
  }

  const shownNotice = notice && LOGIN_NOTICES[notice];

  async function handleSubmit(e) {
    e.preventDefault();
    if (busy.current) return;
    setFormError('');
    const check = validateLogin({ employeeId, password });
    setErrors(check.errors);
    if (!check.ok) {
      (check.errors.employeeId ? idRef : passwordRef).current.focus();
      return;
    }
    busy.current = true; setSubmitting(true);
    if (notice) clearNotice();
    try {
      // Employee Sign In sends no portal (the request is exactly what it has always been); Admin Sign In sends 'admin'.
      await login(check.value.employeeId, password, portal === 'admin' ? 'admin' : undefined);
      // After signing out on purpose, do not send the next person to the previous person's page. The create-account path goes to the form.
      navigate(loginDestination({ createBde, notice, from: location.state && location.state.from }), { replace: true });
    } catch (err) {
      if (!mounted.current) return;
      const failure = loginFailure(err, portal);
      setFormError(failure.message);
      if (failure.kind === 'credentials') { setPassword(''); setShowPassword(false); }
      busy.current = false; setSubmitting(false);
      // Wrong details: back to the password. A connection or server problem: keep what was typed so a retry is one click.
      if (failure.kind === 'credentials') setTimeout(() => passwordRef.current && passwordRef.current.focus(), 0);
      return;
    }
    busy.current = false; // (the page is replaced after a successful sign-in; this only matters if it is not)
    if (mounted.current) setSubmitting(false);
  }

  const onKey = (e) => { if (e.getModifierState) setCapsOn(e.getModifierState('CapsLock')); };

  return (
    <div className="login-page">
      <a className="skip-link" href="#login-form">Skip to sign in</a>

      <aside className="login-brand" aria-label="About ADZ4NEEDZ BDE Team Management">
        <span className="login-orb login-orb-a" aria-hidden="true" />
        <span className="login-orb login-orb-b" aria-hidden="true" />
        <div className="login-brand-top">
          <span className="login-logo" aria-hidden="true">A4</span>
          <span className="login-brand-text"><span className="login-brand-name">ADZ4NEEDZ</span><span className="login-brand-sub">BDE Team Management</span></span>
        </div>
        <div className="login-brand-body">
          <p className="login-headline">Welcome to your BDE workspace</p>
          <p className="login-copy">Record every call in one click, follow each lead through to payment, and see how the whole team is performing, all in one place.</p>
        </div>
        <div className="login-brand-foot">
          <p className="login-tagline">Call. Convert. Grow.</p>
          <p className="login-subtag">One workspace for the whole BDE team.</p>
        </div>
      </aside>

      <main className="login-panel">
        <div className="login-panel-inner">
          <div className="login-tabs" role="tablist" aria-label="Sign-in type">
            {TABS.map((t, i) => (
              <button key={t.portal} type="button" role="tab" id={'login-tab-' + t.portal} className="login-tab"
                aria-selected={portal === t.portal} aria-controls="login-form" tabIndex={portal === t.portal ? 0 : -1}
                disabled={submitting} onClick={() => switchView({ portal: t.portal })} onKeyDown={(e) => onTabKeyDown(e, i)}>{t.label}</button>
            ))}
          </div>
          <h1>{copy.title}</h1>
          <p className="login-lead">{copy.lead}</p>

          {shownNotice && <div className={'login-notice login-notice-' + shownNotice.tone} role="status">{shownNotice.text}</div>}
          {formError && <div className="login-alert" role="alert"><strong>Could not sign in.</strong> {formError}</div>}

          <form id="login-form" role="tabpanel" aria-labelledby={'login-tab-' + portal} onSubmit={handleSubmit} noValidate aria-busy={submitting ? 'true' : undefined}>
            <div className="login-field">
              <label htmlFor="employeeId">Employee ID <span className="login-req" aria-hidden="true">*</span></label>
              <input id="employeeId" name="employeeId" ref={idRef} type="text" autoComplete="username" autoCapitalize="none" autoCorrect="off" spellCheck="false"
                placeholder={copy.idPlaceholder} value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} readOnly={submitting}
                aria-required="true" aria-invalid={errors.employeeId ? 'true' : undefined} aria-describedby={errors.employeeId ? 'employeeId-error' : undefined} />
              {errors.employeeId && <p className="login-field-error" id="employeeId-error">{errors.employeeId}</p>}
            </div>

            <div className="login-field">
              <label htmlFor="password">Password <span className="login-req" aria-hidden="true">*</span></label>
              <div className="login-password">
                <input id="password" name="password" ref={passwordRef} type={showPassword ? 'text' : 'password'} autoComplete="current-password"
                  placeholder="Enter your password" value={password} onChange={(e) => setPassword(e.target.value)} onKeyUp={onKey} onKeyDown={onKey} readOnly={submitting}
                  aria-required="true" aria-invalid={errors.password ? 'true' : undefined} aria-describedby={[errors.password ? 'password-error' : '', capsOn ? 'caps-hint' : ''].filter(Boolean).join(' ') || undefined} />
                <button type="button" className="login-eye" onClick={() => setShowPassword((v) => !v)} aria-pressed={showPassword} aria-label={showPassword ? 'Hide password' : 'Show password'} disabled={submitting}>
                  <EyeIcon off={showPassword} />
                </button>
              </div>
              {errors.password && <p className="login-field-error" id="password-error">{errors.password}</p>}
              {capsOn && <p className="login-hint" id="caps-hint" role="status">Caps Lock is on.</p>}
            </div>

            <button type="submit" className="login-submit" disabled={submitting}>
              {submitting && <span className="login-spinner" aria-hidden="true" />}
              <span>{submitting ? 'Signing in…' : copy.submit}</span>
            </button>
          </form>

          {portal === 'employee' ? (
            <div className="login-help">
              <p><strong>New to the team?</strong> Your admin creates your employee ID and first password. Ask them to set you up.</p>
              <p><strong>Forgot your password?</strong> Ask your admin to reset it. You will get a temporary password, and you can change it under Profile after you sign in.</p>
              <p><strong>Need help signing in?</strong> Contact your team admin.</p>
              <p className="login-switch">Are you an administrator? <button type="button" className="login-link" onClick={() => switchView({ portal: 'admin' })} disabled={submitting}>Admin Sign In →</button></p>
            </div>
          ) : (
            <div className="login-help">
              {createBde ? (
                <p><strong>Just signing in?</strong> <button type="button" className="login-link" onClick={() => switchView({ portal: 'admin' })} disabled={submitting}>Go to Admin Sign In</button></p>
              ) : (
                <p><strong>Need to add a new BDE?</strong> <button type="button" className="login-link" onClick={() => switchView({ portal: 'admin', createBde: true })} disabled={submitting}>Create BDE Account →</button> <span className="login-hint-inline">Administrators only: you sign in first.</span></p>
              )}
              <p><strong>Forgot your password?</strong> Contact the system administrator, who manages administrator accounts on the server.</p>
              <p><strong>Need help signing in?</strong> Contact the system administrator.</p>
              <p className="login-switch">Are you an employee? <button type="button" className="login-link" onClick={() => switchView({ portal: 'employee' })} disabled={submitting}>Employee Sign In →</button></p>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
