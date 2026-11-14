import type { Config, Context } from '@netlify/functions';
import { getDatabase } from '@netlify/database';
import { requireAuth, jsonResponse, errorResponse } from './_shared/auth-utils.mts';

export default async (req: Request, context: Context) => {
  try {
    const payload = await requireAuth(req);

    const db = getDatabase();
    const result = await db.sql`
      SELECT id, email, name, role, is_active, created_at, updated_at
      FROM users
      WHERE id = ${payload.userId}
    `;

    if (result.length === 0) {
      return errorResponse('User not found', 404);
    }

    return jsonResponse({ user: result[0] });
  } catch (err: any) {
    console.error('auth-me error:', err);
    if (
      err.message === 'Missing or invalid Authorization header' ||
      err.message === 'Invalid or expired token' ||
      err.message?.includes('revoked')
    ) {
      return errorResponse(err.message, 401);
    }
    if (err.message === 'User account is deactivated') {
      return errorResponse(err.message, 403);
    }
    return errorResponse(err.message || 'Internal server error', 500);
  }
};

export const config: Config = {
  path: '/api/auth-me',
  method: ['GET'],
};
