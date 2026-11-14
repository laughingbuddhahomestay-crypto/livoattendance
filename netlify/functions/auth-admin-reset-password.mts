import type { Config, Context } from '@netlify/functions';
import { getDatabase } from '@netlify/database';
import {
  requireOwner,
  hashPassword,
  jsonResponse,
  errorResponse,
} from './_shared/auth-utils.mts';
import { ensureDatabaseSchema } from './_shared/schema-init.mts';

export default async (req: Request, context: Context) => {
  try {
    const owner = await requireOwner(req);
    const db = getDatabase();
    await ensureDatabaseSchema(db);

    const body = await req.json().catch(() => ({}));
    const { user_id, new_password } = body;

    if (!user_id || typeof user_id !== 'string') {
      return errorResponse('User ID is required', 400);
    }

    if (!new_password || typeof new_password !== 'string' || new_password.length < 8) {
      return errorResponse('New password must be at least 8 characters', 400);
    }

    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');

      const userRes = await client.query(
        `SELECT id, email, name, role FROM users WHERE id = $1`,
        [user_id]
      );

      if (userRes.rows.length === 0) {
        await client.query('ROLLBACK');
        return errorResponse('User not found', 404);
      }

      const targetUser = userRes.rows[0];
      const newHash = await hashPassword(new_password);
      const now = new Date().toISOString();

      await client.query(
        `UPDATE users
         SET password_hash = $1,
             token_version = COALESCE(token_version, 1) + 1,
             updated_at = $2
         WHERE id = $3`,
        [newHash, now, user_id]
      );

      // Invalidate any outstanding self-service reset tokens for this user
      await client.query(
        `UPDATE password_resets
         SET used_at = $1
         WHERE user_id = $2 AND used_at IS NULL`,
        [now, user_id]
      );

      // Clear rate limits so the user can immediately log in
      await client.query(
        `DELETE FROM login_rate_limits
         WHERE key = $1`,
        [`email:${targetUser.email.toLowerCase()}`]
      );

      await client.query('COMMIT');

      return jsonResponse({
        message: `Password for ${targetUser.name} (${targetUser.email}) has been successfully updated.`,
      });
    } catch (txErr) {
      await client.query('ROLLBACK');
      throw txErr;
    } finally {
      client.release();
    }
  } catch (err: any) {
    console.error('auth-admin-reset-password error:', err);
    if (err.message === 'Missing or invalid Authorization header' || err.message === 'Invalid or expired token') {
      return errorResponse(err.message, 401);
    }
    if (err.message === 'Owner access required') {
      return errorResponse(err.message, 403);
    }
    return errorResponse('Unable to update user password.', 500);
  }
};

export const config: Config = {
  path: '/api/auth-admin-reset-password',
  method: ['POST'],
};
