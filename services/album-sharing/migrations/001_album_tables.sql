CREATE TABLE IF NOT EXISTS albums (
  id VARCHAR(255) PRIMARY KEY,
  owner_id VARCHAR(255) NOT NULL,
  title VARCHAR(1024) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS album_items (
  album_id VARCHAR(255) NOT NULL REFERENCES albums(id) ON DELETE CASCADE,
  media_id VARCHAR(255) NOT NULL,
  added_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (album_id, media_id)
);

CREATE INDEX IF NOT EXISTS idx_albums_owner_id ON albums(owner_id);
CREATE INDEX IF NOT EXISTS idx_album_items_media_id ON album_items(media_id);
