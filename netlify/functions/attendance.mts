import type { Config, Context } from '@netlify/functions';
import { getDatabase } from '@netlify/database';
import { requireAuth, jsonResponse, errorResponse, todayIST } from './_shared/auth-utils.mts';

const VALID_STATUSES = new Set([
  'present',
  'absent',
  'half_day',
  'weekly_off',
  'paid_leave',
  'unpaid_leave',
]);

const STATUS_DISPLAY: Record<string, string> = {
  present: 'Present',
  absent: 'Absent',
  half_day: 'Half Day',
  weekly_off: 'Weekly Off',
  paid_leave: 'Paid Leave',
  unpaid_leave: 'Unpaid Leave',
};

function parseISTIsoString(dtStr: string): string | null {
  if (!dtStr) return null;
  if (dtStr.includes('Z') || dtStr.includes('+') || (dtStr.split('-').length > 3 && dtStr.lastIndexOf('-') > 10)) {
    const d = new Date(dtStr);
    return isNaN(d.getTime()) ? null : d.toISOString();
  }
  const d = new Date(`${dtStr.length === 16 ? dtStr + ':00' : dtStr}+05:30`);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

const ALERT_STATUSES = new Set(['absent', 'half_day', 'unpaid_leave']);

function getAlertDetails(
  status: string,
  staffName: string,
  date: string,
): { notificationType: string; subject: string; bodyHtml: string; bodyText: string } | null {
  if (status === 'absent') {
    return {
      notificationType: 'absence_alert',
      subject: `Attendance Notice: Marked Absent on ${date} — Livotel Premium Hotel`,
      bodyText: `Dear ${staffName},\n\nThis is an automated notification from Livotel Premium Hotel, Bhubaneswar.\n\nYou have been marked Absent for duty on ${date} (Asia/Kolkata).\n\nIf this was recorded in error or you have an approved leave arrangement, please contact your hotel manager immediately.\n\nWarm regards,\nManagement\nLivotel Premium Hotel, Bhubaneswar`,
      bodyHtml: `
        <div style="font-family: sans-serif; max-width: 600px; width: 100%; box-sizing: border-box; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 8px;">
          <h2 style="color: #1B2A4A; margin-top: 0;">Livotel Premium Hotel, Bhubaneswar</h2>
          <p style="font-size: 16px;">Dear <strong>${staffName}</strong>,</p>
          <p style="font-size: 15px; color: #333;">You have been marked <strong>Absent</strong> for duty on <strong>${date}</strong> (Asia/Kolkata).</p>
          <div style="background-color: #FFEBEE; border-left: 4px solid #C62828; padding: 12px; margin: 16px 0;">
            <p style="margin: 0; color: #C62828; font-size: 14px;"><strong>Notice:</strong> If this was recorded in error or you have an approved leave arrangement, please contact your hotel manager immediately.</p>
          </div>
          <p style="font-size: 13px; color: #666; margin-top: 24px;">Warm regards,<br>Management<br>Livotel Premium Hotel, Bhubaneswar</p>
        </div>
      `,
    };
  }

  if (status === 'half_day') {
    return {
      notificationType: 'half_day_alert',
      subject: `Attendance Notice: Marked Half Day on ${date} — Livotel Premium Hotel`,
      bodyText: `Dear ${staffName},\n\nThis is an automated notification from Livotel Premium Hotel, Bhubaneswar.\n\nYou have been marked for Half Day duty on ${date} (Asia/Kolkata).\n\nIf your recorded shift timing or hours require adjustment, please contact your hotel manager.\n\nWarm regards,\nManagement\nLivotel Premium Hotel, Bhubaneswar`,
      bodyHtml: `
        <div style="font-family: sans-serif; max-width: 600px; width: 100%; box-sizing: border-box; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 8px;">
          <h2 style="color: #1B2A4A; margin-top: 0;">Livotel Premium Hotel, Bhubaneswar</h2>
          <p style="font-size: 16px;">Dear <strong>${staffName}</strong>,</p>
          <p style="font-size: 15px; color: #333;">You have been marked for <strong>Half Day</strong> duty on <strong>${date}</strong> (Asia/Kolkata).</p>
          <div style="background-color: #FFF3E0; border-left: 4px solid #EF6C00; padding: 12px; margin: 16px 0;">
            <p style="margin: 0; color: #E65100; font-size: 14px;"><strong>Notice:</strong> If your recorded shift timing or hours require adjustment, please contact your hotel manager.</p>
          </div>
          <p style="font-size: 13px; color: #666; margin-top: 24px;">Warm regards,<br>Management<br>Livotel Premium Hotel, Bhubaneswar</p>
        </div>
      `,
    };
  }

  if (status === 'unpaid_leave') {
    return {
      notificationType: 'non_attendance_alert',
      subject: `Attendance Notice: Marked Unpaid Leave on ${date} — Livotel Premium Hotel`,
      bodyText: `Dear ${staffName},\n\nThis is an automated notification from Livotel Premium Hotel, Bhubaneswar.\n\nYou have been marked for Unpaid Leave on ${date} (Asia/Kolkata).\n\nIf this was recorded in error, please contact your hotel manager immediately.\n\nWarm regards,\nManagement\nLivotel Premium Hotel, Bhubaneswar`,
      bodyHtml: `
        <div style="font-family: sans-serif; max-width: 600px; width: 100%; box-sizing: border-box; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 8px;">
          <h2 style="color: #1B2A4A; margin-top: 0;">Livotel Premium Hotel, Bhubaneswar</h2>
          <p style="font-size: 16px;">Dear <strong>${staffName}</strong>,</p>
          <p style="font-size: 15px; color: #333;">You have been marked for <strong>Unpaid Leave</strong> on <strong>${date}</strong> (Asia/Kolkata).</p>
          <div style="background-color: #EFEBE9; border-left: 4px solid #4E342E; padding: 12px; margin: 16px 0;">
            <p style="margin: 0; color: #3E2723; font-size: 14px;"><strong>Notice:</strong> If this was recorded in error or you have questions, please contact your hotel manager immediately.</p>
          </div>
          <p style="font-size: 13px; color: #666; margin-top: 24px;">Warm regards,<br>Management<br>Livotel Premium Hotel, Bhubaneswar</p>
        </div>
      `,
    };
  }

  return null;
}

function getCorrectionDetails(
  oldStatus: string,
  newStatus: string,
  staffName: string,
  date: string,
): { notificationType: string; subject: string; bodyHtml: string; bodyText: string } {
  const oldLabel = STATUS_DISPLAY[oldStatus] || oldStatus;
  const newLabel = STATUS_DISPLAY[newStatus] || newStatus;
  const nType = oldStatus === 'half_day' ? 'half_day_correction' : 'absence_correction';

  return {
    notificationType: nType,
    subject: `Attendance Correction: Status Updated to ${newLabel} on ${date} — Livotel Premium Hotel`,
    bodyText: `Dear ${staffName},\n\nThis is an automated update from Livotel Premium Hotel, Bhubaneswar.\n\nYour attendance record for ${date} has been updated from ${oldLabel} to ${newLabel}.\n\nIf you have any questions, please contact your hotel manager.\n\nWarm regards,\nManagement\nLivotel Premium Hotel, Bhubaneswar`,
    bodyHtml: `
      <div style="font-family: sans-serif; max-width: 600px; width: 100%; box-sizing: border-box; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 8px;">
        <h2 style="color: #1B2A4A; margin-top: 0;">Livotel Premium Hotel, Bhubaneswar</h2>
        <p style="font-size: 16px;">Dear <strong>${staffName}</strong>,</p>
        <p style="font-size: 15px; color: #333;">Your attendance record for <strong>${date}</strong> has been updated from <strong>${oldLabel}</strong> to <strong>${newLabel}</strong>.</p>
        <div style="background-color: #E8F5E9; border-left: 4px solid #2E7D32; padding: 12px; margin: 16px 0;">
          <p style="margin: 0; color: #2E7D32; font-size: 14px;"><strong>Correction Applied:</strong> Your record has been successfully corrected.</p>
        </div>
        <p style="font-size: 13px; color: #666; margin-top: 24px;">Warm regards,<br>Management<br>Livotel Premium Hotel, Bhubaneswar</p>
      </div>
    `,
  };
}

export default async (req: Request, context: Context) => {
  try {
    const user = await requireAuth(req);
    const db = getDatabase();
    const url = new URL(req.url);

    if (req.method === 'GET') {
      const date = url.searchParams.get('date');
      if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return errorResponse('Valid date query parameter (YYYY-MM-DD) is required');
      }

      // 1. Get staff employed on that date
      const staffRes = await db.sql`
        SELECT id, employee_id, full_name, designation, department, phone, email,
               notify_absence, notify_monthly_report,
               TO_CHAR(joining_date, 'YYYY-MM-DD') as joining_date,
               TO_CHAR(leaving_date, 'YYYY-MM-DD') as leaving_date,
               is_active, default_shift
        FROM staff
        WHERE joining_date <= ${date}::date
          AND (leaving_date IS NULL OR leaving_date >= ${date}::date)
        ORDER BY department ASC, full_name ASC
      `;

      // 2. Get attendance records for that date with creator and updater user details
      const attendanceRes = await db.sql`
        SELECT a.id, a.staff_id,
               TO_CHAR(a.attendance_date, 'YYYY-MM-DD') as attendance_date,
               a.status, a.shift,
               a.check_in, a.check_out,
               a.notes, a.version,
               a.created_at, a.updated_at,
               a.created_by, a.updated_by,
               s.full_name as staff_name, s.employee_id, s.department,
               uc.name as created_by_name, uc.email as created_by_email, uc.role as created_by_role,
               uu.name as updated_by_name, uu.email as updated_by_email, uu.role as updated_by_role
        FROM attendance a
        JOIN staff s ON a.staff_id = s.id
        LEFT JOIN users uc ON a.created_by = uc.id
        LEFT JOIN users uu ON a.updated_by = uu.id
        WHERE a.attendance_date = ${date}::date
      `;

      // 3. Check if month is locked
      const [year, month] = date.split('-').map(Number);
      const lockRes = await db.sql`
        SELECT id, year, month, locked_at
        FROM month_locks
        WHERE year = ${year} AND month = ${month}
      `;

      return jsonResponse({
        date,
        is_locked: lockRes.length > 0,
        staff: staffRes,
        records: attendanceRes,
      });
    }

    if (req.method === 'POST') {
      const body = await req.json();
      const { date, entries } = body;

      if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return errorResponse('Valid date string (YYYY-MM-DD) is required');
      }

      if (!Array.isArray(entries) || entries.length === 0) {
        return errorResponse('Entries must be a non-empty array');
      }

      // Reject future dates in Asia/Kolkata
      const currentIST = todayIST();
      if (date > currentIST) {
        return errorResponse(`Cannot enter attendance for future date: ${date}. Today is ${currentIST}`);
      }

      const [year, month] = date.split('-').map(Number);

      const client = await db.pool.connect();
      try {
        await client.query('BEGIN');

        // Coordinate shared lock with month locking transactions
        await client.query('SELECT pg_advisory_xact_lock_shared(hashtext($1))', [`month_lock_${year}_${month}`]);

        // Check if month is locked
        const lockCheck = await client.query(
          'SELECT id FROM month_locks WHERE year = $1 AND month = $2',
          [year, month]
        );
        if (lockCheck.rows.length > 0) {
          await client.query('ROLLBACK');
          return errorResponse(
            `Month ${month}/${year} is locked. It must be unlocked by the owner before modifying records.`,
            403
          );
        }

        const conflicts: Array<{ staff_id: string; current_version: number; staff_name?: string }> = [];
        const savedStaffIds: string[] = [];
        let savedCount = 0;

        for (const entry of entries) {
          const { staff_id, status, shift, check_in, check_out, notes, version, reason } = entry;

          if (!staff_id || !status) {
            continue;
          }

          if (!VALID_STATUSES.has(status)) {
            await client.query('ROLLBACK');
            return errorResponse(`Invalid attendance status: ${status}`);
          }

          // Validate check-in / check-out timestamps in Asia/Kolkata (IST)
          let validCheckIn: string | null = null;
          let validCheckOut: string | null = null;
          if (check_in) {
            validCheckIn = parseISTIsoString(check_in);
            if (!validCheckIn) {
              await client.query('ROLLBACK');
              return errorResponse(`Invalid check_in time for staff ${staff_id}`);
            }
          }
          if (check_out) {
            validCheckOut = parseISTIsoString(check_out);
            if (!validCheckOut) {
              await client.query('ROLLBACK');
              return errorResponse(`Invalid check_out time for staff ${staff_id}`);
            }
          }

          if (validCheckIn && validCheckOut) {
            if (new Date(validCheckOut).getTime() <= new Date(validCheckIn).getTime()) {
              await client.query('ROLLBACK');
              return errorResponse('Check-out time must be after check-in time (even for overnight shifts)');
            }
          }

          // Check staff exists, employment range, and notification preferences
          const staffRow = await client.query(
            `SELECT id, full_name, employee_id, email, notify_absence,
                    TO_CHAR(joining_date, 'YYYY-MM-DD') as join_str,
                    TO_CHAR(leaving_date, 'YYYY-MM-DD') as leave_str
             FROM staff
             WHERE id = $1`,
            [staff_id]
          );

          if (staffRow.rows.length === 0) {
            await client.query('ROLLBACK');
            return errorResponse(`Staff record not found for id ${staff_id}`, 404);
          }

          const s = staffRow.rows[0];
          if (date < s.join_str) {
            await client.query('ROLLBACK');
            return errorResponse(
              `Cannot mark attendance before joining date for ${s.full_name} (Joined: ${s.join_str})`
            );
          }
          if (s.leave_str && date > s.leave_str) {
            await client.query('ROLLBACK');
            return errorResponse(
              `Cannot mark attendance after leaving date for ${s.full_name} (Left: ${s.leave_str})`
            );
          }

          // Check existing attendance with lock
          const existingRes = await client.query(
            `SELECT id, status, shift, check_in, check_out, notes, version
             FROM attendance
             WHERE staff_id = $1 AND attendance_date = $2::date
             FOR UPDATE`,
            [staff_id, date]
          );

          if (existingRes.rows.length > 0) {
            const existing = existingRes.rows[0];

            // Optimistic concurrency check
            if (version !== undefined && version !== existing.version) {
              conflicts.push({
                staff_id,
                current_version: existing.version,
                staff_name: s.full_name,
              });
              continue; // Do not overwrite conflicting record
            }

            const previousValues = {
              status: existing.status,
              shift: existing.shift,
              check_in: existing.check_in,
              check_out: existing.check_out,
              notes: existing.notes,
              version: existing.version,
            };

            const newValues = {
              status,
              shift: shift || null,
              check_in: validCheckIn,
              check_out: validCheckOut,
              notes: notes || null,
            };

            // Update record
            const updateRes = await client.query(
              `UPDATE attendance
               SET status = $1,
                   shift = $2,
                   check_in = $3,
                   check_out = $4,
                   notes = $5,
                   version = version + 1,
                   updated_at = NOW(),
                   updated_by = $6
               WHERE id = $7
               RETURNING version`,
              [
                status,
                shift || null,
                validCheckIn,
                validCheckOut,
                notes || null,
                user.userId,
                existing.id,
              ]
            );

            const newVersion = updateRes.rows[0]?.version || existing.version + 1;

            // Insert audit history
            await client.query(
              `INSERT INTO attendance_audit (
                 attendance_id, staff_id, attendance_date,
                 previous_values, new_values, change_reason,
                 changed_by, changed_at
               ) VALUES ($1, $2, $3::date, $4, $5, $6, $7, NOW())`,
              [
                existing.id,
                staff_id,
                date,
                JSON.stringify(previousValues),
                JSON.stringify(newValues),
                reason || null,
                user.userId,
              ]
            );

            // Queue notification / correction transactionally for non-attendance or half-day
            if (s.email && s.notify_absence) {
              if (ALERT_STATUSES.has(status) && status !== existing.status) {
                // Transition INTO an alert status (absent, half_day, unpaid_leave)
                const alert = getAlertDetails(status, s.full_name, date);
                if (alert) {
                  const idempotencyKey = `${alert.notificationType}:${staff_id}:${date}:${newVersion}`;
                  await client.query(
                    `INSERT INTO notification_outbox (
                       staff_id, recipient_email, notification_type,
                       idempotency_key, subject, body_html, body_text,
                       status, metadata
                     ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'queued', $8)
                     ON CONFLICT (idempotency_key) DO NOTHING`,
                    [
                      staff_id,
                      s.email,
                      alert.notificationType,
                      idempotencyKey,
                      alert.subject,
                      alert.bodyHtml,
                      alert.bodyText,
                      JSON.stringify({ date, status, staff_id, full_name: s.full_name }),
                    ]
                  );
                }
              } else if (ALERT_STATUSES.has(existing.status) && !ALERT_STATUSES.has(status)) {
                // Corrected from an alert status to a normal attendance status (e.g. Present)
                // 1. Check for strictly 'queued' alert (worker has NOT touched it yet)
                const strictlyQueuedAlerts = await client.query(
                  `SELECT id FROM notification_outbox
                   WHERE staff_id = $1
                     AND metadata->>'date' = $2
                     AND status = 'queued'`,
                  [staff_id, date]
                );

                if (strictlyQueuedAlerts.rows.length > 0) {
                  // Safe to cancel before dispatch: worker has not started transmitting to provider
                  await client.query(
                    `UPDATE notification_outbox
                     SET status = 'cancelled',
                         error_message = $1,
                         updated_at = NOW()
                     WHERE id = $2`,
                    [`Cancelled before dispatch: corrected to ${STATUS_DISPLAY[status] || status}`, strictlyQueuedAlerts.rows[0].id]
                  );
                } else {
                  // 2. Check if an alert was already in-flight ('processing') or sent ('provider_accepted', 'delivered')
                  const inFlightOrSent = await client.query(
                    `SELECT id, status FROM notification_outbox
                     WHERE staff_id = $1
                       AND metadata->>'date' = $2
                       AND status IN ('processing', 'provider_accepted', 'delivered')`,
                    [staff_id, date]
                  );

                  if (inFlightOrSent.rows.length > 0) {
                    const corr = getCorrectionDetails(existing.status, status, s.full_name, date);
                    const idempotencyKey = `correction:${staff_id}:${date}:${newVersion}`;
                    await client.query(
                      `INSERT INTO notification_outbox (
                         staff_id, recipient_email, notification_type,
                         idempotency_key, subject, body_html, body_text,
                         status, metadata
                       ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'queued', $8)
                       ON CONFLICT (idempotency_key) DO NOTHING`,
                      [
                        staff_id,
                        s.email,
                        corr.notificationType,
                        idempotencyKey,
                        corr.subject,
                        corr.bodyHtml,
                        corr.bodyText,
                        JSON.stringify({
                          date,
                          old_status: existing.status,
                          new_status: status,
                          staff_id,
                          full_name: s.full_name,
                          previous_alert_status: inFlightOrSent.rows[0].status,
                        }),
                      ]
                    );
                  }
                }
              }
            }

            savedStaffIds.push(staff_id);
            savedCount++;
          } else {
            // New record
            const newValues = {
              status,
              shift: shift || null,
              check_in: validCheckIn,
              check_out: validCheckOut,
              notes: notes || null,
            };

            const insertRes = await client.query(
              `INSERT INTO attendance (
                 staff_id, attendance_date, status, shift,
                 check_in, check_out, notes, version,
                 created_by, updated_by
               ) VALUES ($1, $2::date, $3, $4, $5, $6, $7, 1, $8, $8)
               RETURNING id`,
              [
                staff_id,
                date,
                status,
                shift || null,
                validCheckIn,
                validCheckOut,
                notes || null,
                user.userId,
              ]
            );

            const newAttId = insertRes.rows[0].id;

            // Audit entry for creation
            await client.query(
              `INSERT INTO attendance_audit (
                 attendance_id, staff_id, attendance_date,
                 previous_values, new_values, change_reason,
                 changed_by, changed_at
               ) VALUES ($1, $2, $3::date, NULL, $4, $5, $6, NOW())`,
              [
                newAttId,
                staff_id,
                date,
                JSON.stringify(newValues),
                reason || 'Initial entry',
                user.userId,
              ]
            );

            // Queue alert notification transactionally if new record is an alert status (absent, half_day, unpaid_leave)
            if (ALERT_STATUSES.has(status) && s.email && s.notify_absence) {
              const alert = getAlertDetails(status, s.full_name, date);
              if (alert) {
                const idempotencyKey = `${alert.notificationType}:${staff_id}:${date}:1`;
                await client.query(
                  `INSERT INTO notification_outbox (
                     staff_id, recipient_email, notification_type,
                     idempotency_key, subject, body_html, body_text,
                     status, metadata
                   ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'queued', $8)
                   ON CONFLICT (idempotency_key) DO NOTHING`,
                  [
                    staff_id,
                    s.email,
                    alert.notificationType,
                    idempotencyKey,
                    alert.subject,
                    alert.bodyHtml,
                    alert.bodyText,
                    JSON.stringify({ date, status, staff_id, full_name: s.full_name }),
                  ]
                );
              }
            }

            savedStaffIds.push(staff_id);
            savedCount++;
          }
        }

        await client.query('COMMIT');

        if (conflicts.length > 0) {
          return new Response(
            JSON.stringify({
              saved: savedCount,
              saved_staff_ids: savedStaffIds,
              conflicts,
              message: `${savedCount} record(s) saved, but ${conflicts.length} had conflicting updates by another user. Conflicting drafts were kept for your review.`,
            }),
            {
              status: savedCount === 0 ? 409 : 207,
              headers: { 'Content-Type': 'application/json' },
            }
          );
        }

        return jsonResponse({
          saved: savedCount,
          saved_staff_ids: savedStaffIds,
          conflicts: [],
        });
      } catch (txnError) {
        await client.query('ROLLBACK');
        throw txnError;
      } finally {
        client.release();
      }
    }

    return errorResponse('Method not allowed', 405);
  } catch (err: any) {
    console.error('attendance error:', err);
    if (err.message === 'Missing or invalid Authorization header' || err.message === 'Invalid or expired token') {
      return errorResponse(err.message, 401);
    }
    if (err.message === 'User account is deactivated') {
      return errorResponse(err.message, 403);
    }
    return errorResponse(err.message || 'Internal server error', 500);
  }
};

export const config: Config = {
  path: '/api/attendance',
  method: ['GET', 'POST'],
};
