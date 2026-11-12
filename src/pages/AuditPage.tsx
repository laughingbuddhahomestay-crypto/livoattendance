import React, { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api/client';
import { STATUS_LABELS, type AttendanceStatus } from '../types';
import LoadingSpinner from '../components/LoadingSpinner';
import ErrorBanner from '../components/ErrorBanner';

export default function AuditPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const initialStaffId = searchParams.get('staff_id') || '';
  const initialDate = searchParams.get('date') || '';

  const [entries, setEntries] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Filters
  const [staffList, setStaffList] = useState<any[]>([]);
  const [selectedStaffId, setSelectedStaffId] = useState(initialStaffId);
  const [selectedDate, setSelectedDate] = useState(initialDate);

  // Sync state with URL params
  const updateStaffFilter = (id: string) => {
    setSelectedStaffId(id);
    setPage(1);
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      if (id) next.set('staff_id', id);
      else next.delete('staff_id');
      return next;
    });
  };

  const updateDateFilter = (d: string) => {
    setSelectedDate(d);
    setPage(1);
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      if (d) next.set('date', d);
      else next.delete('date');
      return next;
    });
  };

  const clearFilters = () => {
    setSelectedStaffId('');
    setSelectedDate('');
    setPage(1);
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      next.delete('staff_id');
      next.delete('date');
      return next;
    });
  };

  // Fetch staff for dropdown
  useEffect(() => {
    api.listStaff(true)
      .then(res => setStaffList(res.staff || []))
      .catch(err => console.error('Failed to load staff list for audit filter', err));
  }, []);

  const fetchAudit = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await api.getAudit({
        staff_id: selectedStaffId || undefined,
        date: selectedDate || undefined,
        page,
      });
      setEntries(res.entries || []);
      setTotal(res.total || 0);
    } catch (err: any) {
      setError(err.message || 'Failed to load audit history');
    } finally {
      setLoading(false);
    }
  }, [selectedStaffId, selectedDate, page]);

  useEffect(() => {
    fetchAudit();
  }, [fetchAudit]);

  const totalPages = Math.ceil(total / 50);

  const formatChanges = (prev: any, current: any) => {
    if (!prev) {
      return (
        <span style={{ color: 'var(--green)', fontWeight: 500 }}>
          Initial record created with status:{' '}
          <strong>{STATUS_LABELS[current.status as AttendanceStatus] || current.status}</strong>
        </span>
      );
    }

    const changes: string[] = [];

    if (prev.status !== current.status) {
      const from = STATUS_LABELS[prev.status as AttendanceStatus] || prev.status;
      const to = STATUS_LABELS[current.status as AttendanceStatus] || current.status;
      changes.push(`Status changed: "${from}" → "${to}"`);
    }

    if (prev.shift !== current.shift) {
      changes.push(`Shift: "${prev.shift || 'None'}" → "${current.shift || 'None'}"`);
    }

    if (prev.check_in !== current.check_in) {
      const fIn = prev.check_in ? new Date(prev.check_in).toLocaleTimeString('en-IN') : 'None';
      const tIn = current.check_in ? new Date(current.check_in).toLocaleTimeString('en-IN') : 'None';
      changes.push(`Check-In: ${fIn} → ${tIn}`);
    }

    if (prev.check_out !== current.check_out) {
      const fOut = prev.check_out ? new Date(prev.check_out).toLocaleTimeString('en-IN') : 'None';
      const tOut = current.check_out ? new Date(current.check_out).toLocaleTimeString('en-IN') : 'None';
      changes.push(`Check-Out: ${fOut} → ${tOut}`);
    }

    if (prev.notes !== current.notes) {
      changes.push(`Notes updated`);
    }

    return (
      <ul style={{ paddingLeft: '1.2rem', margin: '0.25rem 0' }}>
        {changes.map((c, i) => (
          <li key={i}>{c}</li>
        ))}
      </ul>
    );
  };

  return (
    <div className="audit-page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Attendance Audit Trail</h1>
          <p className="page-subtitle">Complete chronological record of all creations and corrections</p>
        </div>
      </div>

      {error && <ErrorBanner message={error} onRetry={fetchAudit} />}

      {/* Toolbar filters */}
      <div className="toolbar">
        <select
          value={selectedStaffId}
          onChange={e => updateStaffFilter(e.target.value)}
          style={{ minWidth: '220px' }}
        >
          <option value="">All Staff Members</option>
          {staffList.map(s => (
            <option key={s.id} value={s.id}>
              {s.full_name} ({s.employee_id})
            </option>
          ))}
        </select>

        <input
          type="date"
          value={selectedDate}
          onChange={e => updateDateFilter(e.target.value)}
          style={{ width: '170px' }}
        />

        {(selectedStaffId || selectedDate) && (
          <button
            className="btn btn-sm btn-ghost"
            onClick={clearFilters}
          >
            Clear Filters
          </button>
        )}
      </div>

      {loading ? (
        <LoadingSpinner message="Loading audit entries…" />
      ) : entries.length === 0 ? (
        <div className="card empty-state">
          <div className="empty-state-icon">🔍</div>
          <p>No audit trail records found for the selected filters.</p>
        </div>
      ) : (
        <div className="card">
          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>Timestamp</th>
                  <th>Staff Member</th>
                  <th>Attendance Date</th>
                  <th>Modifications</th>
                  <th>Reason for Change</th>
                  <th>Changed By</th>
                </tr>
              </thead>
              <tbody>
                {entries.map(e => (
                  <tr key={e.id}>
                    <td style={{ fontSize: '0.8rem', whiteSpace: 'nowrap' }}>
                      {new Date(e.changed_at).toLocaleString('en-IN', {
                        year: 'numeric',
                        month: 'short',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </td>
                    <td>
                      <div style={{ fontWeight: 600 }}>{e.staff_name}</div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--gray-500)' }}>
                        {e.employee_id} • {e.department}
                      </div>
                    </td>
                    <td style={{ fontWeight: 500 }}>{e.attendance_date}</td>
                    <td style={{ fontSize: '0.85rem' }}>
                      {formatChanges(e.previous_values, e.new_values)}
                    </td>
                    <td style={{ fontSize: '0.85rem', color: 'var(--gray-700)' }}>
                      {e.change_reason ? (
                        <em>"{e.change_reason}"</em>
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </td>
                    <td style={{ fontSize: '0.85rem' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', flexWrap: 'wrap' }}>
                        <strong>{e.changed_by_name}</strong>
                        <span
                          className={`badge badge-${e.changed_by_role === 'owner' ? 'owner' : 'manager'}`}
                          style={{ fontSize: '0.65rem', padding: '1px 5px', textTransform: 'uppercase' }}
                        >
                          {e.changed_by_role || 'MANAGER'}
                        </span>
                      </div>
                      <div style={{ fontSize: '0.7rem', color: 'var(--gray-500)' }}>
                        {e.changed_by_email}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {totalPages > 1 && (
            <div className="toolbar mt-2 justify-between">
              <span className="text-sm text-muted">
                Showing page {page} of {totalPages} ({total} total entries)
              </span>
              <div className="flex gap-1">
                <button
                  className="btn btn-sm btn-outline"
                  disabled={page <= 1}
                  onClick={() => setPage(p => p - 1)}
                >
                  ◀ Previous
                </button>
                <button
                  className="btn btn-sm btn-outline"
                  disabled={page >= totalPages}
                  onClick={() => setPage(p => p + 1)}
                >
                  Next ▶
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
