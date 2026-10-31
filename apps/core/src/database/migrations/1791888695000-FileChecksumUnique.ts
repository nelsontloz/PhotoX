import type { MigrationInterface, QueryRunner } from 'typeorm';

// P1-5 upload double-create race: concurrent uploads of identical bytes both passed the
// findOne-then-save check and inserted duplicate `files` rows (loser bytes leaked). The
// services now insert with ON CONFLICT DO NOTHING and re-read the winner; this partial
// unique index (originals only — transcodes legitimately share checksums across assets)
// is the arbiter. synchronize covers dev/test; this migration covers prod (migrationsRun).
export class FileChecksumUnique1791888695000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE UNIQUE INDEX "files_user_checksum_original" ON "files" ("userId", "checksumSha256") WHERE "purpose" = 'original'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."files_user_checksum_original"`);
  }
}
