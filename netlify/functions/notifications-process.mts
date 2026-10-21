import type { Config, Context } from '@netlify/functions';
import { getDatabase } from '@netlify/database';
import crypto from 'node:crypto';
import { requireAuth, jsonResponse, errorResponse } from './_shared/auth-utils.mts';

export default async (req: Request, context: Context) => {
  try {
    // Requires authenticated caller (owner, or internal scheduler with token)
    await requireAuth(req);
    const db = getDatabase();

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

      for (const item of items) {
        try {
          // 2. Recheck employee's current live email and notification preferences at dispatch time
          let recipientEmail = item.recipient_email;

          if (item.staff_id) {
            const staffCheck = await client.query(
              `SELECT id, full_name, email, notify_absence, notify_monthly_report, is_active
               FROM staff WHERE id = $1`,
              [item.staff_id]
            );

            if (staffCheck.rows.length === 0) {
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

            const staff = staffCheck.rows[0];

            // If staff has no email configured, cancel
            if (!staff.email) {
              await client.query(
                `UPDATE notification_outbox
                 SET status = 'cancelled',
                     error_message = 'Staff email address was removed prior to dispatch',
                     locked_by = NULL,
                     locked_at = NULL,
                     updated_at = NOW()
                 WHERE id = $1`,
                [item.id]
              );
              cancelledCount++;
              continue;
            }

            // Check preference opt-outs
            if (
              (item.notification_type === 'absence_alert' || item.notification_type === 'absence_correction') &&
              !staff.notify_absence
            ) {
              await client.query(
                `UPDATE notification_outbox
                 SET status = 'cancelled',
                     error_message = 'Employee opted out of absence notifications prior to dispatch',
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

            // If staff email changed, update recipient for this dispatch
            if (staff.email !== item.recipient_email) {
              recipientEmail = staff.email;
              await client.query(
                `UPDATE notification_outbox
                 SET recipient_email = $1,
                     updated_at = NOW()
                 WHERE id = $2`,
                [staff.email, item.id]
              );
            }
          }

          // 3. Dispatch to email provider
          let providerMsgId = `sandbox_${item.id}_${Date.now()}`;
          let targetStatus: 'provider_accepted' | 'delivered' = 'provider_accepted';

          if (isSandbox) {
            // Local sandbox test sink: records log, never makes external HTTP requests
            console.log(
              `[SANDBOX EMAIL SINK] Dispatched ${item.notification_type} to ${recipientEmail}: "${item.subject}" (Worker: ${workerId})`
            );
            targetStatus = 'delivered';
          } else if (providerName === 'resend') {
            const resendApiKey = process.env.RESEND_API_KEY;
            const fromEmail = process.env.EMAIL_FROM || 'attendance@updates.livotelhotel.com';

            const sendRes = await fetch('https://api.resend.com/emails', {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${resendApiKey}`,
                'Content-Type': 'application/json',
                'Idempotency-Key': item.idempotency_key, // Provider-level deduplication
              },
              body: JSON.stringify({
                from: `Livotel Attendance <${fromEmail}>`,
                to: [recipientEmail],
                subject: item.subject,
                html: item.body_html,
                text: item.body_text,
              }),
            });

            if (!sendRes.ok) {
              const errBody = await sendRes.text();
              throw new Error(`Resend API HTTP ${sendRes.status}: ${errBody}`);
            }

            const sendData = (await sendRes.json()) as any;
            providerMsgId = sendData.id || providerMsgId;
            targetStatus = 'provider_accepted';
          } else {
            throw new Error(`Unsupported email provider: ${providerName}`);
          }

          // 4. Update status to provider_accepted or delivered and clear lease lock
          await client.query(
            `UPDATE notification_outbox
             SET status = $1,
                 provider = $2,
                 provider_message_id = $3,
                 sent_at = NOW(),
                 locked_by = NULL,
                 locked_at = NULL,
                 error_message = NULL,
                 updated_at = NOW()
             WHERE id = $4`,
            [targetStatus, providerName, providerMsgId, item.id]
          );

          processedCount++;
        } catch (itemErr: any) {
          console.error(`Failed to dispatch notification ${item.id}:`, itemErr);
          const newAttemptCount = item.attempt_count + 1;
          const isFinalFailure = newAttemptCount >= item.max_attempts;

          // Exponential backoff: 5m, 15m, 45m, 2h...
          const backoffMinutes = Math.min(180, Math.pow(3, newAttemptCount) * 2);

          await client.query(
            `UPDATE notification_outbox
             SET attempt_count = $1,
                 status = $2,
                 next_retry_at = NOW() + ($3 || ' minutes')::interval,
                 locked_by = NULL,
                 locked_at = NULL,
                 error_message = $4,
                 updated_at = NOW()
             WHERE id = $5`,
            [
              newAttemptCount,
              isFinalFailure ? 'failed' : 'queued',
              `${backoffMinutes} minutes`,
              itemErr.message || 'Unknown delivery failure',
              item.id,
            ]
          );

          failedCount++;
        }
      }

      return jsonResponse({
        worker_id: workerId,
        claimed: items.length,
        processed: processedCount,
        failed: failedCount,
        cancelled: cancelledCount,
        provider: providerName,
        is_sandbox: isSandbox,
      });
    } finally {
      client.release();
    }
  } catch (err: any) {
    console.error('notifications-process error:', err);
    return errorResponse(err.message || 'Outbox processing failed', 500);
  }
};

export const config: Config = {
  path: '/api/notifications-process',
  method: ['POST'],
};
