import type { Config, Context } from '@netlify/functions';
import { getDatabase } from '@netlify/database';
import crypto from 'node:crypto';
import {
  jsonResponse,
  errorResponse,
  getClientIp,
  checkRateLimit,
  recordFailedAttempt,
} from './_shared/auth-utils.mts';
import { ensureDatabaseSchema } from './_shared/schema-init.mts';

export default async (req: Request, context: Context) => {
  try {
    const db = getDatabase();
    await ensureDatabaseSchema(db);

    const body = await req.json().catch(() => ({}));
    const { email } = body;

    if (!email || typeof email !== 'string') {
      return errorResponse('Email is required', 400);
    }

    const cleanEmail = email.toLowerCase().trim();
    const clientIp = getClientIp(req);

    // Rate limit: max 5 forgot-password requests per 15 minutes per IP
    const ipLimit = await checkRateLimit(`forgot_ip:${clientIp}`);
    if (ipLimit.blocked) {
      return new Response(
        JSON.stringify({
          error: `Too many password reset requests from this network. Please wait ${Math.ceil(ipLimit.retryAfterSeconds / 60)} minutes.`,
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

    const users = await db.sql`
      SELECT id, email, name, is_active
      FROM users
      WHERE LOWER(email) = ${cleanEmail}
    `;

    const user = users[0];
    let resetLink: string | null = null;

    if (user && user.is_active) {
      const token = crypto.randomBytes(32).toString('hex');
      const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

      await db.sql`
        INSERT INTO password_resets (user_id, token, expires_at)
        VALUES (${user.id}, ${token}, ${expiresAt.toISOString()})
      `;

      // Determine origin for the reset link
      const origin =
        req.headers.get('origin') ||
        req.headers.get('referer')?.replace(/\/$/, '') ||
        'https://livotel-attendance.netlify.app';

      resetLink = `${origin}/reset-password?token=${token}`;

      // Queue email in notification_outbox if table is available
      try {
        const idempotencyKey = `pwd_reset_${user.id}_${Date.now()}`;
        const subject = 'Reset Your Livotel Attendance Password';
        const bodyText = `Hello ${user.name},\n\nA password reset was requested for your account.\nPlease use the link below to set a new password within 1 hour:\n\n${resetLink}\n\nIf you did not request this, please ignore this email.`;
        const bodyHtml = `
          <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 560px; margin: 0 auto; padding: 24px; border: 1px solid #E2E8F0; border-radius: 8px;">
            <h2 style="color: #1B2A4A; margin-top: 0;">Livotel Premium Hotel</h2>
            <p style="color: #334155; font-size: 16px;">Hello <strong>${user.name}</strong>,</p>
            <p style="color: #475569; font-size: 14px; line-height: 1.5;">A password reset request was received for your Livotel Attendance staff account.</p>
            <div style="margin: 24px 0; text-align: center;">
              <a href="${resetLink}" style="background-color: #C5A059; color: #FFFFFF; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: 600; display: inline-block;">Reset Password</a>
            </div>
            <p style="color: #64748B; font-size: 13px;">This link expires in 1 hour. If the button above does not work, copy and paste this link into your browser:<br/><a href="${resetLink}" style="color: #1B2A4A; word-break: break-all;">${resetLink}</a></p>
            <p style="color: #94A3B8; font-size: 12px; margin-top: 24px; border-top: 1px solid #E2E8F0; padding-top: 12px;">If you did not request this password reset, no action is needed and your account remains secure.</p>
          </div>
        `;

        await db.sql`
          INSERT INTO notification_outbox (
            recipient_email, notification_type, idempotency_key, subject,
            body_html, body_text, status
          ) VALUES (
            ${user.email}, 'password_reset', ${idempotencyKey}, ${subject},
            ${bodyHtml}, ${bodyText}, 'queued'
          )
        `;
      } catch (queueErr) {
        console.warn('[PWD_RESET] Non-fatal outbox queuing notice:', queueErr);
      }
    } else {
      // Record a soft attempt on non-existent account to rate-limit enumeration
      await recordFailedAttempt(`forgot_ip:${clientIp}`);
    }

    const isDevOrPreview = process.env.NODE_ENV !== 'production' || process.env.CONTEXT === 'deploy-preview';

    return jsonResponse({
      message: 'If an account exists with that email, a password reset link has been dispatched to your email address.',
      ...(isDevOrPreview && resetLink ? { reset_link: resetLink } : {}),
    });
  } catch (err: any) {
    console.error('auth-forgot-password error:', err);
    return errorResponse('Unable to process password reset request right now.', 500);
  }
};

export const config: Config = {
  path: '/api/auth-forgot-password',
  method: ['POST'],
};
