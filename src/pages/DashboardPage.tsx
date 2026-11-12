import React, { useState, useEffect, useCallback } from 'react';
import { api } from '../api/client';
import { todayIST, STATUS_COLORS } from '../types';
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
      setError(err.message || 'Failed to load dashboard');
    } finally {
      setLoading(false);
    }
  }, [date]);

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
      <div className="page-header">
        <div style={{ textAlign: 'center', marginBottom: '0.5rem' }}>
          <h2 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 700, color: '#1e293b' }}>
            🏨 Livotel Premium Hotel, Bhubaneswar
          </h2>
        </div>
        <h1 className="page-title">Dashboard</h1>
        <p style={{ color: '#64748b', margin: '0.25rem 0 0' }}>{displayDate}</p>
      </div>

      <div className="toolbar">
        <input
          type="date"
          value={date}
          max={todayIST()}
          onChange={(e) => setDate(e.target.value)}
          className="input"
          style={{ maxWidth: '200px' }}
        />
      </div>

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
      ) : null}
    </div>
  );
}
