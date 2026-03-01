function buildMediaRepo(db) {
  function queryable(executor) {
    return executor || db;
  }

  async function acquireLockClient(executor) {
    if (executor) {
      return { client: executor, shouldReleaseClient: false };
    }

    if (typeof db.connect === "function") {
      const client = await db.connect();
      return { client, shouldReleaseClient: true };
    }

    return { client: db, shouldReleaseClient: false };
  }

  return {
    async getVideoEncodingProfile(profileKey, executor) {
      const result = await queryable(executor).query(
        `
          SELECT profile_key, profile_json, updated_by, updated_at
          FROM video_encoding_profiles
          WHERE profile_key = $1
          LIMIT 1
        `,
        [profileKey]
      );

      return result.rows[0] || null;
    },

    async upsertVideoEncodingProfile({ profileKey, profileJson, updatedBy = null }, executor) {
      const result = await queryable(executor).query(
        `
          INSERT INTO video_encoding_profiles (
            profile_key,
            profile_json,
            updated_by,
            updated_at
          )
          VALUES ($1, $2::jsonb, $3, NOW())
          ON CONFLICT (profile_key)
          DO UPDATE SET
            profile_json = EXCLUDED.profile_json,
            updated_by = EXCLUDED.updated_by,
            updated_at = NOW()
          RETURNING profile_key, profile_json, updated_by, updated_at
        `,
        [profileKey, JSON.stringify(profileJson), updatedBy]
      );

      return result.rows[0] || null;
    },

    async acquireProcessingLock(mediaId, optionsOrExecutor, maybeExecutor) {
      const options =
        optionsOrExecutor && typeof optionsOrExecutor.query === "function" ? {} : optionsOrExecutor || {};
      const executor =
        optionsOrExecutor && typeof optionsOrExecutor.query === "function" ? optionsOrExecutor : maybeExecutor;
      const tryOnly = Boolean(options.tryOnly);

      const { client, shouldReleaseClient } = await acquireLockClient(executor);

      try {
        if (tryOnly) {
          const result = await client.query("SELECT pg_try_advisory_lock(hashtext($1)) AS acquired", [mediaId]);
          const acquired = Boolean(result.rows[0]?.acquired);

          if (!acquired && shouldReleaseClient) {
            client.release?.();
          }

          return {
            acquired,
            mediaId,
            client: acquired ? client : null,
            shouldReleaseClient: acquired ? shouldReleaseClient : false
          };
        }

        await client.query("SELECT pg_advisory_lock(hashtext($1))", [mediaId]);
        return {
          acquired: true,
          mediaId,
          client,
          shouldReleaseClient
        };
      } catch (err) {
        if (shouldReleaseClient) {
          client.release?.();
        }
        throw err;
      }
    },

    async releaseProcessingLock(lockHandleOrMediaId, executor) {
      if (lockHandleOrMediaId && typeof lockHandleOrMediaId === "object" && lockHandleOrMediaId.mediaId) {
        const lockHandle = lockHandleOrMediaId;

        if (!lockHandle.client || !lockHandle.acquired) {
          return;
        }

        try {
          await lockHandle.client.query("SELECT pg_advisory_unlock(hashtext($1))", [lockHandle.mediaId]);
        } finally {
          if (lockHandle.shouldReleaseClient) {
            lockHandle.client.release?.();
          }
        }

        return;
      }

      await queryable(executor).query("SELECT pg_advisory_unlock(hashtext($1))", [lockHandleOrMediaId]);
    },

    async setStatus(mediaId, status, executor) {
      const result = await queryable(executor).query(
        `
          UPDATE media
          SET status = $2,
              updated_at = NOW()
          WHERE id = $1
          RETURNING id, owner_id, status, updated_at
        `,
        [mediaId, status]
      );

      return result.rows[0] || null;
    },

    async setReadyIfProcessing(mediaId, executor) {
      const result = await queryable(executor).query(
        `
          UPDATE media
          SET status = 'ready',
              updated_at = NOW()
          WHERE id = $1
            AND status = 'processing'
          RETURNING id, owner_id, status, updated_at
        `,
        [mediaId]
      );

      return result.rows[0] || null;
    },

    async setFailedIfProcessing(mediaId, executor) {
      const result = await queryable(executor).query(
        `
          UPDATE media
          SET status = 'failed',
              updated_at = NOW()
          WHERE id = $1
            AND status = 'processing'
          RETURNING id, owner_id, status, updated_at
        `,
        [mediaId]
      );

      return result.rows[0] || null;
    },

    async findById(mediaId, executor) {
      const result = await queryable(executor).query(
        `
          SELECT id, owner_id, relative_path, mime_type, status, checksum_sha256, created_at, updated_at
          FROM media
          WHERE id = $1
          LIMIT 1
        `,
        [mediaId]
      );

      return result.rows[0] || null;
    },

    async existsByRelativePath(relativePath, executor) {
      const result = await queryable(executor).query(
        `
          SELECT 1
          FROM media
          WHERE relative_path = $1
          LIMIT 1
        `,
        [relativePath]
      );

      return result.rowCount > 0;
    },

    async existsById(mediaId, executor) {
      const result = await queryable(executor).query(
        `
          SELECT 1
          FROM media
          WHERE id = $1
          LIMIT 1
        `,
        [mediaId]
      );

      return result.rowCount > 0;
    },

    async upsertMetadata(
      {
        mediaId,
        takenAt,
        uploadedAt,
        width,
        height,
        location,
        exif
      },
      executor
    ) {
      const result = await queryable(executor).query(
        `
          INSERT INTO media_metadata (
            media_id,
            taken_at,
            uploaded_at,
            exif_json,
            location_json,
            width,
            height
          )
          VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6, $7)
          ON CONFLICT (media_id)
          DO UPDATE SET
            taken_at = COALESCE(EXCLUDED.taken_at, media_metadata.taken_at),
            uploaded_at = COALESCE(media_metadata.uploaded_at, EXCLUDED.uploaded_at),
            exif_json = COALESCE(EXCLUDED.exif_json, media_metadata.exif_json),
            location_json = COALESCE(EXCLUDED.location_json, media_metadata.location_json),
            width = COALESCE(EXCLUDED.width, media_metadata.width),
            height = COALESCE(EXCLUDED.height, media_metadata.height),
            updated_at = NOW()
          RETURNING media_id, taken_at, uploaded_at, width, height, exif_json, location_json, updated_at
        `,
        [
          mediaId,
          takenAt || null,
          uploadedAt,
          exif ? JSON.stringify(exif) : null,
          location ? JSON.stringify(location) : null,
          width || null,
          height || null
        ]
      );

      await queryable(executor).query(
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

      return result.rows[0] || null;
    },

    async findCleanupCandidate(mediaId, ownerId, executor) {
      const result = await queryable(executor).query(
        `
          SELECT
            m.id,
            m.owner_id,
            m.relative_path,
            COALESCE(mf.deleted_soft, false) AS deleted_soft,
            mf.deleted_soft_at
          FROM media m
          LEFT JOIN media_flags mf ON mf.media_id = m.id
          WHERE m.id = $1
            AND m.owner_id = $2
          LIMIT 1
        `,
        [mediaId, ownerId]
      );

      return result.rows[0] || null;
    },

    async hardDeleteMediaGraphIfStillSoftDeleted(mediaId, ownerId, executor) {
      const dbExecutor = queryable(executor);
      const client = executor || (typeof db.connect === "function" ? await db.connect() : dbExecutor);
      const shouldReleaseClient = !executor && typeof db.connect === "function";

      try {
        await client.query("BEGIN");

        const target = await client.query(
          `
            SELECT m.id
            FROM media m
            JOIN media_flags mf ON mf.media_id = m.id
            WHERE m.id = $1
              AND m.owner_id = $2
              AND COALESCE(mf.deleted_soft, false) = true
            FOR UPDATE
          `,
          [mediaId, ownerId]
        );

        if (target.rowCount === 0) {
          await client.query("ROLLBACK");
          return { deleted: false };
        }

        await client.query(
          `
            DELETE FROM album_items
            WHERE media_id = $1::text
          `,
          [mediaId]
        );

        await client.query(
          `
            DELETE FROM media_metadata
            WHERE media_id = $1
          `,
          [mediaId]
        );

        await client.query(
          `
            DELETE FROM media_flags
            WHERE media_id = $1
          `,
          [mediaId]
        );

        const deletedMedia = await client.query(
          `
            DELETE FROM media
            WHERE id = $1
              AND owner_id = $2
            RETURNING id
          `,
          [mediaId, ownerId]
        );

        await client.query("COMMIT");
        return { deleted: deletedMedia.rowCount > 0 };
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        if (shouldReleaseClient) {
          client.release?.();
        }
      }
    }
  };
}

module.exports = {
  buildMediaRepo
};
