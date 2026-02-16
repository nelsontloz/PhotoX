ALTER TABLE users
  ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;

WITH earliest_user AS (
  SELECT id
  FROM users
  ORDER BY created_at ASC, id ASC
  LIMIT 1
)
UPDATE users
SET is_admin = TRUE,
    updated_at = NOW()
WHERE id IN (SELECT id FROM earliest_user)
  AND NOT EXISTS (SELECT 1 FROM users WHERE is_admin = TRUE);

CREATE INDEX IF NOT EXISTS idx_users_is_admin_is_active
  ON users(is_admin, is_active);
