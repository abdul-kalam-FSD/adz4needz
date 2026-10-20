import { useCallback, useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext.jsx';
import { ChatUnreadProvider, useChatUnread } from './ChatUnreadContext.jsx';
import { unreadLabel } from '../lib/chat.js';
import { useStackedTables } from './useStackedTables.js';

// The menu is a drawer at or below this width (must match the 768px breakpoint in styles.css)
const DRAWER_QUERY = '(max-width: 768px)';

// Menu icons: simple 24x24 outline glyphs, decorative only (the text label next to each one is what screen readers read).
// Shell look (all in styles.css, section 2): white top bar and light sidebar, each with a 1px border; navy text; teal selected state.
const ICONS = {
  dashboard: <><rect x="3" y="3" width="7" height="9" rx="1" /><rect x="14" y="3" width="7" height="5" rx="1" /><rect x="14" y="12" width="7" height="9" rx="1" /><rect x="3" y="16" width="7" height="5" rx="1" /></>,
  chat: <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />,
  users: <><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></>,
  briefcase: <><rect x="2" y="7" width="20" height="14" rx="2" /><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" /></>,
  target: <><circle cx="12" cy="12" r="10" /><circle cx="12" cy="12" r="6" /><circle cx="12" cy="12" r="2" /></>,
  calendarCheck: <><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" /><path d="m9 16 2 2 4-4" /></>,
  calendar: <><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" /></>,
  card: <><rect x="2" y="5" width="20" height="14" rx="2" /><path d="M2 10h20" /></>,
  upload: <><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><path d="m17 8-5-5-5 5" /><path d="M12 3v12" /></>,
  chart: <><path d="M3 3v18h18" /><path d="M7 16v-5M12 16V7M17 16v-8" /></>,
  user: <><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></>,
  phone: <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z" />,
  fileText: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6M16 13H8M16 17H8M10 9H8" /></>,
  menu: <path d="M4 6h16M4 12h16M4 18h16" />
};
function Icon({ name, className }) {
  return <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">{ICONS[name]}</svg>;
}

// Initials for the round avatar in the top bar (decorative: the full name is next to it, or in the label on small screens).
function initials(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  return ((parts[0] || '?')[0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}

// The "Team chat" menu entry with its unread badge. The badge text is for the eye; the label says the same thing in words for screen readers.
function ChatNavLink({ onNavigate }) {
  const { unread, mentions } = useChatUnread();
  const label = unreadLabel(unread);
  const words = unread > 0 ? `, ${unread} unread${mentions > 0 ? `, ${mentions} mention${mentions === 1 ? '' : 's'} of you` : ''}` : '';
  return (
    <li>
      <NavLink to="/chat" className={({ isActive }) => 'nav-item' + (isActive ? ' is-current' : '')} onClick={onNavigate} aria-label={'Team chat' + words}>
        <Icon name="chat" className="nav-icon" />
        <span className="nav-label">Team chat</span>
        {label && <span className={'nav-badge' + (mentions > 0 ? ' nav-badge-mention' : '')} aria-hidden="true">{mentions > 0 ? '@ ' : ''}{label}</span>}
      </NavLink>
    </li>
  );
}

export default function AppShell() {
  const { user, logout } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const menuButtonRef = useRef(null);
  const navRef = useRef(null);
  const mainRef = useRef(null);
  const { pathname } = useLocation();
  const firstRender = useRef(true);
  useStackedTables(mainRef);

  // Close the drawer; with returnFocus the keyboard user lands back on the menu button they opened it with.
  const closeMenu = useCallback((returnFocus) => { setMenuOpen(false); if (returnFocus && menuButtonRef.current) menuButtonRef.current.focus(); }, []);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') closeMenu(true); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [closeMenu]);

  // While the drawer is open: the page behind it does not scroll, focus starts inside the menu, and a window resized up to desktop
  // width closes it (there it is a normal sidebar, so an "open" flag would only leave a stale aria-expanded behind).
  useEffect(() => {
    if (!menuOpen) return undefined;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const first = navRef.current && navRef.current.querySelector('a');
    if (first) first.focus();
    const mql = window.matchMedia(DRAWER_QUERY);
    const onChange = () => { if (!mql.matches) setMenuOpen(false); };
    mql.addEventListener('change', onChange);
    return () => { document.body.style.overflow = previous; mql.removeEventListener('change', onChange); };
  }, [menuOpen]);

  // After a page change, keyboard and screen-reader users start at the new page's content instead of on a link that has just left the screen.
  useEffect(() => {
    if (firstRender.current) { firstRender.current = false; return; }
    if (mainRef.current) mainRef.current.focus({ preventScroll: true });
  }, [pathname]);

  async function handleLogout() {
    if (loggingOut) return;
    setLoggingOut(true);
    try { await logout(); } catch { /* session is cleared on the client either way */ }
  }

  const link = (to, label, icon) => (
    <li>
      <NavLink to={to} className={({ isActive }) => 'nav-item' + (isActive ? ' is-current' : '')} onClick={() => setMenuOpen(false)}>
        <Icon name={icon} className="nav-icon" />
        <span className="nav-label">{label}</span>
      </NavLink>
    </li>
  );

  return (
    <ChatUnreadProvider>
      <a className="skip-link" href="#main-content">Skip to main content</a>
      <header className="topbar">
        <button type="button" ref={menuButtonRef} className="menu-button" aria-controls="sidebar" aria-expanded={menuOpen} onClick={() => setMenuOpen((o) => !o)}>
          <Icon name="menu" />
          <span className="sr-only">Menu</span>
        </button>
        <span className="brand">
          <span className="brand-logo" aria-hidden="true">A4</span>
          <span className="brand-text"><span className="brand-name">ADZ4NEEDZ</span><span className="brand-sub">BDE Team Management</span></span>
        </span>
        <div className="topbar-right">
          <div className="user" title={`${user.name} / ${user.employeeId}`}>
            <span className="avatar" aria-hidden="true">{initials(user.name)}</span>
            <span className="user-meta"><span className="user-name">{user.name}</span><span className="user-id">{user.employeeId}</span></span>
          </div>
          <button type="button" className="btn btn-quiet" onClick={handleLogout} disabled={loggingOut}>{loggingOut ? 'Logging out…' : 'Logout'}</button>
        </div>
      </header>
      <div className="layout">
        <nav ref={navRef} className={'sidebar' + (menuOpen ? ' is-open' : '')} id="sidebar" aria-label="Main navigation">
          <ul>
            {user.role === 'bde' ? (
              <>
                {link('/dashboard', 'Dashboard', 'dashboard')}
                <ChatNavLink onNavigate={() => setMenuOpen(false)} />
                {link('/call-desk', 'Call desk', 'phone')}
                {link('/daily-report', 'Daily Report', 'fileText')}
                {link('/leads', 'Leads', 'target')}
                {link('/interviews', 'Interviews', 'calendarCheck')}
                {link('/payments', 'Payments', 'card')}
                {link('/monthly', 'My Month', 'calendar')}
                {link('/profile', 'Profile', 'user')}
              </>
            ) : (
              <>
                <li>
                  <NavLink to="/admin" end className={({ isActive }) => 'nav-item' + (isActive ? ' is-current' : '')} onClick={() => setMenuOpen(false)}>
                    <Icon name="dashboard" className="nav-icon" />
                    <span className="nav-label">Dashboard</span>
                  </NavLink>
                </li>
                <ChatNavLink onNavigate={() => setMenuOpen(false)} />
                {link('/admin/bdes', 'BDEs', 'users')}
                {link('/admin/employees', 'Employees', 'briefcase')}
                {link('/admin/leads', 'Leads', 'target')}
                {link('/admin/assign', 'Assign Leads', 'users')}
                {link('/admin/interviews', 'Interviews', 'calendarCheck')}
                {link('/admin/payments', 'Payments', 'card')}
                {link('/admin/import', 'Import Leads', 'upload')}
                {link('/admin/reports', 'Reports', 'chart')}
                {link('/admin/activity', 'Activity', 'fileText')}
                {link('/profile', 'Profile', 'user')}
              </>
            )}
          </ul>
        </nav>
        {menuOpen && <div className="scrim" aria-hidden="true" onClick={() => closeMenu(true)} />}
        <main ref={mainRef} className="content" id="main-content" tabIndex={-1} inert={menuOpen ? '' : undefined}><Outlet /></main>
      </div>
    </ChatUnreadProvider>
  );
}
