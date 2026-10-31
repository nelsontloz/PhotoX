import type { MigrationInterface, QueryRunner } from 'typeorm';

// `upload_sessions.mimeHint` was never written or read (the MIME type comes from the assembled
// original on complete), so drop the dead column.
export class DropUploadSessionMimeHint1793900000001 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "upload_sessions" DROP COLUMN "mimeHint"`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "upload_sessions" ADD "mimeHint" character varying`);
  }
}
