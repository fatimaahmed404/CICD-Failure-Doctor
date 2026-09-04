/**
 * GitHubConnect component
 *
 * Handles the GitHub OAuth repository connection flow:
 *  1. "Connect GitHub" button → redirect to /auth/github/login
 *  2. Connected state → show username + repo picker + disconnect button
 *  3. Repo picker → connect repo → show confirmation
 *
 * Requirements: 17.11, 17.12, 17.13, 17.20
 */

import React, { useState, useEffect } from 'react';
import {
  fetchGitHubRepos,
  connectGitHubRepo,
  disconnectGitHub,
  getOrCreateClientId,
  type GitHubRepo,
  type ConnectRepoResponse,
  type ConnectRepoPartialResponse,
} from '../api';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000';

interface GitHubConnectProps {
  /** Anonymous client ID from localStorage; null means not yet generated */
  clientId: string | null;
  /** GitHub username if connected via OAuth, null otherwise */
  username: string | null;
  /** Called after the user clicks Disconnect and the token is cleared */
  onDisconnect: () => void;
}

type InternalPhase =
  | { tag: 'idle' }
  | { tag: 'loading-repos' }
  | { tag: 'picking-repo'; repos: GitHubRepo[] }
  | { tag: 'connecting'; repoFullName: string }
  | { tag: 'success'; repoFullName: string; workflowUrl: string }
  | { tag: 'partial'; repoFullName: string; message: string; manualSetupUrl: string }
  | { tag: 'error'; message: string };

const GitHubConnect: React.FC<GitHubConnectProps> = ({ clientId, username, onDisconnect }) => {
  const [phase, setPhase] = useState<InternalPhase>({ tag: 'idle' });

  // When loaded after OAuth callback (detected by ?connected=true), go straight to repo picker
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const isCallback = params.get('connected') === 'true';

    if (isCallback && clientId) {
      // Clean URL without reload
      window.history.replaceState({}, '', window.location.pathname);
      loadRepos(clientId);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId]);

  const loadRepos = async (cid: string) => {
    setPhase({ tag: 'loading-repos' });
    try {
      const repos = await fetchGitHubRepos(cid);
      setPhase({ tag: 'picking-repo', repos });
    } catch (err) {
      setPhase({
        tag: 'error',
        message: err instanceof Error ? err.message : 'Failed to load repositories',
      });
    }
  };

  // ── Handlers ──────────────────────────────────────────────────────────────

  const handleConnect = () => {
    // Req 17.11: navigate user to /auth/github/login
    const cid = clientId ?? getOrCreateClientId();
    window.location.href = `${API_BASE_URL}/auth/github/login?client_id=${encodeURIComponent(cid)}`;
  };

  const handleShowRepos = () => {
    if (!clientId) return;
    loadRepos(clientId);
  };

  const handleConnectRepo = async (repoFullName: string) => {
    if (!clientId) return;
    setPhase({ tag: 'connecting', repoFullName });
    try {
      const result = await connectGitHubRepo(clientId, repoFullName);

      // Partial success: secrets were created but workflow file creation failed (HTTP 207)
      if ('secretsCreated' in result) {
        const partial = result as ConnectRepoPartialResponse;
        setPhase({
          tag: 'partial',
          repoFullName,
          message: partial.message,
          manualSetupUrl: partial.manualSetupUrl,
        });
      } else {
        // Full success: both secrets and workflow file created (HTTP 200)
        const success = result as ConnectRepoResponse;
        setPhase({
          tag: 'success',
          repoFullName,
          workflowUrl: success.workflowUrl,
        });
      }
    } catch (err) {
      setPhase({
        tag: 'error',
        message: err instanceof Error ? err.message : 'Failed to connect repository',
      });
    }
  };

  const handleDisconnect = async () => {
    if (!clientId) return;
    try {
      await disconnectGitHub(clientId);
    } catch (err) {
      console.error('Disconnect error:', err);
    } finally {
      setPhase({ tag: 'idle' });
      onDisconnect();
    }
  };

  const handleReset = () => setPhase({ tag: 'idle' });

  // ── Render: not connected ──────────────────────────────────────────────────

  if (!username && phase.tag === 'idle') {
    return (
      <div className="github-connect-section">
        <button onClick={handleConnect} className="github-connect-button">
          <span>🔗</span> Connect GitHub
        </button>
        <p className="github-connect-hint">
          Automatically configure a repository with CI/CD Failure Doctor
        </p>
      </div>
    );
  }

  // ── Render: connected (idle, show username + actions) ─────────────────────

  if (username && phase.tag === 'idle') {
    return (
      <div className="github-connect-section github-connected">
        <div className="github-connected-header">
          <span className="connected-indicator">✅ GitHub Connected</span>
          <span className="github-username">@{username}</span>
        </div>
        <div className="github-connected-actions">
          <button onClick={handleShowRepos} className="github-repos-button">
            Connect a Repository
          </button>
          <button onClick={handleDisconnect} className="github-disconnect-button">
            Disconnect
          </button>
        </div>
      </div>
    );
  }

  // ── Render: loading repos ──────────────────────────────────────────────────

  if (phase.tag === 'loading-repos') {
    return (
      <div className="github-connect-section">
        <div className="loading">Loading repositories…</div>
      </div>
    );
  }

  // ── Render: repository picker ──────────────────────────────────────────────

  if (phase.tag === 'picking-repo') {
    return (
      <div className="github-connect-section">
        <div className="repo-picker-header">
          <h3>Select a repository to connect</h3>
          {username && (
            <span className="github-username">Connected as @{username}</span>
          )}
          <button onClick={handleDisconnect} className="github-disconnect-button small">
            Disconnect
          </button>
        </div>
        {phase.repos.length === 0 ? (
          <p className="no-repos">No repositories with push access found.</p>
        ) : (
          <div className="repo-list">
            {phase.repos.map((repo) => (
              <div key={repo.full_name} className="repo-item">
                <div className="repo-info">
                  <a
                    href={repo.html_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="repo-name"
                  >
                    {repo.full_name}
                  </a>
                  <span className="repo-branch">
                    branch: <code>{repo.default_branch}</code>
                  </span>
                </div>
                <button
                  onClick={() => handleConnectRepo(repo.full_name)}
                  className="connect-repo-button"
                >
                  Connect this repo
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  // ── Render: connecting ─────────────────────────────────────────────────────

  if (phase.tag === 'connecting') {
    return (
      <div className="github-connect-section">
        <div className="loading">
          Connecting <strong>{phase.repoFullName}</strong>…
        </div>
      </div>
    );
  }

  // ── Render: full success ───────────────────────────────────────────────────

  if (phase.tag === 'success') {
    return (
      <div className="github-connect-section github-success">
        <h3>✅ Repository connected!</h3>
        <p>
          <strong>{phase.repoFullName}</strong> is now configured to send failed
          build logs to CI/CD Failure Doctor.
        </p>
        <a
          href={phase.workflowUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="workflow-link"
        >
          View workflow file on GitHub ↗
        </a>
        <div className="github-success-actions">
          <button onClick={handleReset} className="github-disconnect-button small">
            Connect another repo
          </button>
        </div>
      </div>
    );
  }

  // ── Render: partial success (secrets created, workflow failed) ─────────────

  if (phase.tag === 'partial') {
    return (
      <div className="github-connect-section github-partial">
        <h3>⚠️ Partially connected</h3>
        <p>{phase.message}</p>
        <a
          href={phase.manualSetupUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="workflow-link"
        >
          View manual setup instructions ↗
        </a>
        <button onClick={handleReset} className="github-disconnect-button small">
          Close
        </button>
      </div>
    );
  }

  // ── Render: error ──────────────────────────────────────────────────────────

  if (phase.tag === 'error') {
    return (
      <div className="github-connect-section github-error">
        <p>❌ {phase.message}</p>
        <button onClick={handleReset} className="github-disconnect-button small">
          Try again
        </button>
      </div>
    );
  }

  return null;
};

export default GitHubConnect;
