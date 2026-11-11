import type { MigrationInterface, QueryRunner } from 'typeorm';

// Durable progress for the batched account wipe (`POST /worker/users/:id/purge/step`).
// One row per deleted account, keyed by userId, no FK: the user row is removed last, and the
// admin status poll must keep answering afterwards. Without it a core restart mid-wipe loses
// the phase (the previous implementation kept progress in memory).
export class UserDeletes1794400000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "user_deletes" (
        "userId" uuid NOT NULL,
        "jobId" character varying(64) NOT NULL,
        "state" character varying(16) NOT NULL DEFAULT 'queued',
        "backupPrefix" character varying(512) NOT NULL DEFAULT '',
        "phase" character varying(16),
        "deletedRows" integer NOT NULL DEFAULT 0,
        "deletedFiles" integer NOT NULL DEFAULT 0,
        "failedFiles" integer NOT NULL DEFAULT 0,
        "error" text,
        "sessionsLocked" boolean NOT NULL DEFAULT false,
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_user_deletes" PRIMARY KEY ("userId")
      )`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "user_deletes"`);
  }
}
