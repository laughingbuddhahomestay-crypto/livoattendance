-- Migration 0003: Configure Main Owner and Manager Accounts

-- 1. Main Owner Account: pkray2012@gmail.com / Livotel@2027
INSERT INTO users (id, email, password_hash, name, role, is_active, token_version)
VALUES (
  '00000000-0000-4000-8000-000000000001',
  'pkray2012@gmail.com',
  '$2a$12$J8FHC9/fxGf1.8BWllTEI.iISXOjUoK5SZ4qPHgHJgaKGgs.oUVTe',
  'Pradipta Kumar Ray (Owner)',
  'owner',
  true,
  1
)
ON CONFLICT (email) DO UPDATE SET
  password_hash = EXCLUDED.password_hash,
  name = EXCLUDED.name,
  role = 'owner',
  is_active = true,
  token_version = COALESCE(users.token_version, 1) + 1,
  updated_at = NOW();

-- 2. Manager Account: livotelpremiumhotel@gmail.com / Livo@2026
INSERT INTO users (id, email, password_hash, name, role, is_active, token_version)
VALUES (
  '00000000-0000-4000-8000-000000000002',
  'livotelpremiumhotel@gmail.com',
  '$2a$12$.9osSw4R0oe2.TwAvujqIO3YzLlKErmfVYSrvNfFoEJs37u8CPOJ.',
  'Hotel Manager',
  'manager',
  true,
  1
)
ON CONFLICT (email) DO UPDATE SET
  password_hash = EXCLUDED.password_hash,
  name = EXCLUDED.name,
  role = 'manager',
  is_active = true,
  token_version = COALESCE(users.token_version, 1) + 1,
  updated_at = NOW();

-- 3. Clear rate limits for both accounts to guarantee instant login
DELETE FROM login_rate_limits
WHERE key IN (
  'email:pkray2012@gmail.com',
  'email:livotelpremiumhotel@gmail.com'
);
