import type { MigrationInterface, QueryRunner } from 'typeorm';

// Durable per-file backup/restore transfer ledger. A run is created in the same transaction as
// the rows it describes; the advisory-locked sweeper claims one item per file, so a failed file
// retries alone and a core restart resumes where it stopped. Successful items are deleted, the
// run only ever holds outstanding/failed work.
export class BackupTransferRuns1794300000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "backup_runs" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "kind" character varying(16) NOT NULL,
        "userId" uuid NOT NULL,
        "state" character varying(16) NOT NULL DEFAULT 'running',
        "email" character varying(255),
        "prefix" text,
        "manifestKey" text,
        "manifestPath" text,
        "identity" text,
        "stalePrefixes" jsonb NOT NULL DEFAULT '[]',
        "brokenFileIds" jsonb NOT NULL DEFAULT '[]',
        "counts" jsonb NOT NULL DEFAULT '{}',
        "totalItems" integer NOT NULL DEFAULT 0,
        "completedItems" integer NOT NULL DEFAULT 0,
        "uploaded" integer NOT NULL DEFAULT 0,
        "skipped" integer NOT NULL DEFAULT 0,
        "failedItems" integer NOT NULL DEFAULT 0,
        "currentFile" text,
        "error" text,
        "result" jsonb,
        "startedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "finishedAt" TIMESTAMP WITH TIME ZONE,
        CONSTRAINT "PK_backup_runs" PRIMARY KEY ("id")
      )`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_backup_runs_user_started" ON "backup_runs" ("userId", "startedAt")`,
    );
    await queryRunner.query(
      `CREATE TABLE "backup_run_items" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "runId" uuid NOT NULL,
        "fileId" uuid NOT NULL,
        "storageKey" text NOT NULL,
        "s3Key" text NOT NULL,
        "sizeBytes" bigint NOT NULL,
        "checksumSha256" character varying(64),
        "mimeType" text,
        "state" character varying(16) NOT NULL DEFAULT 'pending',
        "attempts" integer NOT NULL DEFAULT 0,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "nextAttemptAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "claimedAt" TIMESTAMP WITH TIME ZONE,
        "error" text,
        CONSTRAINT "PK_backup_run_items" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_backup_run_items_run_file" UNIQUE ("runId", "fileId"),
        CONSTRAINT "FK_backup_run_items_run" FOREIGN KEY ("runId")
          REFERENCES "backup_runs"("id") ON DELETE CASCADE ON UPDATE NO ACTION
      )`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_backup_run_items_due" ON "backup_run_items" ("runId", "state", "nextAttemptAt")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."IDX_backup_run_items_due"`);
    await queryRunner.query(`DROP TABLE "backup_run_items"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_backup_runs_user_started"`);
    await queryRunner.query(`DROP TABLE "backup_runs"`);
  }
}
