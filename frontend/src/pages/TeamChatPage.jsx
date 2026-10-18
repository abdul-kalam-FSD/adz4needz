import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api/client.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { validateChatDraft, newRequestId, splitMentions, mentionSuggestions, applyMention, mergeLatest, formatChatTime, CHAT_BODY_MAX } from '../lib/chat-format.js';

// Team Chat for every logged-in user. Filters: all / announcements / mentions of me. Only an admin sees the "announcement" option
// (the server enforces it again). New messages arrive by polling (no websockets). Message text is rendered as text, never as HTML.
const FILTERS = [{ key: 'all', label: 'All' }, { key: 'announcement', label: 'Announcements' }, { key: 'mentions', label: 'Mentions of me' }];
const POLL_MS = 20000;
const PAGE = 30;

export default function TeamChatPage() {
  const { user } = useAuth();
  const [filter, setFilter] = useState('all');
  const [state, setState] = useState({ loading: true, error: '', messages: [], hasMore: false, nextBefore: null });
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [people, setPeople] = useState([]);
  const [draft, setDraft] = useState('');
  const [asAnnouncement, setAsAnnouncement] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState('');
  const [removeError, setRemoveError] = useState('');
  const pendingId = useRef(null); // request id of the message being sent; reused on retry, cleared after the server confirms
  const listEnd = useRef(null);

  const fetchPage = useCallback((before) => {
    const qs = `limit=${PAGE}` + (before ? `&before=${before}` : '') + (filter === 'announcement' ? '&kind=announcement' : '');
    return filter === 'mentions' ? api.chatMentions(qs) : api.chatMessages(qs);
  }, [filter]);

  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: '' }));
    try {
      const d = await fetchPage();
      setState({ loading: false, error: '', messages: [...d.messages].reverse(), hasMore: d.hasMore, nextBefore: d.nextBefore });
    } catch (err) { setState({ loading: false, error: err.message || 'Could not load messages.', messages: [], hasMore: false, nextBefore: null }); }
  }, [fetchPage]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { api.chatPeople().then((d) => setPeople(d.people)).catch(() => { /* mention suggestions are optional */ }); }, []);
  useEffect(() => { if (!user || user.role !== 'admin') setAsAnnouncement(false); }, [user]);

  // Poll the newest page; a failed poll is silent (the next one retries) so it never replaces what the person is reading.
  useEffect(() => {
    const t = setInterval(async () => {
      if (document.hidden) return;
      try { const d = await fetchPage(); setState((s) => (s.loading ? s : { ...s, error: '', messages: mergeLatest(s.messages, d.messages) })); } catch { /* retry next tick */ }
    }, POLL_MS);
    return () => clearInterval(t);
  }, [fetchPage]);

  async function loadOlder() {
    if (loadingOlder || !state.nextBefore) return;
    setLoadingOlder(true);
    try {
      const d = await fetchPage(state.nextBefore);
      setState((s) => ({ ...s, messages: [...[...d.messages].reverse(), ...s.messages], hasMore: d.hasMore, nextBefore: d.nextBefore }));
    } catch (err) { setState((s) => ({ ...s, error: err.message || 'Could not load older messages.' })); }
    finally { setLoadingOlder(false); }
  }

  async function handleSend(e) {
    e.preventDefault();
    if (sending) return;
    setSendError('');
    const check = validateChatDraft(draft);
    if (!check.ok) { setSendError(check.error); return; }
    if (!pendingId.current) pendingId.current = newRequestId();
    setSending(true);
    try {
      await api.chatPost({ body: check.value, kind: asAnnouncement ? 'announcement' : 'chat', clientRequestId: pendingId.current });
      pendingId.current = null; setDraft(''); setAsAnnouncement(false);
      await load();
      if (listEnd.current && listEnd.current.scrollIntoView) listEnd.current.scrollIntoView({ block: 'end' });
    } catch (err) {
      setSendError((err.message || 'Could not send the message.') + ' Your text is still here; press Send to try again.');
    } finally { setSending(false); }
  }

  async function handleRemove(m) {
    if (!window.confirm('Remove this message for everyone?')) return;
    setRemoveError('');
    try { await api.chatRemove(m.id); setState((s) => ({ ...s, messages: s.messages.filter((x) => x.id !== m.id) })); }
    catch (err) { setRemoveError(err.message || 'Could not remove the message.'); }
  }

  const suggestions = mentionSuggestions(draft, people);
  const left = CHAT_BODY_MAX - draft.length;

  return (
    <div className="chat-page">
      <h1>Team Chat</h1>
      <div className="chat-filters" role="group" aria-label="Show messages">
        {FILTERS.map((f) => (
          <button key={f.key} type="button" className={'btn ' + (filter === f.key ? 'btn-primary' : 'btn-secondary')} aria-pressed={filter === f.key} onClick={() => setFilter(f.key)}>{f.label}</button>
        ))}
      </div>

      {state.error && <div className="alert alert-error" role="alert">{state.error} <button type="button" className="btn btn-secondary" onClick={load}>Try again</button></div>}
      {removeError && <div className="alert alert-error" role="alert">{removeError}</div>}

      <section className="chat-list" aria-label="Messages" aria-live="polite">
        {state.hasMore && <button type="button" className="btn btn-secondary chat-older" onClick={loadOlder} disabled={loadingOlder}>{loadingOlder ? 'Loading…' : 'Load older messages'}</button>}
        {state.loading && <p className="hint">Loading messages…</p>}
        {!state.loading && !state.error && state.messages.length === 0 && (
          <p className="hint">{filter === 'mentions' ? 'Nobody has mentioned you yet.' : filter === 'announcement' ? 'No announcements yet.' : 'No messages yet. Say hello to the team.'}</p>
        )}
        {state.messages.map((m) => (
          <article key={m.id} className={'chat-msg' + (m.kind === 'announcement' ? ' is-announcement' : '') + (m.sender.id === user.id ? ' is-mine' : '')}>
            <header>
              <strong>{m.sender.name}</strong> <span className="chat-meta">{m.sender.employeeId}{m.sender.role === 'admin' ? ' · Admin' : ''} · {formatChatTime(m.createdAt)}</span>
              {m.kind === 'announcement' && <span className="badge badge-today">Announcement</span>}
              {m.mentionsMe && <span className="badge badge-upcoming">Mentions you</span>}
            </header>
            <p className="chat-body">{splitMentions(m.body, m.mentions).map((p, i) => (p.mention ? <span key={i} className="chat-mention" title={p.mention.name}>{p.text}</span> : <span key={i}>{p.text}</span>))}</p>
            {m.canRemove && <button type="button" className="btn btn-quiet chat-remove" onClick={() => handleRemove(m)} aria-label={'Remove message from ' + m.sender.name}>Remove</button>}
          </article>
        ))}
        <div ref={listEnd} />
      </section>

      <form className="chat-compose" onSubmit={handleSend} noValidate>
        <label htmlFor="chat-draft">Message</label>
        <textarea id="chat-draft" rows={3} value={draft} maxLength={CHAT_BODY_MAX + 50} onChange={(e) => setDraft(e.target.value)} placeholder="Write a message. Type @ to mention a teammate." aria-describedby="chat-count chat-send-error" />
        {suggestions.length > 0 && (
          <ul className="chat-suggest" aria-label="Mention suggestions">
            {suggestions.map((p) => <li key={p.id}><button type="button" className="btn btn-quiet" onClick={() => setDraft(applyMention(draft, p))}>@{p.employeeId} · {p.name}</button></li>)}
          </ul>
        )}
        <div className="chat-compose-row">
          {user.role === 'admin' && <label className="chat-check"><input type="checkbox" checked={asAnnouncement} onChange={(e) => setAsAnnouncement(e.target.checked)} /> Post as announcement</label>}
          <span id="chat-count" className={'hint' + (left < 0 ? ' field-error' : '')}>{left} characters left</span>
          <button type="submit" className="btn btn-primary" disabled={sending}>{sending ? 'Sending…' : 'Send'}</button>
        </div>
        {sendError && <p className="field-error" id="chat-send-error" role="alert">{sendError}</p>}
      </form>
    </div>
  );
}
