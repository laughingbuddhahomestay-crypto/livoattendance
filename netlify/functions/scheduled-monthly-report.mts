import type { Config } from '@netlify/functions';
import { getDatabase } from '@netlify/database';
import { generateEmployeeMonthlyReportData } from './notifications-monthly.mts';
import { processOutboxJobs } from './notifications-process.mts';

export default async (req?: Request) => {
  console.log('[CRON] Scheduled Monthly Report trigger activated.');

  // Guard: Pauses only if explicitly disabled in environment variables
  if (process.env.ENABLE_MONTHLY_REPORT_CRON === 'false') {
    console.log('[CRON] Scheduled monthly emails are paused via ENABLE_MONTHLY_REPORT_CRON="false". No emails sent.');
    return new Response('Scheduler paused via configuration', { status: 200 });
  }

  try {
    const db = getDatabase();

    // 1. Calculate the target previous month in Asia/Kolkata
    // When running on the 1st of the month, the target is the month that just concluded yesterday.
    const now = new Date();
    const istDateStr = now.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
    const [currentYear, currentMonth, currentDay] = istDateStr.split('-').map(Number);

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
             AND is_active = true
             AND joining_date <= $1::date
             AND (leaving_date IS NULL OR leaving_date >= $2::date)`,
          [monthEnd, monthStart]
        );

        if (eligibleStaff.rows.length === 0) continue;

        // Performance Optimization: Check existing outbox records in 1 query instead of N round-trips
        const keysToCheck = eligibleStaff.rows.map((s: any) => `monthly_report:${s.id}:${reportYear}:${reportMonth}`);
        const existingRes = await client.query(
          'SELECT idempotency_key FROM notification_outbox WHERE idempotency_key = ANY($1)',
          [keysToCheck]
        );
        const existingKeys = new Set(existingRes.rows.map((r: any) => r.idempotency_key));

        const pendingStaff = eligibleStaff.rows.filter((s: any) => {
          const key = `monthly_report:${s.id}:${reportYear}:${reportMonth}`;
          return !existingKeys.has(key);
        });

        for (const s of pendingStaff) {
          const idempotencyKey = `monthly_report:${s.id}:${reportYear}:${reportMonth}`;

          // Generate full report data (including totals, provisional status, and attendance breakdown)
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
                automated_cron: true,
              }),
            ]
          );
          totalQueuedCount++;
        }
      }
    } finally {
      client.release();
    }

    console.log(`[CRON] Queued ${totalQueuedCount} monthly report(s). Running outbox dispatcher...`);

    // 2. Dispatch queued emails immediately through the outbox processor
    let dispatchResult = null;
    if (totalQueuedCount > 0) {
      dispatchResult = await processOutboxJobs(db);
      console.log('[CRON] Outbox dispatch completed:', dispatchResult);
    }

    return new Response(
      JSON.stringify({
        success: true,
        queued: totalQueuedCount,
        dispatch: dispatchResult,
        ist_date: istDateStr,
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  } catch (err: any) {
    console.error('[CRON] Error during scheduled monthly report run:', err);
    return new Response(
      JSON.stringify({ success: false, error: err.message || 'Scheduler execution failed' }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
};

/**
 * Netlify Scheduled Function Cron Configuration:
 * "30 3 1 * *" runs on the 1st of every month at:
 * - Minute 30
 * - Hour 3 (03:30 AM UTC = 09:00 AM Asia/Kolkata, IST = UTC + 5:30)
 * - Day 1 of the month
 */
export const config: Config = {
  schedule: '30 3 1 * *',
};
