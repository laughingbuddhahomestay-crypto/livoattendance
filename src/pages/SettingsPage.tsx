import React, { useState, useEffect, useCallback } from 'react';
import { api } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { MONTH_NAMES, todayIST, type UserRole, type NotificationOutboxEntry } from '../types';
import LoadingSpinner from '../components/LoadingSpinner';
import ErrorBanner from '../components/ErrorBanner';
import ConfirmDialog from '../components/ConfirmDialog';

export default function SettingsPage() {
  const { user } = useAuth();
  const isOwner = user?.role === 'owner';

  const [activeTab, setActiveTab] = useState<'profile' | 'users' | 'locks' | 'notifications' | 'system'>('profile');

  // Profile / Password State
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [pwError, setPwError] = useState('');
  const [pwSuccess, setPwSuccess] = useState('');
  const [pwLoading, setPwLoading] = useState(false);

  // Users State (Owner)
  const [users, setUsers] = useState<any[]>([]);
  const [invitations, setInvitations] = useState<any[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [userError, setUserError] = useState('');

  // Invite Form State
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteName, setInviteName] = useState('');
  const [inviteRole, setInviteRole] = useState<UserRole>('manager');
  const [inviteLoading, setInviteLoading] = useState(false);
  const [generatedInviteLink, setGeneratedInviteLink] = useState('');
  const [copySuccess, setCopySuccess] = useState(false);

  // Month Locks State (Owner)
  const [locks, setLocks] = useState<any[]>([]);
  const [locksLoading, setLocksLoading] = useState(false);
  const [lockYear, setLockYear] = useState(new Date().getFullYear());
  const [lockMonth, setLockMonth] = useState(new Date().getMonth() + 1);
  const [unlockConfirm, setUnlockConfirm] = useState<{ year: number; month: number } | null>(null);

  // Notifications State (Owner)
  const [notifications, setNotifications] = useState<NotificationOutboxEntry[]>([]);
  const [notificationsTotal, setNotificationsTotal] = useState(0);
  const [notifLoading, setNotifLoading] = useState(false);
  const [notifError, setNotifError] = useState('');
  const [notifStatusFilter, setNotifStatusFilter] = useState('all');
  const [processingOutbox, setProcessingOutbox] = useState(false);
  const [processResult, setProcessResult] = useState<string | null>(null);

  // Monthly Report Dispatch / Preview State
  const [staffList, setStaffList] = useState<any[]>([]);
  const [selectedStaffId, setSelectedStaffId] = useState('');
  const [reportYear, setReportYear] = useState(new Date().getFullYear());
  const [reportMonth, setReportMonth] = useState(new Date().getMonth() === 0 ? 12 : new Date().getMonth());
  const [previewData, setPreviewData] = useState<any>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [sendingReport, setSendingReport] = useState(false);
  const [sendSuccessMessage, setSendSuccessMessage] = useState('');
  const [resendConfirmPrompt, setResendConfirmPrompt] = useState<string | null>(null);

  // Health State
  const [healthStatus, setHealthStatus] = useState<any>(null);
  const [healthLoading, setHealthLoading] = useState(false);

  // Fetch Users & Invitations
  const fetchUsersData = useCallback(async () => {
    if (!isOwner) return;
    setUsersLoading(true);
    setUserError('');
    try {
      const [uRes, iRes] = await Promise.all([api.listUsers(), api.listInvitations()]);
      setUsers(uRes.users || []);
      setInvitations(iRes.invitations || []);
    } catch (err: any) {
      setUserError(err.message || 'Failed to load user management data');
    } finally {
      setUsersLoading(false);
    }
  }, [isOwner]);

  // Fetch Locks
  const fetchLocks = useCallback(async () => {
    if (!isOwner) return;
    setLocksLoading(true);
    try {
      const res = await api.getMonthLocks();
      setLocks(res.locks || []);
    } catch (err: any) {
      console.error('Failed to load locks:', err);
    } finally {
      setLocksLoading(false);
    }
  }, [isOwner]);

  // Fetch Notifications Outbox
  const fetchNotifications = useCallback(async () => {
    if (!isOwner) return;
    setNotifLoading(true);
    setNotifError('');
    try {
      const res = await api.getNotifications({
        status: notifStatusFilter === 'all' ? undefined : notifStatusFilter,
      });
      setNotifications(res.entries || []);
      setNotificationsTotal(res.total || 0);
    } catch (err: any) {
      setNotifError(err.message || 'Failed to load notifications history');
    } finally {
      setNotifLoading(false);
    }
  }, [isOwner, notifStatusFilter]);

  const fetchStaffListOnce = useCallback(async () => {
    if (!isOwner) return;
    try {
      const staffRes = await api.listStaff(true);
      const st = (staffRes as any).staff || [];
      setStaffList(st);
      if (st.length > 0) {
        setSelectedStaffId((curr) => {
          if (curr) return curr;
          const withEmail = st.find((s: any) => s.email);
          return withEmail ? withEmail.id : st[0].id;
        });
      }
    } catch {
      // non-fatal
    }
  }, [isOwner]);

  useEffect(() => {
    if (activeTab === 'users' && isOwner) {
      fetchUsersData();
    } else if (activeTab === 'locks' && isOwner) {
      fetchLocks();
    } else if (activeTab === 'notifications' && isOwner) {
      fetchNotifications();
      if (staffList.length === 0) {
        fetchStaffListOnce();
      }
    }
  }, [activeTab, isOwner, fetchUsersData, fetchLocks, fetchNotifications, fetchStaffListOnce, staffList.length]);

  // Handle password change
  const handlePasswordChange = async (e: React.FormEvent) => {
    e.preventDefault();
    setPwError('');
    setPwSuccess('');

    if (newPassword.length < 8) {
      setPwError('New password must be at least 8 characters');
      return;
    }
    if (newPassword !== confirmPassword) {
      setPwError('Passwords do not match');
      return;
    }

    setPwLoading(true);
    try {
      await api.changePassword({
        current_password: currentPassword,
        new_password: newPassword,
      });
      setPwSuccess('Password updated successfully. Other active sessions were invalidated.');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err: any) {
      setPwError(err.message || 'Failed to change password');
    } finally {
      setPwLoading(false);
    }
  };

  // Handle user invite
  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    setUserError('');
    setGeneratedInviteLink('');
    setInviteLoading(true);

    try {
      const result = await api.invite({
        email: inviteEmail.trim().toLowerCase(),
        name: inviteName.trim(),
        role: inviteRole,
      });
      setGeneratedInviteLink(result.link);
      setInviteEmail('');
      setInviteName('');
      fetchUsersData();
    } catch (err: any) {
      setUserError(err.message || 'Failed to generate invitation');
    } finally {
      setInviteLoading(false);
    }
  };

  const handleCopyLink = () => {
    if (!generatedInviteLink) return;
    navigator.clipboard.writeText(generatedInviteLink);
    setCopySuccess(true);
    setTimeout(() => setCopySuccess(false), 2500);
  };

  // Handle toggle user active
  const handleToggleUserActive = async (targetUser: any) => {
    try {
      await api.updateUser(targetUser.id, {
        is_active: !targetUser.is_active,
      });
      fetchUsersData();
    } catch (err: any) {
      alert(err.message || 'Failed to update user status');
    }
  };

  // Handle lock month
  const handleLockMonth = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.lockMonth(lockYear, lockMonth);
      fetchLocks();
    } catch (err: any) {
      alert(err.message || 'Failed to lock month');
    }
  };

  // Handle confirm unlock
  const handleConfirmUnlock = async () => {
    if (!unlockConfirm) return;
    try {
      await api.unlockMonth(unlockConfirm.year, unlockConfirm.month);
      setUnlockConfirm(null);
      fetchLocks();
    } catch (err: any) {
      alert(err.message || 'Failed to unlock month');
    }
  };

  // Handle run outbox process
  const handleProcessOutbox = async () => {
    setProcessingOutbox(true);
    setProcessResult(null);
    try {
      const res = await api.processNotificationsOutbox();
      setProcessResult(
        `Outbox processed: ${res.processed} message(s) dispatched (${res.is_sandbox ? 'Sandbox Sink' : res.provider}). ${res.failed} failure(s).`
      );
      fetchNotifications();
    } catch (err: any) {
      setProcessResult(`Error: ${err.message || 'Processing failed'}`);
    } finally {
      setProcessingOutbox(false);
    }
  };

  // Handle retry single notification
  const handleRetryNotification = async (id: string) => {
    try {
      await api.retryNotification(id);
      fetchNotifications();
    } catch (err: any) {
      alert(err.message || 'Failed to retry notification');
    }
  };

  // Handle preview monthly report email
  const handlePreviewReport = async () => {
    if (!selectedStaffId) return;
    setPreviewLoading(true);
    setPreviewData(null);
    setSendSuccessMessage('');
    setResendConfirmPrompt(null);
    try {
      const data = await api.previewMonthlyReportEmail(selectedStaffId, reportYear, reportMonth);
      setPreviewData(data);
    } catch (err: any) {
      alert(err.message || 'Failed to generate preview');
    } finally {
      setPreviewLoading(false);
    }
  };

  // Handle send monthly report email
  const handleSendReport = async (resend = false) => {
    if (!selectedStaffId) return;
    setSendingReport(true);
    setSendSuccessMessage('');
    try {
      const res = await api.sendMonthlyReportEmail({
        staff_id: selectedStaffId,
        year: reportYear,
        month: reportMonth,
        resend,
      });
      setResendConfirmPrompt(null);
      setSendSuccessMessage(res.message);
      fetchNotifications();
    } catch (err: any) {
      if (err.status === 409 && (err.body as any)?.already_sent) {
        setResendConfirmPrompt((err.body as any).message);
      } else {
        alert(err.message || 'Failed to send monthly report');
      }
    } finally {
      setSendingReport(false);
    }
  };

  // Handle health check
  const handleRunHealthCheck = async () => {
    setHealthLoading(true);
    setHealthStatus(null);
    try {
      const res = await api.health();
      setHealthStatus(res);
    } catch (err: any) {
      setHealthStatus({ status: 'error', db_connected: false, error: err.message });
    } finally {
      setHealthLoading(false);
    }
  };

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Settings & System Management</h1>
      </div>

      {/* Tabs */}
      <div className="tabs">
        <button
          className={`tab ${activeTab === 'profile' ? 'active' : ''}`}
          onClick={() => setActiveTab('profile')}
        >
          My Profile
        </button>
        {isOwner && (
          <>
            <button
              className={`tab ${activeTab === 'users' ? 'active' : ''}`}
              onClick={() => setActiveTab('users')}
            >
              Users & Invitations
            </button>
            <button
              className={`tab ${activeTab === 'locks' ? 'active' : ''}`}
              onClick={() => setActiveTab('locks')}
            >
              Month Locks
            </button>
            <button
              className={`tab ${activeTab === 'notifications' ? 'active' : ''}`}
              onClick={() => setActiveTab('notifications')}
            >
              Staff Email Notifications
            </button>
            <button
              className={`tab ${activeTab === 'system' ? 'active' : ''}`}
              onClick={() => setActiveTab('system')}
            >
              System Health
            </button>
          </>
        )}
      </div>

      {/* Profile Tab */}
      {activeTab === 'profile' && (
        <div style={{ maxWidth: '540px' }}>
          <div className="card mb-2">
            <h3 className="card-title">User Account Details</h3>
            <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: '0.5rem', fontSize: '0.9rem' }}>
              <div style={{ color: 'var(--gray-600)' }}>Name:</div>
              <div style={{ fontWeight: 600 }}>{user?.name}</div>
              <div style={{ color: 'var(--gray-600)' }}>Email:</div>
              <div>{user?.email}</div>
              <div style={{ color: 'var(--gray-600)' }}>Role:</div>
              <div>
                <span className="role-badge" style={{ textTransform: 'capitalize' }}>
                  {user?.role}
                </span>
              </div>
            </div>
          </div>

          <div className="card">
            <h3 className="card-title">Change Password</h3>
            {pwSuccess && <div className="alert alert-success">{pwSuccess}</div>}
            {pwError && <div className="alert alert-error">{pwError}</div>}

            <form onSubmit={handlePasswordChange}>
              <div className="form-group">
                <label>Current Password</label>
                <input
                  type="password"
                  value={currentPassword}
                  onChange={e => setCurrentPassword(e.target.value)}
                  placeholder="Enter current password"
                  required
                />
              </div>
              <div className="form-group">
                <label>New Password (min 8 characters)</label>
                <input
                  type="password"
                  value={newPassword}
                  onChange={e => setNewPassword(e.target.value)}
                  placeholder="Enter new secure password"
                  required
                  minLength={8}
                />
              </div>
              <div className="form-group">
                <label>Confirm New Password</label>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={e => setConfirmPassword(e.target.value)}
                  placeholder="Re-enter new password"
                  required
                  minLength={8}
                />
              </div>
              <button type="submit" className="btn btn-primary" disabled={pwLoading}>
                {pwLoading ? 'Updating…' : 'Change Password'}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Users Tab (Owner Only) */}
      {activeTab === 'users' && isOwner && (
        <div>
          {userError && <ErrorBanner message={userError} onRetry={fetchUsersData} />}

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '1.5rem' }}>
            {/* Invite Form */}
            <div className="card">
              <h3 className="card-title">Invite New Team Member</h3>
              <p className="text-sm text-muted mb-2">
                Public registration is disabled. Generate a secure, single-use 7-day invitation link.
              </p>

              <form onSubmit={handleInvite}>
                <div className="form-group">
                  <label>Full Name</label>
                  <input
                    type="text"
                    value={inviteName}
                    onChange={e => setInviteName(e.target.value)}
                    placeholder="e.g. Ramesh Kumar"
                    required
                  />
                </div>
                <div className="form-group">
                  <label>Email Address</label>
                  <input
                    type="email"
                    value={inviteEmail}
                    onChange={e => setInviteEmail(e.target.value)}
                    placeholder="colleague@livotelhotel.com"
                    required
                  />
                </div>
                <div className="form-group">
                  <label>Role</label>
                  <select
                    value={inviteRole}
                    onChange={e => setInviteRole(e.target.value as UserRole)}
                  >
                    <option value="manager">Manager (Can mark attendance and view reports)</option>
                    <option value="owner">Owner / Admin (Full access to settings, staff & locks)</option>
                  </select>
                </div>
                <button type="submit" className="btn btn-primary" disabled={inviteLoading}>
                  {inviteLoading ? 'Generating…' : 'Generate Invitation Link'}
                </button>
              </form>

              {generatedInviteLink && (
                <div style={{ marginTop: '1.25rem', background: '#F8F9FA', padding: '1rem', borderRadius: '4px', border: '1px solid #DEE2E6' }}>
                  <div style={{ fontWeight: 600, fontSize: '0.85rem', marginBottom: '0.5rem', color: 'var(--navy)' }}>
                    ✓ Invitation Link Created (Single-Use, Valid 7 Days):
                  </div>
                  <input
                    type="text"
                    readOnly
                    value={generatedInviteLink}
                    style={{ fontSize: '0.8rem', background: '#fff', marginBottom: '0.5rem' }}
                    onClick={e => (e.target as HTMLInputElement).select()}
                  />
                  <button className="btn btn-sm btn-outline" onClick={handleCopyLink}>
                    {copySuccess ? '✓ Copied to Clipboard!' : '📋 Copy Link'}
                  </button>
                </div>
              )}
            </div>

            {/* Pending Invitations */}
            <div className="card">
              <h3 className="card-title">Pending Invitations ({invitations.filter(i => !i.used_at).length})</h3>
              {invitations.filter(i => !i.used_at).length === 0 ? (
                <p className="text-sm text-muted">No pending invitations.</p>
              ) : (
                <div className="table-wrapper">
                  <table>
                    <thead>
                      <tr>
                        <th>Recipient</th>
                        <th>Role</th>
                        <th>Expires</th>
                      </tr>
                    </thead>
                    <tbody>
                      {invitations
                        .filter(i => !i.used_at)
                        .map(i => {
                          const isExpired = new Date(i.expires_at).getTime() < Date.now();
                          return (
                            <tr key={i.id}>
                              <td>
                                <div style={{ fontWeight: 500 }}>{i.name}</div>
                                <div style={{ fontSize: '0.75rem', color: 'var(--gray-600)' }}>{i.email}</div>
                              </td>
                              <td style={{ textTransform: 'capitalize' }}>{i.role}</td>
                              <td style={{ fontSize: '0.8rem', color: isExpired ? 'var(--red)' : 'inherit' }}>
                                {isExpired ? 'Expired' : new Date(i.expires_at).toLocaleDateString()}
                              </td>
                            </tr>
                          );
                        })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>

          {/* Existing Users Table */}
          <div className="card mt-2">
            <h3 className="card-title">Active Team Accounts ({users.length})</h3>
            {usersLoading ? (
              <LoadingSpinner message="Loading user roster…" />
            ) : (
              <div className="table-wrapper">
                <table>
                  <thead>
                    <tr>
                      <th>Name & Email</th>
                      <th>Role</th>
                      <th>Account Status</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {users.map(u => (
                      <tr key={u.id}>
                        <td>
                          <div style={{ fontWeight: 600 }}>{u.name}</div>
                          <div style={{ fontSize: '0.8rem', color: 'var(--gray-600)' }}>{u.email}</div>
                        </td>
                        <td>
                          <span className="role-badge" style={{ textTransform: 'capitalize' }}>
                            {u.role}
                          </span>
                        </td>
                        <td>
                          <span className={`badge ${u.is_active ? 'badge-active' : 'badge-inactive'}`}>
                            {u.is_active ? 'Active' : 'Deactivated'}
                          </span>
                        </td>
                        <td>
                          {u.id === user?.id ? (
                            <span style={{ fontSize: '0.75rem', color: 'var(--gray-500)' }}>Current User</span>
                          ) : (
                            <button
                              className="btn btn-sm btn-outline"
                              onClick={() => handleToggleUserActive(u)}
                            >
                              {u.is_active ? 'Deactivate' : 'Reactivate'}
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Month Locks Tab (Owner Only) */}
      {activeTab === 'locks' && isOwner && (
        <div style={{ maxWidth: '680px' }}>
          <div className="card mb-2">
            <h3 className="card-title">Lock Completed Attendance Month</h3>
            <p className="text-sm text-muted mb-2">
              Locking prevents managers and owners from accidentally modifying completed payroll periods.
            </p>

            <form onSubmit={handleLockMonth} style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center' }}>
              <select value={lockMonth} onChange={e => setLockMonth(Number(e.target.value))}>
                {MONTH_NAMES.map((name, i) => (
                  <option key={name} value={i + 1}>
                    {name}
                  </option>
                ))}
              </select>
              <input
                type="number"
                value={lockYear}
                onChange={e => setLockYear(Number(e.target.value))}
                style={{ width: '100px' }}
                min={2020}
                max={2030}
              />
              <button type="submit" className="btn btn-primary btn-sm">
                🔒 Lock This Month
              </button>
            </form>
          </div>

          <div className="card">
            <h3 className="card-title">Currently Locked Periods ({locks.length})</h3>
            {locksLoading ? (
              <LoadingSpinner message="Checking lock registry…" />
            ) : locks.length === 0 ? (
              <p className="text-sm text-muted">No months are locked.</p>
            ) : (
              <div className="table-wrapper">
                <table>
                  <thead>
                    <tr>
                      <th>Month</th>
                      <th>Locked By</th>
                      <th>Locked At</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {locks.map(l => (
                      <tr key={l.id}>
                        <td style={{ fontWeight: 600 }}>
                          {MONTH_NAMES[l.month - 1]} {l.year}
                        </td>
                        <td>{l.locked_by_name}</td>
                        <td style={{ fontSize: '0.8rem' }}>
                          {new Date(l.locked_at).toLocaleDateString('en-IN', {
                            year: 'numeric',
                            month: 'short',
                            day: 'numeric',
                          })}
                        </td>
                        <td>
                          <button
                            className="btn btn-sm btn-outline"
                            onClick={() => setUnlockConfirm({ year: l.year, month: l.month })}
                          >
                            🔓 Unlock
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Staff Email Notifications Tab (Owner Only) */}
      {activeTab === 'notifications' && isOwner && (
        <div>
          {notifError && <ErrorBanner message={notifError} onRetry={fetchNotifications} />}

          {/* Section A: Manual Monthly Report Dispatch & Preview */}
          <div className="card mb-2">
            <div style={{ background: '#e0f2fe', border: '1px solid #7dd3fc', borderRadius: '6px', padding: '0.75rem 1rem', marginBottom: '1.25rem', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <span style={{ fontSize: '1.25rem' }}>📅</span>
              <div style={{ fontSize: '0.85rem', color: '#0369a1' }}>
                <strong>Automated 1st-of-Month Scheduler:</strong> Active and scheduled to run automatically on the <strong>1st of every month at 09:00 AM IST</strong>. All staff with an email and notifications enabled receive a detailed statement of total attendance, absent days, half days, and approved leaves for the concluding month.
              </div>
            </div>

            <h3 className="card-title">Staff Monthly Report Email Dispatch</h3>
            <p className="text-sm text-muted mb-2">
              Preview and send an individual employee their monthly attendance report. Only the employee's own records are included.
            </p>

            <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center', marginBottom: '1rem' }}>
              <select
                value={selectedStaffId}
                onChange={e => setSelectedStaffId(e.target.value)}
                style={{ minWidth: '220px' }}
              >
                {staffList.map(s => (
                  <option key={s.id} value={s.id}>
                    {s.full_name || s.name} ({s.employee_id}) {s.email ? `• ${s.email}` : '• [No email]'}
                  </option>
                ))}
              </select>

              <select value={reportMonth} onChange={e => setReportMonth(Number(e.target.value))}>
                {MONTH_NAMES.map((name, i) => (
                  <option key={name} value={i + 1}>
                    {name}
                  </option>
                ))}
              </select>

              <input
                type="number"
                value={reportYear}
                onChange={e => setReportYear(Number(e.target.value))}
                style={{ width: '90px' }}
                min={2020}
                max={2030}
              />

              <button
                className="btn btn-sm btn-outline"
                onClick={handlePreviewReport}
                disabled={previewLoading || !selectedStaffId}
              >
                {previewLoading ? 'Generating Preview…' : '👁️ Preview Report'}
              </button>

              <button
                className="btn btn-sm btn-primary"
                onClick={() => handleSendReport(false)}
                disabled={sendingReport || !selectedStaffId}
              >
                {sendingReport ? 'Queuing…' : '✉️ Send Report to Staff'}
              </button>
            </div>

            {sendSuccessMessage && (
              <div className="alert alert-success mb-2">
                ✓ {sendSuccessMessage}
              </div>
            )}

            {/* Resend confirmation prompt */}
            {resendConfirmPrompt && (
              <div style={{ background: '#FFF3E0', border: '1px solid #EF6C00', padding: '1rem', borderRadius: '6px', marginBottom: '1rem' }}>
                <p style={{ margin: '0 0 0.5rem 0', color: '#B26A00', fontSize: '0.85rem' }}>
                  ⚠️ {resendConfirmPrompt}
                </p>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <button
                    className="btn btn-sm btn-primary"
                    onClick={() => handleSendReport(true)}
                    disabled={sendingReport}
                  >
                    Confirm & Resend Report
                  </button>
                  <button
                    className="btn btn-sm btn-secondary"
                    onClick={() => setResendConfirmPrompt(null)}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {/* Preview Modal / Container */}
            {previewData && (
              <div style={{ background: '#f8fafc', border: '1px solid #cbd5e1', borderRadius: '6px', padding: '1.25rem', marginTop: '1rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                  <h4 style={{ margin: 0, color: '#1B2A4A' }}>Report Email Preview: {previewData.subject}</h4>
                  <button className="btn btn-sm btn-ghost" onClick={() => setPreviewData(null)}>✕ Close</button>
                </div>
                <div
                  style={{ background: '#fff', padding: '1rem', borderRadius: '4px', border: '1px solid #e2e8f0', maxHeight: '350px', overflowY: 'auto' }}
                  dangerouslySetInnerHTML={{ __html: previewData.body_html }}
                />
              </div>
            )}
          </div>

          {/* Section B: Notification Outbox & Delivery History */}
          <div className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '1rem' }}>
              <div>
                <h3 className="card-title" style={{ margin: 0 }}>Notification Outbox & Delivery Log ({notificationsTotal})</h3>
                <p className="text-sm text-muted" style={{ margin: 0 }}>
                  Durable database outbox tracking absence alerts and monthly reports.
                </p>
              </div>

              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                <select
                  value={notifStatusFilter}
                  onChange={e => setNotifStatusFilter(e.target.value)}
                  style={{ maxWidth: '160px', fontSize: '0.85rem' }}
                >
                  <option value="all">All Statuses</option>
                  <option value="queued">Queued</option>
                  <option value="provider_accepted">Provider Accepted</option>
                  <option value="delivered">Delivered</option>
                  <option value="failed">Failed</option>
                </select>

                <button
                  className="btn btn-sm btn-outline"
                  onClick={handleProcessOutbox}
                  disabled={processingOutbox}
                  title="Flushes queued outbox messages"
                >
                  {processingOutbox ? 'Processing…' : '⚡ Process Outbox Now'}
                </button>
              </div>
            </div>

            {processResult && (
              <div className="alert alert-info mb-2" style={{ fontSize: '0.85rem' }}>
                {processResult}
              </div>
            )}

            {notifLoading ? (
              <LoadingSpinner message="Loading outbox history…" />
            ) : notifications.length === 0 ? (
              <p className="text-sm text-muted">No notification records in outbox.</p>
            ) : (
              <div className="table-wrapper">
                <table>
                  <thead>
                    <tr>
                      <th>Recipient / Staff</th>
                      <th>Type</th>
                      <th>Subject</th>
                      <th>Status</th>
                      <th>Queued At</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {notifications.map(n => (
                      <tr key={n.id}>
                        <td>
                          <div style={{ fontWeight: 600 }}>{n.staff_name || 'Staff'}</div>
                          <div style={{ fontSize: '0.75rem', color: '#64748b' }}>{n.recipient_email}</div>
                        </td>
                        <td>
                          <span style={{ fontSize: '0.75rem', textTransform: 'capitalize' }}>
                            {n.notification_type.replace('_', ' ')}
                          </span>
                        </td>
                        <td style={{ fontSize: '0.8rem', maxWidth: '240px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={n.subject}>
                          {n.subject}
                        </td>
                        <td>
                          <span
                            style={{
                              display: 'inline-block',
                              padding: '0.15rem 0.45rem',
                              borderRadius: '4px',
                              fontSize: '0.75rem',
                              fontWeight: 600,
                              background:
                                n.status === 'delivered'
                                  ? '#dcfce7'
                                  : n.status === 'provider_accepted'
                                  ? '#e0f2fe'
                                  : n.status === 'queued'
                                  ? '#fef9c3'
                                  : '#fee2e2',
                              color:
                                n.status === 'delivered'
                                  ? '#166534'
                                  : n.status === 'provider_accepted'
                                  ? '#0369a1'
                                  : n.status === 'queued'
                                  ? '#854d0e'
                                  : '#991b1b',
                            }}
                          >
                            {n.status === 'provider_accepted'
                              ? 'Provider Accepted'
                              : n.status === 'delivered'
                              ? 'Delivered'
                              : n.status === 'queued'
                              ? `Queued (Try ${n.attempt_count + 1}/${n.max_attempts})`
                              : 'Failed'}
                          </span>
                          {n.error_message && (
                            <div style={{ fontSize: '0.7rem', color: '#dc2626', marginTop: '0.2rem' }}>
                              {n.error_message}
                            </div>
                          )}
                        </td>
                        <td style={{ fontSize: '0.75rem', color: '#64748b' }}>
                          {new Date(n.created_at).toLocaleDateString('en-IN', {
                            month: 'short',
                            day: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </td>
                        <td>
                          {n.status === 'failed' && (
                            <button
                              className="btn btn-sm btn-outline"
                              onClick={() => handleRetryNotification(n.id)}
                            >
                              Retry
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* System Health Tab (Owner Only) */}
      {activeTab === 'system' && isOwner && (
        <div style={{ maxWidth: '600px' }}>
          <div className="card">
            <h3 className="card-title">Database & Backend Health</h3>
            <p className="text-sm text-muted mb-2">
              Executes an authenticated database handshake to confirm operational connectivity. Credentials and connection strings remain strictly secured on the server.
            </p>

            <button
              className="btn btn-primary mb-2"
              onClick={handleRunHealthCheck}
              disabled={healthLoading}
            >
              {healthLoading ? 'Testing Connectivity…' : 'Check Database Connection'}
            </button>

            {healthStatus && (
              <div
                className={`alert ${healthStatus.db_connected ? 'alert-success' : 'alert-error'}`}
              >
                <div>
                  <strong>
                    {healthStatus.db_connected
                      ? '✓ Database Connected and Healthy'
                      : '✕ Database Connectivity Failure'}
                  </strong>
                  <div style={{ fontSize: '0.8rem', marginTop: '0.2rem' }}>
                    Status: {healthStatus.status} | Handshake Timestamp: {healthStatus.timestamp}
                  </div>
                  {healthStatus.error && (
                    <div style={{ fontSize: '0.75rem', marginTop: '0.2rem', color: 'red' }}>
                      {healthStatus.error}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Unlock Confirmation Dialog */}
      {unlockConfirm && (
        <ConfirmDialog
          title="Unlock Month?"
          message={`Are you sure you want to unlock ${MONTH_NAMES[unlockConfirm.month - 1]} ${unlockConfirm.year}? This will allow managers and owners to modify attendance records for this period.`}
          confirmLabel="Unlock Month"
          variant="warning"
          onConfirm={handleConfirmUnlock}
          onCancel={() => setUnlockConfirm(null)}
        />
      )}
    </div>
  );
}
