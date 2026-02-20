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
    if (/SELECT id FROM media WHERE id = \$1 AND owner_id = \$2/i.test(text)) {
        const id = params[0];
        const ownerId = params[1];
        const m = media.get(id);
        if (m && m.owner_id === ownerId) {
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

    // SELECT ... FROM album_items WHERE album_id = $1
    if (/SELECT .* FROM album_items WHERE album_id = \$1/i.test(text)) {
        const albumId = params[0];
        const items = albumItems.get(albumId) || [];
        return { rows: items, rowCount: items.length };
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

    seedMedia(id, ownerId) {
        media.set(id, { id, owner_id: ownerId });
    },

    seedAlbumItem(albumId, mediaId) {
        if (!albumItems.has(albumId)) {
            albumItems.set(albumId, []);
        }
        albumItems.get(albumId).push({ mediaId, addedAt: "2026-02-18T12:00:00.000Z" });
    }
};

module.exports = mockPool;
