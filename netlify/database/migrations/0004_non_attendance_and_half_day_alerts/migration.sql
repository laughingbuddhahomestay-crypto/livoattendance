-- Migration 0004: Support Non-Attendance and Half-Day Alerts
ALTER TABLE notification_outbox DROP CONSTRAINT IF EXISTS notification_outbox_notification_type_check;
ALTER TABLE notification_outbox ADD CONSTRAINT notification_outbox_notification_type_check 
  CHECK (notification_type IN (
    'absence_alert',
    'absence_correction',
    'half_day_alert',
    'half_day_correction',
    'non_attendance_alert',
    'non_attendance_correction',
    'monthly_report'
  ));
