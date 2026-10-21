import type { Config, Context } from '@netlify/functions';
import { getDatabase } from '@netlify/database';
import crypto from 'node:crypto';
import { jsonResponse, errorResponse } from './_shared/auth-utils.mts';

/**
 * Verify Svix-style / HMAC-SHA256 webhook signatures from email providers (Resend, Postmark, etc.)
 */
export function verifyWebhookSignature(
  rawBody: string,
  headers: Headers,
  secret: string
): { valid: boolean; reason?: string } {
  if (!secret) {
    return { valid: false, reason: 'Webhook secret is not configured' };
  }

  // Check for Svix headers (Resend uses Svix)
  const svixId = headers.get('svix-id');
  const svixTimestamp = headers.get('svix-timestamp');
  const svixSignature = headers.get('svix-signature');

  if (svixId && svixTimestamp && svixSignature) {
    // 1. Prevent replay attacks: timestamp must be within 5 minutes
    const tsSec = parseInt(svixTimestamp, 10);
    const nowSec = Math.floor(Date.now() / 1000);
    if (isNaN(tsSec) || Math.abs(nowSec - tsSec) > 300) {
      return { valid: false, reason: 'Webhook timestamp is outside tolerance window' };
    }

    // 2. Decode Svix secret (base64 after 'whsec_' prefix if present)
    const secretKey = secret.startsWith('whsec_') ? secret.slice(6) : secret;
    const keyBuf = Buffer.from(secretKey, 'base64');

    // 3. Compute HMAC-SHA256 over `${svixId}.${svixTimestamp}.${rawBody}`
    const toSign = `${svixId}.${svixTimestamp}.${rawBody}`;
    const expectedSig = crypto.createHmac('sha256', keyBuf).update(toSign).digest('base64');

    // svix-signature may contain multiple signatures separated by space, e.g. "v1,signature"
    const passedSigs = svixSignature.split(' ').map(s => {
      const parts = s.split(',');
      return parts.length > 1 ? parts[1] : parts[0];
    });

    const isMatch = passedSigs.some(sig => {
      try {
        const sigBuf = Buffer.from(sig, 'base64');
        const expBuf = Buffer.from(expectedSig, 'base64');
        return sigBuf.length === expBuf.length && crypto.timingSafeEqual(sigBuf, expBuf);
      } catch {
        return false;
      }
    });

    return { valid: isMatch, reason: isMatch ? undefined : 'Signature mismatch' };
  }

  // Fallback: Check custom HMAC header "x-webhook-signature"
  const customSig = headers.get('x-webhook-signature') || headers.get('x-signature');
  if (customSig) {
    const hmac = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
    try {
      const match = crypto.timingSafeEqual(Buffer.from(customSig), Buffer.from(hmac));
      return { valid: match, reason: match ? undefined : 'Signature mismatch' };
    } catch {
      return { valid: false, reason: 'Invalid signature format' };
    }
  }

  // Fallback: Token comparison (e.g. Postmark X-Postmark-Secret)
  const token = headers.get('x-postmark-secret');
  if (token) {
    const match = crypto.timingSafeEqual(Buffer.from(token), Buffer.from(secret));
    return { valid: match, reason: match ? undefined : 'Token mismatch' };
  }

  return { valid: false, reason: 'No valid signature or verification headers found' };
}

export default async (req: Request, context: Context) => {
  if (req.method !== 'POST') {
    return errorResponse('Method not allowed', 405);
  }

  try {
    const rawBody = await req.text();
    const webhookSecret = process.env.EMAIL_WEBHOOK_SECRET || process.env.RESEND_WEBHOOK_SECRET;

    // Verify cryptographic signature
    if (webhookSecret) {
      const verification = verifyWebhookSignature(rawBody, req.headers, webhookSecret);
      if (!verification.valid) {
        console.warn('[WEBHOOK] Rejected invalid webhook signature:', verification.reason);
        return errorResponse(`Unauthorized: ${verification.reason}`, 401);
      }
    } else if (process.env.NODE_ENV === 'production') {
      return errorResponse('Webhook secret is not configured on server', 500);
    }

    const payload = JSON.parse(rawBody);
    const db = getDatabase();
    const client = await db.pool.connect();

    try {
      // Handle Resend & standard email events
      const eventType = payload.type || payload.event || payload.RecordType;
      const data = payload.data || payload;
      const emailId = data.email_id || data.id || data.MessageID;

      if (!emailId) {
        return jsonResponse({ message: 'Event ignored: no message identifier' });
      }

      if (eventType === 'email.delivered' || eventType === 'Delivery') {
        await client.query(
          `UPDATE notification_outbox
           SET status = 'delivered',
               updated_at = NOW()
           WHERE provider_message_id = $1`,
          [emailId]
        );
        console.log(`[WEBHOOK] Marked notification ${emailId} as DELIVERED`);
      } else if (eventType === 'email.bounced' || eventType === 'Bounce') {
        const bounceReason = data.bounce_reason || data.description || 'Email bounced by recipient mail server';
        await client.query(
          `UPDATE notification_outbox
           SET status = 'bounced',
               error_message = $1,
               updated_at = NOW()
           WHERE provider_message_id = $2`,
          [bounceReason, emailId]
        );
        console.log(`[WEBHOOK] Marked notification ${emailId} as BOUNCED: ${bounceReason}`);
      }

      return jsonResponse({ received: true });
    } finally {
      client.release();
    }
  } catch (err: any) {
    console.error('[WEBHOOK] Error processing webhook:', err);
    return errorResponse(err.message || 'Webhook processing failed', 400);
  }
};

export const config: Config = {
  path: '/api/notifications-webhook',
  method: ['POST'],
};
