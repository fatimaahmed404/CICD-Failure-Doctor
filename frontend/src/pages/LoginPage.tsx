import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { login } from '../api';
import { useAuth } from '../contexts/AuthContext';

const LoginPage: React.FC = () => {
  const navigate = useNavigate();
  const { refreshUser } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await login(email, password);
      await refreshUser();
      navigate('/');
    } catch (err) {
      const apiErr = err as Error & { status?: number };
      if (apiErr.status === 401) {
        setError('Invalid email or password');
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
        <p className="subtitle">Sign in to your account</p>
      </header>

      <div className="detail-content" style={{ maxWidth: 480, margin: '0 auto' }}>
        {error && <div className="error-banner">⚠️ {error}</div>}

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
              autoComplete="current-password"
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
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        <div style={{ marginTop: 24, textAlign: 'center', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <p>
            <Link to="/signup" style={{ color: '#3498db', textDecoration: 'none' }}>
              New here? Sign up
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

export default LoginPage;
