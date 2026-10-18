import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, ApiError } from '../api/client.js';
import { todayValue } from '../lib/format.js';
import { suggestSplit } from '../lib/assign-split.js';

const errorText = (err) => {
  if (!(err instanceof ApiError)) return 'Something went wrong. Please try again.';
  const f = Object.values(err.fields || {}).filter(Boolean);
  return f.length ? `${err.message} ${f.join(' ')}` : err.message;
};

// Move leads that nobody has worked on yet from one BDE to others. Only leads with no call, interview or payment can move; the server
// enforces that and refuses the whole request if it cannot move every lead asked for.
export default function AdminAssignPage() {
  const [today] = useState(todayValue());
  const [state, setState] = useState({ loading: true, error: '', data: null });
  const [fromId, setFromId] = useState('');
  const [counts, setCounts] = useState({}); // toBdeId -> text
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: '' }));
    try { setState({ loading: false, error: '', data: await api.adminAssignOverview(today) }); }
    catch (err) { setState({ loading: false, error: errorText(err), data: null }); }
  }, [today]);
  useEffect(() => { load(); }, [load]);

  const bdes = state.data ? state.data.bdes : [];
  const from = bdes.find((b) => String(b.id) === String(fromId)) || null;
  const targets = bdes.filter((b) => String(b.id) !== String(fromId));
  const parsed = useMemo(() => targets.map((b) => {
    const t = String(counts[b.id] ?? '').trim();
    return { b, n: t === '' ? 0 : /^\d{1,5}$/.test(t) ? Number(t) : NaN };
  }), [targets, counts]);
  const total = parsed.reduce((a, p) => a + (Number.isNaN(p.n) ? 0 : p.n), 0);
  const invalid = parsed.some((p) => Number.isNaN(p.n));
  const tooMany = from && total > from.reassignable;

  function suggest() {
    if (!from || from.reassignable < 1) return;
    const split = suggestSplit(from.reassignable, targets.map((b) => ({ id: b.id, openLeads: b.openLeads })));
    const next = {}; for (const s of split) next[s.id] = String(s.count);
    setCounts(next); setResult(null); setError('');
  }

  async function submit(e) {
    e.preventDefault();
    if (saving || !from || total < 1 || invalid || tooMany) return;
    const lines = parsed.filter((p) => p.n > 0);
    if (!window.confirm(`Move ${total} lead${total === 1 ? '' : 's'} from ${from.name} to ${lines.map((p) => `${p.b.name} (${p.n})`).join(', ')}? This cannot be undone from this screen.`)) return;
    setSaving(true); setError(''); setResult(null);
    try {
      const r = await api.adminAssignLeads({ fromBdeId: from.id, allocations: lines.map((p) => ({ toBdeId: p.b.id, count: p.n })) });
      setResult(r); setCounts({}); await load();
    } catch (err) { setError(errorText(err)); }
    finally { setSaving(false); }
  }

  return (
    <>
      <h1>Assign leads</h1>
      <p className="hint">Hand over leads that have not been worked yet. A lead with a recorded call, interview or payment stays with its BDE. Switched-off BDEs are not listed as receivers.</p>
      {state.loading && <p role="status">Loading…</p>}
      {state.error && <div className="alert alert-error" role="alert"><p>{state.error}</p><button type="button" className="btn btn-secondary" onClick={load}>Try again</button></div>}
      {result && <div className="alert alert-success" role="status"><p className="alert-title">{result.moved} lead{result.moved === 1 ? '' : 's'} moved from {result.from.name}</p><p>{result.to.map((t) => `${t.name}: ${t.count}`).join(', ')}</p></div>}
      {state.data && (
        <form onSubmit={submit} noValidate aria-label="Assign leads">
          <div className="field">
            <label htmlFor="as-from">1. Take leads from</label>
            <select id="as-from" value={fromId} onChange={(e) => { setFromId(e.target.value); setCounts({}); setResult(null); setError(''); }}>
              <option value="">Choose a BDE…</option>
              {bdes.map((b) => <option key={b.id} value={b.id}>{b.name} ({b.employeeId}) — {b.reassignable} can move</option>)}
            </select>
          </div>
          {from && (
            <>
              <h2 className="section-title">2. Who should get them</h2>
              {from.reassignable === 0 && <p className="state-message">{from.name} has no leads that can be moved (every lead already has a call, interview or payment).</p>}
              {from.reassignable > 0 && (
                <>
                  <p><button type="button" className="btn btn-secondary" onClick={suggest}>Suggest a split of all {from.reassignable}</button> <span className="hint">Gives the most to the BDEs with the fewest open leads. You can change every number.</span></p>
                  <div className="table-wrap"><table>
                    <thead><tr><th>BDE</th><th className="num">Open leads</th><th className="num">Overdue</th><th className="num">Calls today</th><th>Give</th></tr></thead>
                    <tbody>{parsed.map(({ b, n }) => (
                      <tr key={b.id}><td>{b.name} ({b.employeeId})</td><td className="num">{b.openLeads}</td><td className="num">{b.overdue}</td><td className="num">{b.callsToday}</td>
                        <td><input type="text" inputMode="numeric" aria-label={`Leads for ${b.name}`} aria-invalid={Number.isNaN(n) ? 'true' : undefined} style={{ width: '5rem' }} value={counts[b.id] ?? ''} onChange={(e) => setCounts((c) => ({ ...c, [b.id]: e.target.value }))} /></td></tr>
                    ))}</tbody>
                  </table></div>
                  <p className={invalid || tooMany ? 'field-error' : 'hint'} role={invalid || tooMany ? 'alert' : undefined}>
                    {invalid ? 'Use whole numbers only.' : tooMany ? `That is ${total}, but only ${from.reassignable} can be moved.` : `${total} of ${from.reassignable} selected.`}
                  </p>
                  {error && <div className="alert alert-error" role="alert"><p>{error}</p></div>}
                  <button type="submit" className="btn btn-primary" disabled={saving || total < 1 || invalid || tooMany}>{saving ? 'Moving…' : `Give ${total || ''} lead${total === 1 ? '' : 's'}`}</button>
                </>
              )}
            </>
          )}
          <p className="hint">Open leads = leads whose status is not closed. {state.data.basis}</p>
        </form>
      )}
    </>
  );
}
