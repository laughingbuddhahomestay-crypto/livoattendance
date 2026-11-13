import type { Config, Context } from '@netlify/functions';
import { getDatabase } from '@netlify/database';
import {
  comparePassword,
  generateToken,
  jsonResponse,
  errorResponse,
  getClientIp,
  checkRateLimit,
  recordFailedAttempt,
  resetRateLimit,
  ensureDefaultAccounts,
} from './_shared/auth-utils.mts';
import { ensureDatabaseSchema } from './_shared/schema-init.mts';

export default async (req: Request, context: Context) => {
  try {
    const body = await req.json();
    const { email, password } = body;

    if (!email || typeof email !== 'string') {
      return errorResponse('Email is required');
    }
    if (!password || typeof password !== 'string') {
      return errorResponse('Password is required');
    }

    const cleanEmail = email.toLowerCase().trim();
    const clientIp = getClientIp(req);

    const db = getDatabase();
    await ensureDatabaseSchema(db);

    // Auto-ensure requested owner & manager accounts are provisioned/synced
    if (cleanEmail === 'pkray2012@gmail.com' || cleanEmail === 'livotelpremiumhotel@gmail.com') {
      await ensureDefaultAccounts(db);
    }

    // 1. Check rate limits by IP and by Email (shared persistent database check)
    const ipLimit = await checkRateLimit(`ip:${clientIp}`);
    if (ipLimit.blocked) {
      return new Response(
        JSON.stringify({
          error: `Too many failed login attempts from this network. Please wait ${Math.ceil(ipLimit.retryAfterSeconds / 60)} minutes.`,
        }),
        {
          status: 429,
          headers: {
            'Content-Type': 'application/json',
            'Retry-After': String(ipLimit.retryAfterSeconds),
          },
        }
      );
    }

    const emailLimit = await checkRateLimit(`email:${cleanEmail}`);
    if (emailLimit.blocked) {
      return new Response(
        JSON.stringify({
          error: `Too many failed login attempts for this account. Please wait ${Math.ceil(emailLimit.retryAfterSeconds / 60)} minutes.`,
        }),
        {
          status: 429,
          headers: {
            'Content-Type': 'application/json',
            'Retry-After': String(emailLimit.retryAfterSeconds),
          },
        }
      );
    }

    const result = await db.sql`
      SELECT id, email, password_hash, name, role, is_active, token_version, created_at, updated_at
      FROM users
      WHERE LOWER(email) = ${cleanEmail}
    `;

    if (!result || result.length === 0) {
      await recordFailedAttempt(`ip:${clientIp}`);
      await recordFailedAttempt(`email:${cleanEmail}`);
      return errorResponse('Invalid email or password', 401);
    }

    const user = result[0];

    if (!user.is_active) {
      return errorResponse('Your account has been deactivated. Please contact an administrator.', 403);
    }

    const valid = await comparePassword(password, user.password_hash);
    if (!valid) {
      await recordFailedAttempt(`ip:${clientIp}`);
      await recordFailedAttempt(`email:${cleanEmail}`);
      return errorResponse('Invalid email or password', 401);
    }

    // Reset rate limit counters upon successful login
    await resetRateLimit(`ip:${clientIp}`);
    await resetRateLimit(`email:${cleanEmail}`);

    const token = generateToken(user as any);

    const { password_hash, ...userWithoutPassword } = user;
    return jsonResponse({ token, user: userWithoutPassword });
  } catch (err: any) {
    console.error('auth-login error:', err);
    return errorResponse(err.message || 'Internal server error', 500);
  }
};

export const config: Config = {
  path: '/api/auth-login',
  method: ['POST'],
};
