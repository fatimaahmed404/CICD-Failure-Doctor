import React, { useState, useEffect } from 'react';
import {
  fetchGitHubRepos,
  connectGitHubRepo,
  disconnectGitHub,
  type GitHubRepo,
  type ConnectRepoResponse,
  type ConnectRepoPartialResponse,
} from '../api';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000';

interface GitHubConnectProps {
  clientId: string | null; // kept for prop compat, not used for auth
  username: string | null;
  onDisconnect: () => void;
}

type Phase =
  | { tag: 'idle' }
  | { tag: 'loading-repos' }
  | { tag: 'picking-repo'; repos: GitHubRepo[] }
  | { tag: 'connecting'; repoFullName: string }
  | { tag: 'success'; repoFullName: string; workflowUrl: string }
  | { tag: 'partial'; repoFullName: string; message: string; manualSetupUrl: string }
  | { tag: 'error'; message: string };

const GitHubConnect: React.FC<GitHubConnectProps> = ({ clientId, username, onDisconnect }) => {
  const [phase, setPhase] = useState<Phase>({ tag: 'idle' });

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('connected') === 'true' && clientId) {
      window.history.replaceState({}, '', window.location.pathname);
      loadRepos();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId]);

  const loadRepos = async () => {
    setPhase({ tag: 'loading-repos' });
    try {
      const repos = await fetchGitHubRepos();
      setPhase({ tag: 'picking-repo', repos });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to load repositories';
      if (msg.includes('401') || msg.toLowerCase().includes('no github account')) {
        setPhase({ tag: 'idle' });
      } else {
        setPhase({ tag: 'error', message: msg });
      }
    }
  };

  const handleConnect = () => {
    window.location.href = `${API_BASE_URL}/auth/github/login`;
  };

  const handleConnectRepo = async (repoFullName: string) => {
    setPhase({ tag: 'connecting', repoFullName });
    try {
      const result = await connectGitHubRepo(repoFullName);
      if ('secretsCreated' in result) {
        const p = result as ConnectRepoPartialResponse;
        setPhase({ tag: 'partial', repoFullName, message: p.message, manualSetupUrl: p.manualSetupUrl });
      } else {
        const s = result as ConnectRepoResponse;
        setPhase({ tag: 'success', repoFullName, workflowUrl: s.workflowUrl });
      }
    } catch (err) {
      setPhase({ tag: 'error', message: err instanceof Error ? err.message : 'Failed to connect repository' });
    }
  };

  const handleDisconnect = async () => {
    try { await disconnectGitHub(); } catch (err) { console.error('Disconnect error:', err); }
    setPhase({ tag: 'idle' });
    onDisconnect();
  };

  const reset = () => setPhase({ tag: 'idle' });

  if (!username && phase.tag === 'idle') return (
    <div className="github-connect-section">
      <button onClick={handleConnect} className="github-connect-button">🔗 Connect GitHub</button>
      <p className="github-connect-hint">Automatically configure a repository with CI/CD Failure Doctor</p>
    </div>
  );

  if (username && phase.tag === 'idle') return (
    <div className="github-connect-section github-connected">
      <div className="github-connected-header">
        <span className="connected-indicator">✅ GitHub Connected</span>
        <span className="github-username">@{username}</span>
      </div>
      <div className="github-connected-actions">
        <button onClick={loadRepos} className="github-repos-button">Connect a Repository</button>
        <button onClick={handleDisconnect} className="github-disconnect-button">Disconnect</button>
      </div>
    </div>
  );

  if (phase.tag === 'loading-repos') return (
    <div className="github-connect-section"><div className="loading">Loading repositories…</div></div>
  );

  if (phase.tag === 'picking-repo') return (
    <div className="github-connect-section">
      <div className="repo-picker-header">
        <h3>Select a repository to connect</h3>
        {username && <span className="github-username">@{username}</span>}
        <button onClick={handleDisconnect} className="github-disconnect-button small">Disconnect</button>
      </div>
      {phase.repos.length === 0
        ? <p className="no-repos">No repositories with push access found.</p>
        : <div className="repo-list">
            {phase.repos.map(repo => (
              <div key={repo.full_name} className="repo-item">
                <div className="repo-info">
                  <a href={repo.html_url} target="_blank" rel="noopener noreferrer" className="repo-name">{repo.full_name}</a>
                  <span className="repo-branch">branch: <code>{repo.default_branch}</code></span>
                </div>
                <button onClick={() => handleConnectRepo(repo.full_name)} className="connect-repo-button">Connect this repo</button>
              </div>
            ))}
          </div>
      }
    </div>
  );

  if (phase.tag === 'connecting') return (
    <div className="github-connect-section"><div className="loading">Connecting <strong>{phase.repoFullName}</strong>…</div></div>
  );

  if (phase.tag === 'success') return (
    <div className="github-connect-section github-success">
      <h3>✅ Repository connected!</h3>
      <p><strong>{phase.repoFullName}</strong> is now configured.</p>
      <a href={phase.workflowUrl} target="_blank" rel="noopener noreferrer" className="workflow-link">View workflow file on GitHub ↗</a>
      <div className="github-success-actions">
        <button onClick={reset} className="github-disconnect-button small">Connect another repo</button>
      </div>
    </div>
  );

  if (phase.tag === 'partial') return (
    <div className="github-connect-section github-partial">
      <h3>⚠️ Partially connected</h3>
      <p>{phase.message}</p>
      <p style={{fontSize:'0.9rem',color:'#555',marginTop:8}}>
        Secrets were created. Add the workflow file manually by creating{' '}
        <code>.github/workflows/cicd-failure-doctor.yml</code> in your repo.
      </p>
      <button onClick={reset} className="github-disconnect-button small">Close</button>
    </div>
  );

  if (phase.tag === 'error') return (
    <div className="github-connect-section github-error">
      <p>❌ {phase.message}</p>
      <button onClick={reset} className="github-disconnect-button small">Try again</button>
    </div>
  );

  return null;
};

export default GitHubConnect;
