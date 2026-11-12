import type { Config, Context } from '@netlify/functions';
import { getDatabase } from '@netlify/database';
import crypto from 'node:crypto';
import { requireAuth, jsonResponse, errorResponse } from './_shared/auth-utils.mts';

export async function processOutboxJobs(db: any) {
  const providerName = (process.env.EMAIL_PROVIDER || 'sandbox').toLowerCase();
  const isSandbox = providerName === 'sandbox' || !process.env.RESEND_API_KEY;
  const workerId = `worker_${crypto.randomUUID()}`;

  const client = await db.pool.connect();
  try {
    // 1. Atomically claim up to 20 jobs using durable lease with FOR UPDATE SKIP LOCKED
    // Includes jobs that crashed or were abandoned by another worker (locked_at > 5 minutes ago)
    const claimRes = await client.query(
      `WITH claimable AS (
         SELECT id FROM notification_outbox
         WHERE (status = 'queued' AND next_retry_at <= NOW())
            OR (status = 'processing' AND locked_at < NOW() - INTERVAL '5 minutes')
         ORDER BY created_at ASC
         LIMIT 20
         FOR UPDATE SKIP LOCKED
       )
       UPDATE notification_outbox
       SET status = 'processing',
           locked_by = $1,
           locked_at = NOW(),
           updated_at = NOW()
       FROM claimable
       WHERE notification_outbox.id = claimable.id
       RETURNING notification_outbox.id, staff_id, recipient_email, notification_type,
                 subject, body_html, body_text, attempt_count, max_attempts,
                 idempotency_key, metadata`,
      [workerId]
    );

    const items = claimRes.rows;
    let processedCount = 0;
    let failedCount = 0;
    let cancelledCount = 0;

    // Performance Optimization: Batch pre-fetch staff details in 1 query (saves 20+ DB round-trips)
    const staffIds = Array.from(new Set(items.map((i: any) => i.staff_id).filter(Boolean)));
    const staffMap = new Map<string, any>();
    if (staffIds.length > 0) {
      const staffRes = await client.query(
        `SELECT id, full_name, email, notify_absence, notify_monthly_report, is_active
         FROM staff WHERE id = ANY($1)`,
        [staffIds]
      );
      for (const s of staffRes.rows) {
        staffMap.set(s.id, s);
      }
    }

    for (const item of items) {
      try {
        // 2. Recheck employee's current live email and notification preferences at dispatch time
        let recipientEmail = item.recipient_email;

        if (item.staff_id) {
          const staff = staffMap.get(item.staff_id);

          if (!staff) {
            // Staff was removed
            await client.query(
              `UPDATE notification_outbox
               SET status = 'cancelled',
                   error_message = 'Staff record no longer exists at dispatch time',
                   locked_by = NULL,
                   locked_at = NULL,
                   updated_at = NOW()
               WHERE id = $1`,
              [item.id]
            );
            cancelledCount++;
            continue;
          }
          if (!staff.is_active) {
            // Inactive staff
            await client.query(
              `UPDATE notification_outbox
               SET status = 'cancelled',
                   error_message = 'Staff member is marked inactive at dispatch time',
                   locked_by = NULL,
                   locked_at = NULL,
                   updated_at = NOW()
               WHERE id = $1`,
              [item.id]
            );
            cancelledCount++;
            continue;
          }

          if (staff.email && staff.email !== item.recipient_email) {
            // Email was updated after queueing, use updated address
            recipientEmail = staff.email;
          }

          // Check preference opt-outs
          const isAttendanceAlert = [
            'absence_alert',
            'absence_correction',
            'half_day_alert',
            'half_day_correction',
            'non_attendance_alert',
            'non_attendance_correction',
          ].includes(item.notification_type);

          if (isAttendanceAlert && !staff.notify_absence) {
            await client.query(
              `UPDATE notification_outbox
               SET status = 'cancelled',
                   error_message = 'Employee opted out of attendance notifications prior to dispatch',
                   locked_by = NULL,
                   locked_at = NULL,
                   updated_at = NOW()
               WHERE id = $1`,
              [item.id]
            );
            cancelledCount++;
            continue;
          }

          if (item.notification_type === 'monthly_report' && !staff.notify_monthly_report) {
            await client.query(
              `UPDATE notification_outbox
               SET status = 'cancelled',
                   error_message = 'Employee opted out of monthly report notifications prior to dispatch',
                   locked_by = NULL,
                   locked_at = NULL,
                   updated_at = NOW()
               WHERE id = $1`,
              [item.id]
            );
            cancelledCount++;
            continue;
          }
        }

        // 3. Dispatch through provider or sandbox
        if (isSandbox) {
          // Sandbox Mode: Record simulated dispatch with zero third-party calls
          const simulatedProviderId = `sandbox_msg_${crypto.randomUUID()}`;
          await client.query(
            `UPDATE notification_outbox
             SET status = 'delivered',
                 sent_at = NOW(),
                 provider_message_id = $1,
                 error_message = NULL,
                 locked_by = NULL,
                 locked_at = NULL,
                 updated_at = NOW()
             WHERE id = $2`,
            [simulatedProviderId, item.id]
          );
          processedCount++;
        } else {
          // Production Mode: Resend API Dispatch
          const apiKey = process.env.RESEND_API_KEY;
          const fromAddress = process.env.NOTIFICATION_FROM_EMAIL || 'attendance@updates.livotelhotel.com';

          const resendPayload = {
            from: `Livotel Attendance <${fromAddress}>`,
            to: [recipientEmail],
            subject: item.subject,
            html: item.body_html,
            text: item.body_text,
            headers: {
              'X-Entity-Ref-ID': item.idempotency_key,
            },
          };

          const res = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${apiKey}`,
              'Content-Type': 'application/json',
              'Idempotency-Key': item.idempotency_key,
            },
            body: JSON.stringify(resendPayload),
          });

          if (!res.ok) {
            const errBody = await res.text();
            throw new Error(`Resend API returned status ${res.status}: ${errBody}`);
          }

          const resJson: any = await res.json();
          const providerMessageId = resJson.id || null;

          // Transition to provider_accepted
          await client.query(
            `UPDATE notification_outbox
             SET status = 'provider_accepted',
                 sent_at = NOW(),
                 provider_message_id = $1,
                 error_message = NULL,
                 locked_by = NULL,
                 locked_at = NULL,
                 updated_at = NOW()
             WHERE id = $2`,
            [providerMessageId, item.id]
          );
          processedCount++;
        }
      } catch (sendErr: any) {
        console.error(`Error dispatching outbox item ${item.id}:`, sendErr);
        const nextAttempt = item.attempt_count + 1;
        const hasExhaustedRetries = nextAttempt >= item.max_attempts;

        // Exponential backoff with jitter: 2^attempt * 30 seconds
        const backoffSeconds = Math.min(3600, Math.pow(2, nextAttempt) * 30 + Math.floor(Math.random() * 10));

        if (hasExhaustedRetries) {
          await client.query(
            `UPDATE notification_outbox
             SET status = 'failed',
                 attempt_count = $1,
                 error_message = $2,
                 locked_by = NULL,
                 locked_at = NULL,
                 updated_at = NOW()
             WHERE id = $3`,
            [nextAttempt, sendErr.message || 'Maximum delivery attempts exhausted', item.id]
          );
        } else {
          await client.query(
            `UPDATE notification_outbox
             SET status = 'queued',
                 attempt_count = $1,
                 next_retry_at = NOW() + ($2 || ' seconds')::interval,
                 error_message = $3,
                 locked_by = NULL,
                 locked_at = NULL,
                 updated_at = NOW()
             WHERE id = $4`,
            [nextAttempt, backoffSeconds, sendErr.message || 'Temporary dispatch error', item.id]
          );
        }

        failedCount++;
      }
    }

    return {
      worker_id: workerId,
      claimed: items.length,
      processed: processedCount,
      failed: failedCount,
      cancelled: cancelledCount,
      provider: providerName,
      is_sandbox: isSandbox,
    };
  } finally {
    client.release();
  }
}

export default async (req: Request, context: Context) => {
  try {
    // Requires authenticated caller (owner, or internal scheduler with token)
    await requireAuth(req);
    const db = getDatabase();
    const result = await processOutboxJobs(db);
    return jsonResponse(result);
  } catch (err: any) {
    console.error('notifications-process error:', err);
    const status =
      err.status ||
      (err.message?.toLowerCase().includes('unauthorized') ||
      err.message?.toLowerCase().includes('token') ||
      err.message?.toLowerCase().includes('forbidden')
        ? 401
        : 500);
    return errorResponse(err.message || 'Outbox processing failed', status);
  }
};

export const config: Config = {
  path: '/api/notifications-process',
  method: ['POST'],
};
