import React, { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';

const DISMISSED_KEY = 'cicd-doctor-onboarding-dismissed';

const OnboardingCard: React.FC = () => {
  const { user } = useAuth();
  const [dismissed, setDismissed] = useState<boolean>(
    () => localStorage.getItem(DISMISSED_KEY) === 'true',
  );
  const [copied, setCopied] = useState(false);

  if (!user || dismissed) return null;

  const handleDismiss = () => {
    localStorage.setItem(DISMISSED_KEY, 'true');
    setDismissed(true);
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(user.webhookSecret);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // fallback: select the input
    }
  };

  return (
    <div
      className="simulate-section"
      style={{ borderLeft: '4px solid #3498db', position: 'relative' }}
    >
      <button
        onClick={handleDismiss}
        aria-label="Dismiss onboarding"
        style={{
          position: 'absolute',
          top: 12,
          right: 12,
          background: 'transparent',
          border: 'none',
          fontSize: '1.1rem',
          color: '#7f8c8d',
          cursor: 'pointer',
          lineHeight: 1,
        }}
      >
        ×
      </button>

      <h2 style={{ marginBottom: 8 }}>🎉 Welcome! Connect your CI/CD pipeline</h2>
      <p style={{ marginBottom: 16, color: '#555' }}>
        Use the webhook secret below in your GitHub Actions workflow to automatically diagnose
        build failures.
      </p>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span className="metadata-label">Webhook secret:</span>
        <input
          readOnly
          value={user.webhookSecret}
          style={{
            fontFamily: 'Courier New, monospace',
            fontSize: '0.9rem',
            padding: '6px 10px',
            border: '1px solid #ddd',
            borderRadius: 4,
            background: '#f8f9fa',
            flex: 1,
            minWidth: 200,
          }}
          onFocus={(e) => e.target.select()}
          aria-label="Your webhook secret"
        />
        <button onClick={handleCopy} className="simulate-button" style={{ padding: '8px 16px' }}>
          {copied ? '✓ Copied' : 'Copy'}
        </button>
      </div>
    </div>
  );
};

export default OnboardingCard;
