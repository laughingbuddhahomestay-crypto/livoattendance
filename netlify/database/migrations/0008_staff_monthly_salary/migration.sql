-- Migration: 0008_staff_monthly_salary
-- Adds optional monthly_salary column to staff, defaulting to 0, restricted to owner access

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'staff' AND column_name = 'monthly_salary'
  ) THEN
    ALTER TABLE staff
    ADD COLUMN monthly_salary NUMERIC(12, 2) DEFAULT 0 CHECK (monthly_salary >= 0);
  END IF;
END $$;
