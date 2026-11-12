import type { MigrationInterface, QueryRunner } from 'typeorm';

// `PersonsService.list` used to count every live face of the user per page just to sort by it; it
// now orders by the maintained `persons.faceCount` column, and this index serves that ORDER BY.
// Name is explicit so it never collides with TypeORM's generated name for the entity's @Index.
export class PersonsFaceCountIndex1794450000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE INDEX "IDX_persons_userId_faceCount" ON "persons" ("userId", "faceCount")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_persons_userId_faceCount"`);
  }
}
