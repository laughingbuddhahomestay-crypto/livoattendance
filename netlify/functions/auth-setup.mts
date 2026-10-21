import type { Config, Context } from '@netlify/functions';
import { getDatabase } from '@netlify/database';
import { hashPassword, generateToken, jsonResponse, errorResponse } from './_shared/auth-utils.mts';
import crypto from 'node:crypto';

export default async (req: Request, context: Context) => {
  try {
    const db = getDatabase();

    if (req.method === 'GET') {
      const result = await db.sql`SELECT COUNT(*) as count FROM users`;
      const count = parseInt((result[0] as any).count, 10);
      return jsonResponse({
        needs_setup: count === 0,
        requires_setup_secret: Boolean(process.env.SETUP_SECRET),
      });
    }

    if (req.method === 'POST') {
      const body = await req.json();
      const { email, password, name, setup_secret } = body;

      // 1. Enforce setup secret if configured in environment
      const configuredSecret = process.env.SETUP_SECRET;
      if (configuredSecret) {
        if (!setup_secret || typeof setup_secret !== 'string') {
          return errorResponse('Setup secret key is required for initial owner setup', 401);
        }
        // Timing-safe comparison to prevent timing attacks
        const bufA = Buffer.from(setup_secret);
        const bufB = Buffer.from(configuredSecret);
        if (bufA.length !== bufB.length || !crypto.timingSafeEqual(bufA, bufB)) {
          return errorResponse('Invalid setup secret key', 401);
        }
      }

      // 2. Validate email format
      if (!email || typeof email !== 'string') {
        return errorResponse('Email is required');
      }
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        return errorResponse('Invalid email format');
      }

      // 3. Validate password (min 8 chars)
      if (!password || typeof password !== 'string' || password.length < 8) {
        return errorResponse('Password must be at least 8 characters');
      }

      // 4. Validate name
      if (!name || typeof name !== 'string' || name.trim().length === 0) {
        return errorResponse('Name is required');
      }

      // 5. Connect dedicated client to execute atomic exclusive setup transaction
      const client = await db.pool.connect();
      try {
        await client.query('BEGIN');

        // Exclusively lock users table to serialize concurrent initialization requests
        await client.query('LOCK TABLE users IN EXCLUSIVE MODE');

        const countRes = await client.query('SELECT COUNT(*)::int as count FROM users');
        const count = countRes.rows[0]?.count || 0;
        if (count > 0) {
          await client.query('ROLLBACK');
          return errorResponse('Setup already completed. Initial owner account exists.', 403);
        }

        const passwordHash = await hashPassword(password);
        const userId = crypto.randomUUID();
        const now = new Date().toISOString();

        const insertRes = await client.query(
          `INSERT INTO users (id, email, password_hash, name, role, is_active, created_at, updated_at)
           VALUES ($1, $2, $3, $4, 'owner', true, $5, $5)
           RETURNING id, email, name, role, is_active, created_at, updated_at`,
          [userId, email.toLowerCase().trim(), passwordHash, name.trim(), now]
        );

        await client.query('COMMIT');

        const user = insertRes.rows[0];
        const token = generateToken(user);

        return jsonResponse({ token, user }, 201);
      } catch (txErr) {
        await client.query('ROLLBACK');
        throw txErr;
      } finally {
        client.release();
      }
    }

    return errorResponse('Method not allowed', 405);
  } catch (err: any) {
    console.error('auth-setup error:', err);
    if (err.code === '23505') {
      return errorResponse('Email already exists', 409);
    }
    return errorResponse(err.message || 'Internal server error', 500);
  }
};

export const config: Config = {
  path: '/api/auth-setup',
  method: ['GET', 'POST'],
};
