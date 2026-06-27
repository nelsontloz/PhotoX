import { MigrationInterface, QueryRunner } from 'typeorm'

export class AddPurposeAndAssetId1751155200001 implements MigrationInterface {
  name = '1751155200001-add-purpose-and-asset-id'

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE files ADD COLUMN "purpose" varchar(16) NOT NULL DEFAULT 'original'`,
    )
    await queryRunner.query(`ALTER TABLE files ADD COLUMN "assetId" uuid NULL`)
    await queryRunner.query(
      `CREATE INDEX "IDX_files_assetId" ON files ("assetId") WHERE "assetId" IS NOT NULL`,
    )
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_files_assetId"`)
    await queryRunner.query(`ALTER TABLE files DROP COLUMN "assetId"`)
    await queryRunner.query(`ALTER TABLE files DROP COLUMN "purpose"`)
  }
}
