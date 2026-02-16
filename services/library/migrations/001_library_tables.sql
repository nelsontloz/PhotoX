CREATE TABLE IF NOT EXISTS media (
  id UUID PRIMARY KEY,
  owner_id UUID NOT NULL,
  relative_path TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  status TEXT NOT NULL,
  checksum_sha256 TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS media_metadata (
  media_id UUID PRIMARY KEY REFERENCES media(id) ON DELETE CASCADE,
  taken_at TIMESTAMPTZ,
  uploaded_at TIMESTAMPTZ NOT NULL,
  exif_json JSONB,
  location_json JSONB,
  width INTEGER,
  height INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS media_flags (
  media_id UUID PRIMARY KEY REFERENCES media(id) ON DELETE CASCADE,
  favorite BOOLEAN NOT NULL DEFAULT FALSE,
  archived BOOLEAN NOT NULL DEFAULT FALSE,
  hidden BOOLEAN NOT NULL DEFAULT FALSE,
  deleted_soft BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO media_metadata (media_id, taken_at, uploaded_at)
SELECT id, created_at, created_at
FROM media
ON CONFLICT (media_id) DO NOTHING;

INSERT INTO media_flags (media_id)
SELECT id
FROM media
ON CONFLICT (media_id) DO NOTHING;

CREATE INDEX IF NOT EXISTS idx_media_owner_created_id
  ON media(owner_id, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_media_metadata_timeline
  ON media_metadata(taken_at DESC, uploaded_at DESC, media_id DESC);

CREATE INDEX IF NOT EXISTS idx_media_flags_timeline
  ON media_flags(deleted_soft, favorite, archived, hidden, media_id);
