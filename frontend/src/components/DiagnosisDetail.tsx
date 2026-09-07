import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import rehypeHighlight from 'rehype-highlight';
import 'highlight.js/styles/github-dark.css';
import type { DiagnosisDetail as DiagnosisDetailType } from '../types';
import { getOrCreateClientId, postFeedback, fetchDiagnosisById } from '../api';
import { useAuth } from '../contexts/AuthContext';

// Local storage key for persisting ratings per diagnosis
const RATINGS_STORAGE_KEY = 'cicd-doctor-ratings';

type Rating = 'helpful' | 'unhelpful';

interface RatingsCache {
  [diagnosisId: string]: Rating;
}

const DiagnosisDetail: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [diagnosis, setDiagnosis] = useState<DiagnosisDetailType | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showRawLog, setShowRawLog] = useState(false);
  const [currentRating, setCurrentRating] = useState<Rating | null>(null);
  const [submittingRating, setSubmittingRating] = useState(false);

  useEffect(() => {
    const load = async () => {
      try {
        if (!id) throw new Error('No diagnosis ID');
        const data = await fetchDiagnosisById(id);
        setDiagnosis(data);
        setError(null);
      } catch (err) {
        console.error('Fetch error:', err);
        setError(err instanceof Error ? err.message : 'Failed to fetch diagnosis');
      } finally {
        setLoading(false);
      }
    };

    load();
  }, [id]);

  // Load existing rating from localStorage on mount
  // Requirement 13.1: show the matching button in a selected state
  useEffect(() => {
    if (!id) return;

    try {
      const ratingsJson = localStorage.getItem(RATINGS_STORAGE_KEY);
      if (ratingsJson) {
        const ratings: RatingsCache = JSON.parse(ratingsJson);
        if (ratings[id]) {
          setCurrentRating(ratings[id]);
        }
      }
    } catch (err) {
      console.error('Failed to load rating from localStorage:', err);
    }
  }, [id]);

  // Handler for submitting feedback
  // Requirement 13.2: POST to /diagnoses/:id/feedback with X-Client-Id header
  const handleRatingClick = async (rating: Rating) => {
    if (!id || submittingRating) return;

    // Optimistic update
    const previousRating = currentRating;
    setCurrentRating(rating);

    // Persist to localStorage
    try {
      const ratingsJson = localStorage.getItem(RATINGS_STORAGE_KEY);
      const ratings: RatingsCache = ratingsJson ? JSON.parse(ratingsJson) : {};
      ratings[id] = rating;
      localStorage.setItem(RATINGS_STORAGE_KEY, JSON.stringify(ratings));
    } catch (err) {
      console.error('Failed to save rating to localStorage:', err);
    }

    // Submit to backend
    setSubmittingRating(true);
    try {
      const clientId = getOrCreateClientId();
      await postFeedback(id, clientId, rating);
    } catch (err) {
      console.error('Failed to submit feedback:', err);
      // Revert on error
      setCurrentRating(previousRating);
    } finally {
      setSubmittingRating(false);
    }
  };

  if (loading) {
    return <div className="container"><div className="loading">Loading diagnosis...</div></div>;
  }

  if (error) {
    return (
      <div className="container">
        <div className="error-message">
          <h2>Error</h2>
          <p>{error}</p>
          <button onClick={() => navigate('/')} className="back-button">
            ← Back to List
          </button>
        </div>
      </div>
    );
  }

  if (!diagnosis) {
    return <div className="container"><div className="error-message">Diagnosis not found</div></div>;
  }

  const renderStatusBadge = (status: DiagnosisDetailType['status']) => {
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

  const renderCategoryBadge = (category: DiagnosisDetailType['category']) => {
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

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return 'N/A';
    const date = new Date(dateStr);
    return date.toLocaleString();
  };

  return (
    <div className="container">
      <header className="header">
        <button onClick={() => navigate('/')} className="back-button">
          ← Back to List
        </button>
        <h1>Diagnosis Detail</h1>
      </header>

      <div className="detail-content">
        {/* Metadata section */}
        <div className="metadata-section">
          <div className="metadata-grid">
            <div className="metadata-item">
              <span className="metadata-label">Repository:</span>
              <span className="metadata-value">{diagnosis.repoName}</span>
            </div>
            <div className="metadata-item">
              <span className="metadata-label">Job:</span>
              <span className="metadata-value">{diagnosis.jobName}</span>
            </div>
            <div className="metadata-item">
              <span className="metadata-label">Commit SHA:</span>
              <span className="metadata-value commit-sha">{diagnosis.commitSha}</span>
            </div>
            <div className="metadata-item">
              <span className="metadata-label">Source:</span>
              <span className="metadata-value source-badge">{diagnosis.source}</span>
            </div>
            <div className="metadata-item">
              <span className="metadata-label">Status:</span>
              <span className="metadata-value">{renderStatusBadge(diagnosis.status)}</span>
            </div>
            <div className="metadata-item">
              <span className="metadata-label">Category:</span>
              <span className="metadata-value">{renderCategoryBadge(diagnosis.category)}</span>
            </div>
            <div className="metadata-item">
              <span className="metadata-label">Confidence:</span>
              <span className="metadata-value">{diagnosis.confidence || 'N/A'}</span>
            </div>
            <div className="metadata-item">
              <span className="metadata-label">Created:</span>
              <span className="metadata-value">{formatDate(diagnosis.createdAt)}</span>
            </div>
            <div className="metadata-item">
              <span className="metadata-label">Completed:</span>
              <span className="metadata-value">{formatDate(diagnosis.completedAt)}</span>
            </div>
          </div>
        </div>

        {/* Diagnosis content */}
        {diagnosis.status === 'pending' ? (
          <div className="placeholder-message pending">
            <h3>⏳ Diagnosis in progress...</h3>
            <p>The AI is analyzing the build logs. This usually takes a few seconds.</p>
          </div>
        ) : diagnosis.status === 'unavailable' ? (
          <div className="placeholder-message unavailable">
            <h3>⚠️ Diagnosis unavailable</h3>
            <p>The diagnosis could not be generated. This may be due to an LLM API error or invalid response.</p>
          </div>
        ) : (
          <>
            {/* Explanation */}
            <div className="diagnosis-section">
              <h2>📋 Explanation</h2>
              <div className="explanation-content">
                {diagnosis.explanation || 'No explanation available'}
              </div>
            </div>

            {/* Suggested Fix */}
            <div className="diagnosis-section">
              <h2>🔧 Suggested Fix</h2>
              <div className="markdown-content">
                {diagnosis.suggestedFix ? (
                  <ReactMarkdown rehypePlugins={[rehypeHighlight]}>
                    {diagnosis.suggestedFix}
                  </ReactMarkdown>
                ) : (
                  <p>No suggested fix available</p>
                )}
              </div>
            </div>

            {/* Helpfulness Feedback — only shown to authenticated users */}
            {user && (
            <div className="diagnosis-section feedback-section">
              <h3>Was this diagnosis helpful?</h3>
              <div className="feedback-buttons">
                <button
                  className={`feedback-button thumbs-up ${currentRating === 'helpful' ? 'selected' : ''}`}
                  onClick={() => handleRatingClick('helpful')}
                  disabled={submittingRating}
                  aria-label="Mark as helpful"
                  title="This diagnosis was helpful"
                >
                  👍 Helpful
                </button>
                <button
                  className={`feedback-button thumbs-down ${currentRating === 'unhelpful' ? 'selected' : ''}`}
                  onClick={() => handleRatingClick('unhelpful')}
                  disabled={submittingRating}
                  aria-label="Mark as unhelpful"
                  title="This diagnosis was not helpful"
                >
                  👎 Not Helpful
                </button>
              </div>
            </div>
            )}
          </>
        )}

        {/* Raw Log (collapsible) */}
        <div className="diagnosis-section">
          <div className="collapsible-header" onClick={() => setShowRawLog(!showRawLog)}>
            <h2>📄 Raw Log {diagnosis.truncated && '(truncated)'}</h2>
            <span className="toggle-icon">{showRawLog ? '▼' : '▶'}</span>
          </div>
          {showRawLog && (
            <div className="raw-log">
              <pre>{diagnosis.rawLog}</pre>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default DiagnosisDetail;
