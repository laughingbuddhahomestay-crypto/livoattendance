import { describe, it, expect } from 'vitest';
import {
  calculateHours,
  formatWorkingHours,
  toDatetimeLocalValue,
  isSameTime,
  formatDate,
  todayIST,
  daysInMonth,
  STATUS_LABELS,
  STATUS_ABBR,
  STATUS_COLORS,
  ALL_STATUSES,
} from '../src/types';

describe('Attendance Domain Logic & Helpers', () => {
  describe('calculateHours (Shift Durations & Overnight Support)', () => {
    it('calculates regular daytime shift duration correctly', () => {
      const checkIn = '2026-10-21T09:00:00.000Z';
      const checkOut = '2026-10-21T17:00:00.000Z';
      const hours = calculateHours(checkIn, checkOut);
      expect(hours).toBe(8);
    });

    it('calculates overnight shift duration correctly when check-out is next morning', () => {
      // Overnight shift: Check-in at 22:00 on Oct 21, Check-out at 06:30 on Oct 22
      const checkIn = '2026-10-21T22:00:00.000Z';
      const checkOut = '2026-10-22T06:30:00.000Z';
      const hours = calculateHours(checkIn, checkOut);
      expect(hours).toBe(8.5);
    });

    it('returns null when check-in or check-out is missing (no invented hours)', () => {
      expect(calculateHours(null, '2026-10-21T17:00:00.000Z')).toBeNull();
      expect(calculateHours('2026-10-21T09:00:00.000Z', null)).toBeNull();
      expect(calculateHours(null, null)).toBeNull();
    });

    it('returns null when check-out is before check-in (invalid range)', () => {
      const checkIn = '2026-10-21T17:00:00.000Z';
      const checkOut = '2026-10-21T09:00:00.000Z';
      expect(calculateHours(checkIn, checkOut)).toBeNull();
    });

    it('returns null for invalid date strings', () => {
      expect(calculateHours('invalid-date', '2026-10-21T17:00:00.000Z')).toBeNull();
    });
  });

  describe('daysInMonth calculation', () => {
    it('calculates 31 days for October', () => {
      expect(daysInMonth(2026, 10)).toBe(31);
    });

    it('calculates 30 days for November', () => {
      expect(daysInMonth(2026, 11)).toBe(30);
    });

    it('calculates 28 days for February in a non-leap year (2025)', () => {
      expect(daysInMonth(2025, 2)).toBe(28);
    });

    it('calculates 29 days for February in a leap year (2024)', () => {
      expect(daysInMonth(2024, 2)).toBe(29);
    });
  });

  describe('Attendance Status Invariants', () => {
    it('not_marked is completely distinct from absent', () => {
      expect(ALL_STATUSES).toContain('absent');
      expect(ALL_STATUSES).not.toContain('not_marked');
      expect(STATUS_COLORS.not_marked).toBeDefined();
      expect(STATUS_COLORS.absent).not.toEqual(STATUS_COLORS.not_marked);
    });

    it('has full coverage for all required hotel attendance statuses', () => {
      const expected = ['present', 'absent', 'half_day', 'weekly_off', 'paid_leave', 'unpaid_leave'];
      expect(ALL_STATUSES).toEqual(expected);

      for (const status of expected) {
        expect(STATUS_LABELS[status as keyof typeof STATUS_LABELS]).toBeDefined();
        expect(STATUS_ABBR[status as keyof typeof STATUS_ABBR]).toBeDefined();
        expect(STATUS_COLORS[status as keyof typeof STATUS_COLORS]).toBeDefined();
      }
    });

    it('todayIST returns a valid YYYY-MM-DD string', () => {
      const ist = todayIST();
      expect(ist).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it('formatWorkingHours returns correct structure for various shift conditions', () => {
      expect(formatWorkingHours(null, null)).toEqual({
        hours: null,
        label: 'Not recorded',
        status: 'not_recorded',
      });
      expect(formatWorkingHours('2026-11-13T10:00:00.000Z', null)).toEqual({
        hours: null,
        label: 'Incomplete',
        status: 'incomplete',
      });
      expect(formatWorkingHours('2026-11-13T18:00:00.000Z', '2026-11-13T10:00:00.000Z')).toEqual({
        hours: null,
        label: 'Invalid duration',
        status: 'invalid',
      });
      expect(formatWorkingHours('2026-11-13T10:00:00.000Z', '2026-11-13T18:00:00.000Z')).toEqual({
        hours: 8,
        label: '8h',
        status: 'recorded',
      });
    });

    it('toDatetimeLocalValue and isSameTime accurately handle timestamp matching', () => {
      const iso = '2026-11-13T10:30:00.000Z';
      const localVal = toDatetimeLocalValue(iso);
      expect(localVal).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
      expect(toDatetimeLocalValue(null)).toBe('');
      expect(toDatetimeLocalValue('invalid')).toBe('');

      expect(isSameTime(null, null)).toBe(true);
      expect(isSameTime('2026-11-13T10:00:00.000Z', '2026-11-13T10:00:00.000Z')).toBe(true);
      expect(isSameTime('2026-11-13T10:00:00.000Z', '2026-11-13T11:00:00.000Z')).toBe(false);
      expect(isSameTime('2026-11-13T10:00:00.000Z', null)).toBe(false);
    });
  });
});
