CREATE TABLE IF NOT EXISTS video_encoding_profiles (
  profile_key TEXT PRIMARY KEY,
  profile_json JSONB NOT NULL,
  updated_by UUID,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

