import type { Config, Context } from '@netlify/functions';
import { getDatabase } from '@netlify/database';
import { hashPassword, generateToken, jsonResponse, errorResponse } from './_shared/auth-utils.mts';
import crypto from 'node:crypto';

export default async (req: Request, context: Context) => {
  try {
    const body = await req.json();
    const { token, password } = body;

    if (!token || typeof token !== 'string') {
      return errorResponse('Invitation token is required');
    }
    if (!password || typeof password !== 'string' || password.length < 8) {
      return errorResponse('Password must be at least 8 characters');
    }

    const db = getDatabase();

    // Find invitation by token
    const invResult = await db.sql`
      SELECT id, email, name, role, token, invited_by, expires_at, used_at, created_at
      FROM invitations
      WHERE token = ${token}
    `;

    if (invResult.length === 0) {
      return errorResponse('Invalid invitation token', 404);
    }

    const invitation = invResult[0];

    // Check if already used
    if (invitation.used_at) {
      return errorResponse('This invitation has already been used', 400);
    }

    // Check if expired
    if (new Date(invitation.expires_at) < new Date()) {
      return errorResponse('This invitation has expired', 400);
    }

    // Check if email is already registered
    const existingUser = await db.sql`
      SELECT id FROM users WHERE LOWER(email) = ${invitation.email.toLowerCase()}
    `;
    if (existingUser.length > 0) {
      return errorResponse('A user with this email already exists', 409);
    }

    const passwordHash = await hashPassword(password);
    const userId = crypto.randomUUID();
    const now = new Date().toISOString();

    // Use transaction: insert user and mark invitation as used
    const pool = db.pool;
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      const updateInv = await client.query(
        `UPDATE invitations SET used_at = $1 WHERE id = $2 AND used_at IS NULL`,
        [now, invitation.id]
      );

      if (updateInv.rowCount === 0) {
        await client.query('ROLLBACK');
        return errorResponse('This invitation has already been accepted', 409);
      }

      const userInsert = await client.query(
        `INSERT INTO users (id, email, password_hash, name, role, is_active, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, true, $6, $7)
         RETURNING id, email, name, role, is_active, created_at, updated_at`,
        [userId, invitation.email, passwordHash, invitation.name, invitation.role, now, now]
      );

      await client.query('COMMIT');

      const user = userInsert.rows[0];
      const jwtToken = generateToken(user);

      return jsonResponse({ token: jwtToken, user }, 201);
    } catch (txErr) {
      await client.query('ROLLBACK');
      throw txErr;
    } finally {
      client.release();
    }
  } catch (err: any) {
    console.error('auth-accept-invite error:', err);
    if (err.code === '23505') {
      return errorResponse('A user with this email already exists', 409);
    }
    return errorResponse(err.message || 'Internal server error', 500);
  }
};

export const config: Config = {
  path: '/api/auth-accept-invite',
  method: ['POST'],
};
