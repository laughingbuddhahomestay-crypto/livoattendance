import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, ApiResponseError } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { useUnsavedChanges } from '../hooks/useUnsavedChanges';
import {
  type AttendanceStatus,
  type AttendanceRecord,
  type Staff,
  STATUS_LABELS,
  ALL_STATUSES,
  todayIST,
  formatWorkingHours,
  toDatetimeLocalValue,
  parseDatetimeLocalToIST,
  isSameTime,
} from '../types';
import LoadingSpinner from '../components/LoadingSpinner';
import ErrorBanner from '../components/ErrorBanner';
import StatusBadge from '../components/StatusBadge';
import ConfirmDialog from '../components/ConfirmDialog';

interface EditedEntry {
  staff_id: string;
  status?: AttendanceStatus | '';
  shift?: string;
  check_in?: string;
  check_out?: string;
  notes?: string;
  version?: number;
  reason?: string;
}

export default function AttendancePage() {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const initialDate = searchParams.get('date') || todayIST();
  const initialFilter = searchParams.get('filter') || 'all';

  const [date, setDate] = useState(initialDate);
  const [staffList, setStaffList] = useState<Staff[]>([]);
  const [originalRecords, setOriginalRecords] = useState<Map<string, AttendanceRecord>>(new Map());
  const [editedEntries, setEditedEntries] = useState<Map<string, EditedEntry>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [partialSaveInfo, setPartialSaveInfo] = useState<{
    saved: number;
    conflicts: Array<{ staff_id: string; current_version: number; staff_name?: string }>;
  } | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>(initialFilter);
  const [expandedNotes, setExpandedNotes] = useState<Set<string>>(new Set());
  const [monthLocked, setMonthLocked] = useState(false);
  const [reasonDialog, setReasonDialog] = useState<{
    open: boolean;
    staffIds: string[];
    reasons: Map<string, string>;
    currentIndex: number;
  }>({ open: false, staffIds: [], reasons: new Map(), currentIndex: 0 });
  const [confirmDiscard, setConfirmDiscard] = useState(false);

  const hasChanges = editedEntries.size > 0;
  useUnsavedChanges(hasChanges);

  const fetchAttendance = useCallback(async () => {
    setLoading(true);
    setError('');
    setSaveSuccess(false);
    try {
      const data = await api.getAttendance(date);
      const records = (data as any).records || [];
      const staff = (data as any).staff || [];
      setStaffList(staff);
      const recMap = new Map<string, AttendanceRecord>();
      for (const r of records) {
        recMap.set(r.staff_id, r);
      }
      setOriginalRecords(recMap);

      // Check month lock
      try {
        const locksData = await api.getMonthLocks();
        const [y, m] = date.split('-').map(Number);
        const locks = (locksData as any).locks || [];
        const isLocked = locks.some((l: any) => l.year === y && l.month === m);
        setMonthLocked(isLocked);
      } catch {
        setMonthLocked(false);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to load attendance data');
    } finally {
      setLoading(false);
    }
  }, [date]);

  useEffect(() => {
    fetchAttendance();
  }, [fetchAttendance]);

  const sortedStaff = useMemo(() => {
    return [...staffList].sort((a, b) => {
      const deptCmp = (a.department || '').localeCompare(b.department || '');
      if (deptCmp !== 0) return deptCmp;
      const nameA = a.full_name || a.name || '';
      const nameB = b.full_name || b.name || '';
      return nameA.localeCompare(nameB);
    });
  }, [staffList]);

  // Attendance vs Non-attendance counts
  const counts = useMemo(() => {
    let total = sortedStaff.length;
    let attendance = 0;
    let nonAttendance = 0;
    let absent = 0;
    let notMarked = 0;

    for (const s of sortedStaff) {
      const entry = editedEntries.get(s.id);
      const original = originalRecords.get(s.id);
      const currentStatus =
        entry?.status !== undefined
          ? entry.status
          : (original?.status !== undefined ? original.status : 'present');

      if (!original && !entry) {
        notMarked++;
      }

      if (currentStatus === 'absent' || currentStatus === 'unpaid_leave') {
        if (currentStatus === 'absent') absent++;
        nonAttendance++;
      } else {
        // present, half_day, paid_leave, weekly_off
        attendance++;
      }
    }

    return { total, attendance, nonAttendance, absent, notMarked };
  }, [sortedStaff, editedEntries, originalRecords]);

  const filteredStaff = useMemo(() => {
    return sortedStaff.filter(s => {
      const staffName = s.full_name || s.name || '';
      if (search) {
        const q = search.toLowerCase();
        if (!staffName.toLowerCase().includes(q) && !s.employee_id.toLowerCase().includes(q)) {
          return false;
        }
      }
      if (statusFilter !== 'all') {
        const entry = editedEntries.get(s.id);
        const original = originalRecords.get(s.id);
        const currentStatus =
          entry?.status !== undefined
            ? entry.status
            : (original?.status !== undefined ? original.status : 'present');

        if (statusFilter === 'attendance') {
          // Attendance includes Present, Half Day, Paid Leave, Weekly Off
          if (!currentStatus || (currentStatus !== 'present' && currentStatus !== 'half_day' && currentStatus !== 'paid_leave' && currentStatus !== 'weekly_off')) {
            return false;
          }
        } else if (statusFilter === 'non_attendance') {
          // Non-attendance includes Absent, Unpaid Leave
          if (currentStatus !== 'absent' && currentStatus !== 'unpaid_leave') {
            return false;
          }
        } else if (statusFilter === 'not_marked') {
          if (original || entry) return false;
        } else {
          if (currentStatus !== statusFilter) return false;
        }
      }
      return true;
    });
  }, [sortedStaff, search, statusFilter, editedEntries, originalRecords]);

  const handleDateChange = (newDate: string) => {
    setDate(newDate);
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      next.set('date', newDate);
      return next;
    });
  };

  const handleFilterChange = (newFilter: string) => {
    setStatusFilter(newFilter);
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      if (newFilter !== 'all') {
        next.set('filter', newFilter);
      } else {
        next.delete('filter');
      }
      return next;
    });
  };

  const isEditable = !monthLocked || user?.role === 'owner';

  const getFieldValue = (staffId: string, field: keyof EditedEntry) => {
    const edited = editedEntries.get(staffId);
    if (edited && edited[field] !== undefined) {
      return edited[field];
    }
    const original = originalRecords.get(staffId);
    if (original && (original as any)[field] !== undefined) {
      return (original as any)[field];
    }
    if (field === 'status') {
      return 'present'; // Default unmarked staff to Present
    }
    if (field === 'shift') {
      const staff = staffList.find(s => s.id === staffId);
      return staff?.default_shift || '';
    }
    return '';
  };

  const updateEntry = useCallback(
    (staffId: string, field: keyof EditedEntry, value: any) => {
      if (!isEditable) return;
      setEditedEntries(prev => {
        const next = new Map(prev);
        const existing = next.get(staffId) || { staff_id: staffId };
        const original = originalRecords.get(staffId);

        if (existing.version === undefined && original?.version !== undefined) {
          existing.version = original.version;
        }

        const updated = { ...existing, [field]: value };

        // Check if identical to original (or identical to default 'present' for new entry)
        const origStatus = original?.status || 'present';
        const origShift = original?.shift || '';
        const origCheckIn = original?.check_in || '';
        const origCheckOut = original?.check_out || '';
        const origNotes = original?.notes || '';

        const curStatus = updated.status !== undefined ? updated.status : origStatus;
        const curShift = updated.shift !== undefined ? updated.shift : origShift;
        const curCheckIn = updated.check_in !== undefined ? updated.check_in : origCheckIn;
        const curCheckOut = updated.check_out !== undefined ? updated.check_out : origCheckOut;
        const curNotes = updated.notes !== undefined ? updated.notes : origNotes;

        if (
          ((original && curStatus === origStatus) || (!original && curStatus === 'present')) &&
          curShift === origShift &&
          isSameTime(curCheckIn, origCheckIn) &&
          isSameTime(curCheckOut, origCheckOut) &&
          curNotes === origNotes
        ) {
          next.delete(staffId);
        } else {
          next.set(staffId, updated);
        }
        return next;
      });
    },
    [isEditable, originalRecords]
  );

  const markAllPresent = useCallback(() => {
    if (!isEditable) return;
    setEditedEntries(prev => {
      const next = new Map(prev);
      for (const staff of staffList) {
        const original = originalRecords.get(staff.id);
        const edited = next.get(staff.id);
        const currentStatus = edited?.status !== undefined ? edited.status : original?.status;

        if (!currentStatus) {
          const entry: EditedEntry = {
            staff_id: staff.id,
            status: 'present',
            shift: edited?.shift || original?.shift || staff.default_shift || '',
          };
          if (original?.version !== undefined) entry.version = original.version;
          next.set(staff.id, entry);
        }
      }
      return next;
    });
  }, [staffList, originalRecords, isEditable]);

  const discardChanges = useCallback(() => {
    setEditedEntries(new Map());
    setConfirmDiscard(false);
    setPartialSaveInfo(null);
  }, []);

  const performSave = useCallback(
    async (entriesMapOverride?: Map<string, EditedEntry>) => {
      const activeEntries = entriesMapOverride || editedEntries;
      if (activeEntries.size === 0) return;
      setSaving(true);
      setError('');
      setSaveSuccess(false);
      setPartialSaveInfo(null);
      try {
        const entries = Array.from(activeEntries.values())
          .map(entry => {
            const original = originalRecords.get(entry.staff_id);
            const finalStatus = entry.status !== undefined ? entry.status : original?.status;
            const finalShift = entry.shift !== undefined ? entry.shift : original?.shift;
            const finalCheckIn = entry.check_in !== undefined ? entry.check_in : original?.check_in;
            const finalCheckOut = entry.check_out !== undefined ? entry.check_out : original?.check_out;
            const finalNotes = entry.notes !== undefined ? entry.notes : original?.notes;

            const payload: any = {
              staff_id: entry.staff_id,
              status: finalStatus,
            };
            if (finalShift) payload.shift = finalShift;
            if (finalCheckIn) payload.check_in = parseDatetimeLocalToIST(finalCheckIn);
            if (finalCheckOut) payload.check_out = parseDatetimeLocalToIST(finalCheckOut);
            if (finalNotes) payload.notes = finalNotes;
            if (entry.version !== undefined) payload.version = entry.version;
            else if (original?.version !== undefined) payload.version = original.version;
            if (entry.reason) payload.reason = entry.reason;
            return payload;
          })
          .filter(e => Boolean(e.status));

        const result: any = await api.saveAttendance({ date, entries });
        const conflicts = result.conflicts || [];
        const savedStaffIds = new Set<string>(result.saved_staff_ids || []);

        if (conflicts.length > 0) {
          // Partial save or full conflict: retain failed drafts in state, DO NOT show general success
          setPartialSaveInfo({
            saved: result.saved,
            conflicts,
          });

          // Remove only successfully saved staff from editedEntries Map
          setEditedEntries(prev => {
            const next = new Map(entriesMapOverride || prev);
            for (const id of savedStaffIds) {
              next.delete(id);
            }
            return next;
          });

          // Refetch latest records to refresh versions and background state
          await fetchAttendance();
        } else {
          // Full success
          setEditedEntries(new Map());
          setSaveSuccess(true);
          setTimeout(() => setSaveSuccess(false), 3500);
          await fetchAttendance();
        }
      } catch (err: any) {
        if (err instanceof ApiResponseError && err.isConflict) {
          const body = (err as any).body || {};
          setPartialSaveInfo({
            saved: body.saved || 0,
            conflicts: body.conflicts || [],
          });
          await fetchAttendance();
        } else {
          setError(err.message || 'Failed to save attendance records');
        }
      } finally {
        setSaving(false);
      }
    },
    [editedEntries, date, fetchAttendance]
  );

  const handleSave = useCallback(async () => {
    // Collect all entries to save:
    // 1. All explicitly edited entries
    // 2. Any staff not yet marked in the DB (default to 'present')
    const fullEntries = new Map(editedEntries);
    for (const staff of staffList) {
      if (!originalRecords.has(staff.id) && !fullEntries.has(staff.id)) {
        fullEntries.set(staff.id, {
          staff_id: staff.id,
          status: 'present',
          shift: staff.default_shift || '',
        });
      }
    }

    if (fullEntries.size === 0) return;

    // Check for updates that need an audit reason (only for previously existing records whose status changed)
    const updatesNeedingReason: string[] = [];
    fullEntries.forEach((entry, staffId) => {
      const original = originalRecords.get(staffId);
      if (original && entry.status !== undefined && entry.status !== original.status && !entry.reason) {
        updatesNeedingReason.push(staffId);
      }
    });

    if (updatesNeedingReason.length > 0) {
      setReasonDialog({
        open: true,
        staffIds: updatesNeedingReason,
        reasons: new Map(),
        currentIndex: 0,
      });
      return;
    }

    await performSave(fullEntries);
  }, [editedEntries, staffList, originalRecords, performSave]);

  const handleReasonSubmit = useCallback(() => {
    const { staffIds, reasons } = reasonDialog;
    const nextMap = new Map(editedEntries);
    for (const staff of staffList) {
      if (!originalRecords.has(staff.id) && !nextMap.has(staff.id)) {
        nextMap.set(staff.id, {
          staff_id: staff.id,
          status: 'present',
          shift: staff.default_shift || '',
        });
      }
    }
    for (const staffId of staffIds) {
      const entry = nextMap.get(staffId);
      if (entry) {
        nextMap.set(staffId, {
          ...entry,
          reason: reasons.get(staffId) || 'Attendance correction',
        });
      }
    }
    setEditedEntries(nextMap);
    setReasonDialog({ open: false, staffIds: [], reasons: new Map(), currentIndex: 0 });
    performSave(nextMap);
  }, [reasonDialog, editedEntries, staffList, originalRecords, performSave]);

  const toggleNotes = (staffId: string) => {
    setExpandedNotes(prev => {
      const next = new Set(prev);
      if (next.has(staffId)) next.delete(staffId);
      else next.add(staffId);
      return next;
    });
  };

  if (loading) return <LoadingSpinner message="Loading attendance records…" />;

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Daily Attendance</h1>
          <p className="page-subtitle">Mark and review attendance in Asia/Kolkata timezone</p>
        </div>
      </div>

      {error && <ErrorBanner message={error} onRetry={fetchAttendance} />}

      {monthLocked && (
        <div className="lock-banner">
          🔒 <strong>Month Locked:</strong> This month is locked against further edits.{' '}
          {user?.role === 'owner'
            ? 'Unlock it from Settings to make changes.'
            : 'Contact the owner to unlock it.'}
        </div>
      )}

      {/* Partial save warning banner (HTTP 207) */}
      {partialSaveInfo && (
        <div
          style={{
            background: '#FFF3E0',
            border: '1px solid #EF6C00',
            borderRadius: '8px',
            padding: '1rem',
            marginBottom: '1rem',
          }}
        >
          <div style={{ color: '#E65100', fontWeight: 700, fontSize: '0.95rem', marginBottom: '0.25rem' }}>
            ⚠️ Partial Save Notice (HTTP 207 Multi-Status)
          </div>
          <p style={{ margin: '0 0 0.5rem 0', fontSize: '0.85rem', color: '#5D4037' }}>
            <strong>{partialSaveInfo.saved} record(s)</strong> were saved successfully. However,{' '}
            <strong>{partialSaveInfo.conflicts.length} record(s)</strong> failed due to simultaneous edits by another user.
            Your unsaved changes for the conflicting records have been retained below for your review.
          </p>
          <div style={{ fontSize: '0.8rem', color: '#4E342E' }}>
            <strong>Conflicting Staff:</strong>{' '}
            {partialSaveInfo.conflicts
              .map(c => {
                const s = staffList.find(st => st.id === c.staff_id);
                return s?.full_name || s?.name || c.staff_name || c.staff_id;
              })
              .join(', ')}
          </div>
        </div>
      )}

      {/* Quick summary and filter pills */}
      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.75rem', alignItems: 'center' }}>
        <button
          type="button"
          className={`btn btn-sm ${statusFilter === 'all' ? 'btn-primary' : 'btn-outline'}`}
          onClick={() => handleFilterChange('all')}
        >
          All Staff ({counts.total})
        </button>
        <button
          type="button"
          className={`btn btn-sm ${statusFilter === 'attendance' ? 'btn-primary' : 'btn-outline'}`}
          style={statusFilter === 'attendance' ? { background: '#2e7d32', borderColor: '#2e7d32', color: '#fff' } : { borderColor: '#2e7d32', color: '#2e7d32' }}
          onClick={() => handleFilterChange('attendance')}
        >
          ✓ Attendance ({counts.attendance})
        </button>
        <button
          type="button"
          className={`btn btn-sm ${statusFilter === 'non_attendance' ? 'btn-primary' : 'btn-outline'}`}
          style={statusFilter === 'non_attendance' ? { background: '#c62828', borderColor: '#c62828', color: '#fff' } : { borderColor: '#c62828', color: '#c62828' }}
          onClick={() => handleFilterChange('non_attendance')}
        >
          ✕ Non-Attendance ({counts.nonAttendance})
        </button>
        <button
          type="button"
          className={`btn btn-sm ${statusFilter === 'absent' ? 'btn-primary' : 'btn-outline'}`}
          onClick={() => handleFilterChange('absent')}
        >
          Absent ({counts.absent})
        </button>
        <button
          type="button"
          className={`btn btn-sm ${statusFilter === 'not_marked' ? 'btn-primary' : 'btn-outline'}`}
          onClick={() => handleFilterChange('not_marked')}
        >
          Not Marked ({counts.notMarked})
        </button>
        {user?.role === 'owner' && (
          <Link
            to={`/audit?date=${date}`}
            className="btn btn-sm btn-ghost"
            style={{ marginLeft: 'auto', textDecoration: 'none', color: 'var(--primary)', fontWeight: 600 }}
          >
            📋 View Day's Audit Trail ↗
          </Link>
        )}
      </div>

      <div className="toolbar">
        <input
          type="date"
          value={date}
          max={todayIST()}
          onChange={e => handleDateChange(e.target.value)}
          style={{ maxWidth: '180px' }}
        />
        <input
          type="search"
          placeholder="Search staff by name or ID…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ maxWidth: '240px' }}
        />
        <select
          value={statusFilter}
          onChange={e => handleFilterChange(e.target.value)}
          style={{ maxWidth: '220px' }}
        >
          <option value="all">All Staff ({counts.total})</option>
          <option value="attendance">✓ Attendance ({counts.attendance})</option>
          <option value="non_attendance">✕ Non-Attendance ({counts.nonAttendance})</option>
          <option value="present">Present</option>
          <option value="absent">Absent ({counts.absent})</option>
          <option value="half_day">Half Day</option>
          <option value="weekly_off">Weekly Off</option>
          <option value="paid_leave">Paid Leave</option>
          <option value="unpaid_leave">Unpaid Leave</option>
          <option value="not_marked">Not Marked ({counts.notMarked})</option>
        </select>
        {isEditable && (
          <button
            className="btn btn-primary"
            onClick={handleSave}
            disabled={saving || (counts.notMarked === 0 && !hasChanges)}
            style={{ fontWeight: 600 }}
          >
            {saving
              ? 'Saving…'
              : counts.notMarked > 0
              ? `💾 Save Attendance (${counts.total} Staff)`
              : hasChanges
              ? `💾 Save Changes (${editedEntries.size})`
              : '✓ Saved to Database'}
          </button>
        )}
      </div>

      {saveSuccess && (
        <div className="alert alert-success">
          ✓ All attendance records saved successfully to the database.
        </div>
      )}

      {staffList.length === 0 ? (
        <div className="card empty-state">
          <div className="empty-state-icon">👥</div>
          <p>No staff employed on {date}.</p>
        </div>
      ) : filteredStaff.length === 0 ? (
        <div className="card empty-state">
          <div className="empty-state-icon">🔍</div>
          <p>No staff match the current filters.</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', paddingBottom: hasChanges ? '5rem' : '1rem' }}>
          {filteredStaff.map(staff => {
            const original = originalRecords.get(staff.id);
            const isModified = editedEntries.has(staff.id);
            const currentStatus = getFieldValue(staff.id, 'status') as AttendanceStatus | '';
            const shift = (getFieldValue(staff.id, 'shift') as string) || '';
            const checkIn = (getFieldValue(staff.id, 'check_in') as string) || '';
            const checkOut = (getFieldValue(staff.id, 'check_out') as string) || '';
            const notes = (getFieldValue(staff.id, 'notes') as string) || '';
            const workHours = formatWorkingHours(checkIn, checkOut);
            const notesExpanded = expandedNotes.has(staff.id);

            return (
              <div
                key={staff.id}
                className={`attendance-card ${isModified ? 'modified' : ''}`}
              >
                <div className="attendance-card-header">
                  <div>
                    <div className="attendance-staff-name">
                      {staff.full_name || staff.name}
                    </div>
                    <div className="attendance-staff-meta">
                      ID: {staff.employee_id} • {staff.department}
                    </div>
                  </div>
                  {currentStatus ? (
                    <StatusBadge status={currentStatus} />
                  ) : (
                    <span className="badge badge-inactive">Not Marked</span>
                  )}
                </div>

                <div className="attendance-fields">
                  <div className="attendance-field">
                    <label>Status</label>
                    <select
                      value={currentStatus}
                      onChange={e => updateEntry(staff.id, 'status', e.target.value)}
                      disabled={!isEditable}
                      className="status-select"
                    >
                      <option value="">Select status…</option>
                      {ALL_STATUSES.map(s => (
                        <option key={s} value={s}>
                          {STATUS_LABELS[s]}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="attendance-field">
                    <label>Shift</label>
                    <input
                      type="text"
                      value={shift}
                      onChange={e => updateEntry(staff.id, 'shift', e.target.value)}
                      placeholder={staff.default_shift || 'e.g. Morning, Night'}
                      disabled={!isEditable}
                    />
                  </div>

                  <div className="attendance-field">
                    <label>Check In</label>
                    <input
                      type="datetime-local"
                      value={toDatetimeLocalValue(checkIn)}
                      onChange={e => updateEntry(staff.id, 'check_in', e.target.value)}
                      disabled={!isEditable}
                    />
                  </div>

                  <div className="attendance-field">
                    <label>Check Out</label>
                    <input
                      type="datetime-local"
                      value={toDatetimeLocalValue(checkOut)}
                      onChange={e => updateEntry(staff.id, 'check_out', e.target.value)}
                      disabled={!isEditable}
                    />
                  </div>
                </div>

                {/* Working hours indicator: clearly distinguishes Recorded vs Incomplete vs Not Recorded */}
                <div style={{ marginTop: '0.45rem', fontSize: '0.8rem' }}>
                  {workHours.status === 'recorded' && (
                    <span style={{ color: '#1B2A4A', fontWeight: 600 }}>
                      ⏱ Recorded hours: <strong>{workHours.hours}h</strong> (overnight shift calculated)
                    </span>
                  )}
                  {workHours.status === 'incomplete' && (
                    <span style={{ color: '#d97706', fontWeight: 500 }}>
                      ⚠️ Working hours: <em>Incomplete</em> (missing check-in or check-out)
                    </span>
                  )}
                  {workHours.status === 'invalid' && (
                    <span style={{ color: '#dc2626', fontWeight: 500 }}>
                      ⚠️ Working hours: <em>Invalid duration</em> (check-out must be after check-in)
                    </span>
                  )}
                  {workHours.status === 'not_recorded' && (
                    <span style={{ color: '#94a3b8' }}>
                      Working hours: <em>Not recorded</em>
                    </span>
                  )}
                </div>

                <div className="attendance-notes">
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={() => toggleNotes(staff.id)}
                    style={{ paddingLeft: 0 }}
                  >
                    {notesExpanded ? '▾ Hide Notes' : '▸ Add Notes / Remarks'}
                  </button>
                  {notesExpanded && (
                    <textarea
                      value={notes}
                      onChange={e => updateEntry(staff.id, 'notes', e.target.value)}
                      placeholder="Optional notes for this day's attendance..."
                      disabled={!isEditable}
                    />
                  )}
                </div>

                {/* Manager attribution & audit trail link */}
                {original && (original.created_by_name || original.updated_by_name) ? (
                  <div
                    style={{
                      marginTop: '0.6rem',
                      padding: '0.4rem 0.65rem',
                      background: '#f8fafc',
                      border: '1px solid #e2e8f0',
                      borderRadius: '6px',
                      fontSize: '0.75rem',
                      color: '#475569',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      flexWrap: 'wrap',
                      gap: '0.4rem',
                    }}
                  >
                    <div>
                      {original.updated_by_name ? (
                        <span>
                          ✏️ Last updated by <strong>{original.updated_by_name}</strong>{' '}
                          <span
                            className={`badge badge-${original.updated_by_role === 'owner' ? 'owner' : 'manager'}`}
                            style={{ fontSize: '0.65rem', padding: '1px 5px', textTransform: 'uppercase' }}
                          >
                            {original.updated_by_role || 'MANAGER'}
                          </span>
                          {original.updated_at &&
                            ` at ${new Date(original.updated_at).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' })}`}
                        </span>
                      ) : (
                        <span>
                          📝 Marked by <strong>{original.created_by_name}</strong>{' '}
                          <span
                            className={`badge badge-${original.created_by_role === 'owner' ? 'owner' : 'manager'}`}
                            style={{ fontSize: '0.65rem', padding: '1px 5px', textTransform: 'uppercase' }}
                          >
                            {original.created_by_role || 'MANAGER'}
                          </span>
                          {original.created_at &&
                            ` at ${new Date(original.created_at).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' })}`}
                        </span>
                      )}
                    </div>
                    {user?.role === 'owner' && (
                      <Link
                        to={`/audit?staff_id=${staff.id}&date=${date}`}
                        style={{
                          fontSize: '0.75rem',
                          color: 'var(--primary)',
                          fontWeight: 600,
                          textDecoration: 'none',
                        }}
                      >
                        Audit Trail ↗
                      </Link>
                    )}
                  </div>
                ) : (
                  <div
                    style={{
                      marginTop: '0.4rem',
                      fontSize: '0.72rem',
                      color: '#059669',
                      fontWeight: 500,
                    }}
                  >
                    ● Pre-filled as Present • Ready to save
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Unsaved changes bar */}
      {hasChanges && (
        <div className="unsaved-bar">
          <span className="unsaved-text">
            ⚠️ {editedEntries.size} unsaved change{editedEntries.size > 1 ? 's' : ''}
          </span>
          <div className="flex gap-1">
            <button
              className="btn btn-outline btn-sm"
              onClick={() => setConfirmDiscard(true)}
              disabled={saving}
            >
              Discard Changes
            </button>
            <button className="btn btn-primary btn-sm" onClick={handleSave} disabled={saving}>
              {saving ? 'Saving…' : 'Save Attendance'}
            </button>
          </div>
        </div>
      )}

      {/* Discard confirmation dialog */}
      {confirmDiscard && (
        <ConfirmDialog
          title="Discard Unsaved Changes?"
          message="Are you sure you want to discard all your unsaved modifications? This cannot be undone."
          confirmLabel="Discard"
          onConfirm={discardChanges}
          onCancel={() => setConfirmDiscard(false)}
        />
      )}

      {/* Audit Reason Dialog */}
      {reasonDialog.open && (
        <div className="modal-backdrop">
          <div className="modal-card">
            <h3>Reason for Attendance Correction</h3>
            <p className="text-muted" style={{ fontSize: '0.85rem', marginBottom: '1rem' }}>
              Please provide a brief reason for correcting the attendance of{' '}
              <strong>
                {(() => {
                  const s = staffList.find(st => st.id === reasonDialog.staffIds[reasonDialog.currentIndex]);
                  return s?.full_name || s?.name || 'this staff member';
                })()}
              </strong>
              . This is recorded in the permanent audit trail.
            </p>
            <textarea
              className="input"
              rows={3}
              placeholder="e.g., Manager correction, late reporting approved, shift swap..."
              value={reasonDialog.reasons.get(reasonDialog.staffIds[reasonDialog.currentIndex]) || ''}
              onChange={e => {
                const val = e.target.value;
                setReasonDialog(prev => {
                  const nextReasons = new Map(prev.reasons);
                  nextReasons.set(prev.staffIds[prev.currentIndex], val);
                  return { ...prev, reasons: nextReasons };
                });
              }}
              style={{ width: '100%', marginBottom: '1rem' }}
              autoFocus
            />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
              <button
                className="btn btn-secondary"
                onClick={() => setReasonDialog({ open: false, staffIds: [], reasons: new Map(), currentIndex: 0 })}
              >
                Cancel
              </button>
              {reasonDialog.currentIndex < reasonDialog.staffIds.length - 1 ? (
                <button
                  className="btn btn-primary"
                  onClick={() =>
                    setReasonDialog(prev => ({
                      ...prev,
                      currentIndex: prev.currentIndex + 1,
                    }))
                  }
                >
                  Next ({reasonDialog.currentIndex + 1}/{reasonDialog.staffIds.length})
                </button>
              ) : (
                <button className="btn btn-primary" onClick={handleReasonSubmit}>
                  Confirm & Save
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
