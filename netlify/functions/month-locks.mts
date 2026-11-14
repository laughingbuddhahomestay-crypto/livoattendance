import type { Config, Context } from '@netlify/functions';
import { getDatabase } from '@netlify/database';
import { requireAuth, requireOwner, jsonResponse, errorResponse } from './_shared/auth-utils.mts';

export default async (req: Request, context: Context) => {
  try {
    const db = getDatabase();
    const url = new URL(req.url);

    if (req.method === 'GET') {
      await requireAuth(req);
      const res = await db.sql`
        SELECT ml.id, ml.year, ml.month, ml.locked_at, ml.locked_by,
               COALESCE(u.name, 'Executive') as locked_by_name,
               COALESCE(u.email, '') as locked_by_email
        FROM month_locks ml
        LEFT JOIN users u ON ml.locked_by = u.id
        ORDER BY ml.year DESC, ml.month DESC
      `;
      return jsonResponse({ locks: res });
    }

    // Mutating month locks is strictly Owner only
    const user = await requireOwner(req);

    if (req.method === 'POST') {
      const body = await req.json();
      const { year, month } = body;

      const y = Number(year);
      const m = Number(month);
      if (!y || !m || m < 1 || m > 12) {
        return errorResponse('Valid year and month (1-12) are required');
      }

      const client = await db.pool.connect();
      try {
        await client.query('BEGIN');

        // Coordinate exclusive lock with concurrent attendance saves for this month
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`month_lock_${y}_${m}`]);

        // Check if already locked inside the transaction
        const existing = await client.query(
          'SELECT id FROM month_locks WHERE year = $1 AND month = $2',
          [y, m]
        );
        if (existing.rows.length > 0) {
          await client.query('ROLLBACK');
          return errorResponse(`Month ${m}/${y} is already locked`, 409);
        }

        const insertRes = await client.query(
          `INSERT INTO month_locks (year, month, locked_by, locked_at)
           VALUES ($1, $2, $3, NOW())
           RETURNING id, year, month, locked_at, locked_by`,
          [y, m, user.userId]
        );

        await client.query('COMMIT');

        return jsonResponse(
          {
            lock: {
              ...insertRes.rows[0],
              locked_by_name: user.name,
            },
          },
          201
        );
      } catch (txErr) {
        await client.query('ROLLBACK');
        throw txErr;
      } finally {
        client.release();
      }
    }

    if (req.method === 'DELETE') {
      const yearStr = url.searchParams.get('year');
      const monthStr = url.searchParams.get('month');

      if (!yearStr || !monthStr) {
        return errorResponse('year and month query parameters are required');
      }

      const year = parseInt(yearStr, 10);
      const month = parseInt(monthStr, 10);

      const client = await db.pool.connect();
      try {
        await client.query('BEGIN');
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`month_lock_${year}_${month}`]);

        const delRes = await client.query(
          `DELETE FROM month_locks WHERE year = $1 AND month = $2 RETURNING id`,
          [year, month]
        );
        if (delRes.rowCount === 0) {
          await client.query('ROLLBACK');
          return errorResponse(`Month ${month}/${year} is not locked`, 404);
        }

        await client.query('COMMIT');
        return jsonResponse({ message: `Month ${month}/${year} unlocked successfully` });
      } catch (txErr) {
        await client.query('ROLLBACK');
        throw txErr;
      } finally {
        client.release();
      }
    }

    return errorResponse('Method not allowed', 405);
  } catch (err: any) {
    console.error('month-locks error:', err);
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
  path: '/api/month-locks',
  method: ['GET', 'POST', 'DELETE'],
};
