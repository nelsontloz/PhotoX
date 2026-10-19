import type { MigrationInterface, QueryRunner } from 'typeorm'

// Resumable chunked upload sessions (`api/v1/uploads`): one `upload_sessions` row per session,
// one `upload_session_parts` row per received 8 MiB chunk (PK sessionId+partIndex, FK CASCADE so
// deleting a session removes its parts). SQL generated from the entity metadata via the TypeORM
// schema-builder log (fresh pgvector DB, synchronize off) — keep in sync with the entities.
export class UploadSessions1792364530809 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "upload_sessions" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "userId" uuid NOT NULL, "status" character varying(16) NOT NULL DEFAULT 'pending', "chunkSizeBytes" integer NOT NULL, "totalParts" integer NOT NULL, "expectedSizeBytes" bigint NOT NULL, "checksumSha256" character(64), "originalName" text NOT NULL, "mimeHint" character varying, "title" character varying(255), "description" text, "takenAt" TIMESTAMP WITH TIME ZONE, "expiresAt" TIMESTAMP WITH TIME ZONE NOT NULL, "completedFileId" uuid, "completedAssetId" uuid, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_4b6ca30b8bb2baa0de9c6bf8fea" PRIMARY KEY ("id"))`,
    )
    await queryRunner.query(
      `CREATE INDEX "IDX_b1d795c02f8d2dda4940b4e25f" ON "upload_sessions" ("userId") `,
    )
    await queryRunner.query(
      `CREATE INDEX "IDX_d213e02fbc51020df74b0d950c" ON "upload_sessions" ("expiresAt") `,
    )
    await queryRunner.query(
      `CREATE TABLE "upload_session_parts" ("sessionId" uuid NOT NULL, "partIndex" integer NOT NULL, "sizeBytes" integer NOT NULL, "checksumSha256" character(64), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_6d2410d183f16f5e03b5adc40b1" PRIMARY KEY ("sessionId", "partIndex"))`,
    )
    await queryRunner.query(
      `ALTER TABLE "upload_session_parts" ADD CONSTRAINT "FK_225b5f6472cc6ff106d872dc315" FOREIGN KEY ("sessionId") REFERENCES "upload_sessions"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    )
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "upload_session_parts" DROP CONSTRAINT "FK_225b5f6472cc6ff106d872dc315"`,
    )
    await queryRunner.query(`DROP INDEX "public"."IDX_b1d795c02f8d2dda4940b4e25f"`)
    await queryRunner.query(`DROP INDEX "public"."IDX_d213e02fbc51020df74b0d950c"`)
    await queryRunner.query(`DROP TABLE "upload_session_parts"`)
    await queryRunner.query(`DROP TABLE "upload_sessions"`)
  }
}
