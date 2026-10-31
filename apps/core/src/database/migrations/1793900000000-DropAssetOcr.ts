import type { MigrationInterface, QueryRunner } from 'typeorm';

// The OCR (text-extraction) pipeline is gone: drop its table. The single row per asset was
// regenerable from the original bytes, so nothing here is worth preserving.
export class DropAssetOcr1793900000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // the incoming FK on asset_ocr goes with the table; naming it would break on a
    // synchronize-era database whose constraint name was generated differently
    await queryRunner.query(`DROP TABLE "asset_ocr"`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "asset_ocr" ("assetId" uuid NOT NULL, "text" text NOT NULL, "lang" text, "confidence" real, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_dc592ec504976f5636e28bb84c6" PRIMARY KEY ("assetId"))`,
    );
    await queryRunner.query(
      `ALTER TABLE "asset_ocr" ADD CONSTRAINT "FK_dc592ec504976f5636e28bb84c6" FOREIGN KEY ("assetId") REFERENCES "assets"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }
}
