/* ── Shared Types for Livotel Attendance ── */

export type UserRole = 'owner' | 'manager';

export type AttendanceStatus =
  | 'present'
  | 'absent'
  | 'half_day'
  | 'weekly_off'
  | 'paid_leave'
  | 'unpaid_leave';

/** Display-friendly labels and abbreviations */
export const STATUS_LABELS: Record<AttendanceStatus, string> = {
  present: 'Present',
  absent: 'Absent',
  half_day: 'Half Day',
  weekly_off: 'Weekly Off',
  paid_leave: 'Paid Leave',
  unpaid_leave: 'Unpaid Leave',
};

export const STATUS_ABBR: Record<AttendanceStatus, string> = {
  present: 'P',
  absent: 'A',
  half_day: 'HD',
  weekly_off: 'WO',
  paid_leave: 'PL',
  unpaid_leave: 'UL',
};

export const STATUS_COLORS: Record<AttendanceStatus | 'not_marked', string> = {
  present: '#2e7d32',
  absent: '#c62828',
  half_day: '#ef6c00',
  weekly_off: '#1565c0',
  paid_leave: '#6a1b9a',
  unpaid_leave: '#4e342e',
  not_marked: '#9e9e9e',
};

export const ALL_STATUSES: AttendanceStatus[] = [
  'present', 'absent', 'half_day', 'weekly_off', 'paid_leave', 'unpaid_leave',
];

export const DEPARTMENTS = [
  'Reception',
  'Housekeeping',
  'Kitchen',
  'Maintenance',
  'Management',
  'Security',
  'Other',
] as const;

export type Department = (typeof DEPARTMENTS)[number];

/* ── Data Models ── */

export interface User {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  is_active: boolean;
  created_at: string;
}

export interface Staff {
  id: string;
  employee_id: string;
  full_name: string;
  name?: string;
  designation: string;
  department: string;
  phone: string | null;
  email?: string | null;
  notify_absence?: boolean;
  notify_monthly_report?: boolean;
  monthly_salary?: number;
  joining_date: string; // YYYY-MM-DD
  leaving_date: string | null;
  is_active: boolean;
  default_shift: string | null;
  created_at: string;
  updated_at: string;
}

export interface AttendanceRecord {
  id: string;
  staff_id: string;
  attendance_date: string; // YYYY-MM-DD
  status: AttendanceStatus;
  shift: string | null;
  check_in: string | null; // ISO timestamp
  check_out: string | null;
  notes: string | null;
  version: number;
  created_at: string;
  updated_at: string;
  created_by?: string;
  updated_by?: string;
  // Joined fields from staff and users tables
  staff_name?: string;
  employee_id?: string;
  department?: string;
  created_by_name?: string;
  created_by_email?: string;
  created_by_role?: string;
  updated_by_name?: string;
  updated_by_email?: string;
  updated_by_role?: string;
}

export interface AuditEntry {
  id: string;
  attendance_id: string;
  staff_id: string;
  attendance_date: string;
  previous_values: Record<string, unknown> | null;
  new_values: Record<string, unknown>;
  change_reason: string | null;
  changed_by: string;
  changed_by_name?: string;
  changed_by_email?: string;
  changed_by_role?: string;
  changed_at: string;
  staff_name?: string;
  employee_id?: string;
  department?: string;
}

export interface MonthLock {
  id: string;
  year: number;
  month: number;
  locked_by: string;
  locked_by_name?: string;
  locked_at: string;
}

export interface Invitation {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  token: string;
  expires_at: string;
  used_at: string | null;
  created_at: string;
}

/* ── API Payloads ── */

export interface DashboardStats {
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

export interface AttendanceEntry {
  staff_id: string;
  status: AttendanceStatus;
  shift?: string | null;
  check_in?: string | null;
  check_out?: string | null;
  notes?: string | null;
  version?: number; // for optimistic concurrency
  reason?: string;  // required when updating existing record
}

export interface SaveAttendancePayload {
  date: string; // YYYY-MM-DD
  entries: AttendanceEntry[];
}

export interface MonthlyReportRow {
  staff_id: string;
  employee_id: string;
  full_name: string;
  department: string;
  joining_date: string;
  leaving_date: string | null;
  days: Record<number, AttendanceStatus | null>; // day-of-month → status or null
  totals: Record<AttendanceStatus, number>;
  total_hours: number | null; // null if any time entry is incomplete
}

export interface StaffFormData {
  employee_id: string;
  full_name: string;
  designation: string;
  department: string;
  phone?: string;
  email?: string;
  notify_absence?: boolean;
  notify_monthly_report?: boolean;
  monthly_salary?: number;
  joining_date: string;
  leaving_date?: string;
  is_active: boolean;
  default_shift?: string;
}

export type NotificationStatus =
  | 'queued'
  | 'processing'
  | 'provider_accepted'
  | 'delivered'
  | 'failed'
  | 'bounced'
  | 'cancelled';
export type NotificationType = 'absence_alert' | 'absence_correction' | 'monthly_report';

export interface NotificationOutboxEntry {
  id: string;
  staff_id: string | null;
  staff_name?: string;
  recipient_email: string;
  notification_type: NotificationType;
  idempotency_key: string;
  subject: string;
  body_html: string;
  body_text: string;
  status: NotificationStatus;
  attempt_count: number;
  max_attempts: number;
  next_retry_at: string;
  provider: string | null;
  provider_message_id?: string | null;
  error_message: string | null;
  metadata?: Record<string, unknown> | null;
  created_at: string;
  sent_at: string | null;
  updated_at: string;
}

export interface SaveAttendanceResult {
  saved: number;
  saved_staff_ids: string[];
  conflicts: Array<{ staff_id: string; current_version: number; staff_name?: string }>;
  errors?: Array<{ staff_id: string; message: string }>;
}

export interface LoginPayload {
  email: string;
  password: string;
}

export interface SetupPayload {
  email: string;
  password: string;
  name: string;
}

export interface InvitePayload {
  email: string;
  name: string;
  role: UserRole;
}

export interface AcceptInvitePayload {
  token: string;
  password: string;
}

export interface ApiError {
  error: string;
  details?: string;
}

/** Returned when an optimistic concurrency conflict occurs */
export interface ConflictError extends ApiError {
  conflict: true;
  staff_id: string;
  current_version: number;
}

/* ── Helpers ── */

/** Format working hours and descriptive status: 'Not recorded', 'Incomplete', 'Invalid', or formatted hours */
export function formatWorkingHours(
  checkIn: string | null | undefined,
  checkOut: string | null | undefined,
): { hours: number | null; label: string; status: 'not_recorded' | 'incomplete' | 'invalid' | 'recorded' } {
  if (!checkIn && !checkOut) {
    return { hours: null, label: 'Not recorded', status: 'not_recorded' };
  }
  if (!checkIn || !checkOut) {
    return { hours: null, label: 'Incomplete', status: 'incomplete' };
  }
  const inTime = new Date(checkIn).getTime();
  const outTime = new Date(checkOut).getTime();
  if (isNaN(inTime) || isNaN(outTime)) {
    return { hours: null, label: 'Invalid time', status: 'invalid' };
  }
  const diff = outTime - inTime;
  if (diff <= 0) {
    return { hours: null, label: 'Invalid duration', status: 'invalid' };
  }
  const hours = Math.round((diff / (1000 * 60 * 60)) * 100) / 100;
  return { hours, label: `${hours}h`, status: 'recorded' };
}

/** Calculate hours between check-in and check-out, handling overnight */
export function calculateHours(
  checkIn: string | null,
  checkOut: string | null,
): number | null {
  if (!checkIn || !checkOut) return null;
  const inTime = new Date(checkIn).getTime();
  const outTime = new Date(checkOut).getTime();
  if (isNaN(inTime) || isNaN(outTime)) return null;
  const diff = outTime - inTime;
  if (diff <= 0) return null; // invalid or zero duration
  return Math.round((diff / (1000 * 60 * 60)) * 100) / 100;
}

/** Format date as YYYY-MM-DD in Asia/Kolkata timezone */
export function formatDate(d: Date): string {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return formatter.format(d);
}

/** Get today's date in Asia/Kolkata */
export function todayIST(): string {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return formatter.format(new Date());
}

/** Get number of days in a month */
export function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

/** Convert timestamp string into Asia/Kolkata YYYY-MM-DDTHH:mm for datetime-local input */
export function toDatetimeLocalValue(dateStr: string | null | undefined): string {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return '';
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  const parts = formatter.formatToParts(d);
  const partMap: Record<string, string> = {};
  for (const p of parts) partMap[p.type] = p.value;
  return `${partMap.year}-${partMap.month}-${partMap.day}T${partMap.hour}:${partMap.minute}`;
}

/** Parse datetime string (local or ISO) into UTC ISO timestamp assuming Asia/Kolkata (+05:30) if offset omitted */
export function parseDatetimeLocalToIST(str: string | null | undefined): string | null {
  if (!str) return null;
  // If string already has explicit timezone offset or Z
  if (str.includes('Z') || str.includes('+') || (str.split('-').length > 3 && str.lastIndexOf('-') > 10)) {
    const d = new Date(str);
    return isNaN(d.getTime()) ? null : d.toISOString();
  }
  // Enforce Asia/Kolkata (+05:30)
  const d = new Date(`${str.length === 16 ? str + ':00' : str}+05:30`);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

/** Check if two timestamp or datetime strings represent the same moment */
export function isSameTime(t1?: string | null, t2?: string | null): boolean {
  if (!t1 && !t2) return true;
  if (!t1 || !t2) return false;
  const iso1 = parseDatetimeLocalToIST(t1);
  const iso2 = parseDatetimeLocalToIST(t2);
  if (!iso1 || !iso2) return false;
  return new Date(iso1).getTime() === new Date(iso2).getTime();
}

/** Month names */
export const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
