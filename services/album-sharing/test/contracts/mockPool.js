/**
 * In-memory mock of pg.Pool for the album-sharing-service provider pact tests.
 * Covers tables: albums, album_items, media (mocked ownership).
 */

const albums = new Map();
const albumItems = new Map();
const media = new Map();

const now = () => new Date().toISOString();

function routeQuery(sql, params) {
    const text = sql.replace(/\s+/g, " ").trim();

    // DDL / migration no-ops
    if (/CREATE TABLE|ALTER TABLE|CREATE INDEX/i.test(text)) {
        return { rows: [], rowCount: 0 };
    }
    if (/schema_migrations/i.test(text)) {
        return { rows: [], rowCount: 0 };
    }
    if (/^BEGIN$/i.test(text) || /^COMMIT$/i.test(text) || /^ROLLBACK$/i.test(text)) {
        return { rows: [], rowCount: 0 };
    }

    // INSERT INTO albums
    if (/INSERT INTO albums/i.test(text)) {
        const id = params[0];
        const ownerId = params[1];
        const title = params[2];
        const ts = "2026-02-18T12:00:00.000Z";
        const album = { id, owner_id: ownerId, title, created_at: ts, updated_at: ts };
        albums.set(id, album);
        return { rows: [{ id, ownerId, title, createdAt: ts, updatedAt: ts }], rowCount: 1 };
    }

    // SELECT ... FROM albums WHERE owner_id = $1
    if (/SELECT .* FROM albums WHERE owner_id = \$1/i.test(text)) {
        const ownerId = params[0];
        const limit = params[1] || 50;
        const rows = [];
        for (const alb of albums.values()) {
            if (alb.owner_id === ownerId) {
                rows.push({
                    id: alb.id,
                    ownerId: alb.owner_id,
                    title: alb.title,
                    createdAt: alb.created_at,
                    updatedAt: alb.updated_at
                });
            }
        }
        return { rows: rows.slice(0, limit), rowCount: Math.min(rows.length, limit) };
    }

    // SELECT ... FROM albums WITH mediaCount (JOIN album_items)
    if (
        text.includes("FROM albums a") &&
        text.includes("LEFT JOIN album_items ai ON ai.album_id = a.id") &&
        text.includes("WHERE a.owner_id = $1") &&
        text.includes("sampleMediaIds")
    ) {
        const ownerId = params[0];
        const limit = params[1] || 50;
        const rows = [];
        for (const alb of albums.values()) {
            if (alb.owner_id === ownerId) {
                const itemIds = albumItems.get(alb.id) || [];
                const visibleItems = itemIds.filter((item) => {
                    const m = media.get(item.mediaId);
                    return Boolean(m) && !Boolean(m.deleted_soft);
                });
                rows.push({
                    id: alb.id,
                    ownerId: alb.owner_id,
                    title: alb.title,
                    createdAt: alb.created_at,
                    updatedAt: alb.updated_at,
                    mediaCount: visibleItems.length,
                    sampleMediaIds: visibleItems.slice(0, 4).map((item) => item.mediaId)
                });
            }
        }
        return { rows: rows.slice(0, limit), rowCount: Math.min(rows.length, limit) };
    }

    // SELECT ... FROM albums WHERE id = $1 (WITH mediaCount)
    if (
        text.includes("FROM albums a") &&
        text.includes("LEFT JOIN album_items ai ON ai.album_id = a.id") &&
        text.includes("WHERE a.id = $1") &&
        text.includes("mediaCount")
    ) {
        const id = params[0];
        const alb = albums.get(id);
        if (alb) {
            const itemIds = albumItems.get(alb.id) || [];
            const visibleCount = itemIds.filter((item) => {
                const m = media.get(item.mediaId);
                return Boolean(m) && !Boolean(m.deleted_soft);
            }).length;
            return {
                rows: [{
                    id: alb.id,
                    ownerId: alb.owner_id,
                    title: alb.title,
                    createdAt: alb.created_at,
                    updatedAt: alb.updated_at,
                    mediaCount: visibleCount
                }],
                rowCount: 1
            };
        }
        return { rows: [], rowCount: 0 };
    }

    // SELECT ... FROM albums WHERE id = $1
    if (/SELECT .* FROM albums WHERE id = \$1/i.test(text)) {
        const id = params[0];
        const alb = albums.get(id);
        if (alb) {
            return {
                rows: [{
                    id: alb.id,
                    ownerId: alb.owner_id,
                    title: alb.title,
                    createdAt: alb.created_at,
                    updatedAt: alb.updated_at
                }],
                rowCount: 1
            };
        }
        return { rows: [], rowCount: 0 };
    }

    // SELECT id FROM media WHERE id = $1 AND owner_id = $2
    if (/SELECT m\.id FROM media m .* WHERE m\.id = \$1 .* m\.owner_id = \$2 .* m\.status = 'ready' .* COALESCE\(mf\.deleted_soft, false\) = false/i.test(text)) {
        const id = params[0];
        const ownerId = params[1];
        const m = media.get(id);
        if (m && m.owner_id === ownerId && !m.deleted_soft) {
            return { rows: [{ id: m.id }], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
    }

    // INSERT INTO album_items
    if (/INSERT INTO album_items/i.test(text)) {
        const albumId = params[0];
        const mediaId = params[1];
        if (!albumItems.has(albumId)) {
            albumItems.set(albumId, []);
        }
        albumItems.get(albumId).push({ mediaId, addedAt: "2026-02-18T12:00:00.000Z" });
        return { rows: [], rowCount: 1 };
    }

    // DELETE FROM album_items
    if (/DELETE FROM album_items WHERE album_id = \$1 AND media_id = \$2/i.test(text)) {
        const albumId = params[0];
        const mediaId = params[1];
        const items = albumItems.get(albumId) || [];
        const initialLen = items.length;
        const filtered = items.filter(i => i.mediaId !== mediaId);
        albumItems.set(albumId, filtered);
        return { rows: [], rowCount: initialLen - filtered.length };
    }

    // SELECT ... FROM album_items LEFT JOIN media WHERE album_id = $1
    if (/SELECT .* FROM album_items ai LEFT JOIN media m ON m\.id::text = ai\.media_id LEFT JOIN media_flags mf ON mf\.media_id = m\.id WHERE ai\.album_id = \$1 .* COALESCE\(mf\.deleted_soft, false\) = false/i.test(text)) {
        const albumId = params[0];
        const items = albumItems.get(albumId) || [];
        const visibleItems = items.filter((item) => {
            const m = media.get(item.mediaId);
            return Boolean(m) && !Boolean(m.deleted_soft);
        });
        return {
            rows: visibleItems.map((item) => ({
                mediaId: item.mediaId,
                addedAt: item.addedAt,
                mimeType: media.get(item.mediaId)?.mime_type || "application/octet-stream"
            })),
            rowCount: visibleItems.length
        };
    }

    console.warn("[mockPool] unhandled query:", text, params);
    return { rows: [], rowCount: 0 };
}

const mockPool = {
    async query(sql, params) { return routeQuery(sql, params); },
    async connect() {
        return {
            async query(sql, params) { return routeQuery(sql, params); },
            release() { }
        };
    },
    async end() { },

    reset() {
        albums.clear();
        albumItems.clear();
        media.clear();
    },

    seedAlbum(id, ownerId, title) {
        albums.set(id, { id, owner_id: ownerId, title, created_at: "2026-02-18T12:00:00.000Z", updated_at: "2026-02-18T12:00:00.000Z" });
    },

    seedMedia(id, ownerId, mimeType = "image/jpeg", deletedSoft = false) {
        media.set(id, { id, owner_id: ownerId, mime_type: mimeType, deleted_soft: deletedSoft });
    },

    seedAlbumItem(albumId, mediaId) {
        if (!albumItems.has(albumId)) {
            albumItems.set(albumId, []);
        }
        albumItems.get(albumId).push({ mediaId, addedAt: "2026-02-18T12:00:00.000Z" });
    }
};

module.exports = mockPool;
