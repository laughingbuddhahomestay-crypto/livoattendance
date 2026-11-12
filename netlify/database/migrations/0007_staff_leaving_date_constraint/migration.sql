-- Migration: 0007_staff_leaving_date_constraint
-- Ensures leaving_date cannot precede joining_date

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'check_staff_leaving_after_joining'
  ) THEN
    ALTER TABLE staff
    ADD CONSTRAINT check_staff_leaving_after_joining
    CHECK (leaving_date IS NULL OR leaving_date >= joining_date);
  END IF;
END $$;
