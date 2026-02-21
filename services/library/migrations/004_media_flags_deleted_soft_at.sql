ALTER TABLE media_flags
  ADD COLUMN IF NOT EXISTS deleted_soft_at TIMESTAMPTZ;

UPDATE media_flags
SET deleted_soft_at = COALESCE(deleted_soft_at, NOW())
WHERE deleted_soft = true
  AND deleted_soft_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_media_flags_deleted_soft_lifecycle
  ON media_flags(deleted_soft, deleted_soft_at DESC);
