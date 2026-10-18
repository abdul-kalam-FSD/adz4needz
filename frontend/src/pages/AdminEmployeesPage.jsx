import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '../api/client.js';
import { validateEmployeeForm } from '../lib/validate-employee.js';

const EMPTY = { employeeId: '', name: '', password: '', confirmPassword: '' };

export default function AdminEmployeesPage() {
  const [form, setForm] = useState(EMPTY);
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);
  const [created, setCreated] = useState(null);
  const [list, setList] = useState({ loading: true, error: '', items: [] });
  const [busyId, setBusyId] = useState(null);
  const [actionError, setActionError] = useState('');
  const [issued, setIssued] = useState(null); // { name, employeeId, temporaryPassword } shown ONCE after a reset

  const load = useCallback(async () => {
    setList((l) => ({ ...l, loading: true, error: '' }));
    try { const d = await api.adminListEmployees(); setList({ loading: false, error: '', items: d.employees }); }
    catch (err) { setList({ loading: false, error: err.message || 'Could not load the employee list.', items: [] }); }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function toggleActive(b) {
    if (busyId) return;
    const turningOff = b.isActive;
    const msg = turningOff
      ? `Switch off ${b.name} (${b.employeeId})? They will be signed out and cannot sign in. Their leads, calls and payments are kept.`
      : `Switch ${b.name} (${b.employeeId}) back on? They can sign in again with their current password.`;
    if (!window.confirm(msg)) return;
    setBusyId(b.id); setActionError(''); setIssued(null);
    try { await api.adminSetEmployeeActive(b.id, !b.isActive); await load(); }
    catch (err) { setActionError(err.message || 'Could not change the account. Please try again.'); }
    finally { setBusyId(null); }
  }
  async function resetPassword(b) {
    if (busyId) return;
    if (!window.confirm(`Reset the password for ${b.name} (${b.employeeId})? Their current password stops working and they are signed out.`)) return;
    setBusyId(b.id); setActionError(''); setIssued(null);
    try { const d = await api.adminResetPassword(b.id); setIssued({ name: d.employee.name, employeeId: d.employee.employeeId, temporaryPassword: d.temporaryPassword }); }
    catch (err) { setActionError(err.message || 'Could not reset the password. Please try again.'); }
    finally { setBusyId(null); }
  }

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function handleSubmit(e) {
    e.preventDefault();
    if (saving) return;
    setCreated(null); setFormError('');
    const check = validateEmployeeForm(form);
    setErrors(check.errors);
    if (!check.ok) return;
    setSaving(true);
    try {
      const data = await api.adminCreateEmployee({ employeeId: check.value.employeeId, name: check.value.name, password: check.value.password });
      setCreated(data.employee);
      setForm(EMPTY); setErrors({});
      load();
    } catch (err) {
      if (err instanceof ApiError && err.fields) setErrors(err.fields);
      setFormError(err.message || 'Could not create the account. Please try again.');
    } finally { setSaving(false); }
  }

  const field = (key, label, type = 'text', extra = {}) => (
    <div className="field">
      <label htmlFor={'emp-' + key}>{label}</label>
      <input id={'emp-' + key} type={type} value={form[key]} onChange={set(key)} aria-invalid={errors[key] ? 'true' : undefined} autoComplete={type === 'password' ? 'new-password' : 'off'} {...extra} />
      {errors[key] && <p className="field-error">{errors[key]}</p>}
    </div>
  );

  return (
    <>
      <h1>Employees</h1>
      <p className="hint">Create a login for a new BDE. They sign in with the employee ID and the password you set here, and can change the password themselves under Profile. Admin accounts are created by the system administrator on the server.</p>

      {created && <div className="alert alert-success" role="status"><p className="alert-title">Account created</p><p>{created.name} can now sign in with employee ID <strong>{created.employeeId}</strong>. Give them the password you set; it is not shown again.</p></div>}
      <form className="report-form" onSubmit={handleSubmit} noValidate aria-label="Create BDE account">
        {field('employeeId', 'Employee ID', 'text', { maxLength: 32 })}
        {field('name', 'Full name', 'text', { maxLength: 120 })}
        {field('password', 'Password (at least 10 characters)', 'password', { maxLength: 200 })}
        {field('confirmPassword', 'Confirm password', 'password', { maxLength: 200 })}
        {formError && <div className="alert alert-error" role="alert"><p>{formError}</p></div>}
        <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Creating…' : 'Create BDE account'}</button>
      </form>

      <h2>Current BDEs</h2>
      {issued && (
        <div className="alert alert-success" role="status">
          <p className="alert-title">New temporary password for {issued.name}</p>
          <p>Employee ID <strong>{issued.employeeId}</strong>, temporary password <strong style={{ fontFamily: 'monospace' }}>{issued.temporaryPassword}</strong></p>
          <p className="hint">This password is shown only now and is not stored anywhere readable. Give it to them privately; they can change it under Profile.</p>
          <button type="button" className="btn btn-secondary" onClick={() => setIssued(null)}>Done</button>
        </div>
      )}
      {actionError && <div className="alert alert-error" role="alert"><p>{actionError}</p></div>}
      {list.loading && <p role="status">Loading…</p>}
      {list.error && <div className="alert alert-error" role="alert"><p>{list.error}</p><button type="button" className="btn btn-secondary" onClick={load}>Try again</button></div>}
      {!list.loading && !list.error && list.items.length === 0 && <p>No BDEs yet.</p>}
      {list.items.length > 0 && (
        <div className="table-wrap"><table>
          <thead><tr><th>Employee ID</th><th>Name</th><th>Phone</th><th>Status</th><th>Actions</th></tr></thead>
          <tbody>{list.items.map((b) => (
            <tr key={b.id}>
              <td>{b.employeeId}</td><td>{b.name}</td><td>{b.phone || <span className="muted">—</span>}</td>
              <td>{b.isActive ? 'Active' : 'Inactive'}</td>
              <td>
                <button type="button" className="btn btn-secondary" disabled={busyId !== null} onClick={() => resetPassword(b)}>Reset password</button>{' '}
                <button type="button" className="btn btn-secondary" disabled={busyId !== null} onClick={() => toggleActive(b)}>{b.isActive ? 'Deactivate' : 'Activate'}</button>
              </td>
            </tr>))}</tbody>
        </table></div>
      )}
    </>
  );
}
