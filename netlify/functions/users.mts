import type { Config, Context } from '@netlify/functions';
import { getDatabase } from '@netlify/database';
import { requireOwner, jsonResponse, errorResponse } from './_shared/auth-utils.mts';

export default async (req: Request, context: Context) => {
  try {
    const user = await requireOwner(req);
    const db = getDatabase();
    const url = new URL(req.url);

    if (req.method === 'GET') {
      const result = await db.sql`
        SELECT id, email, name, role, is_active, created_at, updated_at
        FROM users
        ORDER BY created_at ASC
      `;
      return jsonResponse({ users: result });
    }

    if (req.method === 'PUT') {
      const id = url.searchParams.get('id');
      if (!id) {
        return errorResponse('User id query parameter is required');
      }

      const body = await req.json();
      const { name, role, is_active } = body;

      // Cannot deactivate yourself
      if (id === user.userId && is_active === false) {
        return errorResponse('You cannot deactivate your own account', 400);
      }

      // Build update fields dynamically
      const updates: string[] = [];
      const values: any[] = [];
      let paramIndex = 1;

      let shouldBumpToken = false;

      if (name !== undefined) {
        updates.push(`name = $${paramIndex++}`);
        values.push(name.trim());
      }
      if (role !== undefined) {
        if (!['owner', 'manager'].includes(role)) {
          return errorResponse('Role must be either "owner" or "manager"');
        }
        updates.push(`role = $${paramIndex++}`);
        values.push(role);
        shouldBumpToken = true;
      }
      if (is_active !== undefined) {
        updates.push(`is_active = $${paramIndex++}`);
        values.push(is_active);
        shouldBumpToken = true;
      }

      if (shouldBumpToken) {
        updates.push(`token_version = COALESCE(token_version, 1) + 1`);
      }

      if (updates.length === 0) {
        return errorResponse('No fields to update');
      }

      const now = new Date().toISOString();
      updates.push(`updated_at = $${paramIndex++}`);
      values.push(now);

      values.push(id);

      const pool = db.pool;
      const client = await pool.connect();
      try {
        const result = await client.query(
          `UPDATE users SET ${updates.join(', ')} WHERE id = $${paramIndex}
           RETURNING id, email, name, role, is_active, created_at, updated_at`,
          values
        );

        if (result.rows.length === 0) {
          return errorResponse('User not found', 404);
        }

        return jsonResponse({ user: result.rows[0] });
      } finally {
        client.release();
      }
    }

    return errorResponse('Method not allowed', 405);
  } catch (err: any) {
    console.error('users error:', err);
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
  path: '/api/users',
  method: ['GET', 'PUT'],
};
