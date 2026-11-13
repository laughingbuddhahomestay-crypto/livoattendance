import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { getDatabase } from '@netlify/database';

const JWT_SECRET = process.env.JWT_SECRET || 'fallback-secret-change-me';
const SALT_ROUNDS = 12;
const TOKEN_EXPIRY = '24h';
const IST_TIMEZONE = 'Asia/Kolkata';
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 15;

export interface UserPayload {
  userId: string;
  email: string;
  role: string;
  name: string;
  jti?: string;
  tokenVersion?: number;
}

/**
 * Returns today's date in Asia/Kolkata timezone as YYYY-MM-DD.
 */
export function todayIST(): string {
  const now = new Date();
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: IST_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return formatter.format(now);
}

/**
 * Creates a JSON response with proper headers.
 */
export function jsonResponse(data: any, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * Creates an error JSON response.
 */
export function errorResponse(message: string, status = 400): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export function getClientIp(req: Request): string {
  return (
    req.headers.get('x-nf-client-connection-ip') ||
    req.headers.get('x-forwarded-for')?.split(',')[0].trim() ||
    '127.0.0.1'
  );
}

/* ── Persistent Multi-Instance Rate Limiting in Database ── */

/**
 * Checks if a key (IP or email) is locked out.
 * Shared across all Netlify Function instances via PostgreSQL.
 */
export async function checkRateLimit(key: string): Promise<{ blocked: boolean; retryAfterSeconds: number }> {
  try {
    const db = getDatabase();
    const rows = await db.sql`
      SELECT failed_attempts, locked_until
      FROM login_rate_limits
      WHERE key = ${key}
    `;

    if (!rows || rows.length === 0) {
      return { blocked: false, retryAfterSeconds: 0 };
    }

    const record = rows[0];
    if (record.locked_until) {
      const lockedUntilMs = new Date(record.locked_until).getTime();
      const nowMs = Date.now();
      if (nowMs < lockedUntilMs) {
        const retryAfterSeconds = Math.max(1, Math.ceil((lockedUntilMs - nowMs) / 1000));
        return { blocked: true, retryAfterSeconds };
      }
    }

    return { blocked: false, retryAfterSeconds: 0 };
  } catch (err) {
    console.error('Persistent rate limit check fallback:', err);
    return { blocked: false, retryAfterSeconds: 0 };
  }
}

/**
 * Records a failed login attempt in the database.
 * If 5 failed attempts occur within 15 minutes, locks out for 15 minutes.
 */
export async function recordFailedAttempt(key: string): Promise<void> {
  try {
    const db = getDatabase();
    await db.sql`
      INSERT INTO login_rate_limits (key, failed_attempts, first_failed_at, locked_until, updated_at)
      VALUES (
        ${key},
        1,
        NOW(),
        NULL,
        NOW()
      )
      ON CONFLICT (key) DO UPDATE SET
        failed_attempts = CASE
          WHEN login_rate_limits.locked_until IS NOT NULL AND login_rate_limits.locked_until < NOW() THEN 1
          WHEN login_rate_limits.first_failed_at < NOW() - INTERVAL '15 minutes' THEN 1
          ELSE login_rate_limits.failed_attempts + 1
        END,
        first_failed_at = CASE
          WHEN (login_rate_limits.locked_until IS NOT NULL AND login_rate_limits.locked_until < NOW())
            OR (login_rate_limits.first_failed_at < NOW() - INTERVAL '15 minutes') THEN NOW()
          ELSE login_rate_limits.first_failed_at
        END,
        locked_until = CASE
          WHEN (login_rate_limits.locked_until IS NOT NULL AND login_rate_limits.locked_until >= NOW()) THEN login_rate_limits.locked_until
          WHEN (
            CASE
              WHEN (login_rate_limits.locked_until IS NOT NULL AND login_rate_limits.locked_until < NOW())
                OR (login_rate_limits.first_failed_at < NOW() - INTERVAL '15 minutes') THEN 1
              ELSE login_rate_limits.failed_attempts + 1
            END
          ) >= ${MAX_FAILED_ATTEMPTS} THEN NOW() + INTERVAL '15 minutes'
          ELSE NULL
        END,
        updated_at = NOW()
    `;
  } catch (err) {
    console.error('Failed to record rate limit attempt in DB:', err);
  }
}

/**
 * Resets the failed attempts upon successful login.
 */
export async function resetRateLimit(key: string): Promise<void> {
  try {
    const db = getDatabase();
    await db.sql`DELETE FROM login_rate_limits WHERE key = ${key}`;
  } catch (err) {
    console.error('Failed to reset rate limit:', err);
  }
}

/* ── JWT Token Verification & Server-Side Revocation ── */

/**
 * Extracts and cryptographically verifies the Bearer JWT token.
 */
export function extractAndVerifyToken(req: Request): { payload: UserPayload; token: string; exp?: number } {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw new Error('Missing or invalid Authorization header');
  }

  const token = authHeader.substring(7);
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as any;
    return {
      payload: {
        userId: decoded.userId,
        email: decoded.email,
        role: decoded.role,
        name: decoded.name,
        jti: decoded.jti,
        tokenVersion: decoded.tokenVersion,
      },
      token,
      exp: decoded.exp,
    };
  } catch (err) {
    throw new Error('Invalid or expired token');
  }
}

export async function verifyToken(req: Request): Promise<UserPayload> {
  const { payload } = extractAndVerifyToken(req);
  return payload;
}

/**
 * Verifies token signature, active status, server-side revocation, and live role.
 * NEVER trusts browser-supplied identity or stale token claims.
 */
export async function requireAuth(req: Request): Promise<UserPayload> {
  const { payload, token, exp } = extractAndVerifyToken(req);
  const db = getDatabase();

  // 1. Check if specific token (jti) has been explicitly revoked upon logout
  if (payload.jti) {
    const revoked = await db.sql`
      SELECT 1 FROM revoked_tokens WHERE token_id = ${payload.jti}
    `;
    if (revoked && revoked.length > 0) {
      throw new Error('Token has been revoked. Please sign in again.');
    }
  }

  // 2. Query fresh live user record from database
  const result = await db.sql`
    SELECT id, email, name, role, is_active, token_version
    FROM users
    WHERE id = ${payload.userId}
  `;

  if (!result || result.length === 0) {
    throw new Error('User not found');
  }

  const user = result[0];
  if (!user.is_active) {
    throw new Error('User account is deactivated');
  }

  // 3. Check token version (if user logged out everywhere, changed password, or had sessions invalidated)
  const userTokenVersion = typeof user.token_version === 'number' ? user.token_version : 1;
  const tokenVersion = typeof payload.tokenVersion === 'number' ? payload.tokenVersion : 1;

  if (tokenVersion !== userTokenVersion) {
    throw new Error('Session has been revoked. Please sign in again.');
  }

  // 4. Return user payload with the LIVE role and name from database
  return {
    userId: user.id,
    email: user.email,
    role: user.role, // Live role from DB
    name: user.name,
    jti: payload.jti,
    tokenVersion: userTokenVersion,
  };
}

/**
 * Verifies the JWT token, checks active status, and ensures the user has OWNER role.
 */
export async function requireOwner(req: Request): Promise<UserPayload> {
  const payload = await requireAuth(req);
  if (payload.role !== 'owner') {
    throw new Error('Owner access required');
  }
  return payload;
}

/**
 * Revokes a single token in the database upon user logout.
 */
export async function revokeTokenInDb(jti: string, userId: string, expSeconds?: number): Promise<void> {
  const db = getDatabase();
  const expiresAt = expSeconds ? new Date(expSeconds * 1000) : new Date(Date.now() + 24 * 60 * 60 * 1000);
  await db.sql`
    INSERT INTO revoked_tokens (token_id, user_id, revoked_at, expires_at)
    VALUES (${jti}, ${userId}, NOW(), ${expiresAt.toISOString()})
    ON CONFLICT (token_id) DO NOTHING
  `;
}

/**
 * Bumps a user's token version in the database, immediately invalidating all
 * previously issued tokens for this user across all devices/sessions.
 */
export async function bumpUserTokenVersion(userId: string): Promise<number> {
  const db = getDatabase();
  const updated = await db.sql`
    UPDATE users
    SET token_version = COALESCE(token_version, 1) + 1, updated_at = NOW()
    WHERE id = ${userId}
    RETURNING token_version
  `;
  return updated[0]?.token_version ?? 1;
}

/**
 * Hashes a password using bcrypt with 12 rounds.
 */
export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, SALT_ROUNDS);
}

/**
 * Compares a plaintext password with a bcrypt hash.
 */
export async function comparePassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

/**
 * Generates a signed JWT token with a unique jti and token_version.
 */
export function generateToken(user: { id: string; email: string; role: string; name: string; token_version?: number }): string {
  const jti = crypto.randomUUID();
  const tokenVersion = user.token_version ?? 1;

  return jwt.sign(
    {
      userId: user.id,
      email: user.email,
      role: user.role,
      name: user.name,
      jti,
      tokenVersion,
    },
    JWT_SECRET,
    { expiresIn: TOKEN_EXPIRY }
  );
}

/**
 * Ensures the primary owner account (pkray2012@gmail.com / Livotel@2027)
 * and primary manager account (livotelpremiumhotel@gmail.com / Livo@2026)
 * exist in the database with their designated credentials and roles.
 */
export async function ensureDefaultAccounts(db: any): Promise<void> {
  try {
    const ownerHash = '$2a$12$J8FHC9/fxGf1.8BWllTEI.iISXOjUoK5SZ4qPHgHJgaKGgs.oUVTe'; // Livotel@2027
    const managerHash = '$2a$12$.9osSw4R0oe2.TwAvujqIO3YzLlKErmfVYSrvNfFoEJs37u8CPOJ.'; // Livo@2026

    await db.sql`
      INSERT INTO users (email, password_hash, name, role, is_active, token_version)
      VALUES (
        'pkray2012@gmail.com',
        ${ownerHash},
        'Pradipta Kumar Ray (Owner)',
        'owner',
        true,
        1
      )
      ON CONFLICT (email) DO UPDATE SET
        role = 'owner',
        is_active = true,
        updated_at = NOW()
    `;

    await db.sql`
      INSERT INTO users (email, password_hash, name, role, is_active, token_version)
      VALUES (
        'livotelpremiumhotel@gmail.com',
        ${managerHash},
        'Hotel Manager',
        'manager',
        true,
        1
      )
      ON CONFLICT (email) DO UPDATE SET
        role = 'manager',
        is_active = true,
        updated_at = NOW()
    `;
  } catch (err) {
    console.warn('ensureDefaultAccounts non-fatal notice:', err);
  }
}

