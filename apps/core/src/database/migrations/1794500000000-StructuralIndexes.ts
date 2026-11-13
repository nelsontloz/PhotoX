import type { MigrationInterface, QueryRunner } from 'typeorm';

// Four indexes the query patterns needed but no migration created. Every name matches the entity
// decorator exactly, so `synchronize` (dev) and this migration (prod) converge on one index
// instead of TypeORM's hash-named duplicate.
//
// CONCURRENTLY: these tables carry rows in production and a plain CREATE INDEX takes a SHARE lock
// that blocks writes. That forbids an enclosing transaction, hence `transaction = false`.
// Ceiling: a failed concurrent build leaves an INVALID index behind and IF NOT EXISTS then skips
// it — drop it by hand and re-run.
export class StructuralIndexes1794500000000 implements MigrationInterface {
  public readonly transaction = false;

  public async up(queryRunner: QueryRunner): Promise<void> {
    // dispatcher claims due transfer work across runs every ~1s, ordered by nextAttemptAt
    await queryRunner.query(
      `CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_backup_run_items_state_next_attempt"
       ON "backup_run_items" ("state", "nextAttemptAt")`,
    );
    // logout-all / account wipe delete refresh tokens by userId
    await queryRunner.query(
      `CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_refresh_tokens_user_id"
       ON "refresh_tokens" ("userId")`,
    );
    // person-filtered timeline correlates on (personId, assetId)
    await queryRunner.query(
      `CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_faces_person_asset"
       ON "faces" ("personId", "assetId")`,
    );
    // the orphan sweep's NOT IN (SELECT id FROM files) predicate
    await queryRunner.query(
      `CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_asset_thumbnails_file_id"
       ON "asset_thumbnails" ("fileId")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const name of [
      'idx_backup_run_items_state_next_attempt',
      'idx_refresh_tokens_user_id',
      'idx_faces_person_asset',
      'idx_asset_thumbnails_file_id',
    ]) {
      await queryRunner.query(`DROP INDEX CONCURRENTLY IF EXISTS "${name}"`);
    }
  }
}
