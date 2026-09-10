import { NavLink, Navigate, Route, Routes } from 'react-router-dom';
import { SessionProvider, useSession } from './lib/session';
import { api } from './lib/api';
import { LoginPage } from './pages/LoginPage';
import { DashboardPage } from './pages/DashboardPage';
import { ShopsPage } from './pages/ShopsPage';
import { PlansPage } from './pages/PlansPage';
import { PlanEditorPage } from './pages/PlanEditorPage';
import { RunsPage } from './pages/RunsPage';
import { RunDetailPage } from './pages/RunDetailPage';
import { SettingsPage } from './pages/SettingsPage';
import { Spinner } from './components/ui';

export function App() {
  return (
    <SessionProvider>
      <Shell />
    </SessionProvider>
  );
}

function Shell() {
  const { user, loading } = useSession();

  if (loading) {
    return (
      <div className="auth-screen">
        <Spinner />
      </div>
    );
  }
  if (!user) return <LoginPage />;

  return (
    <div className="app">
      <Sidebar />
      <main className="content">
        <Routes>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/shops" element={<ShopsPage />} />
          <Route path="/plaene" element={<PlansPage />} />
          <Route path="/plaene/neu" element={<PlanEditorPage />} />
          <Route path="/plaene/:planId" element={<PlanEditorPage />} />
          <Route path="/laeufe" element={<RunsPage />} />
          <Route path="/laeufe/:runId" element={<RunDetailPage />} />
          <Route path="/einstellungen" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  );
}

function Sidebar() {
  const { user, meta, setUser } = useSession();

  const logout = async (): Promise<void> => {
    await api.logout();
    setUser(null);
  };

  return (
    <aside className="sidebar">
      <div className="brand">
        🛒
        <div>
          AutoHouse
          <small>Automatische Bestellungen</small>
        </div>
      </div>

      <nav className="nav">
        <NavLink to="/" end>
          Übersicht
        </NavLink>
        <NavLink to="/shops">Shops</NavLink>
        <NavLink to="/plaene">Bestellpläne</NavLink>
        <NavLink to="/laeufe">Läufe</NavLink>
        <NavLink to="/einstellungen">Einstellungen</NavLink>
      </nav>

      <div className="sidebar-footer">
        {meta && (
          <div>
            <span className={`badge ${meta.allowRealOrders ? 'warn' : 'ok'}`}>
              {meta.allowRealOrders ? 'Echte Bestellungen aktiv' : 'Nur Testläufe'}
            </span>
          </div>
        )}
        {meta && !meta.schedulerEnabled && <span className="badge error">Scheduler aus</span>}
        <div>{user?.displayName ?? user?.email}</div>
        <button type="button" className="small ghost" onClick={() => void logout()}>
          Abmelden
        </button>
      </div>
    </aside>
  );
}
