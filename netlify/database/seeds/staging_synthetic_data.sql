-- Staging Synthetic Staff Dataset (10 Isolated Test Profiles)
-- For Livotel Staging Environment Verification Only
-- No real employee information or private contact details

-- Clean staging data if re-running
DELETE FROM attendance_audit;
DELETE FROM attendance;
DELETE FROM notification_outbox;
DELETE FROM staff;

-- 1. Front Desk / Reception
INSERT INTO staff (id, employee_id, full_name, designation, department, phone, email, notify_absence, notify_monthly_report, joining_date, leaving_date, is_active, default_shift)
VALUES
  ('11111111-0001-4000-8000-000000000001', 'LIV-001', 'Subhashree Mohanty', 'Front Office Executive', 'Reception', '9876500001', 'subhashree.staging@staging-hotel.example.com', true, true, '2024-01-15', NULL, true, 'Morning (07:00 - 15:30)'),
  ('11111111-0002-4000-8000-000000000002', 'LIV-002', 'Ramesh Chandra Patra', 'Front Desk Associate', 'Reception', '9876500002', 'ramesh.staging@staging-hotel.example.com', true, true, '2024-03-01', NULL, true, 'Evening (15:00 - 23:30)');

-- 2. Housekeeping
INSERT INTO staff (id, employee_id, full_name, designation, department, phone, email, notify_absence, notify_monthly_report, joining_date, leaving_date, is_active, default_shift)
VALUES
  ('11111111-0003-4000-8000-000000000003', 'LIV-003', 'Priyanka Das', 'Housekeeping Supervisor', 'Housekeeping', '9876500003', 'priyanka.staging@staging-hotel.example.com', true, true, '2023-08-10', NULL, true, 'Day (08:00 - 16:30)'),
  ('11111111-0004-4000-8000-000000000004', 'LIV-004', 'Sunita Rani Naik', 'Room Attendant', 'Housekeeping', '9876500004', NULL, false, false, '2024-02-15', NULL, true, 'Day (08:00 - 16:30)');

-- 3. Kitchen & Food Service
INSERT INTO staff (id, employee_id, full_name, designation, department, phone, email, notify_absence, notify_monthly_report, joining_date, leaving_date, is_active, default_shift)
VALUES
  ('11111111-0005-4000-8000-000000000005', 'LIV-005', 'Rajesh Kumar Swain', 'Executive Chef', 'Kitchen', '9876500005', 'chef.rajesh.staging@staging-hotel.example.com', true, true, '2023-05-01', NULL, true, 'General (10:00 - 19:00)'),
  ('11111111-0006-4000-8000-000000000006', 'LIV-006', 'Bikram Nayak', 'Line Cook', 'Kitchen', '9876500006', 'bikram.cook.staging@staging-hotel.example.com', true, false, '2024-04-01', NULL, true, 'Morning (06:00 - 14:30)');

-- 4. Maintenance & Engineering
INSERT INTO staff (id, employee_id, full_name, designation, department, phone, email, notify_absence, notify_monthly_report, joining_date, leaving_date, is_active, default_shift)
VALUES
  ('11111111-0007-4000-8000-000000000007', 'LIV-007', 'Manoj Kumar Behera', 'Maintenance Technician', 'Maintenance', '9876500007', NULL, false, false, '2023-11-15', NULL, true, 'Day (09:00 - 18:00)');

-- 5. Security & Night Operations
INSERT INTO staff (id, employee_id, full_name, designation, department, phone, email, notify_absence, notify_monthly_report, joining_date, leaving_date, is_active, default_shift)
VALUES
  ('11111111-0008-4000-8000-000000000008', 'LIV-008', 'Deepak Patra', 'Security Incharge', 'Security', '9876500008', 'deepak.sec.staging@staging-hotel.example.com', true, true, '2023-07-01', NULL, true, 'Day (08:00 - 20:00)'),
  ('11111111-0009-4000-8000-000000000009', 'LIV-009', 'Kalu Charan Sahoo', 'Night Security Guard', 'Security', '9876500009', NULL, false, false, '2023-09-01', NULL, true, 'Night (20:00 - 08:00)');

-- 6. Management / Duty Operations
INSERT INTO staff (id, employee_id, full_name, designation, department, phone, email, notify_absence, notify_monthly_report, joining_date, leaving_date, is_active, default_shift)
VALUES
  ('11111111-0010-4000-8000-000000000010', 'LIV-010', 'Suresh Kumar Rout', 'Duty Manager', 'Management', '9876500010', 'suresh.duty.staging@staging-hotel.example.com', true, true, '2023-01-01', NULL, true, 'Rotating');
