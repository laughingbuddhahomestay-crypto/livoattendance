import type { Config, Context } from '@netlify/functions';
import { getDatabase } from '@netlify/database';
import { requireAuth, jsonResponse, errorResponse, todayIST } from './_shared/auth-utils.mts';

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

    // 1. Check if month is locked
    const lockRes = await db.sql`
      SELECT id FROM month_locks WHERE year = ${year} AND month = ${month}
    `;
    const isLocked = lockRes.length > 0;

    // 2. Query staff who worked during any day of this month
    const staffRes = await db.sql`
      SELECT id, employee_id, full_name, designation, department,
             TO_CHAR(joining_date, 'YYYY-MM-DD') as joining_date,
             TO_CHAR(leaving_date, 'YYYY-MM-DD') as leaving_date,
             is_active
      FROM staff
      WHERE joining_date <= ${endDate}::date
        AND (leaving_date IS NULL OR leaving_date >= ${startDate}::date)
      ORDER BY department ASC, full_name ASC
    `;

    // 3. Query all attendance records for this month
    const attendanceRes = await db.sql`
      SELECT staff_id,
             EXTRACT(DAY FROM attendance_date)::int as day,
             TO_CHAR(attendance_date, 'YYYY-MM-DD') as attendance_date,
             status, check_in, check_out
      FROM attendance
      WHERE attendance_date >= ${startDate}::date
        AND attendance_date <= ${endDate}::date
    `;

    // Index attendance by staff_id -> day -> record
    const attMap = new Map<string, Map<number, any>>();
    for (const row of attendanceRes as any[]) {
      if (!attMap.has(row.staff_id)) {
        attMap.set(row.staff_id, new Map());
      }
      attMap.get(row.staff_id)!.set(row.day, row);
    }

    // 4. Build monthly rows
    const rows = (staffRes as any[]).map((staff: any) => {
      const staffDays = attMap.get(staff.id) || new Map();
      const days: Record<number, string | null> = {};
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

      for (let d = 1; d <= daysInMonth; d++) {
        const dStr = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

        // Check if day is outside employment
        if (dStr < staff.joining_date || (staff.leaving_date && dStr > staff.leaving_date)) {
          days[d] = null; // outside employment
          continue;
        }

        // Check if day is in future
        if (dStr > today) {
          days[d] = null; // future date
          continue;
        }

        const att = staffDays.get(d);
        if (att) {
          days[d] = att.status;
          if (totals[att.status] !== undefined) {
            totals[att.status]++;
          }

          // Calculate completed hours
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
          // Employed, past date, but not marked
          // In fixed-salary hospitality exception model: defaults to 'present' (100% attendance)
          days[d] = 'present';
          totals.present++;
        }
      }

      return {
        staff_id: staff.id,
        employee_id: staff.employee_id,
        full_name: staff.full_name,
        department: staff.department,
        joining_date: staff.joining_date,
        leaving_date: staff.leaving_date,
        days,
        totals,
        total_hours: hasAnyHours && totalHours !== null ? Math.round(totalHours * 10) / 10 : null,
      };
    });

    return jsonResponse({
      rows,
      month_locked: isLocked,
      year,
      month,
      days_in_month: daysInMonth,
    });
  } catch (err: any) {
    console.error('reports-monthly error:', err);
    if (err.message === 'Missing or invalid Authorization header' || err.message === 'Invalid or expired token') {
      return errorResponse(err.message, 401);
    }
    return errorResponse(err.message || 'Internal server error', 500);
  }
};

export const config: Config = {
  path: '/api/reports-monthly',
  method: ['GET'],
};
