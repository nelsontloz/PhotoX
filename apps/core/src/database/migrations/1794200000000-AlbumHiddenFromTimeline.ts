import type { MigrationInterface, QueryRunner } from 'typeorm';

// Per-album "hidden from timeline": assets in a flagged album leave the timeline, nothing is
// deleted. The default backfills every existing album to false (synchronize-era dev DBs get the
// same column from the entity).
export class AlbumHiddenFromTimeline1794200000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "albums" ADD "hiddenFromTimeline" boolean NOT NULL DEFAULT false`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "albums" DROP COLUMN "hiddenFromTimeline"`);
  }
}
