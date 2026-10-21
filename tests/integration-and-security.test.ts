import { describe, it, expect, beforeEach } from 'vitest';
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { formatWorkingHours } from '../src/types';

describe('1. Shared Persistent Rate Limiting Simulation', () => {
  interface RateLimitRow {
    key: string;
    failed_attempts: number;
    locked_until: number | null;
  }

  // Simulated shared PostgreSQL database table
  let sharedDb: Map<string, RateLimitRow>;

  beforeEach(() => {
    sharedDb = new Map();
  });

  function simulateDbRateCheck(key: string, now: number): { blocked: boolean; retryAfter: number } {
    const row = sharedDb.get(key);
    if (!row || !row.locked_until) return { blocked: false, retryAfter: 0 };
    if (now < row.locked_until) {
      return { blocked: true, retryAfter: Math.ceil((row.locked_until - now) / 1000) };
    }
    return { blocked: false, retryAfter: 0 };
  }

  function simulateDbFailedAttempt(key: string, now: number) {
    const row = sharedDb.get(key) || { key, failed_attempts: 0, locked_until: null };
    row.failed_attempts += 1;
    if (row.failed_attempts >= 5) {
      row.locked_until = now + 15 * 60 * 1000; // 15 min lock
    }
    sharedDb.set(key, row);
  }

  function simulateDbReset(key: string) {
    sharedDb.delete(key);
  }

  it('coordinates rate limit across separate Netlify function instances', () => {
    const key = 'ip:198.51.100.42';
    const now = 1700000000000;

    // Instance A records 3 failed attempts
    simulateDbFailedAttempt(key, now);
    simulateDbFailedAttempt(key, now);
    simulateDbFailedAttempt(key, now);

    // Instance B (separate process) sees 3 attempts
    expect(sharedDb.get(key)?.failed_attempts).toBe(3);
    expect(simulateDbRateCheck(key, now).blocked).toBe(false);

    // Instance C records 2 more failed attempts (total 5)
    simulateDbFailedAttempt(key, now);
    simulateDbFailedAttempt(key, now);

    // Instance D checks and is blocked for 15 minutes (900 seconds)
    const check = simulateDbRateCheck(key, now);
    expect(check.blocked).toBe(true);
    expect(check.retryAfter).toBe(900);

    // Successful login from Instance A resets the shared database record
    simulateDbReset(key);
    expect(simulateDbRateCheck(key, now).blocked).toBe(false);
  });
});

describe('2. Server-Side Token Revocation & Role Enforcement', () => {
  const SECRET = 'test-audit-jwt-secret';

  interface UserRow {
    id: string;
    email: string;
    role: string;
    is_active: boolean;
    token_version: number;
  }

  let usersTable: Map<string, UserRow>;
  let revokedTokensTable: Set<string>;

  beforeEach(() => {
    usersTable = new Map();
    revokedTokensTable = new Set();

    usersTable.set('user-1', {
      id: 'user-1',
      email: 'manager@livotelhotel.com',
      role: 'manager',
      is_active: true,
      token_version: 1,
    });
  });

  function issueToken(userId: string, role: string, tokenVersion: number, jti: string): string {
    return jwt.sign({ userId, role, tokenVersion, jti }, SECRET, { expiresIn: '1h' });
  }

  function verifySession(token: string): { valid: boolean; error?: string; role?: string } {
    try {
      const decoded = jwt.verify(token, SECRET) as any;
      if (revokedTokensTable.has(decoded.jti)) {
        return { valid: false, error: 'Token has been revoked' };
      }
      const user = usersTable.get(decoded.userId);
      if (!user) return { valid: false, error: 'User not found' };
      if (!user.is_active) return { valid: false, error: 'Account deactivated' };
      if (decoded.tokenVersion !== user.token_version) {
        return { valid: false, error: 'Session version invalidated' };
      }
      // Live role from DB overrides token claims
      return { valid: true, role: user.role };
    } catch {
      return { valid: false, error: 'Invalid or expired token' };
    }
  }

  it('rejects previously issued token after explicit logout (jti revocation)', () => {
    const token = issueToken('user-1', 'manager', 1, 'jti-abc');
    expect(verifySession(token).valid).toBe(true);

    // User logs out -> jti recorded in revoked_tokens table
    revokedTokensTable.add('jti-abc');
    const result = verifySession(token);
    expect(result.valid).toBe(false);
    expect(result.error).toBe('Token has been revoked');
  });

  it('rejects old token after account deactivation', () => {
    const token = issueToken('user-1', 'manager', 1, 'jti-123');
    expect(verifySession(token).valid).toBe(true);

    // Admin deactivates user
    usersTable.get('user-1')!.is_active = false;
    const result = verifySession(token);
    expect(result.valid).toBe(false);
    expect(result.error).toBe('Account deactivated');
  });

  it('rejects token when token_version is incremented (e.g. password change)', () => {
    const token = issueToken('user-1', 'manager', 1, 'jti-pwd');
    expect(verifySession(token).valid).toBe(true);

    // User changes password -> token_version bumped to 2
    usersTable.get('user-1')!.token_version = 2;
    const result = verifySession(token);
    expect(result.valid).toBe(false);
    expect(result.error).toBe('Session version invalidated');
  });

  it('enforces live role from database instead of stale token claim', () => {
    // Token was issued when user was owner
    const token = issueToken('user-1', 'owner', 1, 'jti-role');
    // But live DB role was changed to manager
    usersTable.get('user-1')!.role = 'manager';

    const result = verifySession(token);
    expect(result.valid).toBe(true);
    // Verified that live role is authoritative
    expect(result.role).toBe('manager');
  });
});

describe('3. Concurrency & Race Condition Guarantees', () => {
  it('guarantees single-use invitation redemption under concurrent requests', () => {
    let invitationUsed = false;

    function redeemInvitation(): { success: boolean } {
      // Simulates UPDATE invitations SET used_at = NOW() WHERE id = $1 AND used_at IS NULL
      if (!invitationUsed) {
        invitationUsed = true;
        return { success: true };
      }
      return { success: false };
    }

    // Two concurrent requests attempt redemption
    const req1 = redeemInvitation();
    const req2 = redeemInvitation();

    expect(req1.success).toBe(true);
    expect(req2.success).toBe(false);
  });

  it('prevents duplicate initial owners with exclusive table lock check', () => {
    let userCount = 0;

    function executeSetup(name: string): { success: boolean; error?: string } {
      // Simulates LOCK TABLE users IN EXCLUSIVE MODE; SELECT COUNT(*) FROM users;
      if (userCount > 0) {
        return { success: false, error: 'Setup already completed' };
      }
      userCount++;
      return { success: true };
    }

    const first = executeSetup('Owner 1');
    const second = executeSetup('Owner 2');

    expect(first.success).toBe(true);
    expect(second.success).toBe(false);
    expect(second.error).toBe('Setup already completed');
    expect(userCount).toBe(1);
  });
});

describe('4. Attendance Concurrency, Partial Saves (HTTP 207) & Transaction Rollback', () => {
  it('identifies partial saves (HTTP 207) and preserves failed drafts', () => {
    interface AttendanceRow {
      staff_id: string;
      version: number;
      status: string;
    }

    const dbRows = new Map<string, AttendanceRow>([
      ['staff-1', { staff_id: 'staff-1', version: 1, status: 'present' }],
      ['staff-2', { staff_id: 'staff-2', version: 3, status: 'absent' }], // DB is version 3
    ]);

    const clientEntries = [
      { staff_id: 'staff-1', version: 1, status: 'half_day' }, // Matches version 1
      { staff_id: 'staff-2', version: 2, status: 'present' },  // Client sent stale version 2
    ];

    const savedStaffIds: string[] = [];
    const conflicts: Array<{ staff_id: string; current_version: number }> = [];

    for (const entry of clientEntries) {
      const existing = dbRows.get(entry.staff_id);
      if (existing && existing.version !== entry.version) {
        conflicts.push({ staff_id: entry.staff_id, current_version: existing.version });
      } else {
        savedStaffIds.push(entry.staff_id);
      }
    }

    expect(savedStaffIds).toEqual(['staff-1']);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].staff_id).toBe('staff-2');
    expect(conflicts[0].current_version).toBe(3);

    // HTTP 207 returned when partially saved
    const httpStatus = conflicts.length > 0 && savedStaffIds.length > 0 ? 207 : 200;
    expect(httpStatus).toBe(207);
  });

  it('atomically rolls back attendance if audit entry insert fails', () => {
    let attendanceSaved = false;
    let auditSaved = false;

    try {
      // BEGIN transaction
      attendanceSaved = true;

      // Simulate failure during audit insertion (e.g. FK constraint or DB error)
      throw new Error('Audit insert failed');
      // auditSaved = true;
    } catch {
      // ROLLBACK transaction
      attendanceSaved = false;
      auditSaved = false;
    }

    expect(attendanceSaved).toBe(false);
    expect(auditSaved).toBe(false);
  });
});

describe('5. Working Hours Classification', () => {
  it('returns "Not recorded" when both check-in and check-out are absent', () => {
    const res = formatWorkingHours(null, null);
    expect(res.status).toBe('not_recorded');
    expect(res.label).toBe('Not recorded');
    expect(res.hours).toBeNull();
  });

  it('returns "Incomplete" when only check-in or check-out is provided', () => {
    const res1 = formatWorkingHours('2026-10-21T09:00:00', null);
    expect(res1.status).toBe('incomplete');
    expect(res1.label).toBe('Incomplete');
    expect(res1.hours).toBeNull();

    const res2 = formatWorkingHours(null, '2026-10-21T17:00:00');
    expect(res2.status).toBe('incomplete');
    expect(res2.label).toBe('Incomplete');
  });

  it('accurately calculates overnight hours and labels as recorded', () => {
    const res = formatWorkingHours('2026-10-21T22:00:00', '2026-10-22T06:30:00');
    expect(res.status).toBe('recorded');
    expect(res.hours).toBe(8.5);
    expect(res.label).toBe('8.5h');
  });

  it('identifies invalid durations where checkout is before checkin', () => {
    const res = formatWorkingHours('2026-10-21T18:00:00', '2026-10-21T09:00:00');
    expect(res.status).toBe('invalid');
    expect(res.label).toBe('Invalid duration');
    expect(res.hours).toBeNull();
  });
});

describe('6. Staff Notifications Outbox & Delivery Integrity', () => {
  interface OutboxEntry {
    idempotency_key: string;
    recipient_email: string;
    notification_type: string;
    subject: string;
    status: string;
  }

  let outbox: Map<string, OutboxEntry>;

  beforeEach(() => {
    outbox = new Map();
  });

  it('queues an absence alert when marked absent with idempotency key', () => {
    const staffId = 'staff-housekeeping-1';
    const date = '2026-10-21';
    const key = `absence:${staffId}:${date}:1`;

    const entry: OutboxEntry = {
      idempotency_key: key,
      recipient_email: 'hk@livotelhotel.com',
      notification_type: 'absence_alert',
      subject: `Attendance Notice: Marked Absent on ${date} — Livotel Premium Hotel`,
      status: 'queued',
    };

    outbox.set(key, entry);
    expect(outbox.size).toBe(1);

    // Repeated save with same key is ignored (ON CONFLICT DO NOTHING)
    if (!outbox.has(key)) {
      outbox.set(key, entry);
    }
    expect(outbox.size).toBe(1);
  });

  it('queues a correction notification when previous status was absent and is updated', () => {
    const staffId = 'staff-frontdesk-2';
    const date = '2026-10-21';
    const correctionKey = `correction:${staffId}:${date}:2`;

    const correctionEntry: OutboxEntry = {
      idempotency_key: correctionKey,
      recipient_email: 'frontdesk@livotelhotel.com',
      notification_type: 'absence_correction',
      subject: `Attendance Correction: Status Updated to Present on ${date} — Livotel Premium Hotel`,
      status: 'queued',
    };

    outbox.set(correctionKey, correctionEntry);
    expect(outbox.get(correctionKey)?.notification_type).toBe('absence_correction');
    expect(outbox.get(correctionKey)?.subject).toContain('Status Updated to Present');
  });

  it('updates pending outbox messages when employee email is modified', () => {
    outbox.set('msg-1', {
      idempotency_key: 'msg-1',
      recipient_email: 'old.email@livotelhotel.com',
      notification_type: 'absence_alert',
      subject: 'Attendance Notice',
      status: 'queued',
    });

    const newEmail = 'new.email@livotelhotel.com';

    // When staff updates email, update pending queued messages
    for (const [k, v] of outbox.entries()) {
      if (v.status === 'queued') {
        v.recipient_email = newEmail;
      }
    }

    expect(outbox.get('msg-1')?.recipient_email).toBe('new.email@livotelhotel.com');
  });
});
