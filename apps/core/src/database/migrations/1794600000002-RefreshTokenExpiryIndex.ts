import type { MigrationInterface, QueryRunner } from 'typeorm';

// The entity declared `@Index()` on `refresh_tokens.expiresAt` (the opportunistic purge on the
// refresh path deletes by it), but no migration ever created the index — so production, which
// never ran `synchronize`, was deleted-from with a sequential scan. The schema-parity spec now
// fails on exactly this kind of "entity index with no migration".
export class RefreshTokenExpiryIndex1794600000002 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_refresh_tokens_expiresAt" ON "refresh_tokens" ("expiresAt")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "public"."IDX_refresh_tokens_expiresAt"`);
  }
}
