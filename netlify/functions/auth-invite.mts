import type { Config, Context } from '@netlify/functions';
import { getDatabase } from '@netlify/database';
import { requireOwner, jsonResponse, errorResponse } from './_shared/auth-utils.mts';
import crypto from 'node:crypto';

export default async (req: Request, context: Context) => {
  try {
    if (req.method === 'GET') {
      await requireOwner(req);

      const db = getDatabase();
      const result = await db.sql`
        SELECT i.id, i.email, i.name, i.role, i.token, i.invited_by, i.expires_at, i.used_at, i.created_at,
               u.name as invited_by_name
        FROM invitations i
        LEFT JOIN users u ON u.id = i.invited_by
        ORDER BY i.created_at DESC
      `;

      return jsonResponse({ invitations: result });
    }

    if (req.method === 'POST') {
      const user = await requireOwner(req);

      const body = await req.json();
      const { email, name, role } = body;

      // Validate email
      if (!email || typeof email !== 'string') {
        return errorResponse('Email is required');
      }
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        return errorResponse('Invalid email format');
      }

      // Validate name
      if (!name || typeof name !== 'string' || name.trim().length === 0) {
        return errorResponse('Name is required');
      }

      // Validate role
      if (!role || !['owner', 'manager'].includes(role)) {
        return errorResponse('Role must be either "owner" or "manager"');
      }

      const db = getDatabase();

      // Check if email is already registered
      const existingUser = await db.sql`
        SELECT id FROM users WHERE LOWER(email) = ${email.toLowerCase().trim()}
      `;
      if (existingUser.length > 0) {
        return errorResponse('A user with this email already exists', 409);
      }

      // Generate random invitation token
      const token = crypto.randomBytes(32).toString('hex');
      const invitationId = crypto.randomUUID();
      const now = new Date();
      const expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000); // 7 days

      const result = await db.sql`
        INSERT INTO invitations (id, email, name, role, token, invited_by, expires_at, created_at)
        VALUES (${invitationId}, ${email.toLowerCase().trim()}, ${name.trim()}, ${role}, ${token}, ${user.userId}, ${expiresAt.toISOString()}, ${now.toISOString()})
        RETURNING id, email, name, role, token, invited_by, expires_at, used_at, created_at
      `;

      const invitation = result[0];

      // Determine origin for the invite link
      const origin = req.headers.get('Origin')
        || (req.headers.get('Referer') ? new URL(req.headers.get('Referer')!).origin : null)
        || 'https://your-site.netlify.app';

      const link = `${origin}/invite?token=${token}`;

      return jsonResponse({ invitation, link }, 201);
    }

    return errorResponse('Method not allowed', 405);
  } catch (err: any) {
    console.error('auth-invite error:', err);
    if (err.message === 'Missing or invalid Authorization header' || err.message === 'Invalid or expired token') {
      return errorResponse(err.message, 401);
    }
    if (err.message === 'Owner access required' || err.message === 'User account is deactivated') {
      return errorResponse(err.message, 403);
    }
    return errorResponse(err.message || 'Internal server error', 500);
  }
};

export const config: Config = {
  path: '/api/auth-invite',
  method: ['GET', 'POST'],
};
