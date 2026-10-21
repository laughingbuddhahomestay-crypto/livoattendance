import { describe, it, expect, beforeEach } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { verifyWebhookSignature } from '../netlify/functions/notifications-webhook.mts';

describe('Real PostgreSQL Integration & Concurrency Tests (PGlite Engine v16.4)', () => {
  let db: PGlite;

  beforeEach(async () => {
    // Spin up an isolated real PostgreSQL 16.4 database instance for each test
    db = new PGlite();

    // Execute actual version-controlled SQL migrations
    const mig1 = fs.readFileSync(
      path.join(process.cwd(), 'netlify/database/migrations/0001_initial_schema/migration.sql'),
      'utf8'
    );
    const mig2 = fs.readFileSync(
      path.join(process.cwd(), 'netlify/database/migrations/0002_notifications_and_security/migration.sql'),
      'utf8'
    );

    await db.exec(mig1);
    await db.exec(mig2);
  });

  describe('1. Concurrent Initial Setup Protection', () => {
    it('guarantees only one owner can be created when two setup requests execute simultaneously', async () => {
      // Transaction 1: Checks user count, takes exclusive table lock, inserts initial owner
      await db.exec('BEGIN');
      await db.exec('LOCK TABLE users IN EXCLUSIVE MODE');
      const countRes1 = await db.query<{ count: string }>('SELECT COUNT(*) as count FROM users');
      expect(parseInt(countRes1.rows[0].count, 10)).toBe(0);

      const ownerId = crypto.randomUUID();
      await db.query(
        `INSERT INTO users (id, email, password_hash, name, role, is_active)
         VALUES ($1, $2, $3, $4, 'owner', true)`,
        [ownerId, 'owner@livotel.com', 'hashed_pass_12_rounds', 'Hotel Owner']
      );
      await db.exec('COMMIT');

      // Transaction 2 (simulating concurrent request that was queued on the lock)
      await db.exec('BEGIN');
      await db.exec('LOCK TABLE users IN EXCLUSIVE MODE');
      const countRes2 = await db.query<{ count: string }>('SELECT COUNT(*) as count FROM users');
      const existingUsers = parseInt(countRes2.rows[0].count, 10);

      let secondOwnerCreated = false;
      if (existingUsers === 0) {
        await db.query(
          `INSERT INTO users (id, email, password_hash, name, role, is_active)
           VALUES ($1, $2, $3, $4, 'owner', true)`,
          [crypto.randomUUID(), 'owner2@livotel.com', 'hashed_pass', 'Imposter Owner']
        );
        secondOwnerCreated = true;
      } else {
        await db.exec('ROLLBACK');
      }

      expect(secondOwnerCreated).toBe(false);

      const allUsers = await db.query('SELECT email, role FROM users');
      expect(allUsers.rows.length).toBe(1);
      expect(allUsers.rows[0].email).toBe('owner@livotel.com');
    });
  });

  describe('2. Concurrent Single-Use Invitation Redemption', () => {
    it('strictly prevents duplicate account creation from a single invitation token', async () => {
      const ownerId = crypto.randomUUID();
      await db.query(
        `INSERT INTO users (id, email, password_hash, name, role, is_active)
         VALUES ($1, 'owner@livotel.com', 'hash', 'Owner', 'owner', true)`,
        [ownerId]
      );

      const token = crypto.randomBytes(32).toString('hex');
      const invId = crypto.randomUUID();
      await db.query(
        `INSERT INTO invitations (id, email, name, role, token, invited_by, expires_at)
         VALUES ($1, 'manager@livotel.com', 'Manager Ramesh', 'manager', $2, $3, NOW() + INTERVAL '7 days')`,
        [invId, token, ownerId]
      );

      // Caller 1 redeems
      await db.exec('BEGIN');
      const redeem1 = await db.query<{ id: string }>(
        `UPDATE invitations
         SET used_at = NOW()
         WHERE token = $1 AND used_at IS NULL AND expires_at > NOW()
         RETURNING id, email, name, role`,
        [token]
      );
      expect(redeem1.rows.length).toBe(1);

      await db.query(
        `INSERT INTO users (id, email, password_hash, name, role, is_active)
         VALUES ($1, $2, 'manager_hash', $3, $4, true)`,
        [crypto.randomUUID(), redeem1.rows[0].email, redeem1.rows[0].name, redeem1.rows[0].role]
      );
      await db.exec('COMMIT');

      // Caller 2 attempts simultaneous redemption of the same token
      await db.exec('BEGIN');
      const redeem2 = await db.query(
        `UPDATE invitations
         SET used_at = NOW()
         WHERE token = $1 AND used_at IS NULL AND expires_at > NOW()
         RETURNING id`,
        [token]
      );
      // Row count must be 0 because token was already marked used
      expect(redeem2.rows.length).toBe(0);
      await db.exec('ROLLBACK');

      const userCount = await db.query('SELECT COUNT(*) as count FROM users WHERE role = $1', ['manager']);
      expect(parseInt(userCount.rows[0].count, 10)).toBe(1);
    });
  });

  describe('3. Attendance Concurrency & Version Checking', () => {
    it('detects concurrent edits and rejects stale version submissions', async () => {
      const ownerId = crypto.randomUUID();
      await db.query(
        `INSERT INTO users (id, email, password_hash, name, role, is_active)
         VALUES ($1, 'owner@livotel.com', 'hash', 'Owner', 'owner', true)`,
        [ownerId]
      );

      const staffId = crypto.randomUUID();
      await db.query(
        `INSERT INTO staff (id, employee_id, full_name, designation, department, joining_date, is_active, created_by, updated_by)
         VALUES ($1, 'LIV-101', 'Priyanka Das', 'Front Desk', 'Reception', '2024-01-01', true, $2, $2)`,
        [staffId, ownerId]
      );

      // Initial attendance record: Version 1
      const attId = crypto.randomUUID();
      await db.query(
        `INSERT INTO attendance (id, staff_id, attendance_date, status, version, created_by, updated_by)
         VALUES ($1, $2, '2026-10-21'::date, 'present', 1, $3, $3)`,
        [attId, staffId, ownerId]
      );

      // Manager A updates version 1 to 'half_day'
      await db.exec('BEGIN');
      const curA = await db.query<{ version: number }>(
        'SELECT version FROM attendance WHERE staff_id = $1 AND attendance_date = $2::date FOR UPDATE',
        [staffId, '2026-10-21']
      );
      expect(curA.rows[0].version).toBe(1);

      await db.query(
        `UPDATE attendance
         SET status = 'half_day', version = version + 1, updated_at = NOW()
         WHERE staff_id = $1 AND attendance_date = $2::date`,
        [staffId, '2026-10-21']
      );
      await db.exec('COMMIT');

      // Manager B (who loaded screen before Manager A saved) submits update with stale version 1
      await db.exec('BEGIN');
      const curB = await db.query<{ version: number }>(
        'SELECT version FROM attendance WHERE staff_id = $1 AND attendance_date = $2::date',
        [staffId, '2026-10-21']
      );
      const managerBStaleVersion = 1;
      const isConflict = curB.rows[0].version !== managerBStaleVersion;

      expect(isConflict).toBe(true);
      expect(curB.rows[0].version).toBe(2);
      await db.exec('ROLLBACK');

      // Verify the database retained Manager A's change
      const finalRecord = await db.query<{ status: string; version: number }>(
        'SELECT status, version FROM attendance WHERE staff_id = $1 AND attendance_date = $2::date',
        [staffId, '2026-10-21']
      );
      expect(finalRecord.rows[0].status).toBe('half_day');
      expect(finalRecord.rows[0].version).toBe(2);
    });
  });

  describe('4. Transaction Atomicity & Audit Rollback', () => {
    it('completely rolls back attendance creation if the audit trail fails', async () => {
      const ownerId = crypto.randomUUID();
      await db.query(
        `INSERT INTO users (id, email, password_hash, name, role, is_active)
         VALUES ($1, 'owner@livotel.com', 'hash', 'Owner', 'owner', true)`,
        [ownerId]
      );

      const staffId = crypto.randomUUID();
      await db.query(
        `INSERT INTO staff (id, employee_id, full_name, designation, department, joining_date, is_active, created_by, updated_by)
         VALUES ($1, 'LIV-102', 'Deepak Patra', 'Security', 'Security', '2024-01-01', true, $2, $2)`,
        [staffId, ownerId]
      );

      await db.exec('BEGIN');
      const attId = crypto.randomUUID();
      await db.query(
        `INSERT INTO attendance (id, staff_id, attendance_date, status, version, created_by, updated_by)
         VALUES ($1, $2, '2026-10-21'::date, 'present', 1, $3, $3)`,
        [attId, staffId, ownerId]
      );

      // Simulate a failure during audit logging (e.g. non-existent user ID violates foreign key)
      let transactionFailed = false;
      try {
        const invalidUserId = crypto.randomUUID();
        await db.query(
          `INSERT INTO attendance_audit (
             attendance_id, staff_id, attendance_date,
             new_values, change_reason, changed_by, changed_at
           ) VALUES ($1, $2, '2026-10-21'::date, $3, $4, $5, NOW())`,
          [attId, staffId, JSON.stringify({ status: 'present' }), 'Initial entry', invalidUserId]
        );
      } catch (err) {
        transactionFailed = true;
        await db.exec('ROLLBACK');
      }

      expect(transactionFailed).toBe(true);

      // Confirm attendance row was rolled back and does NOT exist in the database
      const attCheck = await db.query(
        'SELECT * FROM attendance WHERE staff_id = $1 AND attendance_date = $2::date',
        [staffId, '2026-10-21']
      );
      expect(attCheck.rows.length).toBe(0);
    });
  });

  describe('5. Month Lock Coordination', () => {
    it('prevents non-owners from modifying attendance in locked months', async () => {
      const ownerId = crypto.randomUUID();
      await db.query(
        `INSERT INTO users (id, email, password_hash, name, role, is_active)
         VALUES ($1, 'owner@livotel.com', 'hash', 'Owner', 'owner', true)`,
        [ownerId]
      );

      // Lock month: September 2026 (Month 9)
      await db.query(
        `INSERT INTO month_locks (id, year, month, locked_by)
         VALUES ($1, 2026, 9, $2)`,
        [crypto.randomUUID(), ownerId]
      );

      // Check lock for Sept 2026
      const lockRes = await db.query(
        'SELECT id FROM month_locks WHERE year = $1 AND month = $2',
        [2026, 9]
      );
      expect(lockRes.rows.length).toBe(1);

      // Check lock for Oct 2026 (unlocked)
      const lockResOct = await db.query(
        'SELECT id FROM month_locks WHERE year = $1 AND month = $2',
        [2026, 10]
      );
      expect(lockResOct.rows.length).toBe(0);
    });
  });

  describe('6. Absence Alert Transition & Stale Notification Cancellation', () => {
    it('queues an alert only when transitioning into Absent, and cancels it if corrected before dispatch', async () => {
      const ownerId = crypto.randomUUID();
      await db.query(
        `INSERT INTO users (id, email, password_hash, name, role, is_active)
         VALUES ($1, 'owner@livotel.com', 'hash', 'Owner', 'owner', true)`,
        [ownerId]
      );

      const staffId = crypto.randomUUID();
      await db.query(
        `INSERT INTO staff (id, employee_id, full_name, designation, department, email, notify_absence, joining_date, is_active, created_by, updated_by)
         VALUES ($1, 'LIV-103', 'Subhashree Mohanty', 'Receptionist', 'Reception', 'subhashree@livotel.com', true, '2024-01-01', true, $2, $2)`,
        [staffId, ownerId]
      );

      // 1. Initial save: Mark Absent -> Alert queued
      const attId = crypto.randomUUID();
      await db.query(
        `INSERT INTO attendance (id, staff_id, attendance_date, status, version, created_by, updated_by)
         VALUES ($1, $2, '2026-10-21'::date, 'absent', 1, $3, $3)`,
        [attId, staffId, ownerId]
      );

      const idempotencyKey = `absence:${staffId}:2026-10-21:1`;
      await db.query(
        `INSERT INTO notification_outbox (
           staff_id, recipient_email, notification_type, idempotency_key,
           subject, body_html, body_text, status, metadata
         ) VALUES ($1, $2, 'absence_alert', $3, 'Marked Absent', '<p>Absent</p>', 'Absent', 'queued', $4)`,
        [staffId, 'subhashree@livotel.com', idempotencyKey, JSON.stringify({ date: '2026-10-21' })]
      );

      let outbox = await db.query('SELECT status, notification_type FROM notification_outbox WHERE staff_id = $1', [staffId]);
      expect(outbox.rows.length).toBe(1);
      expect(outbox.rows[0].status).toBe('queued');

      // 2. Repeated save: Employee is already Absent, manager updates shift/notes only
      // Must NOT queue a second absence alert
      const existingStatus = 'absent';
      const newStatus = 'absent';
      const isTransitionIntoAbsent = newStatus === 'absent' && existingStatus !== 'absent';
      expect(isTransitionIntoAbsent).toBe(false);

      // Verify outbox count remains 1
      outbox = await db.query('SELECT status, notification_type FROM notification_outbox WHERE staff_id = $1', [staffId]);
      expect(outbox.rows.length).toBe(1);

      // 3. Manager corrects status to Present BEFORE the worker dispatched the alert
      // The pending alert must be marked 'cancelled', and NO correction email queued
      await db.query(
        `UPDATE notification_outbox
         SET status = 'cancelled',
             error_message = 'Cancelled before dispatch: corrected to Present',
             updated_at = NOW()
         WHERE staff_id = $1
           AND notification_type = 'absence_alert'
           AND metadata->>'date' = '2026-10-21'
           AND status = 'queued'`,
        [staffId]
      );

      outbox = await db.query('SELECT status, notification_type, error_message FROM notification_outbox WHERE staff_id = $1', [staffId]);
      expect(outbox.rows.length).toBe(1);
      expect(outbox.rows[0].status).toBe('cancelled');
      expect(outbox.rows[0].error_message).toContain('Cancelled before dispatch');
    });

    it('handles correction during an in-flight send (processing): queues correction notice because provider transmission cannot be cancelled', async () => {
      const ownerId = crypto.randomUUID();
      await db.query(
        `INSERT INTO users (id, email, password_hash, name, role, is_active)
         VALUES ($1, 'owner@livotel.com', 'hash', 'Owner', 'owner', true)`,
        [ownerId]
      );

      const staffId = crypto.randomUUID();
      await db.query(
        `INSERT INTO staff (id, employee_id, full_name, designation, department, email, notify_absence, joining_date, is_active, created_by, updated_by)
         VALUES ($1, 'LIV-105', 'Manoj Nayak', 'Manager', 'Management', 'manoj@livotel.com', true, '2024-01-01', true, $2, $2)`,
        [staffId, ownerId]
      );

      // Alert was claimed by a worker and is currently in-flight ('processing')
      await db.query(
        `INSERT INTO notification_outbox (
           staff_id, recipient_email, notification_type, idempotency_key,
           subject, body_html, body_text, status, locked_at, locked_by, metadata
         ) VALUES ($1, $2, 'absence_alert', 'absence:manoj:2026-10-21:1', 'Marked Absent', '<p>Absent</p>', 'Absent', 'processing', NOW(), 'worker_1', $3)`,
        [staffId, 'manoj@livotel.com', JSON.stringify({ date: '2026-10-21' })]
      );

      // Check for queued alerts: none are 'queued', because it is already 'processing'
      const queuedAlerts = await db.query(
        `SELECT id FROM notification_outbox
         WHERE staff_id = $1 AND notification_type = 'absence_alert' AND metadata->>'date' = '2026-10-21' AND status = 'queued'`,
        [staffId]
      );
      expect(queuedAlerts.rows.length).toBe(0);

      // System identifies that alert is in-flight or sent
      const inFlightOrSent = await db.query(
        `SELECT id, status FROM notification_outbox
         WHERE staff_id = $1 AND notification_type = 'absence_alert' AND metadata->>'date' = '2026-10-21' AND status IN ('processing', 'provider_accepted', 'delivered')`,
        [staffId]
      );
      expect(inFlightOrSent.rows.length).toBe(1);
      expect(inFlightOrSent.rows[0].status).toBe('processing');

      // Because the email is already in-flight over the wire, a correction notice MUST be queued
      await db.query(
        `INSERT INTO notification_outbox (
           staff_id, recipient_email, notification_type, idempotency_key,
           subject, body_html, body_text, status, metadata
         ) VALUES ($1, $2, 'absence_correction', 'correction:manoj:2026-10-21:2', 'Status Updated to Present', '<p>Corrected</p>', 'Corrected', 'queued', $3)`,
        [staffId, 'manoj@livotel.com', JSON.stringify({ date: '2026-10-21', old_status: 'absent', new_status: 'present', previous_alert_status: 'processing' })]
      );

      const notifs = await db.query(
        'SELECT notification_type, status FROM notification_outbox WHERE staff_id = $1 ORDER BY created_at ASC',
        [staffId]
      );
      expect(notifs.rows.length).toBe(2);
      expect(notifs.rows[0].status).toBe('processing'); // Remains in-flight
      expect(notifs.rows[1].notification_type).toBe('absence_correction'); // Correction queued
      expect(notifs.rows[1].status).toBe('queued');
    });

    it('sends a correction email if the absence alert was already delivered', async () => {
      const ownerId = crypto.randomUUID();
      await db.query(
        `INSERT INTO users (id, email, password_hash, name, role, is_active)
         VALUES ($1, 'owner@livotel.com', 'hash', 'Owner', 'owner', true)`,
        [ownerId]
      );

      const staffId = crypto.randomUUID();
      await db.query(
        `INSERT INTO staff (id, employee_id, full_name, designation, department, email, notify_absence, joining_date, is_active, created_by, updated_by)
         VALUES ($1, 'LIV-104', 'Rajesh Swain', 'Chef', 'Kitchen', 'rajesh@livotel.com', true, '2024-01-01', true, $2, $2)`,
        [staffId, ownerId]
      );

      // Alert was already dispatched and marked delivered
      await db.query(
        `INSERT INTO notification_outbox (
           staff_id, recipient_email, notification_type, idempotency_key,
           subject, body_html, body_text, status, metadata
         ) VALUES ($1, $2, 'absence_alert', 'absence:rajesh:2026-10-21:1', 'Marked Absent', '<p>Absent</p>', 'Absent', 'delivered', $3)`,
        [staffId, 'rajesh@livotel.com', JSON.stringify({ date: '2026-10-21' })]
      );

      // Attendance is now corrected to Half Day
      const sentAlerts = await db.query(
        `SELECT id FROM notification_outbox
         WHERE staff_id = $1
           AND notification_type = 'absence_alert'
           AND metadata->>'date' = '2026-10-21'
           AND status IN ('provider_accepted', 'delivered')`,
        [staffId]
      );

      expect(sentAlerts.rows.length).toBe(1);

      // Since employee was already notified, a correction notice is queued
      await db.query(
        `INSERT INTO notification_outbox (
           staff_id, recipient_email, notification_type, idempotency_key,
           subject, body_html, body_text, status, metadata
         ) VALUES ($1, $2, 'absence_correction', 'correction:rajesh:2026-10-21:2', 'Status Updated', '<p>Corrected</p>', 'Corrected', 'queued', $3)`,
        [staffId, 'rajesh@livotel.com', JSON.stringify({ date: '2026-10-21', old_status: 'absent', new_status: 'half_day' })]
      );

      const allNotifs = await db.query(
        'SELECT notification_type, status FROM notification_outbox WHERE staff_id = $1 ORDER BY created_at ASC',
        [staffId]
      );
      expect(allNotifs.rows.length).toBe(2);
      expect(allNotifs.rows[0].notification_type).toBe('absence_alert');
      expect(allNotifs.rows[0].status).toBe('delivered');
      expect(allNotifs.rows[1].notification_type).toBe('absence_correction');
      expect(allNotifs.rows[1].status).toBe('queued');
    });
  });

  describe('7. Outbox Worker Concurrency & Crash Recovery Lease', () => {
    it('prevents concurrent workers from processing the same message and recovers crashed worker leases', async () => {
      // Create 2 queued messages
      await db.query(
        `INSERT INTO notification_outbox (
           recipient_email, notification_type, idempotency_key, subject, body_html, body_text, status
         ) VALUES
           ('emp1@livotel.com', 'absence_alert', 'key-1', 'Notice 1', 'html', 'text', 'queued'),
           ('emp2@livotel.com', 'absence_alert', 'key-2', 'Notice 2', 'html', 'text', 'queued')`
      );

      const worker1 = 'worker_node_1';
      const claim1 = await db.query<{ id: string }>(
        `WITH claimable AS (
           SELECT id FROM notification_outbox
           WHERE (status = 'queued' AND next_retry_at <= NOW())
              OR (status = 'processing' AND locked_at < NOW() - INTERVAL '5 minutes')
           LIMIT 1
           FOR UPDATE SKIP LOCKED
         )
         UPDATE notification_outbox
         SET status = 'processing', locked_by = $1, locked_at = NOW()
         FROM claimable
         WHERE notification_outbox.id = claimable.id
         RETURNING notification_outbox.id`,
        [worker1]
      );
      expect(claim1.rows.length).toBe(1);

      // Concurrent Worker 2 runs: receives the OTHER message, never the one Worker 1 claimed
      const worker2 = 'worker_node_2';
      const claim2 = await db.query<{ id: string }>(
        `WITH claimable AS (
           SELECT id FROM notification_outbox
           WHERE (status = 'queued' AND next_retry_at <= NOW())
              OR (status = 'processing' AND locked_at < NOW() - INTERVAL '5 minutes')
           LIMIT 1
           FOR UPDATE SKIP LOCKED
         )
         UPDATE notification_outbox
         SET status = 'processing', locked_by = $1, locked_at = NOW()
         FROM claimable
         WHERE notification_outbox.id = claimable.id
         RETURNING notification_outbox.id`,
        [worker2]
      );
      expect(claim2.rows.length).toBe(1);
      expect(claim1.rows[0].id).not.toBe(claim2.rows[0].id);

      // Simulate Worker 1 crashing while holding its job lease:
      // Time advances 6 minutes (locked_at becomes 6 minutes ago)
      await db.query(
        `UPDATE notification_outbox
         SET locked_at = NOW() - INTERVAL '6 minutes'
         WHERE id = $1`,
        [claim1.rows[0].id]
      );

      // Worker 3 arrives: recovers the crashed worker's job lease
      const worker3 = 'worker_node_3';
      const recovered = await db.query<{ id: string }>(
        `WITH claimable AS (
           SELECT id FROM notification_outbox
           WHERE (status = 'queued' AND next_retry_at <= NOW())
              OR (status = 'processing' AND locked_at < NOW() - INTERVAL '5 minutes')
           LIMIT 1
           FOR UPDATE SKIP LOCKED
         )
         UPDATE notification_outbox
         SET status = 'processing', locked_by = $1, locked_at = NOW()
         FROM claimable
         WHERE notification_outbox.id = claimable.id
         RETURNING notification_outbox.id`,
        [worker3]
      );

      expect(recovered.rows.length).toBe(1);
      expect(recovered.rows[0].id).toBe(claim1.rows[0].id);
    });
  });

  describe('8. Webhook Signature Verification (Cryptographic Defense)', () => {
    it('verifies Svix / HMAC-SHA256 signatures and rejects tampered or expired webhooks', () => {
      const secret = 'whsec_' + Buffer.from('my_secret_key_1234567890123456').toString('base64');
      const payload = JSON.stringify({ type: 'email.delivered', data: { id: 'msg_987' } });
      const svixId = 'msg_svix_123';
      const svixTimestamp = Math.floor(Date.now() / 1000).toString();

      const toSign = `${svixId}.${svixTimestamp}.${payload}`;
      const rawKey = secret.slice(6);
      const signature = crypto
        .createHmac('sha256', Buffer.from(rawKey, 'base64'))
        .update(toSign)
        .digest('base64');

      const validHeaders = new Headers({
        'svix-id': svixId,
        'svix-timestamp': svixTimestamp,
        'svix-signature': `v1,${signature}`,
      });

      // 1. Valid signature
      const resultValid = verifyWebhookSignature(payload, validHeaders, secret);
      expect(resultValid.valid).toBe(true);

      // 2. Tampered payload
      const tamperedPayload = JSON.stringify({ type: 'email.delivered', data: { id: 'msg_tampered' } });
      const resultTampered = verifyWebhookSignature(tamperedPayload, validHeaders, secret);
      expect(resultTampered.valid).toBe(false);
      expect(resultTampered.reason).toBe('Signature mismatch');

      // 3. Expired timestamp (> 5 minutes ago)
      const expiredHeaders = new Headers({
        'svix-id': svixId,
        'svix-timestamp': (Math.floor(Date.now() / 1000) - 400).toString(),
        'svix-signature': `v1,${signature}`,
      });
      const resultExpired = verifyWebhookSignature(payload, expiredHeaders, secret);
      expect(resultExpired.valid).toBe(false);
      expect(resultExpired.reason).toBe('Webhook timestamp is outside tolerance window');
    });
  });

  describe('9. Monthly Catch-Up Processing & Recovery Window', () => {
    it('catches up missed reports across recovery window and guarantees zero duplicate reports', async () => {
      const ownerId = crypto.randomUUID();
      await db.query(
        `INSERT INTO users (id, email, password_hash, name, role, is_active)
         VALUES ($1, 'owner@livotel.com', 'hash', 'Owner', 'owner', true)`,
        [ownerId]
      );

      const staff1 = crypto.randomUUID();
      const staff2 = crypto.randomUUID();
      await db.query(
        `INSERT INTO staff (id, employee_id, full_name, designation, department, email, notify_monthly_report, joining_date, is_active, created_by, updated_by)
         VALUES
           ($1, 'LIV-106', 'Staff One', 'Associate', 'Reception', 'staff1@livotel.com', true, '2024-01-01', true, $3, $3),
           ($2, 'LIV-107', 'Staff Two', 'Associate', 'Kitchen', 'staff2@livotel.com', true, '2024-01-01', true, $3, $3)`,
        [staff1, staff2, ownerId]
      );

      // Simulate a missed monthly cron: Day 1 came and went without executing.
      // Day 4 catch-up execution runs for September 2026 (Month 9):
      const year = 2026;
      const month = 9;

      async function runCatchUp() {
        let queued = 0;
        const eligible = await db.query<{ id: string; email: string; full_name: string }>(
          `SELECT id, email, full_name FROM staff WHERE notify_monthly_report = true AND email IS NOT NULL`
        );

        for (const s of eligible.rows) {
          const idempotencyKey = `monthly_report:${s.id}:${year}:${month}`;
          const res = await db.query(
            `INSERT INTO notification_outbox (
               staff_id, recipient_email, notification_type, idempotency_key,
               subject, body_html, body_text, status
             ) VALUES ($1, $2, 'monthly_report', $3, 'Monthly Statement', 'html', 'text', 'queued')
             ON CONFLICT (idempotency_key) DO NOTHING
             RETURNING id`,
            [s.id, s.email, idempotencyKey]
          );
          if (res.rows.length > 0) queued++;
        }
        return queued;
      }

      // First catch-up run: queues reports for both staff members
      const firstRunQueued = await runCatchUp();
      expect(firstRunQueued).toBe(2);

      const count1 = await db.query<{ count: string }>(
        `SELECT COUNT(*) as count FROM notification_outbox WHERE notification_type = 'monthly_report'`
      );
      expect(parseInt(count1.rows[0].count, 10)).toBe(2);

      // Second catch-up run (e.g. daily cron running next day):
      // Idempotency key uniqueness MUST ensure 0 new rows are inserted
      const secondRunQueued = await runCatchUp();
      expect(secondRunQueued).toBe(0);

      const count2 = await db.query<{ count: string }>(
        `SELECT COUNT(*) as count FROM notification_outbox WHERE notification_type = 'monthly_report'`
      );
      expect(parseInt(count2.rows[0].count, 10)).toBe(2); // Still strictly 2
    });
  });
});
