const crypto = require("node:crypto");
const { ApiError } = require("../errors");

function buildAlbumRepo(db) {
    function generateId(prefix) {
        return `${prefix}_${crypto.randomBytes(16).toString("hex")}`;
    }

    async function createAlbum({ ownerId, title }) {
        const id = generateId("alb");
        const result = await db.query(
            `
        INSERT INTO albums (id, owner_id, title, created_at, updated_at)
        VALUES ($1, $2, $3, NOW(), NOW())
        RETURNING id, owner_id AS "ownerId", title, created_at AS "createdAt", updated_at AS "updatedAt"
      `,
            [id, ownerId, title]
        );
        return result.rows[0];
    }

    async function listAlbums({ ownerId, limit = 50 }) {
        const result = await db.query(
            `
        SELECT id, owner_id AS "ownerId", title, created_at AS "createdAt", updated_at AS "updatedAt"
        FROM albums
        WHERE owner_id = $1
        ORDER BY created_at DESC
        LIMIT $2
      `,
            [ownerId, limit]
        );
        return result.rows;
    }

    async function getAlbumById({ albumId }) {
        const result = await db.query(
            `
        SELECT id, owner_id AS "ownerId", title, created_at AS "createdAt", updated_at AS "updatedAt"
        FROM albums
        WHERE id = $1
      `,
            [albumId]
        );

        if (result.rowCount === 0) {
            throw new ApiError(404, "ALBUM_NOT_FOUND", "Album not found");
        }

        return result.rows[0];
    }

    async function addMediaToAlbum({ albumId, ownerId, mediaId }) {
        const album = await getAlbumById({ albumId });
        if (album.ownerId !== ownerId) {
            throw new ApiError(403, "ALBUM_FORBIDDEN", "Forbidden: not the album owner");
        }

        // Verify media belongs to user (assumes `media` table is accessible in the same database)
        const mediaRes = await db.query(
            `SELECT id FROM media WHERE id = $1 AND owner_id = $2 AND status = 'ready'`,
            [mediaId, ownerId]
        );

        if (mediaRes.rowCount === 0) {
            throw new ApiError(400, "INVALID_MEDIA", "Media does not exist or does not belong to the user");
        }

        try {
            await db.query(
                `
          INSERT INTO album_items (album_id, media_id, added_at)
          VALUES ($1, $2, NOW())
          ON CONFLICT (album_id, media_id) DO NOTHING
        `,
                [albumId, mediaId]
            );
        } catch (err) {
            if (err.code === "23503") { // foreign_key_violation
                throw new ApiError(404, "ALBUM_NOT_FOUND", "Album not found");
            }
            throw err;
        }

        return { albumId, mediaId };
    }

    async function getAlbumItems({ albumId, ownerId }) {
        const album = await getAlbumById({ albumId });
        if (album.ownerId !== ownerId) {
            throw new ApiError(403, "ALBUM_FORBIDDEN", "Forbidden: not the album owner");
        }

        const result = await db.query(
            `
        SELECT media_id AS "mediaId", added_at AS "addedAt"
        FROM album_items
        WHERE album_id = $1
        ORDER BY added_at DESC
      `,
            [albumId]
        );

        return result.rows;
    }

    return {
        createAlbum,
        listAlbums,
        getAlbumById,
        addMediaToAlbum,
        getAlbumItems
    };
}

module.exports = {
    buildAlbumRepo
};
