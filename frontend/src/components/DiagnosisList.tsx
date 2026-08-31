import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import type { DiagnosisSummary, SimulationScenario } from '../types';

// API base URL - defaults to localhost:3000 for development
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000';

const POLL_INTERVAL_MS = 3000; // 3 seconds

const SIMULATION_SCENARIOS: SimulationScenario[] = [
  "test-failure",
  "dependency-error",
  "docker-build-failure",
  "env-var-missing",
  "timeout",
  "lint-error",
];

const DiagnosisList: React.FC = () => {
  const navigate = useNavigate();
  const [diagnoses, setDiagnoses] = useState<DiagnosisSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedScenario, setSelectedScenario] = useState<SimulationScenario>("test-failure");
  const [simulateLoading, setSimulateLoading] = useState(false);

  // Fetch diagnoses from API
  const fetchDiagnoses = useCallback(async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/diagnoses`);
      if (!response.ok) {
        throw new Error(`Failed to fetch diagnoses: ${response.statusText}`);
      }
      const data = await response.json();
      setDiagnoses(data.data);
      setError(null); // Clear error on successful fetch
      setLoading(false);
    } catch (err) {
      // On poll failure: retain current list and show non-blocking error (Req 8.10)
      console.error('Poll error:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch diagnoses');
      setLoading(false);
    }
  }, []);

  // Initial fetch
  useEffect(() => {
    fetchDiagnoses();
  }, [fetchDiagnoses]);

  // Polling every 3 seconds (Req 8.1)
  useEffect(() => {
    const intervalId = setInterval(() => {
      fetchDiagnoses();
    }, POLL_INTERVAL_MS);

    return () => clearInterval(intervalId);
  }, [fetchDiagnoses]);

  // Handle simulate failed build
  const handleSimulate = async () => {
    setSimulateLoading(true);
    try {
      const response = await fetch(`${API_BASE_URL}/simulate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ scenario: selectedScenario }),
      });

      if (!response.ok) {
        throw new Error(`Simulation failed: ${response.statusText}`);
      }

      const result = await response.json();
      console.log('Simulation created:', result);
      
      // The new pending row will appear within one polling cycle (Req 8.8)
      // Trigger immediate fetch to reduce perceived delay
      await fetchDiagnoses();
    } catch (err) {
      console.error('Simulate error:', err);
      alert(err instanceof Error ? err.message : 'Failed to simulate build');
    } finally {
      setSimulateLoading(false);
    }
  };

  // Navigate to detail view on row click
  const handleRowClick = (id: string) => {
    navigate(`/diagnoses/${id}`);
  };

  // Render status badge
  const renderStatusBadge = (status: DiagnosisSummary['status']) => {
    const colors = {
      pending: 'bg-yellow-500',
      complete: 'bg-green-500',
      unavailable: 'bg-red-500',
    };
    return (
      <span className={`status-badge ${colors[status]}`}>
        {status}
      </span>
    );
  };

  // Render category badge with color coding
  const renderCategoryBadge = (category: DiagnosisSummary['category']) => {
    if (!category) {
      return <span className="category-badge bg-gray-400">Uncategorized</span>;
    }

    const categoryColors: Record<string, string> = {
      'dependency-build-error': 'bg-purple-500',
      'test-failure': 'bg-red-500',
      'docker-build-failure': 'bg-blue-500',
      'env-var-secrets': 'bg-orange-500',
      'timeout-infrastructure': 'bg-yellow-600',
      'syntax-lint-error': 'bg-pink-500',
      'unknown': 'bg-gray-500',
    };

    return (
      <span className={`category-badge ${categoryColors[category] || 'bg-gray-500'}`}>
        {category}
      </span>
    );
  };

  // Truncate commit SHA to first 7 characters
  const truncateSha = (sha: string) => sha.substring(0, 7);

  // Format date for display
  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleString();
  };

  return (
    <div className="container">
      <header className="header">
        <h1>CI/CD Failure Doctor</h1>
        <p className="subtitle">Automated AI-powered build failure diagnosis</p>
      </header>

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
      {error && (
        <div className="error-banner">
          ⚠️ {error}
        </div>
      )}

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
