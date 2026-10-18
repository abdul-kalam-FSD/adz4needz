import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api/client.js';
import { POLL_BADGE_MS, nextPollDelay } from '../lib/chat.js';

// Unread chat counts for the menu badge, available on every page. Polls a very small endpoint every 30 seconds (slower after errors, paused
// while the tab is hidden). The chat page also feeds it from its own responses, so the badge changes the moment messages are read.
const ChatUnreadContext = createContext({ unread: 0, mentions: 0, announcements: 0, apply: () => {}, refresh: async () => false });
export const useChatUnread = () => useContext(ChatUnreadContext);

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

export function ChatUnreadProvider({ children }) {
  const [counts, setCounts] = useState({ unread: 0, mentions: 0, announcements: 0 });
  const failures = useRef(0);

  // Accepts any chat response that carries { unread: { unread, mentions, announcements } }.
  const apply = useCallback((state) => {
    if (!state || !state.unread) return;
    setCounts({ unread: num(state.unread.unread), mentions: num(state.unread.mentions), announcements: num(state.unread.announcements) });
  }, []);

  const refresh = useCallback(async () => {
    try { apply(await api.chatUnread()); failures.current = 0; return true; }
    catch { failures.current += 1; return false; } // the badge simply stays as it was; a failure is never shown as "0 unread"
  }, [apply]);

  useEffect(() => {
    let stopped = false; let timer = null;
    const tick = async () => {
      if (document.visibilityState === 'visible') await refresh();
      if (!stopped) timer = setTimeout(tick, nextPollDelay(POLL_BADGE_MS, failures.current));
    };
    const onVisible = () => { if (document.visibilityState === 'visible' && !stopped) { clearTimeout(timer); tick(); } };
    document.addEventListener('visibilitychange', onVisible);
    tick();
    return () => { stopped = true; clearTimeout(timer); document.removeEventListener('visibilitychange', onVisible); };
  }, [refresh]);

  const value = useMemo(() => ({ ...counts, apply, refresh }), [counts, apply, refresh]);
  return <ChatUnreadContext.Provider value={value}>{children}</ChatUnreadContext.Provider>;
}
