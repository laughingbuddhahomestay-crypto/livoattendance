-- Migration 0002: Staff Notifications, Persistent Rate Limiting, and Server-Side Token Revocation

-- 1. Server-side token versioning for instant revocation
ALTER TABLE users ADD COLUMN IF NOT EXISTS token_version INTEGER NOT NULL DEFAULT 1;

-- 2. Revoked tokens table for single-token explicit logout
CREATE TABLE IF NOT EXISTS revoked_tokens (
  token_id    TEXT PRIMARY KEY,
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  revoked_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at  TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_revoked_tokens_expires ON revoked_tokens(expires_at);

-- 3. Persistent rate limits table across multiple serverless instances
CREATE TABLE IF NOT EXISTS login_rate_limits (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key             TEXT UNIQUE NOT NULL, -- e.g. "ip:1.2.3.4" or "email:test@livotel.com"
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  first_failed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  locked_until    TIMESTAMPTZ,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_rate_limits_key ON login_rate_limits(key);

-- 4. Staff notification fields
ALTER TABLE staff ADD COLUMN IF NOT EXISTS email TEXT;
ALTER TABLE staff ADD COLUMN IF NOT EXISTS notify_absence BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE staff ADD COLUMN IF NOT EXISTS notify_monthly_report BOOLEAN NOT NULL DEFAULT false;

-- 5. Transactional notification outbox
CREATE TABLE IF NOT EXISTS notification_outbox (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id            UUID REFERENCES staff(id) ON DELETE SET NULL,
  recipient_email     TEXT NOT NULL,
  notification_type   TEXT NOT NULL CHECK (notification_type IN ('absence_alert', 'absence_correction', 'monthly_report')),
  idempotency_key     TEXT UNIQUE NOT NULL,
  subject             TEXT NOT NULL,
  body_html           TEXT NOT NULL,
  body_text           TEXT NOT NULL,
  status              TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'processing', 'provider_accepted', 'delivered', 'failed', 'bounced', 'cancelled')),
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

CREATE INDEX IF NOT EXISTS idx_outbox_status_retry ON notification_outbox(status, next_retry_at);
CREATE INDEX IF NOT EXISTS idx_outbox_locked ON notification_outbox(status, locked_at);
CREATE INDEX IF NOT EXISTS idx_outbox_staff ON notification_outbox(staff_id);
CREATE INDEX IF NOT EXISTS idx_outbox_type ON notification_outbox(notification_type);
