import type { MigrationInterface, QueryRunner } from 'typeorm';

// At most one active run per user. `assertNoActiveRun` is a plain read, so two starts that race
// it both passed and then wrote into the same fixed S3 prefix, where each run's finalize pruned
// the other's uploads. The partial unique index is the real guard; the service maps 23505 to 409.
export class BackupRunActiveUnique1794400000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Rows that predate the guard: keep the newest active run per user, fail the rest so the
    // index can be created. A superseded run's bytes are safe — the newest manifest is the one
    // published last, and a failed run stays retryable.
    await queryRunner.query(
      `WITH ranked AS (
         SELECT "id", row_number() OVER (
           PARTITION BY "userId" ORDER BY "startedAt" DESC, "id" DESC
         ) AS rn
         FROM "backup_runs"
         WHERE "state" IN ('running', 'paused', 'finalizing')
       )
       UPDATE "backup_runs" r
       SET "state" = 'failed', "error" = 'superseded by a newer run', "finishedAt" = now()
       FROM ranked
       WHERE r."id" = ranked."id" AND ranked.rn > 1`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_backup_runs_active_user" ON "backup_runs" ("userId")
       WHERE "state" IN ('running', 'paused', 'finalizing')`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "UQ_backup_runs_active_user"`);
  }
}
