import type { Config, Context } from '@netlify/functions';
import { getDatabase } from '@netlify/database';
import { requireOwner, jsonResponse, errorResponse } from './_shared/auth-utils.mts';

export default async (req: Request, context: Context) => {
  try {
    const user = await requireOwner(req);
    const db = getDatabase();
    const url = new URL(req.url);

    if (req.method === 'GET') {
      const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10));
      const limit = 50;
      const offset = (page - 1) * limit;
      const statusFilter = url.searchParams.get('status');
      const staffIdFilter = url.searchParams.get('staff_id');

      let query = `
        SELECT o.id, o.staff_id, o.recipient_email, o.notification_type,
               o.idempotency_key, o.subject, o.status, o.attempt_count,
               o.max_attempts, o.next_retry_at, o.provider, o.provider_message_id,
               o.error_message, o.metadata, o.created_at, o.sent_at, o.updated_at,
               s.full_name as staff_name, s.employee_id
        FROM notification_outbox o
        LEFT JOIN staff s ON o.staff_id = s.id
        WHERE 1=1
      `;
      const params: any[] = [];
      let paramIdx = 1;

      if (statusFilter) {
        query += ` AND o.status = $${paramIdx++}`;
        params.push(statusFilter);
      }
      if (staffIdFilter) {
        query += ` AND o.staff_id = $${paramIdx++}`;
        params.push(staffIdFilter);
      }

      query += ` ORDER BY o.created_at DESC LIMIT $${paramIdx++} OFFSET $${paramIdx++}`;
      params.push(limit, offset);

      const pool = db.pool;
      const client = await pool.connect();
      try {
        const rows = await client.query(query, params);

        const countQuery = `
          SELECT COUNT(*)::int as total
          FROM notification_outbox o
          WHERE 1=1
          ${statusFilter ? ` AND o.status = '${statusFilter}'` : ''}
          ${staffIdFilter ? ` AND o.staff_id = '${staffIdFilter}'` : ''}
        `;
        const countRes = await client.query(countQuery);
        const total = countRes.rows[0]?.total || 0;

        return jsonResponse({
          entries: rows.rows,
          total,
          page,
          limit,
        });
      } finally {
        client.release();
      }
    }

    if (req.method === 'POST') {
      // Manual retry action
      const body = await req.json();
      const { id } = body;
      if (!id) {
        return errorResponse('Notification ID is required for retry');
      }

      const client = await db.pool.connect();
      try {
        const res = await client.query(
          `UPDATE notification_outbox
           SET status = 'queued',
               next_retry_at = NOW(),
               attempt_count = 0,
               error_message = NULL,
               updated_at = NOW()
           WHERE id = $1
           RETURNING id, status`,
          [id]
        );

        if (res.rows.length === 0) {
          return errorResponse('Notification not found', 404);
        }

        return jsonResponse({ message: 'Notification reset to queued for immediate retry', notification: res.rows[0] });
      } finally {
        client.release();
      }
    }

    return errorResponse('Method not allowed', 405);
  } catch (err: any) {
    console.error('notifications endpoint error:', err);
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
  path: '/api/notifications',
  method: ['GET', 'POST'],
};
