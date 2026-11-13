import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { ENTITIES } from './entities';
import { setupTestInfra, teardownTestInfra, type TestInfra } from './test-setup';

/**
 * The constraints in `ReferentialIntegrity1794600000001`, asserted at the database rather than
 * through a service: the point of the migration is that a code path which forgets to clean up
 * fails loudly. Each test drives raw SQL so it proves the schema, not the service layer.
 */
describe('referential integrity', () => {
  let infra: TestInfra;
  let ds: DataSource;

  async function seedUser(): Promise<string> {
    const id = randomUUID();
    await ds.query(
      `INSERT INTO users (id, email, role, "passwordHash", "displayName")
       VALUES ($1, $2, 'user', 'x', 'x')`,
      [id, `${id}@example.com`],
    );
    return id;
  }

  async function seedFile(
    userId: string,
    extra: { assetId?: string | null } = {},
  ): Promise<string> {
    const id = randomUUID();
    await ds.query(
      `INSERT INTO files (id, "userId", "storageKey", "originalName", "mimeType", "sizeBytes",
                          "checksumSha256", purpose, "assetId")
       VALUES ($1, $2, $3, 'a.jpg', 'image/jpeg', 1, $4, 'original', $5)`,
      [
        id,
        userId,
        `originals/${userId}/${id}.jpg`,
        randomUUID().replace(/-/g, ''),
        extra.assetId ?? null,
      ],
    );
    return id;
  }

  async function seedAsset(
    userId: string,
    fileId: string,
    extra: { transcodeFileId?: string } = {},
  ) {
    const id = randomUUID();
    await ds.query(
      `INSERT INTO assets (id, "userId", kind, "fileId", "transcodeFileId")
       VALUES ($1, $2, 'photo', $3, $4)`,
      [id, userId, fileId, extra.transcodeFileId ?? null],
    );
    return id;
  }

  async function count(table: string, where: string, params: unknown[]): Promise<number> {
    const rows: { n: string }[] = await ds.query(
      `SELECT COUNT(*) AS n FROM ${table} WHERE ${where}`,
      params,
    );
    return Number(rows[0]!.n);
  }

  /** Postgres FK violation, whichever shape the driver error surfaces in. */
  async function expectFkViolation(promise: Promise<unknown>): Promise<void> {
    const err = await promise.then(
      () => null,
      (error: unknown) => error as { code?: string; driverError?: { code?: string } },
    );
    expect(err).not.toBeNull();
    expect(err?.code ?? err?.driverError?.code).toBe('23503');
  }

  beforeAll(async () => {
    infra = await setupTestInfra();
    ds = new DataSource({
      type: 'postgres',
      host: infra.pgHost,
      port: infra.pgPort,
      username: 'photox',
      password: 'photox',
      database: infra.pgDb,
      entities: ENTITIES,
      synchronize: false,
    });
    await ds.initialize();
  }, 120_000);

  afterAll(async () => {
    await ds?.destroy();
    await teardownTestInfra();
  });

  beforeEach(async () => {
    // one statement: FK CASCADE truncates every table that references users
    await ds.query('TRUNCATE TABLE users CASCADE');
  });

  it('removes an asset’s children and detaches its files when the asset row goes', async () => {
    const userId = await seedUser();
    const fileId = await seedFile(userId);
    const thumbFileId = await seedFile(userId);
    const assetId = await seedAsset(userId, fileId);
    // the file -> asset link the restore path writes
    await ds.query('UPDATE files SET "assetId" = $1 WHERE id = $2', [assetId, fileId]);
    await ds.query(
      `INSERT INTO faces (id, "assetId", "userId", box, confidence, embedding)
       VALUES ($1, $2, $3, '{"x":0,"y":0,"w":1,"h":1}', 0.9, '[]')`,
      [randomUUID(), assetId, userId],
    );
    await ds.query(
      `INSERT INTO asset_thumbnails (id, "assetId", size, "fileId", width, height, bytes)
       VALUES ($1, $2, 'thumb', $3, 1, 1, 1)`,
      [randomUUID(), assetId, thumbFileId],
    );
    const albumId = randomUUID();
    await ds.query(`INSERT INTO albums (id, "userId", name) VALUES ($1, $2, 'a')`, [
      albumId,
      userId,
    ]);
    await ds.query('INSERT INTO album_assets ("albumId", "assetId") VALUES ($1, $2)', [
      albumId,
      assetId,
    ]);
    await ds.query(
      `INSERT INTO shares (id, "userId", kind, "assetId", token)
       VALUES ($1, $2, 'asset', $3, $4)`,
      [randomUUID(), userId, assetId, randomUUID().replace(/-/g, '')],
    );

    await ds.query('DELETE FROM assets WHERE id = $1', [assetId]);

    expect(await count('faces', '"assetId" = $1', [assetId])).toBe(0);
    expect(await count('asset_thumbnails', '"assetId" = $1', [assetId])).toBe(0);
    expect(await count('album_assets', '"assetId" = $1', [assetId])).toBe(0);
    expect(await count('shares', '"assetId" = $1', [assetId])).toBe(0);
    const files: { assetId: string | null }[] = await ds.query(
      'SELECT "assetId" FROM files WHERE id = $1',
      [fileId],
    );
    expect(files[0]!.assetId).toBeNull();
  });

  it('refuses to delete bytes that a live asset still points at', async () => {
    const userId = await seedUser();
    const fileId = await seedFile(userId);
    await seedAsset(userId, fileId);

    await expectFkViolation(ds.query('DELETE FROM files WHERE id = $1', [fileId]));
  });

  it('nulls the covering face and the person link instead of dangling', async () => {
    const userId = await seedUser();
    const fileId = await seedFile(userId);
    const assetId = await seedAsset(userId, fileId);
    const personId = randomUUID();
    const faceId = randomUUID();
    await ds.query(`INSERT INTO persons (id, "userId") VALUES ($1, $2)`, [personId, userId]);
    await ds.query(
      `INSERT INTO faces (id, "assetId", "userId", box, confidence, embedding, "personId")
       VALUES ($1, $2, $3, '{"x":0,"y":0,"w":1,"h":1}', 0.9, '[]', $4)`,
      [faceId, assetId, userId, personId],
    );
    await ds.query('UPDATE persons SET "coverFaceId" = $1 WHERE id = $2', [faceId, personId]);

    await ds.query('DELETE FROM faces WHERE id = $1', [faceId]);
    const person: { coverFaceId: string | null }[] = await ds.query(
      'SELECT "coverFaceId" FROM persons WHERE id = $1',
      [personId],
    );
    expect(person[0]!.coverFaceId).toBeNull();

    const secondFace = randomUUID();
    await ds.query(
      `INSERT INTO faces (id, "assetId", "userId", box, confidence, embedding, "personId")
       VALUES ($1, $2, $3, '{"x":0,"y":0,"w":1,"h":1}', 0.9, '[]', $4)`,
      [secondFace, assetId, userId, personId],
    );
    await ds.query('DELETE FROM persons WHERE id = $1', [personId]);
    const face: { personId: string | null }[] = await ds.query(
      'SELECT "personId" FROM faces WHERE id = $1',
      [secondFace],
    );
    expect(face[0]!.personId).toBeNull();
  });

  it('refuses to delete an account that still owns rows, and allows it once they are gone', async () => {
    const userId = await seedUser();
    await ds.query(
      `INSERT INTO refresh_tokens (id, "userId", "tokenHash", "expiresAt")
       VALUES ($1, $2, $3, now() + interval '1 hour')`,
      [randomUUID(), userId, randomUUID()],
    );

    await expectFkViolation(ds.query('DELETE FROM users WHERE id = $1', [userId]));

    await ds.query('DELETE FROM refresh_tokens WHERE "userId" = $1', [userId]);
    await ds.query('DELETE FROM users WHERE id = $1', [userId]);
    expect(await count('users', 'id = $1', [userId])).toBe(0);
  });

  // The restore/merge insert order: the asset does not exist yet when the file is written.
  it('accepts a forward file->asset link inside one transaction and rejects it at commit when the asset never lands', async () => {
    const userId = await seedUser();
    const assetId = randomUUID();
    const fileId = randomUUID();
    const thumbFileId = randomUUID();
    // assets.fileId is immediate, so the referenced file must already exist — exactly the
    // order the restore path uses (files first, assets second).
    await ds.query(
      `INSERT INTO files (id, "userId", "storageKey", "originalName", "mimeType", "sizeBytes",
                          "checksumSha256", purpose)
       VALUES ($1, $2, 'originals/x', 'a.jpg', 'image/jpeg', 1, $3, 'original')`,
      [thumbFileId, userId, randomUUID().replace(/-/g, '')],
    );

    const qr = ds.createQueryRunner();
    await qr.connect();
    await qr.startTransaction();
    await qr.query(
      `INSERT INTO files (id, "userId", "storageKey", "originalName", "mimeType", "sizeBytes",
                          "checksumSha256", purpose, "assetId")
       VALUES ($1, $2, 'originals/y', 'b.jpg', 'image/jpeg', 1, $3, 'original', $4)`,
      [fileId, userId, randomUUID().replace(/-/g, ''), assetId],
    );
    await qr.query(
      `INSERT INTO assets (id, "userId", kind, "fileId") VALUES ($1, $2, 'photo', $3)`,
      [assetId, userId, fileId],
    );
    await qr.commitTransaction();
    await qr.release();
    expect(await count('assets', '"fileId" = $1', [fileId])).toBe(1);

    const dangling = ds.createQueryRunner();
    await dangling.connect();
    await dangling.startTransaction();
    await dangling.query(
      `INSERT INTO files (id, "userId", "storageKey", "originalName", "mimeType", "sizeBytes",
                          "checksumSha256", purpose, "assetId")
       VALUES ($1, $2, 'originals/z', 'c.jpg', 'image/jpeg', 1, $3, 'original', $4)`,
      [randomUUID(), userId, randomUUID().replace(/-/g, ''), randomUUID()],
    );
    await expectFkViolation(dangling.commitTransaction());
    if (dangling.isTransactionActive) await dangling.rollbackTransaction();
    await dangling.release();
  });
});
