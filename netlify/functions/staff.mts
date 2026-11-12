import type { Config, Context } from '@netlify/functions';
import { getDatabase } from '@netlify/database';
import { requireAuth, requireOwner, jsonResponse, errorResponse, todayIST } from './_shared/auth-utils.mts';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default async (req: Request, context: Context) => {
  try {
    const url = new URL(req.url);
    const db = getDatabase();

    if (req.method === 'GET') {
      await requireAuth(req);
      const id = url.searchParams.get('id');
      const includeInactive = url.searchParams.get('include_inactive') === 'true';

      if (id) {
        const result = await db.sql`
          SELECT id, employee_id, full_name, designation, department, phone, email,
                 notify_absence, notify_monthly_report,
                 TO_CHAR(joining_date, 'YYYY-MM-DD') as joining_date,
                 TO_CHAR(leaving_date, 'YYYY-MM-DD') as leaving_date,
                 is_active, default_shift, created_at, updated_at
          FROM staff
          WHERE id = ${id}
        `;
        if (result.length === 0) {
          return errorResponse('Staff member not found', 404);
        }
        return jsonResponse({ staff: result[0] });
      }

      let result;
      if (includeInactive) {
        result = await db.sql`
          SELECT id, employee_id, full_name, designation, department, phone, email,
                 notify_absence, notify_monthly_report,
                 TO_CHAR(joining_date, 'YYYY-MM-DD') as joining_date,
                 TO_CHAR(leaving_date, 'YYYY-MM-DD') as leaving_date,
                 is_active, default_shift, created_at, updated_at
          FROM staff
          ORDER BY full_name ASC
        `;
      } else {
        result = await db.sql`
          SELECT id, employee_id, full_name, designation, department, phone, email,
                 notify_absence, notify_monthly_report,
                 TO_CHAR(joining_date, 'YYYY-MM-DD') as joining_date,
                 TO_CHAR(leaving_date, 'YYYY-MM-DD') as leaving_date,
                 is_active, default_shift, created_at, updated_at
          FROM staff
          WHERE is_active = true
          ORDER BY full_name ASC
        `;
      }
      return jsonResponse({ staff: result });
    }

    // Mutating staff requires Owner role
    const user = await requireOwner(req);

    if (req.method === 'POST') {
      const body = await req.json();
      const employee_id = body.employee_id;
      const full_name = body.full_name || body.name;
      const {
        designation,
        department,
        phone,
        email,
        notify_absence,
        notify_monthly_report,
        joining_date,
        leaving_date,
        is_active = true,
        default_shift,
      } = body;

      if (!employee_id || !full_name || !designation || !department || !joining_date) {
        return errorResponse('employee_id, full_name, designation, department, and joining_date are required');
      }

      // Validate email format if provided
      let cleanEmail: string | null = null;
      if (email && typeof email === 'string' && email.trim().length > 0) {
        cleanEmail = email.trim().toLowerCase();
        if (!EMAIL_REGEX.test(cleanEmail)) {
          return errorResponse('Invalid email address format');
        }
      }

      // Check unique employee_id
      const existing = await db.sql`SELECT id FROM staff WHERE employee_id = ${employee_id.trim()}`;
      if (existing.length > 0) {
        return errorResponse('Employee ID already exists. Please choose a unique ID.', 409);
      }

      const client = await db.pool.connect();
      try {
        const insertRes = await client.query(
          `INSERT INTO staff (
             employee_id, full_name, designation, department, phone, email,
             notify_absence, notify_monthly_report,
             joining_date, leaving_date, is_active, default_shift,
             created_by, updated_by
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $13)
           RETURNING id, employee_id, full_name, designation, department, phone, email,
                     notify_absence, notify_monthly_report,
                     TO_CHAR(joining_date, 'YYYY-MM-DD') as joining_date,
                     TO_CHAR(leaving_date, 'YYYY-MM-DD') as leaving_date,
                     is_active, default_shift, created_at, updated_at`,
          [
            employee_id.trim(),
            full_name.trim(),
            designation.trim(),
            department.trim(),
            phone ? phone.trim() : null,
            cleanEmail,
            notify_absence !== undefined ? Boolean(notify_absence) : Boolean(cleanEmail),
            notify_monthly_report !== undefined ? Boolean(notify_monthly_report) : Boolean(cleanEmail),
            joining_date,
            leaving_date || null,
            Boolean(is_active),
            default_shift ? default_shift.trim() : null,
            user.userId,
          ]
        );
        return jsonResponse({ staff: insertRes.rows[0] }, 201);
      } finally {
        client.release();
      }
    }

    if (req.method === 'PUT') {
      const id = url.searchParams.get('id');
      if (!id) {
        return errorResponse('Staff ID is required in query params');
      }

      const body = await req.json();
      const full_name = body.full_name || body.name;
      const {
        designation,
        department,
        phone,
        email,
        notify_absence,
        notify_monthly_report,
        joining_date,
        leaving_date,
        is_active,
        default_shift,
      } = body;

      // Validate email format if provided
      let cleanEmail: string | null | undefined = undefined;
      if (email !== undefined) {
        if (email === null || email === '') {
          cleanEmail = null;
        } else if (typeof email === 'string') {
          const trimmed = email.trim().toLowerCase();
          if (!EMAIL_REGEX.test(trimmed)) {
            return errorResponse('Invalid email address format');
          }
          cleanEmail = trimmed;
        }
      }

      const client = await db.pool.connect();
      try {
        await client.query('BEGIN');
        const curRes = await client.query('SELECT * FROM staff WHERE id = $1 FOR UPDATE', [id]);
        if (curRes.rows.length === 0) {
          await client.query('ROLLBACK');
          return errorResponse('Staff member not found', 404);
        }
        const current = curRes.rows[0];

        let finalLeavingDate = leaving_date !== undefined ? leaving_date : current.leaving_date;
        const finalIsActive = is_active !== undefined ? Boolean(is_active) : current.is_active;

        // If being deactivated and no leaving date set, default to today IST
        if (!finalIsActive && !finalLeavingDate) {
          finalLeavingDate = todayIST();
        } else if (finalIsActive && leaving_date === null) {
          finalLeavingDate = null;
        }

        const finalEmail = cleanEmail !== undefined ? cleanEmail : current.email;
        const finalNotifyAbsence = notify_absence !== undefined ? Boolean(notify_absence) : current.notify_absence;
        const finalNotifyMonthly = notify_monthly_report !== undefined ? Boolean(notify_monthly_report) : current.notify_monthly_report;

        const updateRes = await client.query(
          `UPDATE staff
           SET full_name = COALESCE($1, full_name),
               designation = COALESCE($2, designation),
               department = COALESCE($3, department),
               phone = $4,
               email = $5,
               notify_absence = $6,
               notify_monthly_report = $7,
               joining_date = COALESCE($8, joining_date),
               leaving_date = $9,
               is_active = $10,
               default_shift = $11,
               updated_at = NOW(),
               updated_by = $12
           WHERE id = $13
           RETURNING id, employee_id, full_name, designation, department, phone, email,
                     notify_absence, notify_monthly_report,
                     TO_CHAR(joining_date, 'YYYY-MM-DD') as joining_date,
                     TO_CHAR(leaving_date, 'YYYY-MM-DD') as leaving_date,
                     is_active, default_shift, created_at, updated_at`,
          [
            full_name ? full_name.trim() : null,
            designation ? designation.trim() : null,
            department ? department.trim() : null,
            phone !== undefined ? (phone ? phone.trim() : null) : current.phone,
            finalEmail,
            finalNotifyAbsence,
            finalNotifyMonthly,
            joining_date || null,
            finalLeavingDate || null,
            finalIsActive,
            default_shift !== undefined ? (default_shift ? default_shift.trim() : null) : current.default_shift,
            user.userId,
            id,
          ]
        );

        // If email changed, redirect or cancel queued outbox notifications
        if (cleanEmail !== undefined && cleanEmail !== current.email) {
          if (cleanEmail) {
            // Update destination address for pending queued messages
            await client.query(
              `UPDATE notification_outbox
               SET recipient_email = $1, updated_at = NOW()
               WHERE staff_id = $2 AND status = 'queued'`,
              [cleanEmail, id]
            );
          } else {
            // Email was removed, cancel queued messages
            await client.query(
              `UPDATE notification_outbox
               SET status = 'failed',
                   error_message = 'Staff email address was removed before dispatch',
                   updated_at = NOW()
               WHERE staff_id = $1 AND status = 'queued'`,
              [id]
            );
          }
        }

        await client.query('COMMIT');
        return jsonResponse({ staff: updateRes.rows[0] });
      } catch (txErr) {
        await client.query('ROLLBACK');
        throw txErr;
      } finally {
        client.release();
      }
    }

    if (req.method === 'DELETE') {
      const id = url.searchParams.get('id');
      if (!id) {
        return errorResponse('Staff ID is required in query params');
      }

      const client = await db.pool.connect();
      try {
        await client.query('BEGIN');

        // Check if staff exists
        const checkRes = await client.query(
          'SELECT id, full_name, employee_id FROM staff WHERE id = $1 FOR UPDATE',
          [id]
        );
        if (checkRes.rows.length === 0) {
          await client.query('ROLLBACK');
          return errorResponse('Staff member not found', 404);
        }

        const staffName = checkRes.rows[0].full_name;
        const empId = checkRes.rows[0].employee_id;

        // Atomically delete related notifications, audit records, attendance, and staff
        await client.query('DELETE FROM notification_outbox WHERE staff_id = $1', [id]);
        await client.query('DELETE FROM attendance_audit WHERE staff_id = $1', [id]);
        await client.query('DELETE FROM attendance WHERE staff_id = $1', [id]);
        await client.query('DELETE FROM staff WHERE id = $1', [id]);

        await client.query('COMMIT');
        return jsonResponse({
          success: true,
          message: `Staff member ${staffName} (${empId}) deleted successfully`,
          id,
        });
      } catch (txErr) {
        await client.query('ROLLBACK');
        throw txErr;
      } finally {
        client.release();
      }
    }

    return errorResponse('Method not allowed', 405);
  } catch (err: any) {
    console.error('staff function error:', err);
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
  path: '/api/staff',
  method: ['GET', 'POST', 'PUT', 'DELETE'],
};
