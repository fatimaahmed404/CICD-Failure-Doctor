import React, { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate, Outlet, Link, useNavigate } from 'react-router-dom';
import DiagnosisList from './components/DiagnosisList';
import DiagnosisDetail from './components/DiagnosisDetail';
import LoginPage from './pages/LoginPage';
import SignupPage from './pages/SignupPage';
import DemoPage from './pages/DemoPage';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { fetchConfig, type AppConfig } from './api';

const GITHUB_CLIENT_ID_KEY = 'cicd-doctor-client-id';
const GITHUB_USERNAME_KEY = 'cicd-doctor-github-username';

/** Loading → spinner, no user → /login, user → children. */
const PrivateRoute: React.FC = () => {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', color: '#7f8c8d' }}>
        Loading…
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace />;
  return <Outlet />;
};

/** Top bar: shows email + webhook secret + logout when authenticated, signup CTA when not. */
const AppHeader: React.FC = () => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [copied, setCopied] = React.useState(false);

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  const handleCopy = async () => {
    if (!user?.webhookSecret) return;
    try {
      await navigator.clipboard.writeText(user.webhookSecret);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard not available
    }
  };

  return (
    <div className="app-header-bar">
      {user ? (
        <div className="app-header-auth">
          <span className="app-header-email" title={user.email}>{user.email}</span>
          <div className="app-header-secret-row" title="Your personal webhook secret">
            <span className="app-header-secret-label">Webhook secret:</span>
            <code className="app-header-secret-value">{user.webhookSecret}</code>
            <button onClick={handleCopy} className="app-header-copy-button">
              {copied ? '✓' : 'Copy'}
            </button>
          </div>
          <button onClick={handleLogout} className="app-header-logout-button">Log out</button>
        </div>
      ) : (
        <div className="app-header-auth">
          <Link to="/signup" className="app-header-signup-cta">
            Sign up to save your history privately
          </Link>
        </div>
      )}
    </div>
  );
};

/** Main routes — rendered inside AuthProvider. */
const AppRoutes: React.FC = () => {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [githubClientId, setGithubClientId] = useState<string | null>(
    () => localStorage.getItem(GITHUB_CLIENT_ID_KEY),
  );
  const [githubUsername, setGithubUsername] = useState<string | null>(
    () => localStorage.getItem(GITHUB_USERNAME_KEY),
  );

  useEffect(() => {
    fetchConfig()
      .then(setConfig)
      .catch(() => setConfig({ features: { githubOAuth: false } }));
  }, []);

  // Detect OAuth callback: ?connected=true&client_id=...&username=...
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('connected') !== 'true') return;
    const cid = params.get('client_id');
    const uname = params.get('username');
    if (cid) { localStorage.setItem(GITHUB_CLIENT_ID_KEY, cid); setGithubClientId(cid); }
    if (uname) { localStorage.setItem(GITHUB_USERNAME_KEY, uname); setGithubUsername(uname); }
  }, []);

  const handleGithubDisconnect = () => {
    localStorage.removeItem(GITHUB_USERNAME_KEY);
    setGithubUsername(null);
  };

  return (
    <>
      <AppHeader />
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/signup" element={<SignupPage />} />
        <Route path="/demo" element={<DemoPage />} />
        <Route path="/diagnoses/:id" element={<DiagnosisDetail />} />
        <Route element={<PrivateRoute />}>
          <Route
            path="/"
            element={
              <DiagnosisList
                githubOAuthEnabled={config?.features.githubOAuth ?? false}
                githubClientId={githubClientId}
                githubUsername={githubUsername}
                onGithubDisconnect={handleGithubDisconnect}
              />
            }
          />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </>
  );
};

const App: React.FC = () => (
  <BrowserRouter>
    <AuthProvider>
      <AppRoutes />
    </AuthProvider>
  </BrowserRouter>
);

export default App;
