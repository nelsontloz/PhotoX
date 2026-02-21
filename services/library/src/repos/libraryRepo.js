async function ensureCompanionRows(client, mediaId) {
  await client.query(
    `
      INSERT INTO media_metadata (media_id, uploaded_at)
      SELECT id, created_at
      FROM media
      WHERE id = $1
      ON CONFLICT (media_id) DO NOTHING
    `,
    [mediaId]
  );

  await client.query(
    `
      INSERT INTO media_flags (media_id)
      SELECT id
      FROM media
      WHERE id = $1
      ON CONFLICT (media_id) DO NOTHING
    `,
    [mediaId]
  );
}

function buildLibraryRepo(db) {
  return {
    async listTimeline({
      ownerId,
      limit,
      from,
      to,
      favorite,
      archived,
      hidden,
      q,
      cursorSortAt,
      cursorId
    }) {
      const result = await db.query(
        `
          SELECT
            m.id,
            m.owner_id,
            m.relative_path,
            m.mime_type,
            m.status,
            m.created_at,
            mm.taken_at,
            COALESCE(mm.uploaded_at, m.created_at) AS uploaded_at,
            mm.width,
            mm.height,
            mm.location_json,
            mm.exif_json,
            COALESCE(mf.favorite, false) AS favorite,
            COALESCE(mf.archived, false) AS archived,
            COALESCE(mf.hidden, false) AS hidden,
            COALESCE(mf.deleted_soft, false) AS deleted_soft,
            m.sort_at AS sort_at
          FROM media m
          LEFT JOIN media_metadata mm ON mm.media_id = m.id
          LEFT JOIN media_flags mf ON mf.media_id = m.id
          WHERE m.owner_id = $1
            AND COALESCE(mf.deleted_soft, false) = false
            AND ($2::timestamptz IS NULL OR m.sort_at >= $2)
            AND ($3::timestamptz IS NULL OR m.sort_at <= $3)
            AND ($4::boolean IS NULL OR COALESCE(mf.favorite, false) = $4)
            AND ($5::boolean IS NULL OR COALESCE(mf.archived, false) = $5)
            AND ($6::boolean IS NULL OR COALESCE(mf.hidden, false) = $6)
            AND (
              $7::timestamptz IS NULL
              OR m.sort_at < $7
              OR (m.sort_at = $7 AND m.id < $8::uuid)
            )
            AND ($9::text IS NULL OR m.relative_path ILIKE '%' || $9 || '%')
          ORDER BY m.sort_at DESC, m.id DESC
          LIMIT $10
        `,
        [
          ownerId,
          from || null,
          to || null,
          favorite === undefined ? null : favorite,
          archived === undefined ? null : archived,
          hidden === undefined ? null : hidden,
          cursorSortAt || null,
          cursorId || null,
          q || null,
          limit + 1
        ]
      );

      return result.rows;
    },

    async findOwnedMediaDetails(mediaId, ownerId) {
      const result = await db.query(
        `
          SELECT
            m.id,
            m.owner_id,
            m.relative_path,
            m.mime_type,
            m.status,
            m.created_at,
            mm.taken_at,
            COALESCE(mm.uploaded_at, m.created_at) AS uploaded_at,
            mm.width,
            mm.height,
            mm.location_json,
            mm.exif_json,
            COALESCE(mf.favorite, false) AS favorite,
            COALESCE(mf.archived, false) AS archived,
            COALESCE(mf.hidden, false) AS hidden,
            COALESCE(mf.deleted_soft, false) AS deleted_soft
          FROM media m
          LEFT JOIN media_metadata mm ON mm.media_id = m.id
          LEFT JOIN media_flags mf ON mf.media_id = m.id
          WHERE m.id = $1 AND m.owner_id = $2
          LIMIT 1
        `,
        [mediaId, ownerId]
      );

      return result.rows[0] || null;
    },

    async patchMedia(mediaId, ownerId, patch) {
      const client = await db.connect();
      try {
        await client.query("BEGIN");

        const mediaResult = await client.query(
          `
            SELECT id
            FROM media
            WHERE id = $1 AND owner_id = $2
            LIMIT 1
          `,
          [mediaId, ownerId]
        );

        if (mediaResult.rowCount === 0) {
          await client.query("ROLLBACK");
          return null;
        }

        await ensureCompanionRows(client, mediaId);

        const flagKeys = ["favorite", "archived", "hidden"].filter(
          (key) => patch[key] !== undefined
        );
        if (flagKeys.length > 0) {
          const setParts = [];
          const values = [mediaId];
          for (const [index, key] of flagKeys.entries()) {
            setParts.push(`${key} = $${index + 2}`);
            values.push(patch[key]);
          }

          await client.query(
            `
              UPDATE media_flags
              SET ${setParts.join(", ")}, updated_at = NOW()
              WHERE media_id = $1
            `,
            values
          );
        }

        if (Object.prototype.hasOwnProperty.call(patch, "takenAt")) {
          await client.query(
            `
              UPDATE media_metadata
              SET taken_at = $2, updated_at = NOW()
              WHERE media_id = $1
            `,
            [mediaId, patch.takenAt]
          );

          await client.query(
            `
              UPDATE media m
              SET sort_at = COALESCE(mm.taken_at, mm.uploaded_at, m.created_at),
                  updated_at = NOW()
              FROM media_metadata mm
              WHERE m.id = $1
                AND mm.media_id = m.id
            `,
            [mediaId]
          );
        }

        const detail = await client.query(
          `
            SELECT
              m.id,
              m.owner_id,
              m.relative_path,
              m.mime_type,
              m.status,
              m.created_at,
              mm.taken_at,
              COALESCE(mm.uploaded_at, m.created_at) AS uploaded_at,
              mm.width,
              mm.height,
              mm.location_json,
              mm.exif_json,
              COALESCE(mf.favorite, false) AS favorite,
              COALESCE(mf.archived, false) AS archived,
              COALESCE(mf.hidden, false) AS hidden,
              COALESCE(mf.deleted_soft, false) AS deleted_soft
            FROM media m
            LEFT JOIN media_metadata mm ON mm.media_id = m.id
            LEFT JOIN media_flags mf ON mf.media_id = m.id
            WHERE m.id = $1 AND m.owner_id = $2
            LIMIT 1
          `,
          [mediaId, ownerId]
        );

        await client.query("COMMIT");
        return detail.rows[0] || null;
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }
    },

    async setDeletedSoft(mediaId, ownerId, deletedSoft) {
      const client = await db.connect();
      try {
        await client.query("BEGIN");

        const mediaResult = await client.query(
          `
            SELECT id
            FROM media
            WHERE id = $1 AND owner_id = $2
            LIMIT 1
          `,
          [mediaId, ownerId]
        );

        if (mediaResult.rowCount === 0) {
          await client.query("ROLLBACK");
          return null;
        }

        await ensureCompanionRows(client, mediaId);

        await client.query(
          `
            UPDATE media_flags
            SET deleted_soft = $2,
                deleted_soft_at = CASE WHEN $2 THEN NOW() ELSE NULL END,
                updated_at = NOW()
            WHERE media_id = $1
          `,
          [mediaId, deletedSoft]
        );

        await client.query("COMMIT");
        return {
          mediaId,
          deletedSoft,
          deletedSoftAt: deletedSoft ? new Date().toISOString() : null
        };
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }
    },

    async listTrash({
      ownerId,
      limit,
      cursorDeletedSoftAt,
      cursorId
    }) {
      const result = await db.query(
        `
          SELECT
            m.id,
            m.owner_id,
            m.relative_path,
            m.mime_type,
            m.status,
            m.created_at,
            mm.taken_at,
            COALESCE(mm.uploaded_at, m.created_at) AS uploaded_at,
            mm.width,
            mm.height,
            mm.location_json,
            mm.exif_json,
            COALESCE(mf.favorite, false) AS favorite,
            COALESCE(mf.archived, false) AS archived,
            COALESCE(mf.hidden, false) AS hidden,
            COALESCE(mf.deleted_soft, false) AS deleted_soft,
            mf.deleted_soft_at
          FROM media m
          LEFT JOIN media_metadata mm ON mm.media_id = m.id
          LEFT JOIN media_flags mf ON mf.media_id = m.id
          WHERE m.owner_id = $1
            AND COALESCE(mf.deleted_soft, false) = true
            AND mf.deleted_soft_at IS NOT NULL
            AND (
              $2::timestamptz IS NULL
              OR mf.deleted_soft_at < $2
              OR (mf.deleted_soft_at = $2 AND m.id < $3::uuid)
            )
          ORDER BY mf.deleted_soft_at DESC, m.id DESC
          LIMIT $4
        `,
        [ownerId, cursorDeletedSoftAt || null, cursorId || null, limit + 1]
      );

      return result.rows;
    },

    async listTrashedMediaForCleanup(ownerId) {
      const result = await db.query(
        `
          SELECT m.id, m.owner_id, m.relative_path, mf.deleted_soft_at
          FROM media m
          JOIN media_flags mf ON mf.media_id = m.id
          WHERE m.owner_id = $1
            AND COALESCE(mf.deleted_soft, false) = true
          ORDER BY mf.deleted_soft_at ASC NULLS LAST, m.id ASC
        `,
        [ownerId]
      );

      return result.rows;
    }
  };
}

module.exports = {
  buildLibraryRepo
};
