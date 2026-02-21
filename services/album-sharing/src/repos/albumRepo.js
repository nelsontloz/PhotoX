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
        SELECT a.id, a.owner_id AS "ownerId", a.title,
               a.created_at AS "createdAt", a.updated_at AS "updatedAt",
               COUNT(
                 CASE
                   WHEN m.id IS NOT NULL AND COALESCE(mf.deleted_soft, false) = false
                   THEN ai.media_id
                   ELSE NULL
                 END
               )::int AS "mediaCount",
               (
                  SELECT ARRAY_AGG(media_id)
                  FROM (
                    SELECT ai_sample.media_id
                    FROM album_items ai_sample
                    LEFT JOIN media m_sample ON m_sample.id::text = ai_sample.media_id
                    LEFT JOIN media_flags mf_sample ON mf_sample.media_id = m_sample.id
                    WHERE ai_sample.album_id = a.id
                      AND m_sample.id IS NOT NULL
                      AND COALESCE(mf_sample.deleted_soft, false) = false
                    ORDER BY added_at DESC
                    LIMIT 4
                  ) s
                ) AS "sampleMediaIds"
        FROM albums a
        LEFT JOIN album_items ai ON ai.album_id = a.id
        LEFT JOIN media m ON m.id::text = ai.media_id
        LEFT JOIN media_flags mf ON mf.media_id = m.id
        WHERE a.owner_id = $1
        GROUP BY a.id
        ORDER BY a.created_at DESC
        LIMIT $2
      `,
            [ownerId, limit]
        );
        return result.rows.map(row => ({
            ...row,
            sampleMediaIds: row.sampleMediaIds || []
        }));
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

    async function getAlbumWithItemCount({ albumId, ownerId }) {
        const result = await db.query(
            `
        SELECT a.id, a.owner_id AS "ownerId", a.title,
               a.created_at AS "createdAt", a.updated_at AS "updatedAt",
               COUNT(
                 CASE
                   WHEN m.id IS NOT NULL AND COALESCE(mf.deleted_soft, false) = false
                   THEN ai.media_id
                   ELSE NULL
                 END
               )::int AS "mediaCount"
        FROM albums a
        LEFT JOIN album_items ai ON ai.album_id = a.id
        LEFT JOIN media m ON m.id::text = ai.media_id
        LEFT JOIN media_flags mf ON mf.media_id = m.id
        WHERE a.id = $1
        GROUP BY a.id
      `,
            [albumId]
        );

        if (result.rowCount === 0) {
            throw new ApiError(404, "ALBUM_NOT_FOUND", "Album not found");
        }

        const album = result.rows[0];
        if (album.ownerId !== ownerId) {
            throw new ApiError(403, "ALBUM_FORBIDDEN", "Forbidden: not the album owner");
        }

        return album;
    }

    async function addMediaToAlbum({ albumId, ownerId, mediaId }) {
        const album = await getAlbumById({ albumId });
        if (album.ownerId !== ownerId) {
            throw new ApiError(403, "ALBUM_FORBIDDEN", "Forbidden: not the album owner");
        }

        // Verify media belongs to user (assumes `media` table is accessible in the same database)
        const mediaRes = await db.query(
            `
              SELECT m.id
              FROM media m
              LEFT JOIN media_flags mf ON mf.media_id = m.id
              WHERE m.id = $1
                AND m.owner_id = $2
                AND m.status = 'ready'
                AND COALESCE(mf.deleted_soft, false) = false
            `,
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

    async function removeMediaFromAlbum({ albumId, ownerId, mediaId }) {
        const album = await getAlbumById({ albumId });
        if (album.ownerId !== ownerId) {
            throw new ApiError(403, "ALBUM_FORBIDDEN", "Forbidden: not the album owner");
        }

        const result = await db.query(
            `DELETE FROM album_items WHERE album_id = $1 AND media_id = $2`,
            [albumId, mediaId]
        );

        if (result.rowCount === 0) {
            throw new ApiError(404, "ALBUM_ITEM_NOT_FOUND", "Media not found in album");
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
        SELECT ai.media_id AS "mediaId", ai.added_at AS "addedAt", COALESCE(m.mime_type, 'application/octet-stream') AS "mimeType"
        FROM album_items ai
        LEFT JOIN media m ON m.id::text = ai.media_id
        LEFT JOIN media_flags mf ON mf.media_id = m.id
        WHERE ai.album_id = $1
          AND m.id IS NOT NULL
          AND COALESCE(mf.deleted_soft, false) = false
        ORDER BY ai.added_at DESC
      `,
            [albumId]
        );

        return result.rows;
    }

    return {
        createAlbum,
        listAlbums,
        getAlbumById,
        getAlbumWithItemCount,
        addMediaToAlbum,
        removeMediaFromAlbum,
        getAlbumItems
    };
}

module.exports = {
    buildAlbumRepo
};
