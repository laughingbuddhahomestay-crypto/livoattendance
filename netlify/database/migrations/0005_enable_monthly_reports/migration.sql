-- Migration 0005: Enable Automated Monthly Reports and Set Default to True
ALTER TABLE staff ALTER COLUMN notify_monthly_report SET DEFAULT true;
ALTER TABLE staff ALTER COLUMN notify_absence SET DEFAULT true;

-- Update existing active staff with email to enable monthly reports
UPDATE staff
SET notify_monthly_report = true,
    notify_absence = true,
    updated_at = NOW()
WHERE email IS NOT NULL AND is_active = true;
