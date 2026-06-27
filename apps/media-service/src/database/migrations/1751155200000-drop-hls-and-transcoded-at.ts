import { MigrationInterface, QueryRunner } from 'typeorm'

export class DropHlsAndTranscodedAt1751155200000 implements MigrationInterface {
  name = '1751155200000-drop-hls-and-transcoded-at'

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE assets DROP COLUMN IF EXISTS "hlsMasterKey"`)
    await queryRunner.query(`ALTER TABLE assets DROP COLUMN IF EXISTS "transcodedAt"`)
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE assets ADD COLUMN IF NOT EXISTS "hlsMasterKey" text`)
    await queryRunner.query(
      `ALTER TABLE assets ADD COLUMN IF NOT EXISTS "transcodedAt" TIMESTAMPTZ`,
    )
  }
}
