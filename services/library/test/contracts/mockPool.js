/**
 * In-memory mock of pg.Pool for the library-service provider pact tests.
 *
 * Covers tables: media, media_metadata, media_flags, schema_migrations (no-op).
 * Supports transactions via connect() returning a mock client.
 */

/* ---------- in-memory stores ---------- */
const media = new Map();         // keyed by id
const metadata = new Map();      // keyed by media_id
const flags = new Map();         // keyed by media_id
const schemaMigrations = new Set();

/* ---------- helpers ---------- */
const now = () => new Date().toISOString();

function fullMediaRow(m) {
    const mm = metadata.get(m.id) || {};
    const mf = flags.get(m.id) || {};
    return {
        id: m.id,
        owner_id: m.owner_id,
        relative_path: m.relative_path,
        mime_type: m.mime_type,
        status: m.status,
        created_at: m.created_at,
        taken_at: mm.taken_at || null,
        uploaded_at: mm.uploaded_at || m.created_at,
        width: mm.width || null,
        height: mm.height || null,
        location_json: mm.location_json || null,
        exif_json: mm.exif_json || null,
        favorite: mf.favorite ?? false,
        archived: mf.archived ?? false,
        hidden: mf.hidden ?? false,
        deleted_soft: mf.deleted_soft ?? false,
        sort_at: m.sort_at || mm.taken_at || mm.uploaded_at || m.created_at
    };
}

/* ---------- SQL router ---------- */
function routeQuery(sql, params) {
    const text = sql.replace(/\s+/g, " ").trim();

    // ---- DDL / migration no-ops ----
    if (/CREATE TABLE|ALTER TABLE|CREATE INDEX|CREATE EXTENSION|DO \$\$/i.test(text)) {
        return { rows: [], rowCount: 0 };
    }

    // ---- schema_migrations ----
    if (/CREATE TABLE IF NOT EXISTS schema_migrations/i.test(text)) {
        return { rows: [], rowCount: 0 };
    }
    if (/SELECT filename FROM schema_migrations WHERE filename/i.test(text)) {
        const fn = params[0];
        return { rows: schemaMigrations.has(fn) ? [{ filename: fn }] : [], rowCount: schemaMigrations.has(fn) ? 1 : 0 };
    }
    if (/INSERT INTO schema_migrations/i.test(text)) {
        schemaMigrations.add(params[0]);
        return { rows: [], rowCount: 1 };
    }

    // ---- BEGIN / COMMIT / ROLLBACK ----
    if (/^BEGIN$/i.test(text) || /^COMMIT$/i.test(text) || /^ROLLBACK$/i.test(text)) {
        return { rows: [], rowCount: 0 };
    }

    // ---- media_metadata INSERT ... ON CONFLICT DO NOTHING ----
    if (/INSERT INTO media_metadata/i.test(text)) {
        const mediaId = params[0];
        if (!metadata.has(mediaId)) {
            const m = media.get(mediaId);
            if (m) {
                metadata.set(mediaId, {
                    media_id: mediaId,
                    uploaded_at: m.created_at,
                    taken_at: null,
                    width: null,
                    height: null,
                    location_json: null,
                    exif_json: null,
                    updated_at: now()
                });
            }
        }
        return { rows: [], rowCount: 0 };
    }

    // ---- media_flags INSERT ... ON CONFLICT DO NOTHING ----
    if (/INSERT INTO media_flags/i.test(text)) {
        const mediaId = params[0];
        if (!flags.has(mediaId)) {
            flags.set(mediaId, {
                media_id: mediaId,
                favorite: false,
                archived: false,
                hidden: false,
                deleted_soft: false,
                updated_at: now()
            });
        }
        return { rows: [], rowCount: 0 };
    }

    // ---- UPDATE media_flags SET favorite/archived/hidden ----
    if (/UPDATE media_flags/i.test(text) && /WHERE media_id = \$1/i.test(text)) {
        const mediaId = params[0];
        const mf = flags.get(mediaId);
        if (mf) {
            // Parse SET clause to figure out which flags are being updated
            const setMatch = text.match(/SET\s+(.*?)\s*WHERE/i);
            if (setMatch) {
                const assignments = setMatch[1].split(",").map(s => s.trim());
                let paramIdx = 1; // $1 is media_id, rest are in order of SET
                for (const assignment of assignments) {
                    if (/updated_at/i.test(assignment)) continue;
                    const col = assignment.split("=")[0].trim();
                    if (params[paramIdx] !== undefined) {
                        mf[col] = params[paramIdx];
                    }
                    paramIdx++;
                }
                mf.updated_at = now();
            }
        }
        return { rows: [], rowCount: mf ? 1 : 0 };
    }

    // ---- UPDATE media_flags SET deleted_soft ----
    if (/UPDATE media_flags SET deleted_soft = \$2/i.test(text)) {
        const mediaId = params[0];
        const mf = flags.get(mediaId);
        if (mf) {
            mf.deleted_soft = params[1];
            mf.updated_at = now();
        }
        return { rows: [], rowCount: mf ? 1 : 0 };
    }

    // ---- UPDATE media_metadata SET taken_at ----
    if (/UPDATE media_metadata SET taken_at/i.test(text)) {
        const mediaId = params[0];
        const mm = metadata.get(mediaId);
        if (mm) {
            mm.taken_at = params[1];
            mm.updated_at = now();
        }
        return { rows: [], rowCount: mm ? 1 : 0 };
    }

    // ---- UPDATE media SET sort_at from media_metadata ----
    if (/UPDATE media m SET sort_at/i.test(text) && /FROM media_metadata mm/i.test(text)) {
        const mediaId = params[0];
        const m = media.get(mediaId);
        const mm = metadata.get(mediaId);
        if (m) {
            m.sort_at = (mm && (mm.taken_at || mm.uploaded_at)) || m.created_at;
        }
        return { rows: [], rowCount: m ? 1 : 0 };
    }

    // ---- SELECT id FROM media WHERE id AND owner_id (ownership check) ----
    if (/SELECT id FROM media WHERE id = \$1 AND owner_id = \$2/i.test(text)) {
        const m = media.get(params[0]);
        if (m && m.owner_id === params[1]) {
            return { rows: [{ id: m.id }], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
    }

    // ---- Full media detail SELECT (with JOINs to metadata + flags) ----
    if (/FROM media m/i.test(text) && /LEFT JOIN media_metadata/i.test(text)) {
        // Timeline query (owner_id = $1 with many filters)
        if (/WHERE m\.owner_id = \$1/i.test(text) && /ORDER BY (?:m\.)?sort_at/i.test(text)) {
            const ownerId = params[0];
            const rows = [];
            for (const [, m] of media) {
                if (m.owner_id === ownerId) {
                    const row = fullMediaRow(m);
                    if (!row.deleted_soft) {
                        rows.push(row);
                    }
                }
            }
            rows.sort((a, b) => new Date(b.sort_at) - new Date(a.sort_at));
            const limit = params[9] ? Number(params[9]) : 25;
            return { rows: rows.slice(0, limit), rowCount: Math.min(rows.length, limit) };
        }

        // Single media detail query (WHERE m.id = $1 AND m.owner_id = $2)
        if (/WHERE m\.id = \$1 AND m\.owner_id = \$2/i.test(text)) {
            const m = media.get(params[0]);
            if (m && m.owner_id === params[1]) {
                return { rows: [fullMediaRow(m)], rowCount: 1 };
            }
            return { rows: [], rowCount: 0 };
        }
    }

    console.warn("[mockPool] unhandled query:", text, params);
    return { rows: [], rowCount: 0 };
}

/* ---------- mock pool object ---------- */
const mockPool = {
    async query(sql, params) {
        return routeQuery(sql, params);
    },
    async connect() {
        return {
            async query(sql, params) { return routeQuery(sql, params); },
            release() { }
        };
    },
    async end() { },

    /* ---- test helpers ---- */
    reset() {
        media.clear();
        metadata.clear();
        flags.clear();
        schemaMigrations.clear();
    },

    seedMedia({ id, owner_id, relative_path, mime_type, status, taken_at, uploaded_at }) {
        const ts = now();
        media.set(id, {
            id,
            owner_id,
            relative_path: relative_path || `${owner_id}/2026/02/${id}.jpg`,
            mime_type: mime_type || "image/jpeg",
            status: status || "ready",
            created_at: ts,
            sort_at: taken_at || uploaded_at || ts
        });
        metadata.set(id, {
            media_id: id,
            taken_at: taken_at || ts,
            uploaded_at: uploaded_at || ts,
            width: 4032,
            height: 3024,
            location_json: null,
            exif_json: null,
            updated_at: ts
        });
        flags.set(id, {
            media_id: id,
            favorite: false,
            archived: false,
            hidden: false,
            deleted_soft: false,
            updated_at: ts
        });
    }
};

module.exports = mockPool;
