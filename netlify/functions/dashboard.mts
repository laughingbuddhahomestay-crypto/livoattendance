import type { Config, Context } from '@netlify/functions';
import { getDatabase } from '@netlify/database';
import { requireAuth, jsonResponse, errorResponse, todayIST } from './_shared/auth-utils.mts';
import { ensureDatabaseSchema } from './_shared/schema-init.mts';

export default async (req: Request, context: Context) => {
  try {
    // Optional auth: dashboard summary metrics are viewable publicly
    try {
      await requireAuth(req);
    } catch {
      // Guest view allowed for summary numbers
    }

    const db = getDatabase();
    await ensureDatabaseSchema(db);
    const url = new URL(req.url);

    let date = url.searchParams.get('date');
    if (!date) {
      date = todayIST();
    } else if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return errorResponse('Invalid date format. Expected YYYY-MM-DD');
    }

    // 1. Total staff employed on this date
    const staffCountRes = await db.sql`
      SELECT COUNT(*)::int as count
      FROM staff
      WHERE joining_date <= ${date}::date
        AND (leaving_date IS NULL OR leaving_date >= ${date}::date)
    `;
    const totalEmployed = (staffCountRes[0] as any)?.count || 0;

    // 2. Status counts for attendance on this date
    const statusCountsRes = await db.sql`
      SELECT status, COUNT(*)::int as count
      FROM attendance
      WHERE attendance_date = ${date}::date
      GROUP BY status
    `;

    const counts: Record<string, number> = {
      present: 0,
      absent: 0,
      half_day: 0,
      weekly_off: 0,
      paid_leave: 0,
      unpaid_leave: 0,
    };

    let totalMarked = 0;
    for (const row of statusCountsRes as any[]) {
      if (counts[row.status] !== undefined) {
        counts[row.status] = Number(row.count);
        totalMarked += Number(row.count);
      }
    }

    const isFuture = date > todayIST();
    const notMarked = Math.max(0, totalEmployed - totalMarked);
    // In exception-based attendance for fixed-salary hospitality staff, all unmarked active staff are Present by default for today and past dates
    const effectivePresent = isFuture ? counts.present : counts.present + notMarked;
    const finalNotMarked = isFuture ? notMarked : 0;

    return jsonResponse({
      date,
      total_employed: totalEmployed,
      present: effectivePresent,
      absent: counts.absent,
      half_day: counts.half_day,
      weekly_off: counts.weekly_off,
      paid_leave: counts.paid_leave,
      unpaid_leave: counts.unpaid_leave,
      not_marked: finalNotMarked,
    });
  } catch (err: any) {
    console.error('dashboard error:', err);
    if (err.message === 'Missing or invalid Authorization header' || err.message === 'Invalid or expired token') {
      return errorResponse(err.message, 401);
    }
    return errorResponse(err.message || 'Internal server error', 500);
  }
};

export const config: Config = {
  path: '/api/dashboard',
  method: ['GET'],
};
