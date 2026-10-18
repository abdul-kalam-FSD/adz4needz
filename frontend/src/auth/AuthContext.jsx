import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { api, setUnauthorizedHandler } from '../api/client.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [status, setStatus] = useState('loading'); // loading | ready | error
  // Why the person is back at the login screen: 'signed_out' (they chose to) or 'expired' (the server ended the session). Shown once, then cleared.
  const [notice, setNotice] = useState(null);
  const userRef = useRef(null);
  userRef.current = user;

  // Any protected API call answered "not logged in" while someone was signed in means the session ended: return to the login screen.
  useEffect(() => {
    setUnauthorizedHandler(() => { if (userRef.current) { setUser(null); setNotice('expired'); } });
    return () => setUnauthorizedHandler(null);
  }, []);

  useEffect(() => {
    let active = true;
    api.me()
      .then((data) => { if (active) { setUser(data.user); setStatus('ready'); } })
      .catch((err) => {
        if (!active) return;
        setUser(null);
        // 401 just means "not logged in". Anything else means we could not check.
        setStatus(err.status === 401 ? 'ready' : 'error');
      });
    return () => { active = false; };
  }, []);

  const login = useCallback(async (employeeId, password, portal) => {
    const data = await api.login(employeeId, password, portal);
    setNotice(null);
    setUser(data.user);
    return data.user;
  }, []);

  const logout = useCallback(async () => {
    try { await api.logout(); } finally { setUser(null); setNotice('signed_out'); }
  }, []);
  const clearNotice = useCallback(() => setNotice(null), []);

  const value = useMemo(() => ({ user, status, notice, clearNotice, login, logout }), [user, status, notice, clearNotice, login, logout]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
