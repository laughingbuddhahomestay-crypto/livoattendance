import React, { useState } from 'react';
import { useNavigate, Navigate } from 'react-router-dom';
import { useAuth } from './AuthContext';
import { api } from '../api/client';

export default function LoginPage() {
  const { user, login, openLoginModal } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // Forgot password mode state
  const [isForgotMode, setIsForgotMode] = useState(false);
  const [forgotSuccess, setForgotSuccess] = useState('');

  if (user) {
    return <Navigate to="/dashboard" replace />;
  }

  const handleManualSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(email.trim().toLowerCase(), password);
      navigate('/dashboard');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Login failed. Please check credentials or network.');
    } finally {
      setLoading(false);
    }
  };

  const handleForgotSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setForgotSuccess('');

    if (!email.trim()) {
      setError('Please enter your account email address.');
      return;
    }

    setLoading(true);
    try {
      const res = await api.forgotPassword(email.trim().toLowerCase());
      setForgotSuccess(res.message || 'If an account exists, a reset link has been dispatched to your email.');
    } catch (err: any) {
      setError(err.message || 'Unable to request password reset right now.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-page">
      <div className="login-card">
        <div style={{ marginBottom: '0.75rem', display: 'flex', justifyContent: 'flex-start' }}>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => navigate('/dashboard')}
            style={{ fontSize: '0.8rem', padding: '0.25rem 0.65rem' }}
          >
            ← View Live Dashboard
          </button>
        </div>

        <img src="/logo-dark.jpg" alt="Livotel Premium Hotel" className="login-logo" />

        {isForgotMode ? (
          <div>
            <h1>Reset Password</h1>
            <p className="login-subtitle">Enter your registered email to receive a password reset link</p>

            {error && <div className="alert alert-error" role="alert">{error}</div>}
            {forgotSuccess && (
              <div className="alert alert-success" role="alert">
                <div>{forgotSuccess}</div>
              </div>
            )}

            <form onSubmit={handleForgotSubmit}>
              <div className="form-group">
                <label htmlFor="forgotEmail">Email Address</label>
                <input
                  id="forgotEmail"
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="your.email@example.com"
                  required
                  autoComplete="email"
                  disabled={loading}
                />
              </div>

              <button type="submit" className="btn btn-primary btn-block" disabled={loading}>
                {loading ? 'Sending link…' : 'Send Reset Link'}
              </button>

              <div style={{ marginTop: '1.25rem', textAlign: 'center' }}>
                <button
                  type="button"
                  onClick={() => {
                    setIsForgotMode(false);
                    setError('');
                    setForgotSuccess('');
                  }}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: 'var(--navy)',
                    fontSize: '0.85rem',
                    cursor: 'pointer',
                    fontWeight: 600,
                  }}
                >
                  ← Back to Sign In
                </button>
              </div>
            </form>
          </div>
        ) : (
          <div>
            <h1>Staff Attendance</h1>
            <p className="login-subtitle">Livotel Premium Hotel, Bhubaneswar</p>

            {error && <div className="alert alert-error" role="alert">{error}</div>}

            {/* Netlify Identity One-Click Login */}
            <div style={{ margin: '1.25rem 0' }}>
              <button
                type="button"
                className="btn btn-primary btn-block"
                onClick={() => openLoginModal()}
                style={{
                  padding: '0.85rem 1rem',
                  fontSize: '0.95rem',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '0.5rem',
                  fontWeight: 600,
                  boxShadow: '0 4px 12px rgba(197, 160, 89, 0.3)',
                }}
              >
                <span>🔐 Sign In with Netlify Identity</span>
              </button>
            </div>

            <div className="login-divider">
              <span>OR ENTER CREDENTIALS</span>
            </div>

            {/* Credentials Form */}
            <form onSubmit={handleManualSubmit}>
              <div className="form-group">
                <label htmlFor="email">Email</label>
                <input
                  id="email"
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="your.email@example.com"
                  required
                  autoComplete="email"
                  disabled={loading}
                />
              </div>

              <div className="form-group">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <label htmlFor="password" style={{ marginBottom: 0 }}>Password</label>
                  <button
                    type="button"
                    onClick={() => {
                      setIsForgotMode(true);
                      setError('');
                      setForgotSuccess('');
                    }}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: 'var(--gold-dark)',
                      fontSize: '0.8rem',
                      cursor: 'pointer',
                      fontWeight: 600,
                      padding: 0,
                    }}
                  >
                    Forgot Password?
                  </button>
                </div>
                <input
                  id="password"
                  type="password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="Enter your password"
                  required
                  autoComplete="current-password"
                  disabled={loading}
                  style={{ marginTop: '0.35rem' }}
                />
              </div>

              <button type="submit" className="btn btn-secondary btn-block" disabled={loading}>
                {loading ? 'Signing in…' : 'Sign In'}
              </button>
            </form>

            {/* Invite-Only Identity Information Notice */}
            <div className="invite-notice" style={{ textAlign: 'left', marginTop: '1.5rem', lineHeight: '1.5' }}>
              <div style={{ fontWeight: 700, color: 'var(--navy)', marginBottom: '0.35rem', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                <span>✉️</span> Invite-Only Access via Netlify Identity
              </div>
              <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--gray-600)' }}>
                New accounts are added by email invitation from the administrator with two available roles:
              </p>
              <ul style={{ margin: '0.4rem 0 0 1.1rem', padding: 0, fontSize: '0.8rem', color: 'var(--gray-700)' }}>
                <li><strong>Admin</strong>: Complete management of staff roster, confidential payroll, month locks, and audit logs.</li>
                <li><strong>Manager</strong>: Daily attendance entry, staff roster viewing, and monthly attendance reports.</li>
              </ul>
              <div style={{ marginTop: '0.65rem', paddingTop: '0.5rem', borderTop: '1px dashed var(--gray-300)', fontSize: '0.75rem', color: 'var(--gray-500)' }}>
                💡 <em>Received an invitation email? Click the link in your email to set your password and activate your account.</em>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
