import type { Config, Context } from '@netlify/functions';
import { getDatabase } from '@netlify/database';
import { requireAuth, errorResponse, todayIST } from './_shared/auth-utils.mts';

/**
 * Sanitizes cell values to prevent CSV formula injection (CSV Injection / CWE-1236).
 * Prepends a single quote if string begins with =, +, -, @, \t, or \r.
 */
function sanitizeCsvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '""';
  let str = String(value);

  // If begins with vulnerable formula trigger characters, prefix with single quote
  if (/^[=+\-@\t\r]/.test(str)) {
    str = `'${str}`;
  }

  // Escape any existing double quotes by doubling them
  str = str.replace(/"/g, '""');

  return `"${str}"`;
}

const STATUS_SHORT: Record<string, string> = {
  present: 'P',
  absent: 'A',
  half_day: 'HD',
  weekly_off: 'WO',
  paid_leave: 'PL',
  unpaid_leave: 'UL',
};

export default async (req: Request, context: Context) => {
  try {
    await requireAuth(req);
    const db = getDatabase();
    const url = new URL(req.url);

    const yearStr = url.searchParams.get('year');
    const monthStr = url.searchParams.get('month');

    if (!yearStr || !monthStr) {
      return errorResponse('year and month query parameters are required');
    }

    const year = parseInt(yearStr, 10);
    const month = parseInt(monthStr, 10);

    if (isNaN(year) || isNaN(month) || month < 1 || month > 12) {
      return errorResponse('Invalid year or month');
    }

    const daysInMonth = new Date(year, month, 0).getDate();
    const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
    const endDate = `${year}-${String(month).padStart(2, '0')}-${String(daysInMonth).padStart(2, '0')}`;
    const today = todayIST();

    // Query staff
    const staffRes = await db.sql`
      SELECT id, employee_id, full_name, designation, department,
             TO_CHAR(joining_date, 'YYYY-MM-DD') as joining_date,
             TO_CHAR(leaving_date, 'YYYY-MM-DD') as leaving_date
      FROM staff
      WHERE joining_date <= ${endDate}::date
        AND (leaving_date IS NULL OR leaving_date >= ${startDate}::date)
      ORDER BY department ASC, full_name ASC
    `;

    // Query attendance
    const attendanceRes = await db.sql`
      SELECT staff_id,
             EXTRACT(DAY FROM attendance_date)::int as day,
             status, check_in, check_out
      FROM attendance
      WHERE attendance_date >= ${startDate}::date
        AND attendance_date <= ${endDate}::date
    `;

    const attMap = new Map<string, Map<number, any>>();
    for (const row of attendanceRes as any[]) {
      if (!attMap.has(row.staff_id)) {
        attMap.set(row.staff_id, new Map());
      }
      attMap.get(row.staff_id)!.set(row.day, row);
    }

    // Build CSV header
    const headers = [
      'Employee ID',
      'Full Name',
      'Department',
      'Designation',
      'Joining Date',
      'Leaving Date',
    ];

    for (let d = 1; d <= daysInMonth; d++) {
      headers.push(String(d));
    }

    headers.push(
      'Present (P)',
      'Absent (A)',
      'Half Day (HD)',
      'Weekly Off (WO)',
      'Paid Leave (PL)',
      'Unpaid Leave (UL)',
      'Recorded Hours'
    );

    const csvLines: string[] = [];
    csvLines.push(headers.map(sanitizeCsvCell).join(','));

    // Build rows
    for (const staff of staffRes as any[]) {
      const staffDays = attMap.get(staff.id) || new Map();
      const totals: Record<string, number> = {
        present: 0,
        absent: 0,
        half_day: 0,
        weekly_off: 0,
        paid_leave: 0,
        unpaid_leave: 0,
      };

      let totalHours: number | null = null;
      let hasAnyHours = false;

      const rowValues: (string | number | null)[] = [
        staff.employee_id,
        staff.full_name,
        staff.department,
        staff.designation,
        staff.joining_date,
        staff.leaving_date || '-',
      ];

      for (let d = 1; d <= daysInMonth; d++) {
        const dStr = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

        if (dStr < staff.joining_date || (staff.leaving_date && dStr > staff.leaving_date)) {
          rowValues.push('N/A');
          continue;
        }

        if (dStr > today) {
          rowValues.push('');
          continue;
        }

        const att = staffDays.get(d);
        if (att) {
          rowValues.push(STATUS_SHORT[att.status] || att.status);
          if (totals[att.status] !== undefined) {
            totals[att.status]++;
          }

          if (att.check_in && att.check_out) {
            const inTime = new Date(att.check_in).getTime();
            const outTime = new Date(att.check_out).getTime();
            if (!isNaN(inTime) && !isNaN(outTime) && outTime > inTime) {
              const hrs = (outTime - inTime) / (1000 * 60 * 60);
              totalHours = (totalHours || 0) + hrs;
              hasAnyHours = true;
            }
          }
        } else {
          // Employed, past date, but not explicitly marked: defaults to 'P' (Present)
          rowValues.push('P');
          totals.present++;
        }
      }

      // Append status totals
      rowValues.push(
        totals.present,
        totals.absent,
        totals.half_day,
        totals.weekly_off,
        totals.paid_leave,
        totals.unpaid_leave,
        hasAnyHours && totalHours !== null ? Math.round(totalHours * 10) / 10 : '-'
      );

      csvLines.push(rowValues.map(sanitizeCsvCell).join(','));
    }

    const csvContent = '\uFEFF' + csvLines.join('\r\n'); // UTF-8 BOM for Excel compatibility

    return new Response(csvContent, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="Livotel_Attendance_${year}_${String(month).padStart(2, '0')}.csv"`,
      },
    });
  } catch (err: any) {
    console.error('reports-export error:', err);
    if (err.message === 'Missing or invalid Authorization header' || err.message === 'Invalid or expired token') {
      return errorResponse(err.message, 401);
    }
    return errorResponse(err.message || 'Internal server error', 500);
  }
};

export const config: Config = {
  path: '/api/reports-export',
  method: ['GET'],
};
