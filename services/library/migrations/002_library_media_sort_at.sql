ALTER TABLE media
  ADD COLUMN IF NOT EXISTS sort_at TIMESTAMPTZ;

ALTER TABLE media
  ALTER COLUMN sort_at SET DEFAULT NOW();

UPDATE media m
SET sort_at = COALESCE(mm.taken_at, mm.uploaded_at, m.created_at)
FROM media_metadata mm
WHERE mm.media_id = m.id;

UPDATE media
SET sort_at = created_at
WHERE sort_at IS NULL;

ALTER TABLE media
  ALTER COLUMN sort_at SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_media_owner_sort_at_id
  ON media(owner_id, sort_at DESC, id DESC);
