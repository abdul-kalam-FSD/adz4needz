import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from './AuthContext.jsx';

// The server enforces access on every API call. These guards only decide what the screen shows.
export function RequireAuth({ children }) {
  const { user, status } = useAuth();
  const location = useLocation();
  if (status === 'loading') return <div className="fullpage-message"><p>Loading…</p></div>;
  if (status === 'error') {
    return (
      <div className="fullpage-message">
        <p>Could not reach the server.</p>
        <button type="button" className="btn btn-primary" onClick={() => window.location.reload()}>Try again</button>
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return children;
}

export function RequireRole({ role, children }) {
  const { user } = useAuth();
  if (user && user.role !== role) return <Navigate to="/" replace />;
  return children;
}
