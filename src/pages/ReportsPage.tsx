import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { api } from '../api/client';
import {
  STATUS_LABELS,
  STATUS_ABBR,
  STATUS_COLORS,
  MONTH_NAMES,
  todayIST,
  daysInMonth,
  type AttendanceStatus,
} from '../types';
import LoadingSpinner from '../components/LoadingSpinner';
import ErrorBanner from '../components/ErrorBanner';

interface MonthlyRow {
  staff_id: string;
  employee_id: string;
  full_name: string;
  department: string;
  joining_date: string;
  leaving_date: string | null;
  days: Record<number, AttendanceStatus | null>;
  totals: Record<AttendanceStatus, number>;
  total_hours: number | null;
}

export default function ReportsPage() {
  const currentIST = todayIST();
  const [currentYear, currentMonth] = currentIST.split('-').map(Number);

  const [year, setYear] = useState(currentYear);
  const [month, setMonth] = useState(currentMonth);
  const [rows, setRows] = useState<MonthlyRow[]>([]);
  const [monthLocked, setMonthLocked] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [departmentFilter, setDepartmentFilter] = useState('all');
  const [exporting, setExporting] = useState(false);

  // Selected staff for viewing detailed history
  const [selectedStaff, setSelectedStaff] = useState<MonthlyRow | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyRecords, setHistoryRecords] = useState<any[]>([]);

  const numDays = useMemo(() => daysInMonth(year, month), [year, month]);

  const fetchReport = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await api.getMonthlyReport(year, month);
      setRows((data.rows || []) as unknown as MonthlyRow[]);
      setMonthLocked(Boolean(data.month_locked));
    } catch (err: any) {
      setError(err.message || 'Failed to load monthly report');
    } finally {
      setLoading(false);
    }
  }, [year, month]);

  useEffect(() => {
    fetchReport();
  }, [fetchReport]);

  const handlePrevMonth = () => {
    if (month === 1) {
      setYear(y => y - 1);
      setMonth(12);
    } else {
      setMonth(m => m - 1);
    }
  };

  const handleNextMonth = () => {
    if (month === 12) {
      setYear(y => y + 1);
      setMonth(1);
    } else {
      setMonth(m => m + 1);
    }
  };

  const handleExportCSV = async () => {
    setExporting(true);
    try {
      const blob = await api.exportCSV(year, month);
      const downloadUrl = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = downloadUrl;
      link.download = `Livotel_Attendance_${year}_${String(month).padStart(2, '0')}.csv`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(downloadUrl);
    } catch (err: any) {
      alert(err.message || 'Failed to export CSV');
    } finally {
      setExporting(false);
    }
  };

  const handlePrint = () => {
    window.print();
  };

  const handleViewStaffHistory = async (staff: MonthlyRow) => {
    setSelectedStaff(staff);
    setHistoryLoading(true);
    try {
      const res = await api.getAttendanceHistory(staff.staff_id, year, month);
      setHistoryRecords(res.records || []);
    } catch (err: any) {
      alert(err.message || 'Failed to load staff history');
    } finally {
      setHistoryLoading(false);
    }
  };

  const departments = useMemo(() => {
    const set = new Set<string>();
    rows.forEach(r => {
      if (r.department) set.add(r.department);
    });
    return Array.from(set).sort();
  }, [rows]);

  const filteredRows = useMemo(() => {
    return rows.filter(r => {
      const matchSearch =
        !search ||
        r.full_name.toLowerCase().includes(search.toLowerCase()) ||
        r.employee_id.toLowerCase().includes(search.toLowerCase());
      const matchDept = departmentFilter === 'all' || r.department === departmentFilter;
      return matchSearch && matchDept;
    });
  }, [rows, search, departmentFilter]);

  return (
    <div className="reports-page">
      {/* Printable header */}
      <div className="print-header">
        <img src="/logo-light.png" alt="Livotel Premium Hotel" style={{ maxHeight: '48px', width: 'auto', marginBottom: '8px' }} />
        <h2>Livotel Premium Hotel, Bhubaneswar</h2>
        <h3>Staff Monthly Attendance Report — {MONTH_NAMES[month - 1]} {year}</h3>
      </div>

      <div className="page-header">
        <div>
          <h1 className="page-title">Monthly Attendance Report</h1>
          <p className="page-subtitle">
            {MONTH_NAMES[month - 1]} {year} {monthLocked && <span className="badge badge-inactive">Locked</span>}
          </p>
        </div>

        <div className="toolbar" style={{ margin: 0 }}>
          <button className="btn btn-sm btn-outline" onClick={handlePrevMonth} title="Previous Month">
            ◀ Prev
          </button>
          <span style={{ fontWeight: 600, minWidth: '130px', textAlign: 'center' }}>
            {MONTH_NAMES[month - 1]} {year}
          </span>
          <button className="btn btn-sm btn-outline" onClick={handleNextMonth} title="Next Month">
            Next ▶
          </button>
          <button
            className="btn btn-sm btn-outline"
            onClick={handleExportCSV}
            disabled={exporting || loading}
          >
            {exporting ? 'Exporting…' : '📥 Export CSV'}
          </button>
          <button className="btn btn-sm btn-primary" onClick={handlePrint} disabled={loading}>
            🖨️ Print Report
          </button>
        </div>
      </div>

      {error && <ErrorBanner message={error} onRetry={fetchReport} />}

      {monthLocked && (
        <div className="lock-banner">
          🔒 <strong>Completed Month Locked:</strong> This month has been finalized and locked by the owner. It cannot be altered without unlocking.
        </div>
      )}

      {/* Filter Toolbar */}
      <div className="toolbar">
        <input
          type="search"
          placeholder="Search by staff name or ID…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ minWidth: '220px' }}
        />
        <select
          value={departmentFilter}
          onChange={e => setDepartmentFilter(e.target.value)}
        >
          <option value="all">All Departments ({rows.length})</option>
          {departments.map(d => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>
      </div>

      {/* Status Legend */}
      <div className="legend">
        <div className="legend-item">
          <span className="legend-swatch day-cell P" style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>P</span>
          <span>Present</span>
        </div>
        <div className="legend-item">
          <span className="legend-swatch day-cell A" style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>A</span>
          <span>Absent</span>
        </div>
        <div className="legend-item">
          <span className="legend-swatch day-cell HD" style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>HD</span>
          <span>Half Day</span>
        </div>
        <div className="legend-item">
          <span className="legend-swatch day-cell WO" style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>WO</span>
          <span>Weekly Off</span>
        </div>
        <div className="legend-item">
          <span className="legend-swatch day-cell PL" style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>PL</span>
          <span>Paid Leave</span>
        </div>
        <div className="legend-item">
          <span className="legend-swatch day-cell UL" style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>UL</span>
          <span>Unpaid Leave</span>
        </div>
        <div className="legend-item">
          <span className="legend-swatch day-cell NM" style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>·</span>
          <span>Not Marked</span>
        </div>
        <div className="legend-item">
          <span className="legend-swatch day-cell NA" style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>—</span>
          <span>Not Employed / Future</span>
        </div>
      </div>

      {loading ? (
        <LoadingSpinner message="Generating monthly report…" />
      ) : filteredRows.length === 0 ? (
        <div className="card empty-state">
          <div className="empty-state-icon">📋</div>
          <p>No staff records found for {MONTH_NAMES[month - 1]} {year}.</p>
        </div>
      ) : (
        <div className="card report-table-wrapper">
          <table className="report-table">
            <thead>
              <tr>
                <th>Staff Member</th>
                {Array.from({ length: numDays }, (_, i) => i + 1).map(d => {
                  const dayDate = new Date(year, month - 1, d);
                  const dayOfWeek = dayDate.toLocaleDateString('en-US', { weekday: 'narrow' });
                  const isSunday = dayDate.getDay() === 0;
                  return (
                    <th
                      key={d}
                      style={{
                        backgroundColor: isSunday ? '#FFF8E1' : undefined,
                        color: isSunday ? '#B78103' : undefined,
                      }}
                    >
                      <div>{d}</div>
                      <div style={{ fontSize: '0.65rem', fontWeight: 'normal' }}>{dayOfWeek}</div>
                    </th>
                  );
                })}
                <th title="Total Present">P</th>
                <th title="Total Absent">A</th>
                <th title="Total Half Day">HD</th>
                <th title="Total Weekly Off">WO</th>
                <th title="Total Paid Leave">PL</th>
                <th title="Total Unpaid Leave">UL</th>
                <th title="Recorded working hours for completed shifts">Hours</th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.map(row => {
                return (
                  <tr key={row.staff_id}>
                    <td>
                      <button
                        className="btn-ghost"
                        style={{ textAlign: 'left', padding: '0.2rem 0', cursor: 'pointer' }}
                        onClick={() => handleViewStaffHistory(row)}
                        title="Click to view history"
                      >
                        <div style={{ fontWeight: 600, color: 'var(--navy)' }}>
                          {row.full_name}
                        </div>
                        <div style={{ fontSize: '0.7rem', color: 'var(--gray-500)' }}>
                          {row.employee_id} • {row.department}
                        </div>
                      </button>
                    </td>

                    {Array.from({ length: numDays }, (_, i) => i + 1).map(d => {
                      const dStr = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
                      const isOutsideEmployment =
                        dStr < row.joining_date || (row.leaving_date && dStr > row.leaving_date);
                      const isFuture = dStr > currentIST;
                      const status = row.days[d];

                      if (isOutsideEmployment) {
                        return (
                          <td key={d} className="day-cell NA" title="Not Employed on this date">
                            —
                          </td>
                        );
                      }

                      if (isFuture) {
                        return (
                          <td key={d} className="day-cell NA" title="Future date">
                            &nbsp;
                          </td>
                        );
                      }

                      if (!status) {
                        return (
                          <td key={d} className="day-cell NM" title="Not Marked">
                            ·
                          </td>
                        );
                      }

                      const abbr = STATUS_ABBR[status] || status;
                      return (
                        <td
                          key={d}
                          className={`day-cell ${abbr}`}
                          title={`${STATUS_LABELS[status]} (${dStr})`}
                        >
                          {abbr}
                        </td>
                      );
                    })}

                    <td style={{ fontWeight: 600, color: STATUS_COLORS.present }}>
                      {row.totals.present || 0}
                    </td>
                    <td style={{ fontWeight: 600, color: STATUS_COLORS.absent }}>
                      {row.totals.absent || 0}
                    </td>
                    <td style={{ fontWeight: 600, color: STATUS_COLORS.half_day }}>
                      {row.totals.half_day || 0}
                    </td>
                    <td style={{ fontWeight: 600, color: STATUS_COLORS.weekly_off }}>
                      {row.totals.weekly_off || 0}
                    </td>
                    <td style={{ fontWeight: 600, color: STATUS_COLORS.paid_leave }}>
                      {row.totals.paid_leave || 0}
                    </td>
                    <td style={{ fontWeight: 600, color: STATUS_COLORS.unpaid_leave }}>
                      {row.totals.unpaid_leave || 0}
                    </td>
                    <td style={{ fontSize: '0.75rem', fontWeight: 500 }} title={row.total_hours !== null ? 'Sum of fully completed shift hours' : 'Shift hours incomplete or not recorded'}>
                      {row.total_hours !== null ? `${row.total_hours}h` : <span style={{ color: '#94a3b8' }}>Not recorded</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Staff Attendance History Modal */}
      {selectedStaff && (
        <div className="dialog-overlay" onClick={() => setSelectedStaff(null)}>
          <div
            className="dialog"
            style={{ maxWidth: '640px', maxHeight: '80vh', overflowY: 'auto' }}
            onClick={e => e.stopPropagation()}
          >
            <div className="card-header">
              <div>
                <h3 className="dialog-title">{selectedStaff.full_name}</h3>
                <p className="text-sm text-muted">
                  ID: {selectedStaff.employee_id} • Dept: {selectedStaff.department} • Joined: {selectedStaff.joining_date}
                </p>
              </div>
              <button className="btn btn-sm btn-ghost" onClick={() => setSelectedStaff(null)}>
                ✕
              </button>
            </div>

            <h4 className="mt-1 mb-1" style={{ fontSize: '0.9rem', color: 'var(--navy)' }}>
              Attendance Records for {MONTH_NAMES[month - 1]} {year}
            </h4>

            {historyLoading ? (
              <LoadingSpinner message="Loading employee history…" />
            ) : historyRecords.length === 0 ? (
              <p className="text-muted text-sm">No records logged for this month.</p>
            ) : (
              <div className="table-wrapper">
                <table>
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Status</th>
                      <th>In / Out</th>
                      <th>Notes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {historyRecords.map(rec => (
                      <tr key={rec.id}>
                        <td style={{ whiteSpace: 'nowrap', fontWeight: 500 }}>{rec.attendance_date}</td>
                        <td>
                          <span
                            className="status-badge status-badge-sm"
                            style={{
                              backgroundColor: `${STATUS_COLORS[rec.status as AttendanceStatus] || '#888'}18`,
                              color: STATUS_COLORS[rec.status as AttendanceStatus] || '#888',
                              borderColor: `${STATUS_COLORS[rec.status as AttendanceStatus] || '#888'}40`,
                            }}
                          >
                            {STATUS_LABELS[rec.status as AttendanceStatus] || rec.status}
                          </span>
                        </td>
                        <td style={{ fontSize: '0.75rem', whiteSpace: 'nowrap' }}>
                          {rec.check_in
                            ? new Date(rec.check_in).toLocaleTimeString('en-IN', {
                                hour: '2-digit',
                                minute: '2-digit',
                                hour12: true,
                              })
                            : '—'}
                          {' → '}
                          {rec.check_out
                            ? new Date(rec.check_out).toLocaleTimeString('en-IN', {
                                hour: '2-digit',
                                minute: '2-digit',
                                hour12: true,
                              })
                            : '—'}
                        </td>
                        <td style={{ fontSize: '0.8rem', color: 'var(--gray-600)' }}>{rec.notes || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div className="dialog-actions mt-2">
              <button className="btn btn-outline" onClick={() => setSelectedStaff(null)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
