import type { MigrationInterface, QueryRunner } from 'typeorm';

// One identifier type for a user id. `faces`/`persons`/`refresh_tokens`/`upload_sessions`/
// `backup_runs` already store `uuid`; these four stored text, which costs ~20 bytes per row on
// `assets` (the largest table) and makes a `users` FK impossible — Postgres will not reference
// `uuid` from `text`. Expands first, because every foreign key in the next migration depends on
// the column type matching.
//
// PRECONDITION: every value must already be a valid uuid — these columns were only ever written
// from `users.id`. An empty-string or garbage row makes `"userId"::uuid` fail, which aborts this
// migration (the intended loud failure; run the audit queries in the PR description first).
// The table rewrite also rebuilds every index that carries `userId` (the covering
// `assets_layout_idx` is rebuilt in place when present).
//
// Takes ACCESS EXCLUSIVE on all four tables: run it in a maintenance window, with core and the
// worker stopped. Reversing is `::text`; the data is unchanged either way.
export class UserIdUuid1794600000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const table of ['files', 'albums', 'shares', 'assets']) {
      await queryRunner.query(
        `ALTER TABLE "${table}" ALTER COLUMN "userId" TYPE uuid USING "userId"::uuid`,
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const table of ['assets', 'shares', 'albums', 'files']) {
      await queryRunner.query(
        `ALTER TABLE "${table}" ALTER COLUMN "userId" TYPE character varying USING "userId"::text`,
      );
    }
  }
}
