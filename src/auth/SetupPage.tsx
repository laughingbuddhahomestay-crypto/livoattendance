import React, { useState, useEffect } from 'react';
import { api, setToken } from '../api/client';
import { useAuth } from './AuthContext';

export default function SetupPage() {
  const { refreshUser } = useAuth();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [setupSecret, setSetupSecret] = useState('');
  const [requiresSecret, setRequiresSecret] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    api.checkSetup()
      .then(res => {
        if (res.requires_setup_secret) {
          setRequiresSecret(true);
        }
      })
      .catch(console.error);
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (password.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }
    if (password !== confirm) {
      setError('Passwords do not match');
      return;
    }
    if (requiresSecret && !setupSecret.trim()) {
      setError('Setup secret key is required by environment configuration');
      return;
    }

    setLoading(true);
    try {
      const result = await api.setup({
        name: name.trim(),
        email: email.trim().toLowerCase(),
        password,
        setup_secret: setupSecret.trim() || undefined,
      });
      setToken(result.token);
      await refreshUser();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Setup failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-page">
      <div className="login-card">
        <img src="/logo-dark.jpg" alt="Livotel Premium Hotel" className="login-logo" />
        <h1>First-Time Setup</h1>
        <p className="login-subtitle">Create the initial owner account for Livotel Attendance</p>

        {error && <div className="alert alert-error">{error}</div>}

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label htmlFor="name">Your Full Name</label>
            <input
              id="name"
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g. Pradipta Kumar Ray"
              required
              autoFocus
            />
          </div>
          <div className="form-group">
            <label htmlFor="email">Work Email</label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="owner@livotelhotel.com"
              required
              autoComplete="email"
            />
          </div>
          <div className="form-group">
            <label htmlFor="password">Password (min 8 characters)</label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="At least 8 characters"
              required
              minLength={8}
              autoComplete="new-password"
            />
          </div>
          <div className="form-group">
            <label htmlFor="confirm">Confirm Password</label>
            <input
              id="confirm"
              type="password"
              value={confirm}
              onChange={e => setConfirm(e.target.value)}
              placeholder="Re-enter password"
              required
              autoComplete="new-password"
            />
          </div>

          {requiresSecret ? (
            <div className="form-group">
              <label htmlFor="setupSecret">
                Setup Secret Key <span style={{ color: 'var(--coral)' }}>*</span>
              </label>
              <input
                id="setupSecret"
                type="password"
                value={setupSecret}
                onChange={e => setSetupSecret(e.target.value)}
                placeholder="Enter SETUP_SECRET from Netlify environment"
                required
              />
              <p className="form-hint">
                Configured on Netlify environment variable <code>SETUP_SECRET</code>.
              </p>
            </div>
          ) : (
            <div className="form-group">
              <label htmlFor="setupSecret">Setup Secret Key (Optional)</label>
              <input
                id="setupSecret"
                type="password"
                value={setupSecret}
                onChange={e => setSetupSecret(e.target.value)}
                placeholder="Leave blank if not configured in environment"
              />
            </div>
          )}

          <button type="submit" className="btn btn-primary btn-block" disabled={loading}>
            {loading ? 'Creating Owner Account…' : 'Create Owner Account'}
          </button>
        </form>
      </div>
    </div>
  );
}
