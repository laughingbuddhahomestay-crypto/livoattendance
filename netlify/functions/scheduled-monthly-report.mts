import type { Config } from '@netlify/functions';
import { getDatabase } from '@netlify/database';
import { generateEmployeeMonthlyReportData } from './notifications-monthly.mts';

export default async () => {
  console.log('[CRON] Scheduled Monthly Report trigger activated.');

  // Guard: Kept paused until the owner explicitly approves and enables activation in Netlify environment variables
  if (process.env.ENABLE_MONTHLY_REPORT_CRON !== 'true') {
    console.log('[CRON] Production scheduled emails are currently PAUSED (ENABLE_MONTHLY_REPORT_CRON != "true"). No emails sent.');
    return new Response('Scheduler paused pending owner approval', { status: 200 });
  }

  try {
    const db = getDatabase();

    // 1. Calculate the target previous months for catch-up in Asia/Kolkata
    // Checks the previous completed month and the one before (recovery after downtime)
    const now = new Date();
    const istDateStr = now.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
    const [currentYear, currentMonth] = istDateStr.split('-').map(Number);

    // List target months to check for catch-up (most recent completed month first)
    const monthsToCheck: Array<{ year: number; month: number }> = [];

    let prevMonth = currentMonth - 1;
    let prevYear = currentYear;
    if (prevMonth === 0) {
      prevMonth = 12;
      prevYear -= 1;
    }
    monthsToCheck.push({ year: prevYear, month: prevMonth });

    // Also check 2 months ago for catch-up if not already processed
    let twoMonthsAgoMonth = prevMonth - 1;
    let twoMonthsAgoYear = prevYear;
    if (twoMonthsAgoMonth === 0) {
      twoMonthsAgoMonth = 12;
      twoMonthsAgoYear -= 1;
    }
    monthsToCheck.push({ year: twoMonthsAgoYear, month: twoMonthsAgoMonth });

    let totalQueuedCount = 0;
    const client = await db.pool.connect();
    try {
      for (const target of monthsToCheck) {
        const { year: reportYear, month: reportMonth } = target;
        const totalDays = new Date(reportYear, reportMonth, 0).getDate();
        const monthStart = `${reportYear}-${String(reportMonth).padStart(2, '0')}-01`;
        const monthEnd = `${reportYear}-${String(reportMonth).padStart(2, '0')}-${String(totalDays).padStart(2, '0')}`;

        // Fetch eligible staff employed in this target month who have opted into monthly reports
        const eligibleStaff = await client.query(
          `SELECT id, full_name, email
           FROM staff
           WHERE notify_monthly_report = true
             AND email IS NOT NULL
             AND joining_date <= $1::date
             AND (leaving_date IS NULL OR leaving_date >= $2::date)`,
          [monthEnd, monthStart]
        );

        for (const s of eligibleStaff.rows) {
          const idempotencyKey = `monthly_report:${s.id}:${reportYear}:${reportMonth}`;

          // Check if this employee already has an outbox entry for this month
          const existing = await client.query(
            'SELECT id FROM notification_outbox WHERE idempotency_key = $1',
            [idempotencyKey]
          );

          if (existing.rows.length === 0) {
            // Generate full report data (including totals, provisional status, and former employee handling)
            const reportData = await generateEmployeeMonthlyReportData(db, s.id, reportYear, reportMonth);

            await client.query(
              `INSERT INTO notification_outbox (
                 staff_id, recipient_email, notification_type,
                 idempotency_key, subject, body_html, body_text,
                 status, metadata
               ) VALUES (
                 $1, $2, 'monthly_report', $3,
                 $4, $5, $6, 'queued', $7
               )
               ON CONFLICT (idempotency_key) DO NOTHING`,
              [
                s.id,
                s.email,
                idempotencyKey,
                reportData.subject,
                reportData.body_html,
                reportData.body_text,
                JSON.stringify({
                  year: reportYear,
                  month: reportMonth,
                  is_provisional: reportData.is_provisional,
                  automated_catchup: true,
                }),
              ]
            );
            totalQueuedCount++;
          }
        }
      }
    } finally {
      client.release();
    }

    console.log(`[CRON] Catch-up processing completed. Queued ${totalQueuedCount} monthly report(s).`);
    return new Response(`Queued ${totalQueuedCount} monthly reports across catch-up period`, { status: 200 });
  } catch (err) {
    console.error('[CRON] Error during scheduled monthly report run:', err);
    return new Response('Scheduler execution failed', { status: 500 });
  }
};

/**
 * Netlify Scheduled Function Cron Configuration:
 * "30 3 * * *" runs DAILY at:
 * - Minute 30
 * - Hour 3 (03:30 AM UTC = 09:00 AM Asia/Kolkata, IST = UTC + 5:30)
 * 
 * Running daily ensures automatic catch-up after any missed run or server downtime.
 * If reports for the previous calendar month are already queued, the daily check is a fast 1-query no-op.
 * Deduplication is enforced by the database unique constraint on idempotency_key.
 */
export const config: Config = {
  schedule: '30 3 * * *',
};
