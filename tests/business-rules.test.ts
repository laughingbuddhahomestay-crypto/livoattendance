import { describe, it, expect, beforeEach } from 'vitest';
import crypto from 'node:crypto';
import {
  STATUS_LABELS,
  STATUS_ABBR,
  STATUS_COLORS,
  ALL_STATUSES,
  daysInMonth,
} from '../src/types';

/**
 * Sanitizes cell values to prevent CSV formula injection (CWE-1236).
 * Prepends a single quote if string begins with =, +, -, @, \t, or \r.
 */
function sanitizeCsvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '""';
  let str = String(value);

  if (/^[=+\-@\t\r]/.test(str)) {
    str = `'${str}`;
  }

  str = str.replace(/"/g, '""');
  return `"${str}"`;
}

/**
 * Validates whether an attendance entry date falls within a staff member's employment range.
 * Uses exact ISO YYYY-MM-DD string comparisons.
 */
function isDateWithinEmployment(
  attendanceDate: string,
  joiningDate: string,
  leavingDate: string | null
): { valid: boolean; reason?: string } {
  if (attendanceDate < joiningDate) {
    return {
      valid: false,
      reason: `Cannot mark attendance before joining date (${joiningDate})`,
    };
  }
  if (leavingDate && attendanceDate > leavingDate) {
    return {
      valid: false,
      reason: `Cannot mark attendance after leaving date (${leavingDate})`,
    };
  }
  return { valid: true };
}

/**
 * Verifies optimistic concurrency version match.
 */
function verifyVersionMatch(
  clientVersion: number | undefined,
  dbVersion: number
): { conflict: boolean } {
  if (clientVersion !== undefined && clientVersion !== dbVersion) {
    return { conflict: true };
  }
  return { conflict: false };
}

/**
 * Role-based authorization rules.
 */
function canPerformAction(
  role: 'owner' | 'manager',
  action:
    | 'enter_attendance'
    | 'view_reports'
    | 'manage_staff'
    | 'lock_month'
    | 'unlock_month'
    | 'manage_users'
    | 'view_audit_log'
): boolean {
  if (role === 'owner') return true;

  // Manager permissions
  if (action === 'enter_attendance' || action === 'view_reports') {
    return true;
  }

  // Manager is forbidden from administrative operations
  return false;
}

/**
 * Validates initial setup secret with timing-safe comparison.
 */
function validateSetupSecret(
  suppliedSecret: string | undefined,
  configuredSecret: string | undefined
): boolean {
  if (!configuredSecret) return true; // If not configured in env, open for initial setup
  if (!suppliedSecret) return false;

  const bufA = Buffer.from(suppliedSecret);
  const bufB = Buffer.from(configuredSecret);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Simulates login rate-limiting logic.
 */
class RateLimiter {
  private attempts = new Map<string, { count: number; resetAt: number }>();
  private maxAttempts = 5;
  private windowMs = 15 * 60 * 1000;

  check(key: string): { blocked: boolean; remaining: number } {
    const now = Date.now();
    const record = this.attempts.get(key);
    if (!record || now > record.resetAt) {
      return { blocked: false, remaining: this.maxAttempts };
    }
    if (record.count >= this.maxAttempts) {
      return { blocked: true, remaining: 0 };
    }
    return { blocked: false, remaining: this.maxAttempts - record.count };
  }

  recordFailure(key: string): void {
    const now = Date.now();
    const record = this.attempts.get(key);
    if (!record || now > record.resetAt) {
      this.attempts.set(key, { count: 1, resetAt: now + this.windowMs });
    } else {
      record.count += 1;
    }
  }

  reset(key: string): void {
    this.attempts.delete(key);
  }
}

describe('Business Rules & Security Verification', () => {
  describe('Spreadsheet Formula Injection Protection (CSV Injection)', () => {
    it('escapes cells starting with = (formula trigger)', () => {
      const input = '=SUM(A1:A10)';
      const sanitized = sanitizeCsvCell(input);
      expect(sanitized).toBe("\"'=SUM(A1:A10)\"");
    });

    it('escapes cells starting with + (command trigger)', () => {
      const input = '+1234567890';
      const sanitized = sanitizeCsvCell(input);
      expect(sanitized).toBe("\"'+1234567890\"");
    });

    it('escapes cells starting with - (negative trigger)', () => {
      const input = '-cmd|/C calc!A0';
      const sanitized = sanitizeCsvCell(input);
      expect(sanitized).toBe("\"'-cmd|/C calc!A0\"");
    });

    it('escapes cells starting with @ (lookup trigger)', () => {
      const input = '@SUM(1+1)';
      const sanitized = sanitizeCsvCell(input);
      expect(sanitized).toBe("\"'@SUM(1+1)\"");
    });

    it('escapes cells starting with tab or carriage return', () => {
      expect(sanitizeCsvCell('\tmalicious')).toBe("\"'\tmalicious\"");
      expect(sanitizeCsvCell('\rmalicious')).toBe("\"'\rmalicious\"");
    });

    it('handles normal strings and numbers without prepending quote', () => {
      expect(sanitizeCsvCell('Livotel Hotel')).toBe('"Livotel Hotel"');
      expect(sanitizeCsvCell(8.5)).toBe('"8.5"');
    });

    it('escapes internal quotes correctly', () => {
      expect(sanitizeCsvCell('Livotel "Executive" Suite')).toBe('"Livotel ""Executive"" Suite"');
    });
  });

  describe('Employment Boundaries', () => {
    const joiningDate = '2026-01-15';
    const leavingDate = '2026-06-30';

    it('permits attendance during active employment', () => {
      const result = isDateWithinEmployment('2026-03-10', joiningDate, leavingDate);
      expect(result.valid).toBe(true);
    });

    it('permits attendance on the exact joining date', () => {
      const result = isDateWithinEmployment('2026-01-15', joiningDate, leavingDate);
      expect(result.valid).toBe(true);
    });

    it('permits attendance on the exact leaving date', () => {
      const result = isDateWithinEmployment('2026-06-30', joiningDate, leavingDate);
      expect(result.valid).toBe(true);
    });

    it('rejects attendance before joining date', () => {
      const result = isDateWithinEmployment('2026-01-14', joiningDate, leavingDate);
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('before joining date');
    });

    it('rejects attendance after leaving date', () => {
      const result = isDateWithinEmployment('2026-07-01', joiningDate, leavingDate);
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('after leaving date');
    });

    it('permits attendance for current employee without leaving date', () => {
      const result = isDateWithinEmployment('2026-10-21', joiningDate, null);
      expect(result.valid).toBe(true);
    });
  });

  describe('Setup Secret & Initial Owner Security', () => {
    const secret = 'livotel-secret-key-12345';

    it('accepts correct setup secret', () => {
      expect(validateSetupSecret(secret, secret)).toBe(true);
    });

    it('rejects incorrect setup secret', () => {
      expect(validateSetupSecret('wrong-secret', secret)).toBe(false);
    });

    it('rejects missing setup secret when configured', () => {
      expect(validateSetupSecret(undefined, secret)).toBe(false);
    });

    it('allows setup when no secret is configured in environment', () => {
      expect(validateSetupSecret(undefined, undefined)).toBe(true);
    });
  });

  describe('Login Rate Limiter', () => {
    let limiter: RateLimiter;

    beforeEach(() => {
      limiter = new RateLimiter();
    });

    it('allows 5 failed attempts before blocking', () => {
      const ip = '192.168.1.50';

      for (let i = 0; i < 4; i++) {
        limiter.recordFailure(ip);
        expect(limiter.check(ip).blocked).toBe(false);
      }

      // 5th failure
      limiter.recordFailure(ip);
      expect(limiter.check(ip).blocked).toBe(true);
    });

    it('resets attempts on successful login', () => {
      const ip = '192.168.1.50';
      limiter.recordFailure(ip);
      limiter.recordFailure(ip);
      expect(limiter.check(ip).remaining).toBe(3);

      limiter.reset(ip);
      expect(limiter.check(ip).remaining).toBe(5);
      expect(limiter.check(ip).blocked).toBe(false);
    });
  });

  describe('Optimistic Concurrency Control', () => {
    it('detects a conflict when record was modified on another device', () => {
      const clientVersion = 1;
      const dbVersion = 2; // another device already updated and incremented version
      const result = verifyVersionMatch(clientVersion, dbVersion);
      expect(result.conflict).toBe(true);
    });

    it('allows save when versions match', () => {
      const clientVersion = 2;
      const dbVersion = 2;
      const result = verifyVersionMatch(clientVersion, dbVersion);
      expect(result.conflict).toBe(false);
    });
  });

  describe('Role-Based Authorization Constraints', () => {
    it('Owner has full access to all system capabilities', () => {
      const actions = [
        'enter_attendance',
        'view_reports',
        'manage_staff',
        'lock_month',
        'unlock_month',
        'manage_users',
        'view_audit_log',
      ] as const;

      for (const action of actions) {
        expect(canPerformAction('owner', action)).toBe(true);
      }
    });

    it('Manager can enter attendance and view reports', () => {
      expect(canPerformAction('manager', 'enter_attendance')).toBe(true);
      expect(canPerformAction('manager', 'view_reports')).toBe(true);
    });

    it('Manager CANNOT manage staff, accounts, locks, or view audit history', () => {
      expect(canPerformAction('manager', 'manage_staff')).toBe(false);
      expect(canPerformAction('manager', 'lock_month')).toBe(false);
      expect(canPerformAction('manager', 'unlock_month')).toBe(false);
      expect(canPerformAction('manager', 'manage_users')).toBe(false);
      expect(canPerformAction('manager', 'view_audit_log')).toBe(false);
    });
  });

  describe('Accessibility: Non-Colour Status Communication', () => {
    it('every attendance status has both textual label and textual abbreviation', () => {
      for (const status of ALL_STATUSES) {
        const label = STATUS_LABELS[status];
        const abbr = STATUS_ABBR[status];
        const color = STATUS_COLORS[status];

        expect(label).toBeTruthy();
        expect(abbr).toBeTruthy();
        expect(color).toBeTruthy();

        // Ensure abbreviation is unique
        const sameAbbr = ALL_STATUSES.filter(s => STATUS_ABBR[s] === abbr);
        expect(sameAbbr.length).toBe(1);
      }
    });
  });

  describe('Monthly Calendar Days Completeness', () => {
    it('handles 28-day February correctly (2025)', () => {
      expect(daysInMonth(2025, 2)).toBe(28);
    });

    it('handles 29-day February leap year correctly (2024)', () => {
      expect(daysInMonth(2024, 2)).toBe(29);
    });

    it('handles 30-day April, June, Sept, Nov correctly', () => {
      expect(daysInMonth(2026, 4)).toBe(30);
      expect(daysInMonth(2026, 6)).toBe(30);
      expect(daysInMonth(2026, 9)).toBe(30);
      expect(daysInMonth(2026, 11)).toBe(30);
    });

    it('handles 31-day months correctly', () => {
      expect(daysInMonth(2026, 1)).toBe(31);
      expect(daysInMonth(2026, 3)).toBe(31);
      expect(daysInMonth(2026, 5)).toBe(31);
      expect(daysInMonth(2026, 7)).toBe(31);
      expect(daysInMonth(2026, 8)).toBe(31);
      expect(daysInMonth(2026, 10)).toBe(31);
      expect(daysInMonth(2026, 12)).toBe(31);
    });
  });
});
