import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { todayIST, STATUS_COLORS } from '../types';
import { useAuth } from '../auth/AuthContext';
import LoadingSpinner from '../components/LoadingSpinner';
import ErrorBanner from '../components/ErrorBanner';

interface DashboardStats {
  date: string;
  total_employed: number;
  present: number;
  absent: number;
  half_day: number;
  weekly_off: number;
  paid_leave: number;
  unpaid_leave: number;
  not_marked: number;
}

export default function DashboardPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [date, setDate] = useState(todayIST());
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchDashboard = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await api.getDashboard(date);
      setStats(data as unknown as DashboardStats);
    } catch (err: any) {
      if (user) {
        setError(err.message || 'Failed to load dashboard');
      }
    } finally {
      setLoading(false);
    }
  }, [date, user]);

  useEffect(() => {
    fetchDashboard();
  }, [fetchDashboard]);

  const statCards = stats
    ? [
        { label: 'Total Employed', value: stats.total_employed, color: '#6b7280' },
        { label: 'Present', value: stats.present, color: STATUS_COLORS.present },
        { label: 'Absent', value: stats.absent, color: STATUS_COLORS.absent },
        { label: 'Half Day', value: stats.half_day, color: STATUS_COLORS.half_day },
        { label: 'Weekly Off', value: stats.weekly_off, color: STATUS_COLORS.weekly_off },
        { label: 'Paid Leave', value: stats.paid_leave, color: STATUS_COLORS.paid_leave },
        { label: 'Unpaid Leave', value: stats.unpaid_leave, color: STATUS_COLORS.unpaid_leave },
        { label: 'Not Marked', value: stats.not_marked, color: '#9ca3af' },
      ]
    : [];

  const displayDate = new Date(`${date}T00:00:00+05:30`).toLocaleDateString('en-IN', {
    timeZone: 'Asia/Kolkata',
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  return (
    <div>
      <div className="card dashboard-welcome-card mb-2">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem' }}>
          <div>
            <div className="hotel-subtitle-badge">Bhubaneswar, Odisha</div>
            <h1 className="hotel-welcome-title">Livotel Premium Hotel</h1>
            <p className="hotel-date-subtitle">Daily Attendance & Duty Overview • {displayDate}</p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
            <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--gray-700)' }}>Date:</span>
            <input
              type="date"
              value={date}
              max={todayIST()}
              onChange={(e) => setDate(e.target.value)}
              className="input date-picker-input"
              style={{ maxWidth: '175px' }}
            />
          </div>
        </div>
      </div>

      {!user ? (
        <div
          className="card guest-cta-card mb-2"
          style={{
            background: 'var(--gold-bg)',
            border: '1.5px solid var(--gold-border)',
            padding: '1rem 1.25rem',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: '0.75rem',
            borderRadius: 'var(--radius-md)',
          }}
        >
          <div>
            <div style={{ fontWeight: 700, color: 'var(--navy)', fontSize: '0.95rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <span>👋</span> Live Hotel Attendance Overview
            </div>
            <p style={{ margin: '0.2rem 0 0 0', fontSize: '0.85rem', color: 'var(--gray-600)' }}>
              Viewing live hotel overview. Sign in as Owner or Hotel Manager to record daily attendance, manage staff, or run monthly reports.
            </p>
          </div>
          <button
            className="btn btn-primary"
            style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', whiteSpace: 'nowrap' }}
            onClick={() => navigate('/login')}
          >
            <span>🔐</span>
            <span>Sign In / Login</span>
          </button>
        </div>
      ) : (
        <div style={{ marginBottom: '1rem', display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <button className="btn btn-primary btn-sm" onClick={() => navigate('/attendance')}>
            📋 Mark Today's Attendance
          </button>
          <button className="btn btn-secondary btn-sm" onClick={() => navigate('/reports')}>
            📄 Monthly Reports
          </button>
        </div>
      )}

      {error && <ErrorBanner message={error} onRetry={fetchDashboard} />}

      {loading ? (
        <LoadingSpinner />
      ) : stats ? (
        stats.total_employed === 0 ? (
          <div className="card" style={{ textAlign: 'center', padding: '3rem 1rem', color: '#64748b' }}>
            <p style={{ fontSize: '1.125rem' }}>No staff employed on this date</p>
          </div>
        ) : (
          <div className="stats-grid">
            {statCards.map((card) => (
              <div
                key={card.label}
                className="stat-card"
                style={{ borderTop: `4px solid ${card.color}` }}
              >
                <div className="stat-value">{card.value}</div>
                <div className="stat-label">{card.label}</div>
              </div>
            ))}
          </div>
        )
      ) : !user ? (
        <div className="card" style={{ textAlign: 'center', padding: '2.5rem 1.5rem', background: '#fff', border: '1px solid var(--gold-border)' }}>
          <img src="/logo-dark.jpg" alt="Livotel" style={{ maxWidth: '90px', borderRadius: '8px', border: '2px solid var(--gold)', marginBottom: '1rem' }} />
          <h3 style={{ color: 'var(--navy)', marginBottom: '0.5rem' }}>Welcome to Livotel Staff Attendance</h3>
          <p style={{ color: 'var(--gray-600)', maxWidth: '480px', margin: '0 auto 1.5rem', fontSize: '0.9rem' }}>
            Live attendance tracking, fixed-salary default present automation, absence notifications, and owner-confidential payroll management.
          </p>
          <button className="btn btn-primary" onClick={() => navigate('/login')}>
            🔐 Sign In to Manage Attendance
          </button>
        </div>
      ) : null}
    </div>
  );
}
