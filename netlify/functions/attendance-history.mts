import type { Config, Context } from '@netlify/functions';
import { getDatabase } from '@netlify/database';
import { requireAuth, jsonResponse, errorResponse } from './_shared/auth-utils.mts';

export default async (req: Request, context: Context) => {
  try {
    await requireAuth(req);
    const db = getDatabase();
    const url = new URL(req.url);

    const staffId = url.searchParams.get('staff_id');
    if (!staffId) {
      return errorResponse('staff_id query parameter is required');
    }

    const year = url.searchParams.get('year');
    const month = url.searchParams.get('month');

    let query = `
      SELECT a.id, a.staff_id,
             TO_CHAR(a.attendance_date, 'YYYY-MM-DD') as attendance_date,
             a.status, a.shift,
             a.check_in, a.check_out,
             a.notes, a.version,
             a.created_at, a.updated_at,
             s.full_name as staff_name, s.employee_id,
             u.name as updated_by_name
      FROM attendance a
      JOIN staff s ON a.staff_id = s.id
      LEFT JOIN users u ON a.updated_by = u.id
      WHERE a.staff_id = $1
    `;
    const params: any[] = [staffId];

    if (year && month) {
      params.push(Number(year), Number(month));
      query += ` AND EXTRACT(YEAR FROM a.attendance_date) = $2 AND EXTRACT(MONTH FROM a.attendance_date) = $3`;
    } else if (year) {
      params.push(Number(year));
      query += ` AND EXTRACT(YEAR FROM a.attendance_date) = $2`;
    }

    query += ` ORDER BY a.attendance_date DESC LIMIT 365`;

    const client = await db.pool.connect();
    try {
      const res = await client.query(query, params);
      return jsonResponse({ records: res.rows });
    } finally {
      client.release();
    }
  } catch (err: any) {
    console.error('attendance-history error:', err);
    if (err.message === 'Missing or invalid Authorization header' || err.message === 'Invalid or expired token') {
      return errorResponse(err.message, 401);
    }
    return errorResponse(err.message || 'Internal server error', 500);
  }
};

export const config: Config = {
  path: '/api/attendance-history',
  method: ['GET'],
};
