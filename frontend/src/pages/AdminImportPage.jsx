import { useCallback, useEffect, useState } from 'react';
import { api, ApiError, importInvalidCsvUrl, uploadImportFile } from '../api/client.js';
import { countsSentence, formatErrors, importableCount, rowStatusLabel, validateUploadFile } from '../lib/import-labels.js';

const FILTERS = [['', 'All rows'], ['valid', 'Ready to import'], ['invalid', 'Has errors'], ['duplicate_in_file', 'Repeated in file'], ['duplicate_existing', 'Already in system']];
const PAGE_SIZE = 25;

function errorText(err) {
  if (!(err instanceof ApiError)) return 'Something went wrong. Please try again.';
  const fields = Object.values(err.fields || {}).filter(Boolean);
  return fields.length ? `${err.message} ${fields.join(' ')}` : err.message;
}

export default function AdminImportPage() {
  const [options, setOptions] = useState(null);
  const [optionsError, setOptionsError] = useState('');
  const [history, setHistory] = useState({ loading: true, error: '', items: [] });

  // upload form
  const [file, setFile] = useState(null);
  const [uploadBde, setUploadBde] = useState('');
  const [uploadCourse, setUploadCourse] = useState('');
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');

  // current batch
  const [batch, setBatch] = useState(null);
  const [mapping, setMapping] = useState({});
  const [defaultBde, setDefaultBde] = useState('');
  const [defaultCourse, setDefaultCourse] = useState('');
  const [includeExisting, setIncludeExisting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [settingsError, setSettingsError] = useState('');
  const [reviewed, setReviewed] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [finishError, setFinishError] = useState('');
  const [done, setDone] = useState(null);

  // rows
  const [filter, setFilter] = useState('');
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState({ loading: false, error: '', items: [], total: 0 });

  const loadHistory = useCallback(async () => {
    setHistory((h) => ({ ...h, loading: true, error: '' }));
    try {
      const data = await api.adminListImports();
      setHistory({ loading: false, error: '', items: data.imports });
    } catch (err) {
      setHistory({ loading: false, error: errorText(err), items: [] });
    }
  }, []);

  useEffect(() => {
    let alive = true;
    api.adminImportOptions().then((o) => { if (alive) setOptions(o); }).catch((err) => { if (alive) setOptionsError(errorText(err)); });
    loadHistory();
    return () => { alive = false; };
  }, [loadHistory]);

  function adopt(b) {
    setBatch(b);
    setMapping(b.mapping || {});
    setDefaultBde(b.defaultBde ? String(b.defaultBde.id) : '');
    setDefaultCourse(b.defaultCourse || '');
    setIncludeExisting(Boolean(b.includeExistingDuplicates));
    setReviewed(false);
    setPage(1);
  }

  const loadRows = useCallback(async () => {
    if (!batch || batch.status !== 'preview' || batch.needsMapping) { setRows({ loading: false, error: '', items: [], total: 0 }); return; }
    setRows((r) => ({ ...r, loading: true, error: '' }));
    try {
      const qs = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
      if (filter) qs.set('status', filter);
      const data = await api.adminImportRows(batch.id, qs.toString());
      setRows({ loading: false, error: '', items: data.rows, total: data.total });
    } catch (err) {
      setRows({ loading: false, error: errorText(err), items: [], total: 0 });
    }
  }, [batch, filter, page]);

  useEffect(() => { loadRows(); }, [loadRows]);

  async function handleUpload(e) {
    e.preventDefault();
    if (uploading) return;
    const problem = validateUploadFile(file);
    if (problem) { setUploadError(problem); return; }
    setUploading(true); setUploadError(''); setDone(null); setFinishError(''); setSettingsError('');
    try {
      const data = await uploadImportFile(file, { defaultBdeId: uploadBde, defaultCourse: uploadCourse.trim() });
      adopt(data.import);
      setFile(null);
      e.target.reset();
      loadHistory();
    } catch (err) {
      setUploadError(errorText(err));
    } finally {
      setUploading(false);
    }
  }

  async function handleApply(e) {
    e.preventDefault();
    if (saving || !batch) return;
    setSaving(true); setSettingsError('');
    const cleanMapping = {};
    for (const [k, v] of Object.entries(mapping)) if (v !== '' && v !== null && v !== undefined) cleanMapping[k] = Number(v);
    try {
      const data = await api.adminUpdateImport(batch.id, {
        mapping: cleanMapping, defaultBdeId: defaultBde === '' ? null : Number(defaultBde), defaultCourse: defaultCourse.trim() || null, includeExistingDuplicates: includeExisting
      });
      adopt(data.import);
    } catch (err) {
      setSettingsError(errorText(err));
    } finally {
      setSaving(false);
    }
  }

  async function handleCommit() {
    if (finishing || !batch || !reviewed) return;
    setFinishing(true); setFinishError('');
    try {
      const data = await api.adminCommitImport(batch.id);
      setDone(data.import); setBatch(null);
      loadHistory();
    } catch (err) {
      setFinishError(errorText(err));
    } finally {
      setFinishing(false);
    }
  }

  async function handleCancel() {
    if (finishing || !batch) return;
    setFinishing(true); setFinishError('');
    try {
      await api.adminCancelImport(batch.id);
      setBatch(null);
      loadHistory();
    } catch (err) {
      setFinishError(errorText(err));
    } finally {
      setFinishing(false);
    }
  }

  const bdes = options ? options.bdes : [];
  const fields = options ? options.fields : [];
  const statusName = (id) => { const f = options && options.statuses.find((x) => x.id === id); return f ? f.name : String(id); };
  const toImport = batch ? importableCount(batch.counts, includeExisting && batch.includeExistingDuplicates) : 0;
  const totalPages = Math.max(1, Math.ceil(rows.total / PAGE_SIZE));

  return (
    <>
      <h1>Import Leads from Excel / CSV</h1>
      <p className="hint">Upload the student list provided by the company. Nothing is added to the system until you review the preview and confirm. Each lead is assigned to one BDE.</p>

      {optionsError && <div className="alert alert-error" role="alert"><p>{optionsError}</p></div>}

      {done && (
        <div className="alert alert-success" role="status">
          <p className="alert-title">Import finished</p>
          <p>{done.result ? `${done.result.inserted} leads were added and ${done.result.skipped} rows were skipped (errors or duplicates).` : 'Import finished.'}</p>
        </div>
      )}

      {!batch && (
        <form onSubmit={handleUpload} noValidate aria-label="Upload file">
          <div className="field">
            <label htmlFor="import-file">File (.xlsx or .csv, first row = column headings)</label>
            <input id="import-file" type="file" accept=".xlsx,.csv" onChange={(e) => { setFile(e.target.files[0] || null); setUploadError(''); }} />
          </div>
          <div className="toolbar">
            <div className="field">
              <label htmlFor="upload-bde">Assign leads to BDE</label>
              <select id="upload-bde" value={uploadBde} onChange={(e) => setUploadBde(e.target.value)}>
                <option value="">— none (use the Employee ID column) —</option>
                {bdes.map((b) => <option key={b.id} value={b.id}>{b.name} ({b.employeeId})</option>)}
              </select>
            </div>
            <div className="field">
              <label htmlFor="upload-course">Default course / internship (optional)</label>
              <input id="upload-course" type="text" maxLength={150} value={uploadCourse} onChange={(e) => setUploadCourse(e.target.value)} />
            </div>
          </div>
          {uploadError && <div className="alert alert-error" role="alert"><p>{uploadError}</p></div>}
          <button type="submit" className="btn btn-primary" disabled={uploading || !options}>{uploading ? 'Uploading and checking…' : 'Upload and preview'}</button>
        </form>
      )}

      {batch && (
        <>
          <div className="page-head">
            <h2>Preview: {batch.fileName}</h2>
            <button type="button" className="btn btn-secondary" onClick={handleCancel} disabled={finishing}>Cancel this import</button>
          </div>

          <form onSubmit={handleApply} noValidate aria-label="Column mapping">
            <h3>1. Match your columns</h3>
            {batch.needsMapping && <div className="alert alert-error" role="alert"><p>Candidate name and a Phone or Email column are required. Choose them below, then apply.</p></div>}
            <div className="toolbar">
              {fields.map((f) => (
                <div className="field" key={f.key}>
                  <label htmlFor={'map-' + f.key}>{f.label}{f.required ? '' : f.key === 'phone' ? ' (needed if no email)' : f.key === 'email' ? ' (needed if no phone)' : ' (optional)'}</label>
                  <select id={'map-' + f.key} value={mapping[f.key] === undefined ? '' : String(mapping[f.key])} onChange={(e) => setMapping({ ...mapping, [f.key]: e.target.value })}>
                    <option value="">— not in file —</option>
                    {batch.headers.map((h, i) => <option key={i} value={i}>{h || `Column ${i + 1}`}</option>)}
                  </select>
                </div>
              ))}
            </div>
            <div className="toolbar">
              <div className="field">
                <label htmlFor="batch-bde">Default BDE (used when a row has no employee ID)</label>
                <select id="batch-bde" value={defaultBde} onChange={(e) => setDefaultBde(e.target.value)}>
                  <option value="">— none —</option>
                  {bdes.map((b) => <option key={b.id} value={b.id}>{b.name} ({b.employeeId})</option>)}
                </select>
              </div>
              <div className="field">
                <label htmlFor="batch-course">Default course (used when a row has none)</label>
                <input id="batch-course" type="text" maxLength={150} value={defaultCourse} onChange={(e) => setDefaultCourse(e.target.value)} />
              </div>
            </div>
            <div className="field">
              <label><input type="checkbox" checked={includeExisting} onChange={(e) => setIncludeExisting(e.target.checked)} /> Also import rows whose phone/email already exists in the system (off by default)</label>
            </div>
            {settingsError && <div className="alert alert-error" role="alert"><p>{settingsError}</p></div>}
            <button type="submit" className="btn btn-secondary" disabled={saving}>{saving ? 'Checking rows…' : 'Apply and re-check rows'}</button>
          </form>

          {!batch.needsMapping && (
            <>
              <h3>2. Review the result</h3>
              <p role="status">{countsSentence(batch.counts)}</p>
              <div className="toolbar">
                <div className="field">
                  <label htmlFor="row-filter">Show</label>
                  <select id="row-filter" value={filter} onChange={(e) => { setFilter(e.target.value); setPage(1); }}>
                    {FILTERS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                </div>
                {batch.counts.invalid > 0 && <a className="btn btn-secondary" href={importInvalidCsvUrl(batch.id)}>Download rows with errors (CSV)</a>}
              </div>
              {rows.error && <div className="alert alert-error" role="alert"><p>{rows.error}</p></div>}
              {rows.loading && <p role="status">Loading rows…</p>}
              {!rows.loading && !rows.error && rows.items.length === 0 && <p>No rows to show for this filter.</p>}
              {rows.items.length > 0 && (
                <div className="table-wrap">
                  <table>
                    <caption className="sr-only">Rows found in the uploaded file</caption>
                    <thead><tr><th>Row</th><th>Result</th><th>Candidate</th><th>Phone</th><th>Email</th><th>Course</th><th>Lead status</th><th>BDE</th><th>Notes</th></tr></thead>
                    <tbody>
                      {rows.items.map((r) => (
                        <tr key={r.rowNumber}>
                          <td>{r.rowNumber}</td>
                          <td>{rowStatusLabel(r.status)}</td>
                          <td>{r.lead ? r.lead.candidateName : '—'}</td>
                          <td>{r.lead ? (r.lead.phone || '—') : '—'}</td>
                          <td>{r.lead ? (r.lead.email || '—') : '—'}</td>
                          <td>{r.lead ? r.lead.courseOrInternship : '—'}</td>
                          <td>{r.lead ? statusName(r.lead.leadStatusId) : '—'}</td>
                          <td>{r.bde ? `${r.bde.name} (${r.bde.employeeId})` : '—'}</td>
                          <td>
                            {r.status === 'invalid' && formatErrors(r.errors)}
                            {r.status === 'duplicate_in_file' && `Same phone/email as row ${r.duplicateOfRow}.`}
                            {r.status === 'duplicate_existing' && 'Matches an existing lead.'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {rows.total > PAGE_SIZE && (
                <div className="toolbar">
                  <button type="button" className="btn btn-secondary" disabled={page <= 1 || rows.loading} onClick={() => setPage((p) => p - 1)}>Previous</button>
                  <span>Page {page} of {totalPages}</span>
                  <button type="button" className="btn btn-secondary" disabled={page >= totalPages || rows.loading} onClick={() => setPage((p) => p + 1)}>Next</button>
                </div>
              )}

              <h3>3. Confirm</h3>
              <p>{toImport === 0 ? 'There are no rows ready to import.' : `${toImport} leads will be added. Rows with errors and duplicates are skipped.`}</p>
              <div className="field">
                <label><input type="checkbox" checked={reviewed} onChange={(e) => setReviewed(e.target.checked)} disabled={toImport === 0} /> I have reviewed the preview and want to import these leads.</label>
              </div>
              {finishError && <div className="alert alert-error" role="alert"><p>{finishError}</p></div>}
              <button type="button" className="btn btn-primary" onClick={handleCommit} disabled={!reviewed || toImport === 0 || finishing}>{finishing ? 'Importing…' : `Import ${toImport} leads`}</button>
            </>
          )}
        </>
      )}

      <h2>Recent imports</h2>
      {history.loading && <p role="status">Loading…</p>}
      {history.error && <div className="alert alert-error" role="alert"><p>{history.error}</p></div>}
      {!history.loading && !history.error && history.items.length === 0 && <p>No imports yet.</p>}
      {history.items.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead><tr><th>File</th><th>Status</th><th>Rows</th><th>Added</th><th>Skipped</th><th>By</th><th>Uploaded (UTC)</th></tr></thead>
            <tbody>
              {history.items.map((h) => (
                <tr key={h.id}>
                  <td>{h.fileName}</td><td>{h.status}</td><td>{h.counts.total}</td>
                  <td>{h.result ? h.result.inserted : '—'}</td><td>{h.result ? h.result.skipped : '—'}</td>
                  <td>{h.admin.name}</td><td>{h.createdAt}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
