import type { MigrationInterface, QueryRunner } from 'typeorm';

// Durable merge ledger (`backup_merges`): one row per (backup source account, live target
// account), unique so a second plain merge conflicts instead of replaying, and indexed by
// target because the admin overview batches the ledger lookup per live user.
export class BackupMerges1792450000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "backup_merges" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "backupUserId" uuid NOT NULL, "targetUserId" uuid NOT NULL, "prefix" text NOT NULL, "counts" jsonb NOT NULL DEFAULT '{}', "mergedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_backup_merges" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "backup_merges_backup_target" ON "backup_merges" ("backupUserId", "targetUserId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_backup_merges_target" ON "backup_merges" ("targetUserId")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."IDX_backup_merges_target"`);
    await queryRunner.query(`DROP INDEX "public"."backup_merges_backup_target"`);
    await queryRunner.query(`DROP TABLE "backup_merges"`);
  }
}
