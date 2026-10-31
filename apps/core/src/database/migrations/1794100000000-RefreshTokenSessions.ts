import type { MigrationInterface, QueryRunner } from 'typeorm';

// Per-device sessions: every refresh token row gains a `sessionId` that survives rotation, so
// logout / reuse detection can delete one device's chain instead of the user's whole set. The
// default evaluates per row, so each existing live row becomes its own session (and a
// populated dev table can take the column through `synchronize` too).
export class RefreshTokenSessions1794100000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "refresh_tokens" ADD "sessionId" uuid NOT NULL DEFAULT uuid_generate_v4()`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_refresh_tokens_sessionId" ON "refresh_tokens" ("sessionId")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_refresh_tokens_sessionId"`);
    await queryRunner.query(`ALTER TABLE "refresh_tokens" DROP COLUMN "sessionId"`);
  }
}
