import type { MigrationInterface, QueryRunner } from 'typeorm';

// Three unrelated column corrections that share one shape — an existing column with the wrong
// type — so they share one table-rewrite window and one review instead of three deploys.
//
// 1. `timestamp without time zone` → `timestamptz`. These six tables predate the convention;
//    every other instant in the schema is tz-aware. Both directions pin `AT TIME ZONE 'UTC'`
//    rather than trusting the migration session, because the stored wall clocks were written by
//    a driver that serializes a JS Date in the session zone and every deployment runs the
//    database in UTC. Verify before a first deploy on an unknown host: for one upload,
//    `assets."uploadedAt" - files."createdAt"` should be seconds, not hours.
// 2. `character(64)` → `varchar(64)` for the upload checksums: `char` pads to the fixed width, so
//    a shorter value would not compare equal to itself across tables.
// 3. `user_deletes` gains the audit fields it needs to stand on its own after the account row is
//    gone: the email at wipe time plus first-start and terminal timestamps. `startedAt` is a
//    plain column with a database default, not a CreateDateColumn, so a retry's upsert (which
//    resets the counters) keeps the first attempt's time.
//
// Locking: a type conversion rewrites its table under ACCESS EXCLUSIVE, and all of this is one
// transaction, so the pause is combined rather than four separate ones. That is tiny here (the
// largest tables are `files`/`faces`); split the timestamp group per table if those ever reach
// millions of rows.
const TIMESTAMP_COLUMNS: Record<string, string[]> = {
  // cheap first: their success is the pattern proof before the two big tables are rewritten
  app_settings: ['updatedAt'],
  refresh_tokens: ['createdAt'],
  persons: ['createdAt', 'updatedAt'],
  users: ['createdAt', 'updatedAt'],
  files: ['createdAt'],
  faces: ['createdAt'],
};

const CHECKSUM_COLUMNS: { table: string; column: string }[] = [
  { table: 'upload_sessions', column: 'checksumSha256' },
  { table: 'upload_session_parts', column: 'checksumSha256' },
];

export class ColumnHygiene1794700000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const [table, columns] of Object.entries(TIMESTAMP_COLUMNS)) {
      for (const column of columns) {
        await queryRunner.query(
          `ALTER TABLE "${table}" ALTER COLUMN "${column}" TYPE timestamptz
           USING "${column}" AT TIME ZONE 'UTC'`,
        );
      }
    }

    for (const { table, column } of CHECKSUM_COLUMNS) {
      await queryRunner.query(
        `ALTER TABLE "${table}" ALTER COLUMN "${column}" TYPE character varying(64)
         USING "${column}"::character varying(64)`,
      );
    }

    await queryRunner.query(`ALTER TABLE "user_deletes" ADD "email" character varying(255)`);
    await queryRunner.query(
      `ALTER TABLE "user_deletes" ADD "startedAt" timestamptz NOT NULL DEFAULT now()`,
    );
    // existing rows have only `updatedAt`; a wipe's last write is close enough to its start and
    // far better than stamping them all with the deploy time
    await queryRunner.query(`UPDATE "user_deletes" SET "startedAt" = "updatedAt"`);
    await queryRunner.query(`ALTER TABLE "user_deletes" ADD "finishedAt" timestamptz`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "user_deletes" DROP COLUMN "finishedAt"`);
    await queryRunner.query(`ALTER TABLE "user_deletes" DROP COLUMN "startedAt"`);
    await queryRunner.query(`ALTER TABLE "user_deletes" DROP COLUMN "email"`);

    for (const { table, column } of CHECKSUM_COLUMNS) {
      await queryRunner.query(
        `ALTER TABLE "${table}" ALTER COLUMN "${column}" TYPE character(64)
         USING "${column}"::character(64)`,
      );
    }

    // same zone as up(): any other choice makes the rollback shift every instant
    for (const [table, columns] of Object.entries(TIMESTAMP_COLUMNS)) {
      for (const column of columns) {
        await queryRunner.query(
          `ALTER TABLE "${table}" ALTER COLUMN "${column}" TYPE timestamp
           USING "${column}" AT TIME ZONE 'UTC'`,
        );
      }
    }
  }
}
