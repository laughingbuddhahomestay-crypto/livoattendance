-- Migration 0010: Netlify Identity Integration and Admin Role
-- 1. Update role constraint on users to allow 'admin' alongside 'manager' and 'owner'
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('admin', 'manager', 'owner'));

-- 2. Allow password_hash to be optional (Netlify Identity manages passwords)
ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;

-- 3. Update invitations role constraint if table exists
ALTER TABLE invitations DROP CONSTRAINT IF EXISTS invitations_role_check;
ALTER TABLE invitations ADD CONSTRAINT invitations_role_check CHECK (role IN ('admin', 'manager', 'owner'));

-- 4. Migrate any existing 'owner' roles to 'admin'
UPDATE users SET role = 'admin' WHERE role = 'owner';
