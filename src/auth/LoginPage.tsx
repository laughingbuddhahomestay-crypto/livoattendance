import React, { useState } from 'react';
import { useAuth } from './AuthContext';

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
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [activeQuickRole, setActiveQuickRole] = useState<'owner' | 'manager' | null>(null);

  const performLogin = async (loginEmail: string, loginPass: string) => {
    setError('');
    setLoading(true);
    try {
      await login(loginEmail.trim().toLowerCase(), loginPass);
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

  const handleQuickLogin = async (role: 'owner' | 'manager') => {
    setActiveQuickRole(role);
    if (role === 'owner') {
      setEmail(QUICK_ACCOUNTS.owner.email);
      setPassword('Livotel@2027');
      await performLogin(QUICK_ACCOUNTS.owner.email, 'Livotel@2027');
    } else {
      setEmail(QUICK_ACCOUNTS.manager.email);
      setPassword('Livo@2026');
      await performLogin(QUICK_ACCOUNTS.manager.email, 'Livo@2026');
    }
  };

  return (
    <div className="login-page">
      <div className="login-card">
        <img src="/logo-dark.jpg" alt="Livotel Premium Hotel" className="login-logo" />
        <h1>Staff Attendance</h1>
        <p className="login-subtitle">Livotel Premium Hotel, Bhubaneswar</p>

        {error && <div className="alert alert-error" role="alert">{error}</div>}

        {/* 1-Click Role Logins */}
        <div className="quick-login-section">
          <div className="quick-login-header">
            <span>⚡ Quick 1-Click Login</span>
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
                {activeQuickRole === 'owner' && loading ? 'Signing in…' : QUICK_ACCOUNTS.owner.badge}
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
                {activeQuickRole === 'manager' && loading ? 'Signing in…' : QUICK_ACCOUNTS.manager.badge}
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
              autoFocus
              autoComplete="email"
            />
          </div>
          <div className="form-group">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="Enter your password"
              required
              autoComplete="current-password"
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
    </div>
  );
}
