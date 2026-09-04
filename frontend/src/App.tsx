import React, { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import DiagnosisList from './components/DiagnosisList';
import DiagnosisDetail from './components/DiagnosisDetail';
import { fetchConfig, type AppConfig } from './api';

const GITHUB_CLIENT_ID_KEY = 'cicd-doctor-client-id';
const GITHUB_USERNAME_KEY = 'cicd-doctor-github-username';

const App: React.FC = () => {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [githubClientId, setGithubClientId] = useState<string | null>(
    () => localStorage.getItem(GITHUB_CLIENT_ID_KEY),
  );
  const [githubUsername, setGithubUsername] = useState<string | null>(
    () => localStorage.getItem(GITHUB_USERNAME_KEY),
  );

  // Fetch remote feature flags on mount
  useEffect(() => {
    fetchConfig()
      .then(setConfig)
      .catch(() => {
        // Default to all features disabled if config fetch fails
        setConfig({ features: { githubOAuth: false } });
      });
  }, []);

  // Detect OAuth callback: ?connected=true&client_id=...&username=...
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('connected') !== 'true') return;

    const callbackClientId = params.get('client_id');
    const callbackUsername = params.get('username');

    if (callbackClientId) {
      localStorage.setItem(GITHUB_CLIENT_ID_KEY, callbackClientId);
      setGithubClientId(callbackClientId);
    }

    if (callbackUsername) {
      localStorage.setItem(GITHUB_USERNAME_KEY, callbackUsername);
      setGithubUsername(callbackUsername);
    }
    // Note: URL cleanup is handled inside GitHubConnect on its own useEffect
  }, []);

  const handleGithubDisconnect = () => {
    localStorage.removeItem(GITHUB_USERNAME_KEY);
    setGithubUsername(null);
    // Keep the client ID — it is reused across features (feedback, etc.)
  };

  return (
    <BrowserRouter>
      <Routes>
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
        <Route path="/diagnoses/:id" element={<DiagnosisDetail />} />
      </Routes>
    </BrowserRouter>
  );
};

export default App;
