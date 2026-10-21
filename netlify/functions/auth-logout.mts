import type { Config, Context } from '@netlify/functions';
import {
  extractAndVerifyToken,
  revokeTokenInDb,
  jsonResponse,
  errorResponse,
} from './_shared/auth-utils.mts';

export default async (req: Request, context: Context) => {
  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return jsonResponse({ success: true, message: 'Already logged out' });
    }

    try {
      const { payload, exp } = extractAndVerifyToken(req);
      if (payload.jti) {
        await revokeTokenInDb(payload.jti, payload.userId, exp);
      }
    } catch {
      // If token is already invalid/expired, logout still succeeds
    }

    return jsonResponse({ success: true, message: 'Logged out successfully' });
  } catch (err: any) {
    console.error('auth-logout error:', err);
    return errorResponse(err.message || 'Logout failed', 500);
  }
};

export const config: Config = {
  path: '/api/auth-logout',
  method: ['POST'],
};
