import type { Config, Context } from '@netlify/functions';
import { getDatabase } from '@netlify/database';
import { requireAuth, comparePassword, hashPassword, jsonResponse, errorResponse } from './_shared/auth-utils.mts';

export default async (req: Request, context: Context) => {
  try {
    const user = await requireAuth(req);

    const body = await req.json();
    const { current_password, new_password } = body;

    if (!current_password || typeof current_password !== 'string') {
      return errorResponse('Current password is required');
    }
    if (!new_password || typeof new_password !== 'string' || new_password.length < 8) {
      return errorResponse('New password must be at least 8 characters');
    }

    const db = getDatabase();

    // Get current password hash
    const result = await db.sql`
      SELECT password_hash FROM users WHERE id = ${user.userId}
    `;

    if (result.length === 0) {
      return errorResponse('User not found', 404);
    }

    // Verify current password
    const valid = await comparePassword(current_password, result[0].password_hash);
    if (!valid) {
      return errorResponse('Current password is incorrect', 401);
    }

    // Hash and update new password, and bump token_version to invalidate prior sessions
    const newHash = await hashPassword(new_password);
    const now = new Date().toISOString();

    await db.sql`
      UPDATE users
      SET password_hash = ${newHash},
          token_version = COALESCE(token_version, 1) + 1,
          updated_at = ${now}
      WHERE id = ${user.userId}
    `;

    return jsonResponse({ message: 'Password changed successfully' });
  } catch (err: any) {
    console.error('auth-change-password error:', err);
    if (err.message === 'Missing or invalid Authorization header' || err.message === 'Invalid or expired token') {
      return errorResponse(err.message, 401);
    }
    if (err.message === 'User account is deactivated') {
      return errorResponse(err.message, 403);
    }
    return errorResponse(err.message || 'Internal server error', 500);
  }
};

export const config: Config = {
  path: '/api/auth-change-password',
  method: ['POST'],
};
