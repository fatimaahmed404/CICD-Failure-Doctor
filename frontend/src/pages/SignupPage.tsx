import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { signup } from '../api';
import { useAuth } from '../contexts/AuthContext';

const SignupPage: React.FC = () => {
  const navigate = useNavigate();
  const { refreshUser } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setFieldErrors([]);
    setLoading(true);
    try {
      await signup(email, password);
      await refreshUser();
      navigate('/');
    } catch (err) {
      const apiErr = err as Error & { status?: number; body?: unknown };
      if (apiErr.status === 409) {
        setError('An account with this email already exists');
      } else if (apiErr.status === 400) {
        // Try to extract details array from body
        const body = apiErr.body as { details?: string[]; message?: string } | undefined;
        if (body?.details && Array.isArray(body.details)) {
          setFieldErrors(body.details);
        } else {
          setError(body?.message || 'Invalid input');
        }
      } else {
        setError(apiErr.message || 'An unexpected error occurred');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="container">
      <header className="header">
        <h1>CI/CD Failure Doctor</h1>
        <p className="subtitle">Create your account</p>
      </header>

      <div className="detail-content" style={{ maxWidth: 480, margin: '0 auto' }}>
        {error && <div className="error-banner">⚠️ {error}</div>}

        {fieldErrors.length > 0 && (
          <div className="error-banner">
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              {fieldErrors.map((e, i) => <li key={i}>{e}</li>)}
            </ul>
          </div>
        )}

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <label className="metadata-label" htmlFor="email">Email</label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
              style={{
                display: 'block',
                width: '100%',
                marginTop: 4,
                padding: '10px 12px',
                fontSize: '1rem',
                border: '2px solid #ddd',
                borderRadius: 6,
              }}
            />
          </div>

          <div>
            <label className="metadata-label" htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="new-password"
              style={{
                display: 'block',
                width: '100%',
                marginTop: 4,
                padding: '10px 12px',
                fontSize: '1rem',
                border: '2px solid #ddd',
                borderRadius: 6,
              }}
            />
          </div>

          <button
            type="submit"
            className="simulate-button"
            disabled={loading}
            style={{ marginTop: 8 }}
          >
            {loading ? 'Creating account…' : 'Sign up'}
          </button>
        </form>

        <div style={{ marginTop: 24, textAlign: 'center', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <p>
            <Link to="/login" style={{ color: '#3498db', textDecoration: 'none' }}>
              Already have an account? Sign in
            </Link>
          </p>
          <p>
            <Link to="/demo" style={{ color: '#7f8c8d', textDecoration: 'none', fontSize: '0.9rem' }}>
              Try a demo — no account needed
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
};

export default SignupPage;
