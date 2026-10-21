/**
 * API client — handles all communication with Netlify Functions backend.
 * Adds auth token, parses responses, and provides typed error handling.
 */

import type { ApiError } from '../types';

const TOKEN_KEY = 'livotel_attendance_token';

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

export class ApiResponseError extends Error {
  status: number;
  body: ApiError;
  isConflict: boolean;

  constructor(status: number, body: ApiError) {
    super(body.error || 'Request failed');
    this.name = 'ApiResponseError';
    this.status = status;
    this.body = body;
    this.isConflict = status === 409;
  }
}

async function request<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    ...(options.headers as Record<string, string>),
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  // Set Content-Type for non-GET and if body is string (JSON)
  if (options.body && typeof options.body === 'string') {
    headers['Content-Type'] = 'application/json';
  }

  const res = await fetch(path, {
    ...options,
    headers,
  });

  // Handle blob responses (CSV downloads)
  if (res.headers.get('content-type')?.includes('text/csv')) {
    return res.blob() as unknown as T;
  }

  // Parse JSON
  const contentType = res.headers.get('content-type');
  let data: unknown;
  if (contentType?.includes('application/json')) {
    data = await res.json();
  } else {
    data = { message: await res.text() };
  }

  if (!res.ok) {
    throw new ApiResponseError(res.status, data as ApiError);
  }

  return data as T;
}

/* ── Auth ── */

export const api = {
  // Auth
  checkSetup: () =>
    request<{ needs_setup: boolean; requires_setup_secret?: boolean }>('/api/auth-setup', { method: 'GET' }),

  setup: (payload: { email: string; password: string; name: string; setup_secret?: string }) =>
    request<{ token: string; user: Record<string, unknown> }>('/api/auth-setup', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  login: (payload: { email: string; password: string }) =>
    request<{ token: string; user: Record<string, unknown> }>('/api/auth-login', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  logout: () =>
    request<{ success: boolean; message: string }>('/api/auth-logout', {
      method: 'POST',
    }),

  me: () =>
    request<{ user: Record<string, unknown> }>('/api/auth-me'),

  changePassword: (payload: { current_password: string; new_password: string }) =>
    request<{ message: string }>('/api/auth-change-password', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  // Users
  listUsers: () =>
    request<{ users: Record<string, unknown>[] }>('/api/users'),

  updateUser: (id: string, payload: { name?: string; role?: string; is_active?: boolean }) =>
    request<{ user: Record<string, unknown> }>(`/api/users?id=${id}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),

  // Invitations
  invite: (payload: { email: string; name: string; role: string }) =>
    request<{ invitation: Record<string, unknown>; link: string }>('/api/auth-invite', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  acceptInvite: (payload: { token: string; password: string }) =>
    request<{ token: string; user: Record<string, unknown> }>('/api/auth-accept-invite', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  listInvitations: () =>
    request<{ invitations: Record<string, unknown>[] }>('/api/auth-invite', { method: 'GET' }),

  // Staff
  listStaff: (includeInactive = false) =>
    request<{ staff: Record<string, unknown>[] }>(
      `/api/staff?include_inactive=${includeInactive}`,
    ),

  getStaff: (id: string) =>
    request<{ staff: Record<string, unknown> }>(`/api/staff?id=${id}`),

  createStaff: (payload: Record<string, unknown>) =>
    request<{ staff: Record<string, unknown> }>('/api/staff', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  updateStaff: (id: string, payload: Record<string, unknown>) =>
    request<{ staff: Record<string, unknown> }>(`/api/staff?id=${id}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),

  // Attendance
  getAttendance: (date: string) =>
    request<{ records: Record<string, unknown>[]; staff: Record<string, unknown>[] }>(
      `/api/attendance?date=${date}`,
    ),

  saveAttendance: (payload: { date: string; entries: Record<string, unknown>[] }) =>
    request<{ saved: number; conflicts: Record<string, unknown>[] }>('/api/attendance', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  getAttendanceHistory: (staffId: string, year?: number, month?: number) => {
    let url = `/api/attendance-history?staff_id=${staffId}`;
    if (year) url += `&year=${year}`;
    if (month) url += `&month=${month}`;
    return request<{ records: Record<string, unknown>[] }>(url);
  },

  // Dashboard
  getDashboard: (date: string) =>
    request<Record<string, unknown>>(`/api/dashboard?date=${date}`),

  // Reports
  getMonthlyReport: (year: number, month: number) =>
    request<{ rows: Record<string, unknown>[]; month_locked: boolean }>(
      `/api/reports-monthly?year=${year}&month=${month}`,
    ),

  exportCSV: async (year: number, month: number): Promise<Blob> => {
    const token = getToken();
    const res = await fetch(
      `/api/reports-export?year=${year}&month=${month}`,
      { headers: token ? { Authorization: `Bearer ${token}` } : {} },
    );
    if (!res.ok) {
      const err = await res.json();
      throw new ApiResponseError(res.status, err);
    }
    return res.blob();
  },

  // Month locks
  getMonthLocks: () =>
    request<{ locks: Record<string, unknown>[] }>('/api/month-locks'),

  lockMonth: (year: number, month: number) =>
    request<{ lock: Record<string, unknown> }>('/api/month-locks', {
      method: 'POST',
      body: JSON.stringify({ year, month }),
    }),

  unlockMonth: (year: number, month: number) =>
    request<{ message: string }>(`/api/month-locks?year=${year}&month=${month}`, {
      method: 'DELETE',
    }),

  // Audit
  getAudit: (params: { staff_id?: string; date?: string; page?: number }) => {
    const sp = new URLSearchParams();
    if (params.staff_id) sp.set('staff_id', params.staff_id);
    if (params.date) sp.set('date', params.date);
    if (params.page) sp.set('page', String(params.page));
    return request<{ entries: Record<string, unknown>[]; total: number }>(
      `/api/audit?${sp.toString()}`,
    );
  },

  // Health
  health: () =>
    request<{ status: string; db_connected: boolean; timestamp: string }>('/api/health'),

  // Notifications (Staff Email Settings & Outbox)
  getNotifications: (params?: { page?: number; status?: string; staff_id?: string }) => {
    const sp = new URLSearchParams();
    if (params?.page) sp.set('page', String(params.page));
    if (params?.status) sp.set('status', params.status);
    if (params?.staff_id) sp.set('staff_id', params.staff_id);
    return request<{ entries: any[]; total: number; page: number; limit: number }>(
      `/api/notifications?${sp.toString()}`
    );
  },

  retryNotification: (id: string) =>
    request<{ message: string; notification: Record<string, unknown> }>('/api/notifications', {
      method: 'POST',
      body: JSON.stringify({ id }),
    }),

  previewMonthlyReportEmail: (staffId: string, year: number, month: number) =>
    request<any>(`/api/notifications-monthly?staff_id=${staffId}&year=${year}&month=${month}`),

  sendMonthlyReportEmail: (payload: { staff_id: string; year: number; month: number; resend?: boolean }) =>
    request<{ success: boolean; message: string; outbox_id?: string; already_sent?: boolean }>(
      '/api/notifications-monthly',
      {
        method: 'POST',
        body: JSON.stringify(payload),
      }
    ),

  processNotificationsOutbox: () =>
    request<{ processed: number; failed: number; provider: string; is_sandbox: boolean }>(
      '/api/notifications-process',
      { method: 'POST' }
    ),
};
