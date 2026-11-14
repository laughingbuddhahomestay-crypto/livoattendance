import React, { useState } from 'react';
import { useNavigate, Navigate } from 'react-router-dom';
import { useAuth } from './AuthContext';
import { api } from '../api/client';

interface QuickAccount {
  email: string;
  roleTitle: string;
  badge: string;
  variant: 'owner-variant' | 'manager-variant';
  badgeClass: 'owner-badge' | 'manager-badge';
  description: string;
}

const QUICK_ACCOUNTS: Record<'owner' | 'manager', QuickAccount> = {
  owner: {
    email: 'pkray2012@gmail.com',
    roleTitle: '👑 Owner Login',
    badge: 'Executive',
    variant: 'owner-variant',
    badgeClass: 'owner-badge',
    description: 'Full admin access, confidential salary view, month locks & invite control',
  },
  manager: {
    email: 'livotelpremiumhotel@gmail.com',
    roleTitle: '🏨 Hotel Manager Login',
    badge: 'Manager',
    variant: 'manager-variant',
    badgeClass: 'manager-badge',
    description: 'Daily attendance entry, staff roster management, monthly attendance reports',
  },
};

export default function LoginPage() {
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [activeQuickRole, setActiveQuickRole] = useState<'owner' | 'manager' | null>(null);

  // Forgot password mode state
  const [isForgotMode, setIsForgotMode] = useState(false);
  const [forgotSuccess, setForgotSuccess] = useState('');
  const [directResetLink, setDirectResetLink] = useState<string | null>(null);

  if (user) {
    return <Navigate to="/dashboard" replace />;
  }

  const performLogin = async (loginEmail: string, loginPass: string) => {
    setError('');
    setLoading(true);
    try {
      await login(loginEmail.trim().toLowerCase(), loginPass);
      navigate('/dashboard');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Login failed. Please check credentials or network.');
    } finally {
      setLoading(false);
      setActiveQuickRole(null);
    }
  };

  const handleManualSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await performLogin(email, password);
  };

  const isLocalOrStaging =
    import.meta.env.DEV ||
    (typeof window !== 'undefined' &&
      (window.location.hostname === 'localhost' ||
       window.location.hostname === '127.0.0.1' ||
       window.location.hostname.includes('staging') ||
       window.location.hostname.includes('preview')));

  const handleQuickLogin = async (role: 'owner' | 'manager') => {
    setActiveQuickRole(role);
    const targetEmail = role === 'owner' ? QUICK_ACCOUNTS.owner.email : QUICK_ACCOUNTS.manager.email;
    setEmail(targetEmail);

    if (isLocalOrStaging) {
      // 1-click automatic sign-in for local development, previews & staging environments
      const targetPass = role === 'owner' ? 'Livotel@2027' : 'Livo@2026';
      setPassword(targetPass);
      await performLogin(targetEmail, targetPass);
    } else {
      // On public production: pre-fill email, focus password field, do not expose credentials
      setPassword('');
      setError('');
      setActiveQuickRole(null);
      const passInput = document.getElementById('password');
      if (passInput) passInput.focus();
    }
  };

  const handleForgotSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setForgotSuccess('');
    setDirectResetLink(null);

    if (!email.trim()) {
      setError('Please enter your account email address.');
      return;
    }

    setLoading(true);
    try {
      const res = await api.forgotPassword(email.trim().toLowerCase());
      setForgotSuccess(res.message || 'If an account exists, a reset link has been dispatched.');
      if (res.reset_link) {
        setDirectResetLink(res.reset_link);
      }
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
                {directResetLink && (
                  <div style={{ marginTop: '0.65rem', paddingTop: '0.5rem', borderTop: '1px dashed rgba(22, 101, 52, 0.3)' }}>
                    <div style={{ fontSize: '0.75rem', marginBottom: '0.35rem', color: '#14532d', fontWeight: 600 }}>
                      ⚡ Instant Reset Link (Dev & Preview mode):
                    </div>
                    <a
                      href={directResetLink}
                      className="btn btn-primary btn-sm"
                      style={{ display: 'inline-block', textDecoration: 'none', fontSize: '0.8rem', padding: '0.3rem 0.75rem' }}
                    >
                      Open Password Reset Page →
                    </a>
                  </div>
                )}
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
                  placeholder="e.g. pkray2012@gmail.com"
                  required
                  autoComplete="email"
                  disabled={loading}
                />
              </div>

              <button type="submit" className="btn btn-primary btn-block" disabled={loading}>
                {loading ? 'Sending link…' : 'Send Password Reset Link'}
              </button>

              <div style={{ textAlign: 'center', marginTop: '1.25rem' }}>
                <button
                  type="button"
                  onClick={() => {
                    setIsForgotMode(false);
                    setError('');
                    setForgotSuccess('');
                    setDirectResetLink(null);
                  }}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: 'var(--gray-600)',
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

            {/* 1-Click Role Logins */}
            <div className="quick-login-section">
              <div className="quick-login-header">
                <span>{isLocalOrStaging ? '⚡ Quick 1-Click Login' : '⚡ Quick Role Select'}</span>
              </div>
              <div className="quick-login-grid">
                <button
                  type="button"
                  className={`quick-login-card ${QUICK_ACCOUNTS.owner.variant}`}
                  onClick={() => handleQuickLogin('owner')}
                  disabled={loading}
                  title={QUICK_ACCOUNTS.owner.description}
                >
                  <div className="quick-login-info">
                    <span className="quick-login-role">
                      {QUICK_ACCOUNTS.owner.roleTitle}
                    </span>
                    <span className="quick-login-email">{QUICK_ACCOUNTS.owner.email}</span>
                  </div>
                  <span className={`quick-login-badge ${QUICK_ACCOUNTS.owner.badgeClass}`}>
                    {activeQuickRole === 'owner' && loading
                      ? 'Signing in…'
                      : isLocalOrStaging
                      ? QUICK_ACCOUNTS.owner.badge
                      : 'Select'}
                  </span>
                </button>

                <button
                  type="button"
                  className={`quick-login-card ${QUICK_ACCOUNTS.manager.variant}`}
                  onClick={() => handleQuickLogin('manager')}
                  disabled={loading}
                  title={QUICK_ACCOUNTS.manager.description}
                >
                  <div className="quick-login-info">
                    <span className="quick-login-role">
                      {QUICK_ACCOUNTS.manager.roleTitle}
                    </span>
                    <span className="quick-login-email">{QUICK_ACCOUNTS.manager.email}</span>
                  </div>
                  <span className={`quick-login-badge ${QUICK_ACCOUNTS.manager.badgeClass}`}>
                    {activeQuickRole === 'manager' && loading
                      ? 'Signing in…'
                      : isLocalOrStaging
                      ? QUICK_ACCOUNTS.manager.badge
                      : 'Select'}
                  </span>
                </button>
              </div>
            </div>

            <div className="login-divider">
              <span>OR SIGN IN WITH INVITED ACCOUNT</span>
            </div>

            {/* Manual Credentials Form */}
            <form onSubmit={handleManualSubmit}>
              <div className="form-group">
                <label htmlFor="email">Email</label>
                <input
                  id="email"
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="you@livotelhotel.com"
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

              <button type="submit" className="btn btn-primary btn-block" disabled={loading}>
                {loading && !activeQuickRole ? 'Signing in…' : 'Sign In'}
              </button>
            </form>

            {/* Invite-Only Security Notice */}
            <div className="invite-notice">
              <strong>🔒 Invite-Only Access:</strong> New staff accounts can only be invited by the Owner with assignable roles limited strictly to <em>Owner</em> and <em>Manager</em>.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
