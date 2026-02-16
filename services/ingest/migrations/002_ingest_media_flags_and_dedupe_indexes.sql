CREATE TABLE IF NOT EXISTS media_flags (
  media_id UUID PRIMARY KEY REFERENCES media(id) ON DELETE CASCADE,
  favorite BOOLEAN NOT NULL DEFAULT FALSE,
  archived BOOLEAN NOT NULL DEFAULT FALSE,
  hidden BOOLEAN NOT NULL DEFAULT FALSE,
  deleted_soft BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO media_flags (media_id)
SELECT id
FROM media
ON CONFLICT (media_id) DO NOTHING;

CREATE INDEX IF NOT EXISTS idx_media_owner_checksum
  ON media(owner_id, checksum_sha256);

CREATE INDEX IF NOT EXISTS idx_media_flags_deleted_soft
  ON media_flags(deleted_soft, media_id);
