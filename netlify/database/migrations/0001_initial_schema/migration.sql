-- Livotel Attendance Management — Initial Schema
-- This migration creates all tables needed for the attendance system.

-- 1. Users (authentication & authorization)
CREATE TABLE users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email         TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  name          TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('owner', 'manager')),
  is_active     BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Invitation tokens (invitation-only registration)
CREATE TABLE invitations (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email       TEXT NOT NULL,
  name        TEXT NOT NULL,
  role        TEXT NOT NULL CHECK (role IN ('owner', 'manager')),
  token       TEXT UNIQUE NOT NULL,
  invited_by  UUID NOT NULL REFERENCES users(id),
  expires_at  TIMESTAMPTZ NOT NULL,
  used_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. Staff members
CREATE TABLE staff (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id   TEXT UNIQUE NOT NULL,
  full_name     TEXT NOT NULL,
  designation   TEXT NOT NULL,
  department    TEXT NOT NULL,
  phone         TEXT,
  joining_date  DATE NOT NULL,
  leaving_date  DATE,
  is_active     BOOLEAN NOT NULL DEFAULT true,
  default_shift TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by    UUID REFERENCES users(id),
  updated_by    UUID REFERENCES users(id)
);

CREATE INDEX idx_staff_active ON staff(is_active);
CREATE INDEX idx_staff_department ON staff(department);

-- 4. Attendance records
CREATE TABLE attendance (
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

CREATE INDEX idx_attendance_date ON attendance(attendance_date);
CREATE INDEX idx_attendance_staff ON attendance(staff_id);

-- 5. Attendance audit history
CREATE TABLE attendance_audit (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  attendance_id    UUID NOT NULL REFERENCES attendance(id),
  staff_id         UUID NOT NULL REFERENCES staff(id),
  attendance_date  DATE NOT NULL,
  previous_values  JSONB,
  new_values       JSONB NOT NULL,
  change_reason    TEXT,
  changed_by       UUID NOT NULL REFERENCES users(id),
  changed_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_audit_attendance ON attendance_audit(attendance_id);
CREATE INDEX idx_audit_staff_date ON attendance_audit(staff_id, attendance_date);

-- 6. Month locks
CREATE TABLE month_locks (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  year      INTEGER NOT NULL,
  month     INTEGER NOT NULL,
  locked_by UUID NOT NULL REFERENCES users(id),
  locked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT uq_year_month UNIQUE (year, month)
);
