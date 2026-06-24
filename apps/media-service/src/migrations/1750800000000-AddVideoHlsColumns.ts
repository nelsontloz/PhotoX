import { type MigrationInterface, type QueryRunner } from 'typeorm'

export class AddVideoHlsColumns1750800000000 implements MigrationInterface {
  name = 'AddVideoHlsColumns1750800000000'

  async up(qr: QueryRunner): Promise<void> {
    await qr.query(`ALTER TABLE assets ADD COLUMN "hlsMasterKey" text NULL`)
    await qr.query(
      `ALTER TABLE assets ADD COLUMN "transcodeStatus" varchar(16) NOT NULL DEFAULT 'pending'`,
    )
    await qr.query(`ALTER TABLE assets ADD COLUMN "transcodedAt" timestamptz NULL`)
  }

  async down(qr: QueryRunner): Promise<void> {
    await qr.query(`ALTER TABLE assets DROP COLUMN "transcodedAt"`)
    await qr.query(`ALTER TABLE assets DROP COLUMN "transcodeStatus"`)
    await qr.query(`ALTER TABLE assets DROP COLUMN "hlsMasterKey"`)
  }
}
