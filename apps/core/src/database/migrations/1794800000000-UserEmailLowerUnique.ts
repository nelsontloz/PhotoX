import type { MigrationInterface, QueryRunner } from 'typeorm';

// `users.email` only had a case-sensitive unique constraint, while registration/login/admin all
// compare `LOWER(email)` — the check-then-insert in auth.service could therefore race two
// accounts onto one normalized address (`Bob@x.com` + `bob@x.com`), and every such read was a
// sequential scan. The functional unique index is the DB-level answer to both.
//
// The entity declares only the plain column, so this index exists in the migrations and not in
// the `synchronize` schema: schema-parity skips expression indexes (`indkey` has no attribute
// for them), which is why no entity annotation is needed.
//
// A deployment that already carries a case-duplicate pair fails this index build — deliberate,
// the boot stops instead of picking one of the two accounts. Resolve the duplicate, then boot.
// The build is not CONCURRENTLY (it runs inside the migration transaction and takes the table's
// write lock): fine for a users table of this size, and it matches the other index migrations.
export class UserEmailLowerUnique1794800000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_users_email_lower" ON "users" (LOWER("email"))`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "public"."UQ_users_email_lower"`);
  }
}
