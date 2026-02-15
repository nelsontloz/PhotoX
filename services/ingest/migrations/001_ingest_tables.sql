CREATE TABLE IF NOT EXISTS upload_sessions (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL,
  file_name TEXT NOT NULL,
  content_type TEXT NOT NULL,
  file_size BIGINT NOT NULL CHECK (file_size > 0),
  checksum_sha256 TEXT NOT NULL,
  part_size INTEGER NOT NULL CHECK (part_size > 0),
  status TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  media_id UUID,
  storage_relative_path TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_upload_sessions_user_status
  ON upload_sessions(user_id, status);

CREATE TABLE IF NOT EXISTS upload_parts (
  upload_id UUID NOT NULL REFERENCES upload_sessions(id) ON DELETE CASCADE,
  part_number INTEGER NOT NULL CHECK (part_number > 0),
  byte_size INTEGER NOT NULL CHECK (byte_size > 0),
  checksum_sha256 TEXT NOT NULL,
  relative_part_path TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY(upload_id, part_number)
);

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

CREATE TABLE IF NOT EXISTS idempotency_keys (
  user_id UUID NOT NULL,
  scope TEXT NOT NULL,
  idem_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  response_body JSONB NOT NULL,
  status_code INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY(user_id, scope, idem_key)
);
