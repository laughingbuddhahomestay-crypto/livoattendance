import React, { useState } from 'react';
import { useSearchParams, useNavigate, Link } from 'react-router-dom';
import { api } from '../api/client';

export default function ResetPasswordPage() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');
  const navigate = useNavigate();

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    if (!token) {
      setError('Missing or invalid reset token. Please request a new link.');
      return;
    }

    if (password.length < 8) {
      setError('Password must be at least 8 characters long.');
      return;
    }

    if (password !== confirmPassword) {
      setError('Passwords do not match. Please re-enter.');
      return;
    }

    setLoading(true);
    try {
      const res = await api.resetPassword({ token, new_password: password });
      setSuccess(res.message || 'Password reset successfully!');
      setTimeout(() => {
        navigate('/login');
      }, 2500);
    } catch (err: any) {
      setError(err.message || 'Failed to reset password. The link may have expired.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-page">
      <div className="login-card">
        <div style={{ marginBottom: '0.75rem', display: 'flex', justifyContent: 'flex-start' }}>
          <Link
            to="/dashboard"
            className="btn btn-secondary btn-sm"
            style={{ fontSize: '0.8rem', padding: '0.25rem 0.65rem', textDecoration: 'none' }}
          >
            ← Live Dashboard
          </Link>
        </div>

        <img src="/logo-dark.jpg" alt="Livotel Premium Hotel" className="login-logo" />
        <h1>Set New Password</h1>
        <p className="login-subtitle">Livotel Premium Hotel, Bhubaneswar</p>

        {error && <div className="alert alert-error" role="alert">{error}</div>}
        {success && (
          <div className="alert alert-success" role="alert">
            {success} Redirecting to login…
          </div>
        )}

        {!token ? (
          <div style={{ textAlign: 'center', marginTop: '1rem' }}>
            <p style={{ color: 'var(--red)', fontSize: '0.9rem' }}>
              No password reset token was detected in the URL.
            </p>
            <Link to="/login" className="btn btn-primary btn-block" style={{ marginTop: '1rem', textDecoration: 'none' }}>
              Back to Sign In
            </Link>
          </div>
        ) : (
          <form onSubmit={handleSubmit}>
            <div className="form-group">
              <label htmlFor="password">New Password</label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="At least 8 characters"
                required
                minLength={8}
                autoComplete="new-password"
                disabled={loading || Boolean(success)}
              />
            </div>

            <div className="form-group">
              <label htmlFor="confirmPassword">Confirm New Password</label>
              <input
                id="confirmPassword"
                type="password"
                value={confirmPassword}
                onChange={e => setConfirmPassword(e.target.value)}
                placeholder="Re-enter new password"
                required
                minLength={8}
                autoComplete="new-password"
                disabled={loading || Boolean(success)}
              />
            </div>

            <button
              type="submit"
              className="btn btn-primary btn-block"
              disabled={loading || Boolean(success)}
            >
              {loading ? 'Updating Password…' : 'Update Password'}
            </button>

            <div style={{ textAlign: 'center', marginTop: '1rem' }}>
              <Link to="/login" style={{ fontSize: '0.85rem', color: 'var(--gold-dark)', textDecoration: 'none', fontWeight: 600 }}>
                Remember your password? Sign In
              </Link>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
