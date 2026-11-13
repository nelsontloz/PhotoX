import type { MigrationInterface, QueryRunner } from 'typeorm';

interface ForeignKey {
  table: string;
  name: string;
  /** Column list + parent, exactly as they appear after `FOREIGN KEY`. */
  definition: string;
}

// Referential integrity the code already implements by hand. Every edge is `NOT VALID` first and
// validated afterwards, so the only ACCESS EXCLUSIVE lock is a catalog write; the scan that
// proves the existing rows takes SHARE UPDATE EXCLUSIVE and blocks no writes.
//
// Rules encoded here:
//   - every `userId` is a `users` FK with RESTRICT, never CASCADE. The account wipe drains rows
//     in bounded batches and deletes the user row last, so RESTRICT turns "a table was added and
//     the wipe order was not updated" into a failure on the final step instead of silent orphans.
//   - `backup_merges.backupUserId` and `user_deletes.userId` are deliberately NOT constrained:
//     the first references an account that must already be deleted, the second outlives its row.
//   - asset children CASCADE (faces, album links) to match the three tables that already did
//     (thumbnails, embeddings, detections); a face on a nonexistent photo used to be possible.
//   - bytes and cross-links RESTRICT or SET NULL, never CASCADE: deleting a `files` row must not
//     take an asset with it.
//   - `files.assetId` is INITIALLY DEFERRED because restore and merge insert `files` before
//     `assets` in one transaction, with the asset id already filled in (the pair is mutually
//     referential: `assets.fileId` is NOT NULL and stays immediate, so this side must defer).
//   - `assets.transcodeFileId` is intentionally absent: it is a duplicate of
//     `files(assetId, purpose='transcode')` and is slated for removal. The orphan sweep already
//     counts it as referenced.
const FOREIGN_KEYS: ForeignKey[] = [
  // account ownership
  {
    table: 'assets',
    name: 'fk_assets_user',
    definition: '("userId") REFERENCES "users"("id") ON DELETE RESTRICT',
  },
  {
    table: 'files',
    name: 'fk_files_user',
    definition: '("userId") REFERENCES "users"("id") ON DELETE RESTRICT',
  },
  {
    table: 'albums',
    name: 'fk_albums_user',
    definition: '("userId") REFERENCES "users"("id") ON DELETE RESTRICT',
  },
  {
    table: 'shares',
    name: 'fk_shares_user',
    definition: '("userId") REFERENCES "users"("id") ON DELETE RESTRICT',
  },
  {
    table: 'faces',
    name: 'fk_faces_user',
    definition: '("userId") REFERENCES "users"("id") ON DELETE RESTRICT',
  },
  {
    table: 'persons',
    name: 'fk_persons_user',
    definition: '("userId") REFERENCES "users"("id") ON DELETE RESTRICT',
  },
  {
    table: 'refresh_tokens',
    name: 'fk_refresh_tokens_user',
    definition: '("userId") REFERENCES "users"("id") ON DELETE RESTRICT',
  },
  {
    table: 'upload_sessions',
    name: 'fk_upload_sessions_user',
    definition: '("userId") REFERENCES "users"("id") ON DELETE RESTRICT',
  },
  {
    table: 'backup_runs',
    name: 'fk_backup_runs_user',
    definition: '("userId") REFERENCES "users"("id") ON DELETE RESTRICT',
  },
  {
    table: 'backup_merges',
    name: 'fk_backup_merges_target_user',
    definition: '("targetUserId") REFERENCES "users"("id") ON DELETE RESTRICT',
  },

  // bytes
  {
    table: 'assets',
    name: 'fk_assets_file',
    definition: '("fileId") REFERENCES "files"("id") ON DELETE RESTRICT',
  },
  {
    table: 'files',
    name: 'fk_files_asset',
    definition:
      '("assetId") REFERENCES "assets"("id") ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED',
  },
  // `asset_thumbnails.fileId` is deliberately left free: an orphan thumbnail (a row whose file
  // is gone) is exactly what `POST /admin/cleanup-orphans` exists to repair for pre-existing
  // data, and the sweep's referenced-id union already refuses to delete a file a thumbnail
  // points at. A constraint here would only make that repair path unreachable.

  // asset children
  {
    table: 'faces',
    name: 'fk_faces_asset',
    definition: '("assetId") REFERENCES "assets"("id") ON DELETE CASCADE',
  },
  {
    table: 'faces',
    name: 'fk_faces_person',
    definition: '("personId") REFERENCES "persons"("id") ON DELETE SET NULL',
  },
  {
    table: 'persons',
    name: 'fk_persons_cover_face',
    definition: '("coverFaceId") REFERENCES "faces"("id") ON DELETE SET NULL',
  },
  {
    table: 'album_assets',
    name: 'fk_album_assets_album',
    definition: '("albumId") REFERENCES "albums"("id") ON DELETE CASCADE',
  },
  {
    table: 'album_assets',
    name: 'fk_album_assets_asset',
    definition: '("assetId") REFERENCES "assets"("id") ON DELETE CASCADE',
  },

  // transient references: a purged asset must never block a session row
  {
    table: 'upload_sessions',
    name: 'fk_upload_sessions_completed_file',
    definition: '("completedFileId") REFERENCES "files"("id") ON DELETE SET NULL',
  },
  {
    table: 'upload_sessions',
    name: 'fk_upload_sessions_completed_asset',
    definition: '("completedAssetId") REFERENCES "assets"("id") ON DELETE SET NULL',
  },
];

export class ReferentialIntegrity1794600000001 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const fk of FOREIGN_KEYS) {
      await queryRunner.query(
        `ALTER TABLE "${fk.table}" ADD CONSTRAINT "${fk.name}" FOREIGN KEY ${fk.definition} NOT VALID`,
      );
    }
    for (const fk of FOREIGN_KEYS) {
      await queryRunner.query(`ALTER TABLE "${fk.table}" VALIDATE CONSTRAINT "${fk.name}"`);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const fk of [...FOREIGN_KEYS].reverse()) {
      await queryRunner.query(`ALTER TABLE "${fk.table}" DROP CONSTRAINT "${fk.name}"`);
    }
  }
}
