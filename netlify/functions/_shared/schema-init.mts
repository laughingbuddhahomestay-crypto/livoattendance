import { hashPassword } from './auth-utils.mts';

let schemaInitialized = false;
let initPromise: Promise<void> | null = null;

/**
 * Automatically ensures all required tables, constraints, indexes,
 * and default accounts exist in PostgreSQL (local, staging, or production).
 * Completely idempotent and concurrency-safe via an in-flight promise mutex.
 */
export async function ensureDatabaseSchema(db: any): Promise<void> {
  if (schemaInitialized) return;

  if (initPromise) {
    return initPromise;
  }

  initPromise = (async () => {
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');

      // 1. Users table
      await client.query(`
        CREATE TABLE IF NOT EXISTS users (
          id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          email         TEXT UNIQUE NOT NULL,
          password_hash TEXT NOT NULL,
          name          TEXT NOT NULL,
          role          TEXT NOT NULL CHECK (role IN ('owner', 'manager')),
          is_active     BOOLEAN NOT NULL DEFAULT true,
          token_version INTEGER NOT NULL DEFAULT 1,
          created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
      `);

      // 2. Revoked tokens table for single-token explicit logout
      await client.query(`
        CREATE TABLE IF NOT EXISTS revoked_tokens (
          token_id    TEXT PRIMARY KEY,
          user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          revoked_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          expires_at  TIMESTAMPTZ NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_revoked_tokens_expires ON revoked_tokens(expires_at);
      `);

      // 3. Persistent rate limits table across multiple serverless instances
      await client.query(`
        CREATE TABLE IF NOT EXISTS login_rate_limits (
          id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          key             TEXT UNIQUE NOT NULL,
          failed_attempts INTEGER NOT NULL DEFAULT 0,
          first_failed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          locked_until    TIMESTAMPTZ,
          updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_rate_limits_key ON login_rate_limits(key);
      `);

      // 4. Password resets table
      await client.query(`
        CREATE TABLE IF NOT EXISTS password_resets (
          id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          token      TEXT UNIQUE NOT NULL,
          expires_at TIMESTAMPTZ NOT NULL,
          used_at    TIMESTAMPTZ,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_password_resets_token ON password_resets(token);
        CREATE INDEX IF NOT EXISTS idx_password_resets_user ON password_resets(user_id);
      `);

      // 4. Invitations table
      await client.query(`
        CREATE TABLE IF NOT EXISTS invitations (
          id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          email       TEXT NOT NULL,
          name        TEXT NOT NULL,
          role        TEXT NOT NULL CHECK (role IN ('owner', 'manager')),
          token       TEXT UNIQUE NOT NULL,
          invited_by  UUID REFERENCES users(id),
          expires_at  TIMESTAMPTZ NOT NULL,
          used_at     TIMESTAMPTZ,
          created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
      `);

      // 5. Staff table
      await client.query(`
        CREATE TABLE IF NOT EXISTS staff (
          id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          employee_id           TEXT UNIQUE NOT NULL,
          full_name             TEXT NOT NULL,
          designation           TEXT NOT NULL,
          department            TEXT NOT NULL,
          phone                 TEXT,
          email                 TEXT,
          notify_absence        BOOLEAN NOT NULL DEFAULT true,
          notify_monthly_report BOOLEAN NOT NULL DEFAULT true,
          joining_date          DATE NOT NULL,
          leaving_date          DATE,
          is_active             BOOLEAN NOT NULL DEFAULT true,
          default_shift         TEXT,
          monthly_salary        NUMERIC(12, 2) DEFAULT 0 CHECK (monthly_salary >= 0),
          created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          created_by            UUID REFERENCES users(id),
          updated_by            UUID REFERENCES users(id),
          CONSTRAINT check_staff_leaving_after_joining CHECK (leaving_date IS NULL OR leaving_date >= joining_date)
        );
      `);

      // 6. Attendance table
      await client.query(`
        CREATE TABLE IF NOT EXISTS attendance (
          id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          staff_id         UUID NOT NULL REFERENCES staff(id),
          attendance_date  DATE NOT NULL,
          status           TEXT NOT NULL CHECK (status IN (
                             'present', 'absent', 'half_day',
                             'weekly_off', 'paid_leave', 'unpaid_leave'
                           )),
          shift            TEXT,
          check_in         TIMESTAMPTZ,
          check_out        TIMESTAMPTZ,
          notes            TEXT,
          version          INTEGER NOT NULL DEFAULT 1,
          created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          created_by       UUID REFERENCES users(id),
          updated_by       UUID REFERENCES users(id),
          CONSTRAINT uq_staff_date UNIQUE (staff_id, attendance_date)
        );
      `);

      // 7. Attendance audit table
      await client.query(`
        CREATE TABLE IF NOT EXISTS attendance_audit (
          id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          attendance_id    UUID REFERENCES attendance(id),
          staff_id         UUID NOT NULL REFERENCES staff(id),
          attendance_date  DATE NOT NULL,
          previous_values  JSONB,
          new_values       JSONB NOT NULL,
          change_reason    TEXT,
          changed_by       UUID REFERENCES users(id),
          changed_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
      `);

      // 8. Month locks table
      await client.query(`
        CREATE TABLE IF NOT EXISTS month_locks (
          id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          year       INTEGER NOT NULL,
          month      INTEGER NOT NULL,
          locked_by  UUID NOT NULL REFERENCES users(id),
          locked_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          CONSTRAINT uq_year_month UNIQUE (year, month)
        );
      `);

      // 9. Notification outbox table
      await client.query(`
        CREATE TABLE IF NOT EXISTS notification_outbox (
          id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          staff_id            UUID REFERENCES staff(id) ON DELETE CASCADE,
          recipient_email     TEXT NOT NULL,
          notification_type   TEXT NOT NULL CHECK (notification_type IN (
                                'absence_alert', 'absence_correction',
                                'half_day_alert', 'half_day_correction',
                                'non_attendance_alert', 'non_attendance_correction',
                                'monthly_report'
                              )),
          idempotency_key     TEXT UNIQUE NOT NULL,
          subject             TEXT NOT NULL,
          body_html           TEXT NOT NULL,
          body_text           TEXT NOT NULL,
          status              TEXT NOT NULL DEFAULT 'queued' CHECK (status IN (
                                'queued', 'processing', 'provider_accepted',
                                'delivered', 'failed', 'bounced', 'cancelled'
                              )),
          attempt_count       INTEGER NOT NULL DEFAULT 0,
          max_attempts        INTEGER NOT NULL DEFAULT 5,
          next_retry_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          locked_at           TIMESTAMPTZ,
          locked_by           TEXT,
          provider            TEXT,
          provider_message_id TEXT,
          error_message       TEXT,
          metadata            JSONB,
          created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          sent_at             TIMESTAMPTZ,
          updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
      `);

      // 10. Key Performance & Composite Indexes
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_staff_active ON staff(is_active);
        CREATE INDEX IF NOT EXISTS idx_staff_department ON staff(department);
        CREATE INDEX IF NOT EXISTS idx_staff_monthly_active ON staff(notify_monthly_report, is_active)
          WHERE notify_monthly_report = true AND is_active = true;
        CREATE INDEX IF NOT EXISTS idx_attendance_staff_date_desc ON attendance(staff_id, attendance_date DESC);
        CREATE INDEX IF NOT EXISTS idx_attendance_date ON attendance(attendance_date);
        CREATE INDEX IF NOT EXISTS idx_audit_changed_at_desc ON attendance_audit(changed_at DESC);
        CREATE INDEX IF NOT EXISTS idx_outbox_status_retry ON notification_outbox(status, next_retry_at);
        CREATE INDEX IF NOT EXISTS idx_outbox_locked ON notification_outbox(status, locked_at);
        CREATE INDEX IF NOT EXISTS idx_outbox_staff ON notification_outbox(staff_id);
        CREATE INDEX IF NOT EXISTS idx_outbox_type ON notification_outbox(notification_type);
        CREATE INDEX IF NOT EXISTS idx_outbox_created_at_desc ON notification_outbox(created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_outbox_staff_status ON notification_outbox(staff_id, status);
      `);

      // 11. Default Owner and Manager provisioning
      const ownerHash = '$2a$12$J8FHC9/fxGf1.8BWllTEI.iISXOjUoK5SZ4qPHgHJgaKGgs.oUVTe'; // Livotel@2027
      const managerHash = '$2a$12$.9osSw4R0oe2.TwAvujqIO3YzLlKErmfVYSrvNfFoEJs37u8CPOJ.'; // Livo@2026

      await client.query(`
        INSERT INTO users (id, email, password_hash, name, role, is_active, token_version)
        VALUES (
          '00000000-0000-4000-8000-000000000001',
          'pkray2012@gmail.com',
          $1,
          'Pradipta Kumar Ray (Owner)',
          'owner',
          true,
          1
        )
        ON CONFLICT (email) DO UPDATE SET
          role = 'owner',
          is_active = true,
          updated_at = NOW();
      `, [ownerHash]);

      await client.query(`
        INSERT INTO users (id, email, password_hash, name, role, is_active, token_version)
        VALUES (
          '00000000-0000-4000-8000-000000000002',
          'livotelpremiumhotel@gmail.com',
          $1,
          'Hotel Manager',
          'manager',
          true,
          1
        )
        ON CONFLICT (email) DO UPDATE SET
          role = 'manager',
          is_active = true,
          updated_at = NOW();
      `, [managerHash]);

      await client.query('COMMIT');
      schemaInitialized = true;
      console.log('[SCHEMA] Verified database schema and provisioned default accounts successfully.');
    } catch (err) {
      await client.query('ROLLBACK');
      console.error('[SCHEMA] Error initializing database schema:', err);
      throw err;
    } finally {
      client.release();
      initPromise = null;
    }
  })();

  return initPromise;
}
