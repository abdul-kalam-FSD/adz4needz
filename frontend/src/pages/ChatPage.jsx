import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { api } from '../api/client.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { useChatUnread } from '../components/ChatUnreadContext.jsx';
import { newRequestId } from '../lib/call-desk.js';
import {
  MAX_CHARS, POLL_CHAT_MS, beginSend, buildThread, characterCount, filterMembers, formatMessageTime, initialSendState, insertMention,
  mentionQueryAt, mergeMessages, messageSegments, nextPollDelay, sendFailed, sendSucceeded, shouldMarkRead
} from '../lib/chat.js';

const PAGE = 50;
const NEAR_BOTTOM_PX = 80;

// One message. The body is plain text: React escapes it, and mentions are drawn from the server's exact positions. Nothing here builds HTML.
function MessageItem({ m, viewerId }) {
  const isAnnouncement = m.kind === 'announcement';
  const segments = messageSegments(m.body, m.mentions);
  return (
    <li className={'chat-msg' + (m.mine ? ' chat-msg-mine' : '') + (isAnnouncement ? ' chat-msg-announcement' : '') + (m.mentionsMe ? ' chat-msg-mentions-me' : '')}>
      <div className="chat-meta">
        <span className="chat-author">{m.mine ? 'You' : m.sender.name}</span>
        {m.sender.role === 'admin' && <span className="chat-tag">Admin</span>}
        {isAnnouncement && <span className="chat-tag chat-tag-announcement">Announcement</span>}
        {m.mentionsMe && !m.mine && <span className="chat-tag chat-tag-mention">Mentions you</span>}
        <time dateTime={String(m.createdAt).replace(' ', 'T') + 'Z'}>{formatMessageTime(m.createdAt)}</time>
      </div>
      <p className="chat-body">
        {segments.map((s, i) => (s.type === 'mention'
          ? <span key={i} className={'chat-mention' + (s.userId === viewerId ? ' chat-mention-me' : '')} title={s.name}>@{s.name || s.text.slice(1)}</span>
          : <span key={i}>{s.text}</span>))}
      </p>
      {m.readBy && <p className="chat-readby">Read by {m.readBy.count} of {m.readBy.total}</p>}
    </li>
  );
}

// Team chat: ONE shared conversation. Updates arrive by polling (every 5 s while this page is open and visible; no WebSockets).
export default function ChatPage() {
  const { user } = useAuth();
  const { apply: applyUnread, announcements: unreadAnnouncements } = useChatUnread();
  const isAdmin = user.role === 'admin';

  const [view, setView] = useState('all'); // 'all' | 'announcement'
  const [load, setLoad] = useState({ status: 'loading', message: '' });
  const [messages, setMessages] = useState([]);
  const [hasMore, setHasMore] = useState(false);
  const [olderState, setOlderState] = useState({ loading: false, error: '' });
  const [lastReadAtOpen, setLastReadAtOpen] = useState(0); // the read cursor when this view was opened: the "New messages" line goes after it
  const [members, setMembers] = useState([]);
  const [text, setText] = useState('');
  const [caret, setCaret] = useState(0);
  const [kind, setKind] = useState('message');
  const [send, setSendState] = useState(initialSendState());
  const [pollProblem, setPollProblem] = useState(false);
  const [atBottom, setAtBottom] = useState(true);
  const [newBelow, setNewBelow] = useState(false);
  const [tabVisible, setTabVisible] = useState(typeof document === 'undefined' ? true : document.visibilityState === 'visible');
  const [active, setActive] = useState(0);
  const [pickerClosed, setPickerClosed] = useState(false);

  const listRef = useRef(null);
  const boxRef = useRef(null);
  const sendRef = useRef(send);          // updated at once, so a fast second Enter or click cannot start a second send
  const readRef = useRef(0);             // the newest message id the server knows I have read
  const markingRef = useRef(0);          // the newest id I have already asked the server to mark as read
  const lastIdRef = useRef(0);           // newest message id currently shown (what polling asks "after")
  const prevLastIdRef = useRef(0);
  const atBottomRef = useRef(true);
  const prependRef = useRef(null);       // scroll height before older messages were added (to keep the reading position)
  const failuresRef = useRef(0);
  const forceBottomRef = useRef(false);

  const setSend = (next) => { sendRef.current = next; setSendState(next); };
  const scrollToBottom = () => { const el = listRef.current; if (el) el.scrollTop = el.scrollHeight; };

  useEffect(() => { document.title = 'Team chat · ADZ4NEEDZ'; }, []);
  useEffect(() => {
    const onVis = () => setTabVisible(document.visibilityState === 'visible');
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, []);
  useEffect(() => { api.chatMembers().then((d) => setMembers(d.members)).catch(() => {}); }, []); // only used for the @ suggestions

  // ---- first load of a view -----------------------------------------------------------------------------------------------
  const loadInitial = useCallback(async () => {
    setLoad({ status: 'loading', message: '' });
    try {
      const d = await api.chatMessages(`kind=${view}&limit=${PAGE}`);
      setMessages(d.messages); setHasMore(d.hasMore); setOlderState({ loading: false, error: '' });
      readRef.current = d.lastReadMessageId; markingRef.current = d.lastReadMessageId;
      if (view === 'all') setLastReadAtOpen(d.lastReadMessageId);
      applyUnread(d);
      forceBottomRef.current = true; prevLastIdRef.current = d.messages.length ? d.messages[d.messages.length - 1].id : 0;
      failuresRef.current = 0; setPollProblem(false); setNewBelow(false);
      setLoad({ status: 'ready', message: '' });
    } catch (err) { setLoad({ status: 'error', message: err.message }); }
  }, [view, applyUnread]);
  useEffect(() => { loadInitial(); }, [loadInitial]);

  useEffect(() => { lastIdRef.current = messages.length ? messages[messages.length - 1].id : 0; }, [messages]);

  // ---- scrolling: stay at the bottom for new messages unless the person scrolled up to read; keep position when older ones load ---
  useLayoutEffect(() => {
    const el = listRef.current; if (!el) return;
    if (prependRef.current !== null) { el.scrollTop += el.scrollHeight - prependRef.current; prependRef.current = null; return; }
    if (forceBottomRef.current) { forceBottomRef.current = false; scrollToBottom(); atBottomRef.current = true; setAtBottom(true); return; }
    const last = messages.length ? messages[messages.length - 1] : null;
    if (last && last.id > prevLastIdRef.current) {
      if (atBottomRef.current || last.mine) { scrollToBottom(); } else setNewBelow(true);
    }
    prevLastIdRef.current = last ? last.id : 0;
  }, [messages]);

  function onScroll() {
    const el = listRef.current; if (!el) return;
    const bottom = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX;
    atBottomRef.current = bottom; setAtBottom(bottom); if (bottom) setNewBelow(false);
  }

  // ---- polling for new messages ----------------------------------------------------------------------------------------------
  useEffect(() => {
    if (load.status !== 'ready') return undefined;
    let stopped = false; let timer = null;
    const tick = async () => {
      if (document.visibilityState === 'visible') {
        try {
          for (let round = 0, more = true; more && round < 5 && !stopped; round += 1) {
            const last = lastIdRef.current;
            const d = await api.chatMessages(`kind=${view}&limit=${PAGE}${last ? `&after=${last}` : ''}`);
            if (stopped) return;
            if (d.messages.length) setMessages((cur) => mergeMessages(cur, d.messages));
            applyUnread(d); more = Boolean(d.more); failuresRef.current = 0; setPollProblem(false);
            if (more) lastIdRef.current = d.messages[d.messages.length - 1].id;
          }
        } catch { failuresRef.current += 1; if (!stopped) setPollProblem(true); }
      }
      if (!stopped) timer = setTimeout(tick, nextPollDelay(POLL_CHAT_MS, failuresRef.current));
    };
    timer = setTimeout(tick, POLL_CHAT_MS);
    const onVisible = () => { if (document.visibilityState === 'visible' && !stopped) { clearTimeout(timer); tick(); } };
    document.addEventListener('visibilitychange', onVisible);
    return () => { stopped = true; clearTimeout(timer); document.removeEventListener('visibilitychange', onVisible); };
  }, [load.status, view, applyUnread]);

  // ---- telling the server what I have read -------------------------------------------------------------------------------------
  useEffect(() => {
    if (load.status !== 'ready') return;
    const newest = messages.length ? messages[messages.length - 1].id : null;
    const lastKnown = Math.max(readRef.current, markingRef.current);
    if (!shouldMarkRead({ view, tabVisible, atBottom, newestSeenId: newest, lastReadId: lastKnown })) return;
    markingRef.current = newest;
    api.chatRead(newest)
      .then((d) => { readRef.current = Math.max(readRef.current, d.lastReadMessageId); applyUnread(d); })
      .catch(() => { markingRef.current = readRef.current; }); // not marked: it will be tried again on the next change
  }, [messages, atBottom, tabVisible, view, load.status, applyUnread]);

  async function loadOlder() {
    const first = messages[0]; if (!first || olderState.loading) return;
    setOlderState({ loading: true, error: '' });
    try {
      const d = await api.chatMessages(`kind=${view}&limit=${PAGE}&before=${first.id}`);
      prependRef.current = listRef.current ? listRef.current.scrollHeight : null;
      setMessages((cur) => mergeMessages(d.messages, cur)); setHasMore(d.hasMore); setOlderState({ loading: false, error: '' });
    } catch (err) { setOlderState({ loading: false, error: err.message }); }
  }

  // ---- writing and sending ---------------------------------------------------------------------------------------------------
  const trimmed = text.trim();
  const count = characterCount(trimmed);
  const tooLong = count > MAX_CHARS;
  const mq = !pickerClosed ? mentionQueryAt(text, caret) : null;
  const suggestions = mq ? filterMembers(members, mq.query) : [];
  const pickerOpen = suggestions.length > 0;

  async function doSend() {
    if (!ready || trimmed === '' || tooLong) return;
    const begun = beginSend(sendRef.current, trimmed, kind, newRequestId);
    if (!begun.attempt) return; // a send is already running
    setSend(begun.state);
    try {
      const res = await api.chatSend({ body: begun.attempt.body, kind: begun.attempt.kind, clientRequestId: begun.attempt.requestId });
      setSend(sendSucceeded());
      forceBottomRef.current = true;
      setMessages((cur) => mergeMessages(cur, [res.message]));
      setText(''); setCaret(0); setKind('message'); setPickerClosed(false);
      if (boxRef.current) boxRef.current.focus();
    } catch (err) {
      setSend(sendFailed(sendRef.current, err)); // the text stays in the box; Send again re-sends the same request, so it cannot be posted twice
    }
  }

  function pick(member) {
    if (!mq) return;
    const r = insertMention(text, caret, mq.start, member);
    setText(r.text); setCaret(r.caret); setActive(0);
    requestAnimationFrame(() => { const el = boxRef.current; if (el) { el.focus(); el.setSelectionRange(r.caret, r.caret); } });
  }

  function onKeyDown(e) {
    if (e.nativeEvent && e.nativeEvent.isComposing) return; // an input-method (e.g. Tamil, Hindi) is still composing a character
    if (pickerOpen) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => (i + 1) % suggestions.length); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => (i - 1 + suggestions.length) % suggestions.length); return; }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); pick(suggestions[Math.min(active, suggestions.length - 1)]); return; }
      if (e.key === 'Escape') { e.preventDefault(); setPickerClosed(true); return; }
    }
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); doSend(); }
  }

  const switchView = (next) => { if (next !== view) { setMessages([]); setView(next); } };
  const thread = buildThread(messages, lastReadAtOpen);
  const sending = send.pending;
  const ready = load.status === 'ready'; // writing is only possible once the conversation has loaded: a message you cannot see appear would look like it failed
  const announcing = isAdmin && kind === 'announcement';

  return (
    <div className="chat-page">
      <div className="page-head">
        <h1>Team chat</h1>
        <div className="chat-views" role="group" aria-label="Which messages to show">
          <button type="button" className="chat-view-btn" aria-pressed={view === 'all'} onClick={() => switchView('all')}>All messages</button>
          <button type="button" className="chat-view-btn" aria-pressed={view === 'announcement'} onClick={() => switchView('announcement')}>
            Announcements{unreadAnnouncements > 0 && <span className="chat-view-count"> ({unreadAnnouncements} new)</span>}
          </button>
        </div>
      </div>

      {pollProblem && <div className="chat-banner" role="status">Trying to reconnect. New messages may be delayed.</div>}

      <section className="chat-panel" aria-label="Conversation">
        <div className="chat-list" ref={listRef} onScroll={onScroll} role="log" aria-live={load.status === 'ready' ? 'polite' : 'off'} aria-relevant="additions" aria-label="Messages" tabIndex={0}>
          {load.status === 'loading' && <p className="chat-state">Loading messages…</p>}
          {load.status === 'error' && (
            <div className="chat-state chat-state-error" role="alert">
              <strong>Could not load messages.</strong> {load.message}{' '}
              <button type="button" className="chat-link-btn" onClick={loadInitial}>Try again</button>
            </div>
          )}
          {load.status === 'ready' && (
            <>
              {hasMore && (
                <div className="chat-older">
                  <button type="button" className="chat-link-btn" onClick={loadOlder} disabled={olderState.loading}>{olderState.loading ? 'Loading…' : 'Show earlier messages'}</button>
                  {olderState.error && <p className="chat-error" role="alert">Could not load earlier messages: {olderState.error}</p>}
                </div>
              )}
              {messages.length === 0 && <p className="chat-state">{view === 'announcement' ? 'No announcements yet.' : 'No messages yet. Say hello to your team!'}</p>}
              <ul className="chat-thread">
                {thread.map((item) => {
                  if (item.type === 'day') return <li key={item.key} className="chat-day"><span>{item.label}</span></li>;
                  if (item.type === 'new') return <li key={item.key} className="chat-new"><span>New messages</span></li>;
                  return <MessageItem key={item.key} m={item.message} viewerId={user.id} />;
                })}
              </ul>
            </>
          )}
        </div>
        {newBelow && <button type="button" className="chat-jump" onClick={() => { scrollToBottom(); atBottomRef.current = true; setAtBottom(true); setNewBelow(false); }}>New messages below ↓</button>}

        {view === 'all' ? (
          <form className={'chat-composer' + (announcing ? ' chat-composer-announcement' : '')} onSubmit={(e) => { e.preventDefault(); doSend(); }} noValidate>
            {isAdmin && (
              <label className="chat-announce-toggle">
                <input type="checkbox" checked={kind === 'announcement'} onChange={(e) => setKind(e.target.checked ? 'announcement' : 'message')} disabled={sending || !ready} />
                <span>Send as an announcement to the whole team</span>
              </label>
            )}
            <div className="chat-compose-row">
              <div className="chat-box-wrap">
                <label htmlFor="chat-text" className="sr-only">{announcing ? 'Announcement' : 'Message'}</label>
                <textarea
                  id="chat-text" ref={boxRef} rows={2} value={text} readOnly={sending || !ready}
                  placeholder={!ready ? 'You can write once the messages have loaded.' : announcing ? 'Write an announcement for everyone…' : 'Write a message. Type @ to mention someone.'}
                  onChange={(e) => { setText(e.target.value); setCaret(e.target.selectionStart); setPickerClosed(false); setActive(0); }}
                  onKeyDown={onKeyDown} onKeyUp={(e) => setCaret(e.target.selectionStart)} onClick={(e) => setCaret(e.target.selectionStart)}
                  role="combobox" aria-multiline="true" aria-autocomplete="list" aria-expanded={pickerOpen} aria-controls="chat-mention-list" aria-haspopup="listbox"
                  aria-activedescendant={pickerOpen ? `chat-mention-${suggestions[Math.min(active, suggestions.length - 1)].id}` : undefined}
                  aria-invalid={tooLong ? 'true' : undefined} aria-describedby="chat-count chat-help"
                />
                {pickerOpen && (
                  <ul className="chat-mention-list" id="chat-mention-list" role="listbox" aria-label="People you can mention">
                    {suggestions.map((m, i) => (
                      <li key={m.id} id={`chat-mention-${m.id}`} role="option" aria-selected={i === Math.min(active, suggestions.length - 1)} className="chat-mention-option"
                        onMouseDown={(e) => { e.preventDefault(); pick(m); }}>
                        <span>{m.name}</span><span className="chat-mention-handle">@{m.handle}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <button type="submit" className="chat-send" disabled={sending || !ready || trimmed === '' || tooLong} aria-busy={sending ? 'true' : undefined}>
                {sending ? 'Sending…' : announcing ? 'Post announcement' : 'Send'}
              </button>
            </div>
            <div className="chat-composer-foot">
              <span id="chat-help" className="chat-help">Enter sends. Shift+Enter adds a new line.</span>
              <span id="chat-count" className={'chat-count' + (tooLong ? ' chat-count-over' : '')}>{count} / {MAX_CHARS}</span>
            </div>
            {tooLong && <p className="chat-error" role="alert">Too long: a message can have at most {MAX_CHARS} characters.</p>}
            {send.error && <p className="chat-error" role="alert">Not sent: {send.error}{send.retry ? ' Press Send to try again.' : ''}</p>}
          </form>
        ) : (
          <p className="chat-announce-note">Announcements are posted by admins from the “All messages” view.</p>
        )}
      </section>
    </div>
  );
}
