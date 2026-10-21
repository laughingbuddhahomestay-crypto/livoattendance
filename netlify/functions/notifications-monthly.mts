import type { Config, Context } from '@netlify/functions';
import { getDatabase } from '@netlify/database';
import { requireOwner, jsonResponse, errorResponse } from './_shared/auth-utils.mts';

const STATUS_LABELS: Record<string, string> = {
  present: 'Present',
  absent: 'Absent',
  half_day: 'Half Day',
  weekly_off: 'Weekly Off',
  paid_leave: 'Paid Leave',
  unpaid_leave: 'Unpaid Leave',
  not_marked: 'Not Marked',
};

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export default async (req: Request, context: Context) => {
  try {
    const user = await requireOwner(req);
    const db = getDatabase();
    const url = new URL(req.url);

    if (req.method === 'GET') {
      const staffId = url.searchParams.get('staff_id');
      const yearStr = url.searchParams.get('year');
      const monthStr = url.searchParams.get('month');

      if (!staffId || !yearStr || !monthStr) {
        return errorResponse('staff_id, year, and month query parameters are required');
      }

      const year = parseInt(yearStr, 10);
      const month = parseInt(monthStr, 10);

      const previewData = await generateEmployeeMonthlyReportData(db, staffId, year, month);
      return jsonResponse(previewData);
    }

    if (req.method === 'POST') {
      const body = await req.json();
      const { staff_id, year, month, resend = false } = body;

      if (!staff_id || !year || !month) {
        return errorResponse('staff_id, year, and month are required');
      }

      const reportData = await generateEmployeeMonthlyReportData(db, staff_id, Number(year), Number(month));
      if (!reportData.staff.email) {
        return errorResponse(`Staff member ${reportData.staff.full_name} does not have an email address configured.`, 400);
      }

      const idempotencyKey = resend
        ? `monthly_report:${staff_id}:${year}:${month}:resend_${Date.now()}`
        : `monthly_report:${staff_id}:${year}:${month}`;

      // Check if already sent if not explicit resend
      if (!resend) {
        const existing = await db.sql`
          SELECT id, status, created_at, sent_at
          FROM notification_outbox
          WHERE idempotency_key = ${idempotencyKey}
        `;
        if (existing.length > 0) {
          return new Response(
            JSON.stringify({
              already_sent: true,
              message: `A monthly report for ${MONTH_NAMES[month - 1]} ${year} was already generated on ${new Date(existing[0].created_at).toLocaleDateString()}. Please confirm if you wish to resend.`,
              existing_id: existing[0].id,
            }),
            { status: 409, headers: { 'Content-Type': 'application/json' } }
          );
        }
      }

      const client = await db.pool.connect();
      try {
        const insertRes = await client.query(
          `INSERT INTO notification_outbox (
             staff_id, recipient_email, notification_type,
             idempotency_key, subject, body_html, body_text,
             status, metadata
           ) VALUES ($1, $2, 'monthly_report', $3, $4, $5, $6, 'queued', $7)
           ON CONFLICT (idempotency_key) DO UPDATE
             SET status = 'queued', next_retry_at = NOW(), attempt_count = 0, error_message = NULL, updated_at = NOW()
           RETURNING id, status`,
          [
            staff_id,
            reportData.staff.email,
            idempotencyKey,
            reportData.subject,
            reportData.body_html,
            reportData.body_text,
            JSON.stringify({
              year,
              month,
              staff_id,
              is_provisional: reportData.is_provisional,
              totals: reportData.totals,
            }),
          ]
        );

        return jsonResponse(
          {
            success: true,
            message: `Monthly report queued for ${reportData.staff.full_name} (${reportData.staff.email})`,
            outbox_id: insertRes.rows[0].id,
          },
          201
        );
      } finally {
        client.release();
      }
    }

    return errorResponse('Method not allowed', 405);
  } catch (err: any) {
    console.error('notifications-monthly error:', err);
    if (err.message === 'Missing or invalid Authorization header' || err.message === 'Invalid or expired token') {
      return errorResponse(err.message, 401);
    }
    if (err.message === 'Owner access required' || err.message === 'User account is deactivated') {
      return errorResponse(err.message, 403);
    }
    return errorResponse(err.message || 'Internal server error', 500);
  }
};

export async function generateEmployeeMonthlyReportData(db: any, staffId: string, year: number, month: number) {
  // 1. Get staff info
  const staffRows = await db.sql`
    SELECT id, employee_id, full_name, designation, department, email,
           TO_CHAR(joining_date, 'YYYY-MM-DD') as joining_date,
           TO_CHAR(leaving_date, 'YYYY-MM-DD') as leaving_date,
           is_active
    FROM staff
    WHERE id = ${staffId}
  `;

  if (staffRows.length === 0) {
    throw new Error('Staff member not found');
  }
  const s = staffRows[0];

  // 2. Check if month is locked
  const lockRows = await db.sql`
    SELECT id FROM month_locks WHERE year = ${year} AND month = ${month}
  `;
  const isLocked = lockRows.length > 0;
  const isProvisional = !isLocked;

  // 3. Get days in month
  const totalDays = new Date(year, month, 0).getDate();
  const monthStart = `${year}-${String(month).padStart(2, '0')}-01`;
  const monthEnd = `${year}-${String(month).padStart(2, '0')}-${String(totalDays).padStart(2, '0')}`;

  // 4. Get attendance records for this employee in this month
  const records = await db.sql`
    SELECT TO_CHAR(attendance_date, 'YYYY-MM-DD') as attendance_date,
           status, shift, check_in, check_out, notes
    FROM attendance
    WHERE staff_id = ${staffId}
      AND attendance_date >= ${monthStart}::date
      AND attendance_date <= ${monthEnd}::date
    ORDER BY attendance_date ASC
  `;

  const recordMap = new Map<string, any>();
  for (const r of records) {
    recordMap.set(r.attendance_date, r);
  }

  // 5. Build daily summary and counts
  const totals = {
    present: 0,
    absent: 0,
    half_day: 0,
    weekly_off: 0,
    paid_leave: 0,
    unpaid_leave: 0,
    not_marked: 0,
  };

  const dailyRows: Array<{ day: number; date: string; status: string; label: string }> = [];

  for (let day = 1; day <= totalDays; day++) {
    const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

    // If day is before joining date or after leaving date, employee wasn't employed
    if (dateStr < s.joining_date || (s.leaving_date && dateStr > s.leaving_date)) {
      continue;
    }

    const rec = recordMap.get(dateStr);
    if (rec) {
      const st = rec.status as keyof typeof totals;
      if (totals[st] !== undefined) totals[st]++;
      dailyRows.push({
        day,
        date: dateStr,
        status: rec.status,
        label: STATUS_LABELS[rec.status] || rec.status,
      });
    } else {
      totals.not_marked++;
      dailyRows.push({
        day,
        date: dateStr,
        status: 'not_marked',
        label: 'Not Marked',
      });
    }
  }

  const monthName = MONTH_NAMES[month - 1];
  const subject = `${isProvisional ? '[PROVISIONAL] ' : ''}Monthly Attendance Summary: ${monthName} ${year} — Livotel Premium Hotel`;

  const bodyText = `
Livotel Premium Hotel, Bhubaneswar
Monthly Attendance Summary: ${monthName} ${year}
${isProvisional ? 'NOTE: This report is PROVISIONAL because the monthly audit has not yet been locked.' : 'STATUS: Finalized'}

Employee Name: ${s.full_name}
Employee ID: ${s.employee_id}
Department: ${s.department} (${s.designation})

--- Attendance Summary ---
Present: ${totals.present}
Absent: ${totals.absent}
Half Day: ${totals.half_day}
Weekly Off: ${totals.weekly_off}
Paid Leave: ${totals.paid_leave}
Unpaid Leave: ${totals.unpaid_leave}
Not Marked: ${totals.not_marked}

--- Daily Breakdown ---
${dailyRows.map((r) => `${r.date} (Day ${r.day}): ${r.label}`).join('\n')}

For any discrepancies, please reach out to your hotel manager immediately.
Warm regards,
Management
Livotel Premium Hotel, Bhubaneswar
  `.trim();

  const bodyHtml = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif; max-width: 650px; margin: 0 auto; padding: 24px; border: 1px solid #DEE2E6; border-radius: 8px; background: #ffffff;">
      <div style="border-bottom: 2px solid #1B2A4A; padding-bottom: 12px; margin-bottom: 20px;">
        <h2 style="color: #1B2A4A; margin: 0; font-size: 20px;">Livotel Premium Hotel, Bhubaneswar</h2>
        <p style="color: #6C757D; margin: 4px 0 0; font-size: 14px;">Staff Attendance Report — ${monthName} ${year}</p>
      </div>

      ${
        isProvisional
          ? `<div style="background-color: #FFF3E0; border-left: 4px solid #EF6C00; padding: 10px 14px; margin-bottom: 20px; font-size: 13px; color: #B26A00;">
              <strong>PROVISIONAL REPORT:</strong> This report is provisional as the month has not yet been locked by administration.
            </div>`
          : ''
      }

      <div style="margin-bottom: 20px; background: #F8F9FA; padding: 12px 16px; border-radius: 6px;">
        <table style="width: 100%; font-size: 14px; color: #343A40;">
          <tr><td><strong>Employee:</strong> ${s.full_name}</td><td><strong>Employee ID:</strong> ${s.employee_id}</td></tr>
          <tr><td><strong>Department:</strong> ${s.department}</td><td><strong>Designation:</strong> ${s.designation}</td></tr>
        </table>
      </div>

      <h3 style="color: #1B2A4A; font-size: 16px; margin: 16px 0 8px;">Monthly Summary</h3>
      <table style="width: 100%; border-collapse: collapse; margin-bottom: 24px; font-size: 14px; text-align: center;">
        <thead>
          <tr style="background: #1B2A4A; color: #ffffff;">
            <th style="padding: 6px;">Present</th>
            <th style="padding: 6px;">Absent</th>
            <th style="padding: 6px;">Half Day</th>
            <th style="padding: 6px;">Weekly Off</th>
            <th style="padding: 6px;">Paid Leave</th>
            <th style="padding: 6px;">Unpaid Leave</th>
            <th style="padding: 6px;">Not Marked</th>
          </tr>
        </thead>
        <tbody>
          <tr style="background: #F1F3F5; font-weight: 600;">
            <td style="padding: 8px; border: 1px solid #DEE2E6; color: #2E7D32;">${totals.present}</td>
            <td style="padding: 8px; border: 1px solid #DEE2E6; color: #C62828;">${totals.absent}</td>
            <td style="padding: 8px; border: 1px solid #DEE2E6; color: #EF6C00;">${totals.half_day}</td>
            <td style="padding: 8px; border: 1px solid #DEE2E6; color: #1565C0;">${totals.weekly_off}</td>
            <td style="padding: 8px; border: 1px solid #DEE2E6; color: #6A1B9A;">${totals.paid_leave}</td>
            <td style="padding: 8px; border: 1px solid #DEE2E6; color: #4E342E;">${totals.unpaid_leave}</td>
            <td style="padding: 8px; border: 1px solid #DEE2E6; color: #6C757D;">${totals.not_marked}</td>
          </tr>
        </tbody>
      </table>

      <h3 style="color: #1B2A4A; font-size: 16px; margin: 16px 0 8px;">Daily Attendance Breakdown</h3>
      <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
        <thead>
          <tr style="background: #E9ECEF; text-align: left;">
            <th style="padding: 6px 10px; border: 1px solid #DEE2E6;">Date</th>
            <th style="padding: 6px 10px; border: 1px solid #DEE2E6;">Status</th>
          </tr>
        </thead>
        <tbody>
          ${dailyRows
            .map(
              (r) => `
            <tr>
              <td style="padding: 6px 10px; border: 1px solid #DEE2E6;">${r.date}</td>
              <td style="padding: 6px 10px; border: 1px solid #DEE2E6;">
                <span style="display: inline-block; padding: 2px 8px; border-radius: 4px; font-weight: 500; font-size: 12px; background: ${
                  r.status === 'present'
                    ? '#E8F5E9; color: #2E7D32;'
                    : r.status === 'absent'
                    ? '#FFEBEE; color: #C62828;'
                    : r.status === 'half_day'
                    ? '#FFF3E0; color: #EF6C00;'
                    : r.status === 'weekly_off'
                    ? '#E3F2FD; color: #1565C0;'
                    : '#F1F3F5; color: #495057;'
                }">
                  ${r.label}
                </span>
              </td>
            </tr>
          `
            )
            .join('')}
        </tbody>
      </table>

      <div style="margin-top: 24px; padding-top: 16px; border-top: 1px solid #DEE2E6; font-size: 12px; color: #6C757D;">
        <p style="margin: 0;">This is an automated attendance statement from Livotel Premium Hotel. Please contact your manager regarding any discrepancy.</p>
      </div>
    </div>
  `;

  return {
    staff: s,
    year,
    month,
    month_name: monthName,
    is_provisional: isProvisional,
    totals,
    daily_rows: dailyRows,
    subject,
    body_text: bodyText,
    body_html: bodyHtml,
  };
}

export const config: Config = {
  path: '/api/notifications-monthly',
  method: ['GET', 'POST'],
};
