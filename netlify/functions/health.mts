import type { Config, Context } from '@netlify/functions';
import { getDatabase } from '@netlify/database';
import { requireAuth, jsonResponse, errorResponse } from './_shared/auth-utils.mts';

export default async (req: Request, context: Context) => {
  try {
    // Authenticated health check
    await requireAuth(req);

    const db = getDatabase();
    const result = await db.sql`SELECT 1 as alive`;
    const connected = result.length > 0 && (result[0] as any).alive === 1;

    return jsonResponse({
      status: connected ? 'healthy' : 'degraded',
      db_connected: connected,
      timestamp: new Date().toISOString(),
    });
  } catch (err: any) {
    console.error('health check error:', err);
    if (err.message === 'Missing or invalid Authorization header' || err.message === 'Invalid or expired token') {
      return errorResponse(err.message, 401);
    }
    return jsonResponse(
      {
        status: 'error',
        db_connected: false,
        timestamp: new Date().toISOString(),
      },
      503
    );
  }
};

export const config: Config = {
  path: '/api/health',
  method: ['GET'],
};
