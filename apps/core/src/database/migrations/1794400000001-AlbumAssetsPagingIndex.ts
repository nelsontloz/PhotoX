import type { MigrationInterface, QueryRunner } from 'typeorm';

// Album asset pages are keyset-ordered by ("addedAt", "assetId") within an album; without this
// index every page sorts the whole album. Matches the entity's composite @Index.
export class AlbumAssetsPagingIndex1794400000001 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE INDEX "IDX_album_assets_album_added" ON "album_assets" ("albumId", "addedAt", "assetId")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_album_assets_album_added"`);
  }
}
