import type { Config, Context } from '@netlify/functions';
import { getDatabase } from '@netlify/database';
import { requireOwner, jsonResponse, errorResponse } from './_shared/auth-utils.mts';

export default async (req: Request, context: Context) => {
  try {
    await requireOwner(req);
    const db = getDatabase();
    const url = new URL(req.url);

    const staffId = url.searchParams.get('staff_id');
    const date = url.searchParams.get('date');
    const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10));
    const limit = 50;
    const offset = (page - 1) * limit;

    let whereClauses: string[] = [];
    const params: any[] = [];
    let pIdx = 1;

    if (staffId) {
      whereClauses.push(`a.staff_id = $${pIdx++}`);
      params.push(staffId);
    }

    if (date) {
      whereClauses.push(`a.attendance_date = $${pIdx++}::date`);
      params.push(date);
    }

    const whereStr = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

    const client = await db.pool.connect();
    try {
      // Get count
      const countRes = await client.query(
        `SELECT COUNT(*)::int as count FROM attendance_audit a ${whereStr}`,
        params
      );
      const total = countRes.rows[0]?.count || 0;

      // Get page of records
      const queryParams = [...params, limit, offset];
      const dataRes = await client.query(
        `SELECT a.id, a.attendance_id, a.staff_id,
                TO_CHAR(a.attendance_date, 'YYYY-MM-DD') as attendance_date,
                a.previous_values, a.new_values, a.change_reason,
                a.changed_by, a.changed_at,
                s.full_name as staff_name, s.employee_id, s.department,
                u.name as changed_by_name, u.email as changed_by_email
         FROM attendance_audit a
         JOIN staff s ON a.staff_id = s.id
         JOIN users u ON a.changed_by = u.id
         ${whereStr}
         ORDER BY a.changed_at DESC
         LIMIT $${pIdx++} OFFSET $${pIdx++}`,
        queryParams
      );

      return jsonResponse({
        entries: dataRes.rows,
        total,
        page,
        limit,
      });
    } finally {
      client.release();
    }
  } catch (err: any) {
    console.error('audit error:', err);
    if (err.message === 'Missing or invalid Authorization header' || err.message === 'Invalid or expired token') {
      return errorResponse(err.message, 401);
    }
    if (err.message === 'Owner access required' || err.message === 'User account is deactivated') {
      return errorResponse(err.message, 403);
    }
    return errorResponse(err.message || 'Internal server error', 500);
  }
};

export const config: Config = {
  path: '/api/audit',
  method: ['GET'],
};
