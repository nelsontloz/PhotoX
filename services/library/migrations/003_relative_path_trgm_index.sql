-- Create pg_trgm extension if it doesn't already exist
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Create GIN trigram index on media.relative_path for efficient ILIKE substring search
CREATE INDEX IF NOT EXISTS idx_media_relative_path_trgm
  ON media USING gin (relative_path gin_trgm_ops);
