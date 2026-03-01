const media = new Map();
const users = new Map();
const videoEncodingProfiles = new Map();

function now() {
  return new Date().toISOString();
}

function mediaRow(row) {
  return {
    id: row.id,
    owner_id: row.owner_id,
    relative_path: row.relative_path,
    mime_type: row.mime_type,
    status: row.status,
    checksum_sha256: row.checksum_sha256,
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

function userRow(row) {
  return {
    id: row.id,
    email: row.email,
    password_hash: row.password_hash,
    is_admin: row.is_admin,
    is_active: row.is_active,
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

function routeQuery(sql, params) {
  const text = sql.replace(/\s+/g, " ").trim();

  if (/^BEGIN$/i.test(text) || /^COMMIT$/i.test(text) || /^ROLLBACK$/i.test(text)) {
    return { rows: [], rowCount: 0 };
  }

  if (/SELECT id, is_admin, is_active FROM users WHERE id = \$1 LIMIT 1/i.test(text)) {
    const user = users.get(params[0]);
    if (!user) {
      return { rows: [], rowCount: 0 };
    }
    return {
      rows: [
        {
          id: user.id,
          is_admin: user.is_admin,
          is_active: user.is_active
        }
      ],
      rowCount: 1
    };
  }

  if (/UPDATE media SET status = \$2,/i.test(text) && /WHERE id = \$1/i.test(text)) {
    const mediaId = params[0];
    const nextStatus = params[1];
    const row = media.get(mediaId);
    if (!row) {
      return { rows: [], rowCount: 0 };
    }

    row.status = nextStatus;
    row.updated_at = now();
    media.set(mediaId, row);
    return {
      rows: [
        {
          id: row.id,
          owner_id: row.owner_id,
          status: row.status,
          updated_at: row.updated_at
        }
      ],
      rowCount: 1
    };
  }

  if (/SELECT id, owner_id, relative_path, mime_type, status, checksum_sha256, created_at, updated_at FROM media WHERE id = \$1 LIMIT 1/i.test(text)) {
    const row = media.get(params[0]);
    return { rows: row ? [mediaRow(row)] : [], rowCount: row ? 1 : 0 };
  }

  if (/SELECT 1 FROM media WHERE relative_path = \$1 LIMIT 1/i.test(text)) {
    for (const row of media.values()) {
      if (row.relative_path === params[0]) {
        return { rows: [{ "?column?": 1 }], rowCount: 1 };
      }
    }
    return { rows: [], rowCount: 0 };
  }

  if (/SELECT 1 FROM media WHERE id = \$1 LIMIT 1/i.test(text)) {
    const row = media.get(params[0]);
    return { rows: row ? [{ "?column?": 1 }] : [], rowCount: row ? 1 : 0 };
  }

  if (/SELECT profile_key, profile_json, updated_by, updated_at FROM video_encoding_profiles WHERE profile_key = \$1 LIMIT 1/i.test(text)) {
    const row = videoEncodingProfiles.get(params[0]);
    return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
  }

  if (/INSERT INTO video_encoding_profiles/i.test(text) && /ON CONFLICT \(profile_key\)/i.test(text)) {
    const profileKey = params[0];
    const profileJson = JSON.parse(params[1]);
    const updatedBy = params[2] || null;
    const row = {
      profile_key: profileKey,
      profile_json: profileJson,
      updated_by: updatedBy,
      updated_at: now()
    };
    videoEncodingProfiles.set(profileKey, row);
    return { rows: [row], rowCount: 1 };
  }

  return { rows: [], rowCount: 0 };
}

const mockPool = {
  async query(sql, params) {
    return routeQuery(sql, params);
  },

  async connect() {
    return {
      async query(sql, params) {
        return routeQuery(sql, params);
      },
      release() { },
      async end() { }
    };
  },

  async end() { },

  reset() {
    media.clear();
    users.clear();
    videoEncodingProfiles.clear();
  },

  seedMedia({ id, owner_id, relative_path, mime_type, status, checksum_sha256 }) {
    const ts = now();
    const row = {
      id,
      owner_id,
      relative_path,
      mime_type,
      status,
      checksum_sha256,
      created_at: ts,
      updated_at: ts
    };
    media.set(id, row);
    return mediaRow(row);
  },

  seedUser({ id, email, password_hash, is_admin, is_active }) {
    const ts = now();
    const row = {
      id,
      email,
      password_hash,
      is_admin: Boolean(is_admin),
      is_active: is_active !== false,
      created_at: ts,
      updated_at: ts
    };
    users.set(id, row);
    return userRow(row);
  },

  seedVideoEncodingProfile({ profile_key, profile_json, updated_by = null }) {
    const row = {
      profile_key,
      profile_json,
      updated_by,
      updated_at: now()
    };
    videoEncodingProfiles.set(profile_key, row);
    return row;
  }
};

module.exports = mockPool;
