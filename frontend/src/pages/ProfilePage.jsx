import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client.js';
import { validateContactForm, validatePasswordForm } from '../lib/validate-profile.js';
import { describePasswordFailure, fieldsToClear } from '../lib/profile-messages.js';

const ROLE_LABEL = { bde: 'BDE', admin: 'Admin' };
const EMPTY_PW = { currentPassword: '', newPassword: '', confirmPassword: '' };
const focusFirst = (ids, errors) => {
  const first = ids.find((id) => errors[id]);
  if (first) document.getElementById('field-' + first)?.focus();
};

export default function ProfilePage() {
  const [load, setLoad] = useState({ state: 'loading', profile: null, message: '' });
  const [contact, setContact] = useState({ phone: '', email: '' });
  const [contactErrors, setContactErrors] = useState({});
  const [contactStatus, setContactStatus] = useState(null);
  const [savingContact, setSavingContact] = useState(false);
  const [pw, setPw] = useState(EMPTY_PW);
  const [pwErrors, setPwErrors] = useState({});
  const [pwStatus, setPwStatus] = useState(null);
  const [savingPw, setSavingPw] = useState(false);

  const loadProfile = useCallback(async () => {
    setLoad((l) => ({ ...l, state: 'loading' }));
    try {
      const data = await api.getProfile();
      setLoad({ state: 'ready', profile: data.profile, message: '' });
      setContact({ phone: data.profile.phone || '', email: data.profile.email || '' });
    } catch (err) {
      setLoad({ state: 'error', profile: null, message: err.message });
    }
  }, []);
  useEffect(() => { loadProfile(); }, [loadProfile]);

  async function saveContact(e) {
    e.preventDefault();
    if (savingContact) return;
    setContactStatus(null); setContactErrors({});
    const result = validateContactForm(contact);
    if (!result.ok) { setContactErrors(result.errors); focusFirst(['phone', 'email'], result.errors); return; }
    setSavingContact(true);
    try {
      const data = await api.updateProfile(result.value);
      setLoad((l) => ({ ...l, profile: data.profile }));
      setContact({ phone: data.profile.phone || '', email: data.profile.email || '' });
      setContactStatus({ type: 'success', lead: 'Contact details saved.', text: '' });
    } catch (err) {
      if (err.fields && Object.keys(err.fields).length) { setContactErrors(err.fields); focusFirst(['phone', 'email'], err.fields); }
      setContactStatus({ type: 'error', lead: 'Not saved.', text: err.message });
    } finally {
      setSavingContact(false);
    }
  }

  async function savePassword(e) {
    e.preventDefault();
    if (savingPw) return;
    setPwStatus(null); setPwErrors({});
    const result = validatePasswordForm(pw);
    if (!result.ok) { setPwErrors(result.errors); focusFirst(['currentPassword', 'newPassword', 'confirmPassword'], result.errors); return; }
    setSavingPw(true);
    try {
      await api.changePassword(result.value); // confirmPassword is never sent
      setPw(EMPTY_PW);
      setPwStatus({ type: 'success', lead: 'Password changed.', text: 'Sessions that were already open on your other devices were signed out. If you are asked to log in again, use your new password.' });
    } catch (err) {
      // Never keep a typed password on screen after a rejected attempt: the current password is always cleared;
      // a plain validation answer (400) keeps the new-password fields so they do not have to be typed again.
      const cleared = fieldsToClear(err);
      setPw((p) => ({ ...p, ...Object.fromEntries(cleared.map((k) => [k, ''])) }));
      if (err.status === 400 && err.fields && Object.keys(err.fields).length) {
        setPwErrors(err.fields); focusFirst(['currentPassword', 'newPassword', 'confirmPassword'], err.fields);
      }
      // The heading comes from the server's error code and the text is the server's own message, so the screen
      // never says "not changed" when the server says the password WAS changed, or the other way round.
      const d = describePasswordFailure(err);
      setPwStatus({ type: 'error', lead: d.lead, text: err.message + d.hint });
    } finally {
      setSavingPw(false);
    }
  }

  const setC = (key) => (e) => setContact((c) => ({ ...c, [key]: e.target.value }));
  const setP = (key) => (e) => setPw((p) => ({ ...p, [key]: e.target.value }));
  const fieldError = (errors, key) => errors[key] && <p className="field-error" id={key + '-error'}>{errors[key]}</p>;
  const invalid = (errors, key) => (errors[key] ? 'true' : undefined);

  if (load.state === 'loading') return <><h1>My Profile</h1><p className="state-message">Loading your profile…</p></>;
  if (load.state === 'error') {
    return (
      <>
        <h1>My Profile</h1>
        <p className="state-message">{load.message} <button type="button" className="btn btn-secondary" onClick={loadProfile}>Retry</button></p>
      </>
    );
  }
  const p = load.profile;

  return (
    <>
      <h1>My Profile</h1>

      <section className="report-form profile-card" aria-labelledby="details-heading">
        <h2 id="details-heading" className="section-title">Your details</h2>
        <p className="hint">Name, employee ID and role cannot be changed here.</p>
        <dl className="profile-details">
          <div><dt>Name</dt><dd>{p.name}</dd></div>
          <div><dt>Employee ID</dt><dd>{p.employeeId}</dd></div>
          <div><dt>Role</dt><dd>{ROLE_LABEL[p.role] || p.role}</dd></div>
        </dl>
      </section>

      <form className="report-form profile-card" onSubmit={saveContact} noValidate aria-busy={savingContact} aria-labelledby="contact-heading">
        <h2 id="contact-heading" className="section-title">Contact details</h2>
        <div className="field">
          <label htmlFor="field-phone">Phone (optional)</label>
          <input type="tel" id="field-phone" autoComplete="tel" inputMode="tel" value={contact.phone} onChange={setC('phone')}
            aria-invalid={invalid(contactErrors, 'phone')} aria-describedby="phone-error" />
          {fieldError(contactErrors, 'phone')}
        </div>
        <div className="field">
          <label htmlFor="field-email">Email (optional)</label>
          <input type="email" id="field-email" autoComplete="email" inputMode="email" value={contact.email} onChange={setC('email')}
            aria-invalid={invalid(contactErrors, 'email')} aria-describedby="email-error" />
          {fieldError(contactErrors, 'email')}
        </div>
        <p className="hint">Leave a field empty to remove it.</p>
        <div className="actions">
          <button type="submit" className="btn btn-primary" disabled={savingContact}>{savingContact ? 'Saving…' : 'Save contact details'}</button>
        </div>
        {contactErrors._form && <div className="alert alert-error" role="alert">{contactErrors._form}</div>}
        {contactStatus && (
          <div className={'alert alert-' + contactStatus.type} role={contactStatus.type === 'error' ? 'alert' : 'status'}>
            <strong>{contactStatus.lead}</strong> {contactStatus.text}
          </div>
        )}
      </form>

      <form className="report-form profile-card" onSubmit={savePassword} noValidate aria-busy={savingPw} aria-labelledby="password-heading">
        <h2 id="password-heading" className="section-title">Change password</h2>
        <p className="hint">Use at least 10 characters. Changing your password signs you out on your other devices.</p>
        <div className="field">
          <label htmlFor="field-currentPassword">Current password</label>
          <input type="password" id="field-currentPassword" autoComplete="current-password" value={pw.currentPassword} onChange={setP('currentPassword')}
            aria-invalid={invalid(pwErrors, 'currentPassword')} aria-describedby="currentPassword-error" />
          {fieldError(pwErrors, 'currentPassword')}
        </div>
        <div className="field">
          <label htmlFor="field-newPassword">New password</label>
          <input type="password" id="field-newPassword" autoComplete="new-password" value={pw.newPassword} onChange={setP('newPassword')}
            aria-invalid={invalid(pwErrors, 'newPassword')} aria-describedby="newPassword-error" />
          {fieldError(pwErrors, 'newPassword')}
        </div>
        <div className="field">
          <label htmlFor="field-confirmPassword">Confirm new password</label>
          <input type="password" id="field-confirmPassword" autoComplete="new-password" value={pw.confirmPassword} onChange={setP('confirmPassword')}
            aria-invalid={invalid(pwErrors, 'confirmPassword')} aria-describedby="confirmPassword-error" />
          {fieldError(pwErrors, 'confirmPassword')}
        </div>
        <div className="actions">
          <button type="submit" className="btn btn-primary" disabled={savingPw}>{savingPw ? 'Changing…' : 'Change password'}</button>
        </div>
        {pwErrors._form && <div className="alert alert-error" role="alert">{pwErrors._form}</div>}
        {pwStatus && (
          <div className={'alert alert-' + pwStatus.type} role={pwStatus.type === 'error' ? 'alert' : 'status'}>
            <strong>{pwStatus.lead}</strong> {pwStatus.text}
          </div>
        )}
      </form>
    </>
  );
}
