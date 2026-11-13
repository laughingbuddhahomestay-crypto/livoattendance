import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { type Staff, DEPARTMENTS } from '../types';
import LoadingSpinner from '../components/LoadingSpinner';
import ErrorBanner from '../components/ErrorBanner';
import ConfirmDialog from '../components/ConfirmDialog';

export default function StaffPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const isOwner = user?.role === 'owner';

  const [staff, setStaff] = useState<Staff[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [search, setSearch] = useState('');
  const [deptFilter, setDeptFilter] = useState('all');
  const [showInactive, setShowInactive] = useState(false);
  const [staffToDelete, setStaffToDelete] = useState<Staff | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  const fetchStaff = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await api.listStaff(showInactive);
      setStaff((data as any).staff || []);
    } catch (err: any) {
      setError(err.message || 'Failed to load staff');
    } finally {
      setLoading(false);
    }
  }, [showInactive]);

  useEffect(() => {
    fetchStaff();
  }, [fetchStaff]);

  const handleDeleteStaff = async () => {
    if (!staffToDelete) return;
    setDeleteLoading(true);
    setError('');
    try {
      await api.deleteStaff(staffToDelete.id);
      setSuccessMsg(`Staff member ${staffToDelete.full_name || staffToDelete.name} (${staffToDelete.employee_id}) was deleted successfully.`);
      setTimeout(() => setSuccessMsg(''), 4000);
      setStaffToDelete(null);
      await fetchStaff();
    } catch (err: any) {
      setError(err.message || 'Failed to delete staff member');
    } finally {
      setDeleteLoading(false);
    }
  };

  const filtered = useMemo(() => {
    return staff.filter((s) => {
      const staffName = s.full_name || s.name || '';
      if (
        search &&
        !staffName.toLowerCase().includes(search.toLowerCase()) &&
        !s.employee_id.toLowerCase().includes(search.toLowerCase()) &&
        !(s.email || '').toLowerCase().includes(search.toLowerCase())
      ) {
        return false;
      }
      if (deptFilter !== 'all' && s.department !== deptFilter) return false;
      return true;
    });
  }, [staff, search, deptFilter]);

  if (loading) return <LoadingSpinner />;

  return (
    <div>
      <div className="page-header">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem', width: '100%' }}>
          <div>
            <h1 className="page-title">Staff Management</h1>
            <p className="page-subtitle">Manage hotel employees and email notification preferences</p>
          </div>
          {isOwner && (
            <button className="btn btn-primary" onClick={() => navigate('/staff/new')}>
              + Add Staff
            </button>
          )}
        </div>
      </div>

      {successMsg && <div className="alert alert-success">{successMsg}</div>}
      {error && <ErrorBanner message={error} onRetry={fetchStaff} />}

      <div className="toolbar" style={{ flexWrap: 'wrap', gap: '0.5rem' }}>
        <input
          type="text"
          placeholder="Search name, ID, or email..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="input"
          style={{ maxWidth: '240px' }}
        />
        <select
          value={deptFilter}
          onChange={(e) => setDeptFilter(e.target.value)}
          className="input"
          style={{ maxWidth: '180px' }}
        >
          <option value="all">All Departments</option>
          {DEPARTMENTS.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>
        <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.9rem', color: '#475569', cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={showInactive}
            onChange={(e) => setShowInactive(e.target.checked)}
          />
          Show Inactive Staff
        </label>
      </div>

      {filtered.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: '2rem 1rem', color: '#64748b' }}>
          <p>No staff members found.</p>
        </div>
      ) : (
        <>
          {/* Desktop table */}
          <div className="table-responsive desktop-only">
            <table className="table">
              <thead>
                <tr>
                  <th>Employee ID</th>
                  <th>Name</th>
                  <th>Department / Role</th>
                  <th>Email & Notifications</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((s) => (
                  <tr key={s.id}>
                    <td style={{ fontFamily: 'monospace', fontSize: '0.9rem', fontWeight: 600 }}>{s.employee_id}</td>
                    <td>
                      <button
                        onClick={() => navigate(`/staff/${s.id}/edit`)}
                        style={{
                          background: 'none',
                          border: 'none',
                          color: '#1B2A4A',
                          cursor: 'pointer',
                          fontWeight: 600,
                          padding: 0,
                          textAlign: 'left',
                          fontSize: 'inherit',
                        }}
                      >
                        {s.full_name || s.name}
                      </button>
                    </td>
                    <td>
                      <div>{s.department}</div>
                      <div style={{ fontSize: '0.8rem', color: '#64748b' }}>{s.designation}</div>
                      {isOwner && s.monthly_salary !== undefined && Number(s.monthly_salary) > 0 && (
                        <div style={{ fontSize: '0.75rem', color: '#047857', fontWeight: 600, marginTop: '0.15rem' }}>
                          ₹{Number(s.monthly_salary).toLocaleString('en-IN')}/mo
                        </div>
                      )}
                    </td>
                    <td>
                      {s.email ? (
                        <div>
                          <div style={{ fontSize: '0.85rem', color: '#334155' }}>{s.email}</div>
                          <div style={{ display: 'flex', gap: '0.35rem', marginTop: '0.2rem' }}>
                            {s.notify_absence && (
                              <span style={{ fontSize: '0.7rem', background: '#fee2e2', color: '#991b1b', padding: '0.1rem 0.35rem', borderRadius: '4px' }}>
                                Absence / Half Day Alerts
                              </span>
                            )}
                            {s.notify_monthly_report && (
                              <span style={{ fontSize: '0.7rem', background: '#e0f2fe', color: '#0369a1', padding: '0.1rem 0.35rem', borderRadius: '4px' }}>
                                Monthly Reports
                              </span>
                            )}
                          </div>
                        </div>
                      ) : (
                        <span style={{ fontSize: '0.8rem', color: '#94a3b8' }}>No email</span>
                      )}
                    </td>
                    <td>
                      <span
                        style={{
                          display: 'inline-block',
                          padding: '0.15rem 0.5rem',
                          borderRadius: '9999px',
                          fontSize: '0.8rem',
                          fontWeight: 500,
                          background: s.is_active ? '#dcfce7' : '#fee2e2',
                          color: s.is_active ? '#166534' : '#991b1b',
                        }}
                      >
                        {s.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
                        <button
                          className="btn btn-secondary btn-sm"
                          onClick={() => navigate(`/staff/${s.id}/edit`)}
                          style={{ fontSize: '0.85rem', padding: '0.25rem 0.75rem' }}
                        >
                          {isOwner ? 'Edit' : 'View'}
                        </button>
                        {isOwner && (
                          <button
                            className="btn btn-outline btn-sm"
                            style={{
                              borderColor: '#ef4444',
                              color: '#dc2626',
                              fontSize: '0.85rem',
                              padding: '0.25rem 0.75rem',
                            }}
                            onClick={() => setStaffToDelete(s)}
                            title="Delete staff member"
                          >
                            Delete
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <div className="mobile-only" style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
            {filtered.map((s) => (
              <div
                key={s.id}
                className="card"
                style={{ padding: '1rem' }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.5rem' }}>
                  <div>
                    <div style={{ fontWeight: 600, color: '#1e293b', fontSize: '1rem' }}>{s.full_name || s.name}</div>
                    <div style={{ fontSize: '0.8rem', color: '#64748b' }}>
                      {s.employee_id} · {s.designation} ({s.department})
                    </div>
                    {isOwner && s.monthly_salary !== undefined && Number(s.monthly_salary) > 0 && (
                      <div style={{ fontSize: '0.75rem', color: '#047857', fontWeight: 600, marginTop: '0.15rem' }}>
                        ₹{Number(s.monthly_salary).toLocaleString('en-IN')}/mo
                      </div>
                    )}
                  </div>
                  <span
                    style={{
                      display: 'inline-block',
                      padding: '0.15rem 0.5rem',
                      borderRadius: '9999px',
                      fontSize: '0.75rem',
                      fontWeight: 500,
                      background: s.is_active ? '#dcfce7' : '#fee2e2',
                      color: s.is_active ? '#166534' : '#991b1b',
                    }}
                  >
                    {s.is_active ? 'Active' : 'Inactive'}
                  </span>
                </div>

                {s.email && (
                  <div style={{ borderTop: '1px solid #f1f5f9', paddingTop: '0.5rem', marginTop: '0.5rem', fontSize: '0.8rem', color: '#475569' }}>
                    <div>✉️ {s.email}</div>
                    <div style={{ display: 'flex', gap: '0.35rem', marginTop: '0.25rem' }}>
                      {s.notify_absence && (
                        <span style={{ fontSize: '0.7rem', background: '#fee2e2', color: '#991b1b', padding: '0.1rem 0.35rem', borderRadius: '4px' }}>
                          Absence / Half Day Alerts
                        </span>
                      )}
                      {s.notify_monthly_report && (
                        <span style={{ fontSize: '0.7rem', background: '#e0f2fe', color: '#0369a1', padding: '0.1rem 0.35rem', borderRadius: '4px' }}>
                          Monthly Reports
                        </span>
                      )}
                    </div>
                  </div>
                )}

                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginTop: '0.75rem', paddingTop: '0.5rem', borderTop: '1px solid #f1f5f9' }}>
                  <button
                    className="btn btn-secondary btn-sm"
                    onClick={() => navigate(`/staff/${s.id}/edit`)}
                  >
                    {isOwner ? 'Edit' : 'View'}
                  </button>
                  {isOwner && (
                    <button
                      className="btn btn-outline btn-sm"
                      style={{ borderColor: '#ef4444', color: '#dc2626' }}
                      onClick={() => setStaffToDelete(s)}
                    >
                      Delete
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Delete confirmation dialog */}
          {staffToDelete && (
            <ConfirmDialog
              title="Delete Staff Member"
              message={`Are you sure you want to permanently delete ${staffToDelete.full_name || staffToDelete.name} (${staffToDelete.employee_id})? All associated records, past attendance logs, and notification history for this employee will be deleted. This action cannot be undone.`}
              confirmLabel={deleteLoading ? 'Deleting…' : 'Delete Staff'}
              variant="danger"
              onConfirm={handleDeleteStaff}
              onCancel={() => setStaffToDelete(null)}
            />
          )}
        </>
      )}
    </div>
  );
}
