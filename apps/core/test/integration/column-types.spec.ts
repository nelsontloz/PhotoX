import { closeTestApp, createApiTestApp, resetDb, seedFile, seedUser } from './helpers';
import type { ApiTestApp } from './helpers';

describe('column types', () => {
  let t: ApiTestApp;

  beforeAll(async () => {
    t = await createApiTestApp({ mockUser: null });
  }, 120_000);

  afterAll(async () => {
    await closeTestApp(t);
  });

  beforeEach(async () => {
    await resetDb(t);
  });

  it('stores every converted timestamp as timestamptz', async () => {
    const rows: { table_name: string; column_name: string; data_type: string }[] =
      await t.dataSource.query(
        `SELECT table_name, column_name, data_type
           FROM information_schema.columns
          WHERE table_schema = 'public'`,
      );
    const types = new Map(rows.map((r) => [`${r.table_name}.${r.column_name}`, r.data_type]));

    for (const key of [
      'app_settings.updatedAt',
      'refresh_tokens.createdAt',
      'users.createdAt',
      'users.updatedAt',
      'persons.createdAt',
      'persons.updatedAt',
      'files.createdAt',
      'faces.createdAt',
    ]) {
      expect(`${key}=${types.get(key)}`).toBe(`${key}=timestamp with time zone`);
    }
  });

  // The regression the conversion fixes: a naive `timestamp` is promoted to an instant using the
  // *session* zone when compared with a `timestamptz`, so the same comparison answered differently
  // in a UTC session than in a +14 one. With `timestamptz` the answer is offset-independent.
  it('compares timestamps as instants, not wall clocks', async () => {
    const instant = '2024-03-01T12:00:00Z';
    const runner = t.dataSource.createQueryRunner();
    await runner.connect();
    try {
      await runner.query(`SET TIME ZONE 'Pacific/Kiritimati'`); // UTC+14, no DST
      await runner.query(
        `INSERT INTO users (id, email, role, "passwordHash", "displayName", "createdAt", "updatedAt")
         VALUES (gen_random_uuid(), 'tz@example.com', 'user', 'x', 'tz', $1::timestamptz, $1::timestamptz)`,
        [instant],
      );

      const [row] = (await runner.query(
        `SELECT ("createdAt" = $1::timestamptz) AS same, extract(epoch FROM "createdAt") AS epoch
           FROM users WHERE email = 'tz@example.com'`,
        [instant],
      )) as { same: boolean; epoch: string }[];

      expect(row?.same).toBe(true);
      expect(Number(row?.epoch)).toBe(Date.parse(instant) / 1000);
    } finally {
      // the runner goes back to the shared pool: leave the session zone as we found it
      await runner.query(`RESET TimeZone`);
      await runner.release();
    }
  });

  // `bigint` comes back as a string from pg unless an entity transformer narrows it; the entity
  // declares `number`, so a stale string is a silent comparison bug waiting for the next caller.
  it('hydrates bigint columns as numbers', async () => {
    const user = await seedUser(t);
    const file = await seedFile(t, user.id);
    const large = 2 ** 40; // above a 32-bit int, still exact as a JS number
    await t.dataSource.query(`UPDATE files SET "sizeBytes" = $1 WHERE id = $2`, [large, file.id]);

    const read = await t.fileRepo.findOneOrFail({ where: { id: file.id } });
    expect(typeof read.sizeBytes).toBe('number');
    expect(read.sizeBytes).toBe(large);
  });
});
