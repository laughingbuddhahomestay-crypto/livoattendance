-- Migration 0006: Performance and Compute Hours Optimization (Netlify DB / Neon)

-- 1. Accelerate outbox log viewing in Settings tab (replaces full table sort with index scan)
CREATE INDEX IF NOT EXISTS idx_outbox_created_at_desc ON notification_outbox(created_at DESC);

-- 2. Accelerate audit log pagination (replaces full table sort with index scan)
CREATE INDEX IF NOT EXISTS idx_audit_changed_at_desc ON attendance_audit(changed_at DESC);

-- 3. Accelerate staff attendance history lookups
CREATE INDEX IF NOT EXISTS idx_attendance_staff_date_desc ON attendance(staff_id, attendance_date DESC);

-- 4. Highly efficient partial index for monthly report eligibility queries
CREATE INDEX IF NOT EXISTS idx_staff_monthly_active ON staff(notify_monthly_report, is_active)
  WHERE notify_monthly_report = true AND is_active = true;

-- 5. Accelerate date-based outbox lookups for attendance corrections
CREATE INDEX IF NOT EXISTS idx_outbox_staff_status ON notification_outbox(staff_id, status);
