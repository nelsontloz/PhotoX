// ponytail: no migrator in dev — synchronize: true — keep this file for prod parity
import { MigrationInterface, QueryRunner } from 'typeorm'

export class AddAlbums20260629174112 implements MigrationInterface {
  name = 'AddAlbums20260629174112'

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "albums" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "userId" uuid NOT NULL,
        "name" varchar(255) NOT NULL,
        "description" varchar(2000),
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_albums_id" PRIMARY KEY ("id")
      )
    `)
    await queryRunner.query(`CREATE INDEX "IDX_albums_userId" ON "albums" ("userId")`)

    await queryRunner.query(`
      CREATE TABLE "album_assets" (
        "albumId" uuid NOT NULL,
        "assetId" uuid NOT NULL,
        "addedAt" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_album_assets" PRIMARY KEY ("albumId", "assetId"),
        CONSTRAINT "FK_album_assets_album" FOREIGN KEY ("albumId")
          REFERENCES "albums"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_album_assets_asset" FOREIGN KEY ("assetId")
          REFERENCES "assets"("id") ON DELETE CASCADE
      )
    `)
    await queryRunner.query(`CREATE INDEX "IDX_album_assets_assetId" ON "album_assets" ("assetId")`)
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "album_assets"`)
    await queryRunner.query(`DROP TABLE "albums"`)
  }
}
