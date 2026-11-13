import type { Config, Context } from '@netlify/functions';
import { getDatabase } from '@netlify/database';
import {
  hashPassword,
  jsonResponse,
  errorResponse,
  resetRateLimit,
} from './_shared/auth-utils.mts';
import { ensureDatabaseSchema } from './_shared/schema-init.mts';

export default async (req: Request, context: Context) => {
  try {
    const db = getDatabase();
    await ensureDatabaseSchema(db);

    const body = await req.json().catch(() => ({}));
    const { token, new_password } = body;

    if (!token || typeof token !== 'string') {
      return errorResponse('Reset token is required', 400);
    }

    if (!new_password || typeof new_password !== 'string' || new_password.length < 8) {
      return errorResponse('Password must be at least 8 characters', 400);
    }

    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');

      // 1. Find valid reset token
      const tokenRes = await client.query(
        `SELECT r.id, r.user_id, r.expires_at, r.used_at, u.email, u.name, u.is_active
         FROM password_resets r
         JOIN users u ON u.id = r.user_id
         WHERE r.token = $1
         FOR UPDATE`,
        [token.trim()]
      );

      if (tokenRes.rows.length === 0) {
        await client.query('ROLLBACK');
        return errorResponse('Invalid or expired password reset link.', 400);
      }

      const resetRecord = tokenRes.rows[0];

      if (resetRecord.used_at) {
        await client.query('ROLLBACK');
        return errorResponse('This password reset link has already been used.', 400);
      }

      if (new Date(resetRecord.expires_at).getTime() < Date.now()) {
        await client.query('ROLLBACK');
        return errorResponse('This password reset link has expired. Please request a new one.', 400);
      }

      if (!resetRecord.is_active) {
        await client.query('ROLLBACK');
        return errorResponse('This account is currently deactivated.', 403);
      }

      // 2. Hash new password and update user
      const passwordHash = await hashPassword(new_password);
      const now = new Date().toISOString();

      await client.query(
        `UPDATE users
         SET password_hash = $1,
             token_version = COALESCE(token_version, 1) + 1,
             updated_at = $2
         WHERE id = $3`,
        [passwordHash, now, resetRecord.user_id]
      );

      // 3. Mark token as used
      await client.query(
        `UPDATE password_resets
         SET used_at = $1
         WHERE id = $2`,
        [now, resetRecord.id]
      );

      // 4. Invalidate any other outstanding reset tokens for this user
      await client.query(
        `UPDATE password_resets
         SET used_at = $1
         WHERE user_id = $2 AND used_at IS NULL AND id != $3`,
        [now, resetRecord.user_id, resetRecord.id]
      );

      // 5. Clear login rate limits for this email
      await client.query(
        `DELETE FROM login_rate_limits
         WHERE key = $1`,
        [`email:${resetRecord.email.toLowerCase()}`]
      );

      await client.query('COMMIT');

      return jsonResponse({
        message: 'Password has been reset successfully. You may now sign in.',
      });
    } catch (txErr) {
      await client.query('ROLLBACK');
      throw txErr;
    } finally {
      client.release();
    }
  } catch (err: any) {
    console.error('auth-reset-password error:', err);
    return errorResponse('Unable to complete password reset. Please try again.', 500);
  }
};

export const config: Config = {
  path: '/api/auth-reset-password',
  method: ['POST'],
};
