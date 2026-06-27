import { MigrationInterface, QueryRunner } from 'typeorm'

export class AddTranscodeFileId1751155200001 implements MigrationInterface {
  name = '1751155200001-add-transcode-file-id'

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE assets ADD COLUMN "transcodeFileId" uuid NULL`)
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE assets DROP COLUMN "transcodeFileId"`)
  }
}
