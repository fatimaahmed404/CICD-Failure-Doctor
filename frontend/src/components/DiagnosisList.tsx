import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import type { DiagnosisSummary, SimulationScenario } from '../types';
import GitHubConnect from './GitHubConnect';
import OnboardingCard from './OnboardingCard';
import { fetchDiagnoses as apiFetchDiagnoses, postSimulate } from '../api';

const POLL_INTERVAL_MS = 3000;

const SIMULATION_SCENARIOS: SimulationScenario[] = [
  'test-failure',
  'dependency-error',
  'docker-build-failure',
  'env-var-missing',
  'timeout',
  'lint-error',
];

interface DiagnosisListProps {
  /** Whether the GitHub OAuth integration is available. Req 17.2, 17.11 */
  githubOAuthEnabled?: boolean;
  /** Anonymous client ID (also used as GitHub OAuth identity). Req 17.4 */
  githubClientId?: string | null;
  /** GitHub username if connected, null otherwise. Req 17.20 */
  githubUsername?: string | null;
  /** Called when the user disconnects their GitHub account. Req 17.20 */
  onGithubDisconnect?: () => void;
}

const DiagnosisList: React.FC<DiagnosisListProps> = ({
  githubOAuthEnabled = false,
  githubClientId = null,
  githubUsername = null,
  onGithubDisconnect = () => {},
}) => {
  const navigate = useNavigate();
  const [diagnoses, setDiagnoses] = useState<DiagnosisSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedScenario, setSelectedScenario] = useState<SimulationScenario>('test-failure');
  const [simulateLoading, setSimulateLoading] = useState(false);

  const loadDiagnoses = useCallback(async () => {
    try {
      const data = await apiFetchDiagnoses();
      setDiagnoses(data.data);
      setError(null);
      setLoading(false);
    } catch (err) {
      console.error('Poll error:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch diagnoses');
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadDiagnoses();
  }, [loadDiagnoses]);

  useEffect(() => {
    const intervalId = setInterval(loadDiagnoses, POLL_INTERVAL_MS);
    return () => clearInterval(intervalId);
  }, [loadDiagnoses]);

  const handleSimulate = async () => {
    setSimulateLoading(true);
    try {
      await postSimulate(selectedScenario);
      await loadDiagnoses();
    } catch (err) {
      console.error('Simulate error:', err);
      alert(err instanceof Error ? err.message : 'Failed to simulate build');
    } finally {
      setSimulateLoading(false);
    }
  };

  const handleRowClick = (id: string) => navigate(`/diagnoses/${id}`);

  const renderStatusBadge = (status: DiagnosisSummary['status']) => {
    const colors = {
      pending: 'bg-yellow-500',
      complete: 'bg-green-500',
      unavailable: 'bg-red-500',
    };
    return <span className={`status-badge ${colors[status]}`}>{status}</span>;
  };

  const renderCategoryBadge = (category: DiagnosisSummary['category']) => {
    if (!category) return <span className="category-badge bg-gray-400">Uncategorized</span>;
    const categoryColors: Record<string, string> = {
      'dependency-build-error': 'bg-purple-500',
      'test-failure': 'bg-red-500',
      'docker-build-failure': 'bg-blue-500',
      'env-var-secrets': 'bg-orange-500',
      'timeout-infrastructure': 'bg-yellow-600',
      'syntax-lint-error': 'bg-pink-500',
      unknown: 'bg-gray-500',
    };
    return (
      <span className={`category-badge ${categoryColors[category] || 'bg-gray-500'}`}>
        {category}
      </span>
    );
  };

  const truncateSha = (sha: string) => sha.substring(0, 7);
  const formatDate = (dateStr: string) => new Date(dateStr).toLocaleString();

  return (
    <div className="container">
      <header className="header">
        <h1>CI/CD Failure Doctor</h1>
        <p className="subtitle">Automated AI-powered build failure diagnosis</p>
      </header>

      {/* Onboarding card — shows webhook secret for new users */}
      <OnboardingCard />

      {/* GitHub Connect — only shown when feature flag is on (Req 17.11) */}
      {githubOAuthEnabled && (
        <GitHubConnect
          clientId={githubClientId}
          username={githubUsername}
          onDisconnect={onGithubDisconnect}
        />
      )}

      {/* Simulate Failed Build Section */}
      <div className="simulate-section">
        <h2>Simulate Failed Build</h2>
        <div className="simulate-controls">
          <select
            value={selectedScenario}
            onChange={(e) => setSelectedScenario(e.target.value as SimulationScenario)}
            className="scenario-select"
            disabled={simulateLoading}
          >
            {SIMULATION_SCENARIOS.map((scenario) => (
              <option key={scenario} value={scenario}>
                {scenario}
              </option>
            ))}
          </select>
          <button
            onClick={handleSimulate}
            disabled={simulateLoading}
            className="simulate-button"
          >
            {simulateLoading ? 'Simulating...' : 'Simulate Failed Build'}
          </button>
        </div>
      </div>

      {/* Error banner (non-blocking) */}
      {error && <div className="error-banner">⚠️ {error}</div>}

      {/* Diagnoses List */}
      <div className="diagnoses-section">
        <h2>Recent Diagnoses</h2>
        {loading && diagnoses.length === 0 ? (
          <div className="loading">Loading diagnoses...</div>
        ) : diagnoses.length === 0 ? (
          <div className="empty-state">
            No diagnoses yet. Click "Simulate Failed Build" to create one!
          </div>
        ) : (
          <div className="diagnoses-table">
            <table>
              <thead>
                <tr>
                  <th>Repo</th>
                  <th>Job</th>
                  <th>Commit</th>
                  <th>Source</th>
                  <th>Status</th>
                  <th>Category</th>
                  <th>Created</th>
                </tr>
              </thead>
              <tbody>
                {diagnoses.map((diagnosis) => (
                  <tr
                    key={diagnosis.id}
                    onClick={() => handleRowClick(diagnosis.id)}
                    className="diagnosis-row"
                  >
                    <td>{diagnosis.repoName}</td>
                    <td>{diagnosis.jobName}</td>
                    <td className="commit-sha">{truncateSha(diagnosis.commitSha)}</td>
                    <td>
                      <span className="source-badge">{diagnosis.source}</span>
                    </td>
                    <td>{renderStatusBadge(diagnosis.status)}</td>
                    <td>{renderCategoryBadge(diagnosis.category)}</td>
                    <td className="timestamp">{formatDate(diagnosis.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

export default DiagnosisList;
