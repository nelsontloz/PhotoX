import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import sharp from 'sharp';
import { BullMqService } from '../../src/queue/bullmq.service';
import { TEST_WORKER_SECRET } from './test-setup';
import {
  apiServer,
  closeTestApp,
  createApiTestApp,
  resetDb,
  seedAsset,
  seedFile,
  seedUser,
} from './helpers';
import type { ApiTestApp } from './helpers';

// Fails-first suite for the open audit findings (red until each fix lands). Each test names the
// behavior the fix must produce, so it doubles as the acceptance check when the fix is written.
//
// Covered: job-binding holes (#4), assembly cleanup (#6), quota counting thumbnails (#7), orphan
// sweep deleting the GeoNames cache (#9), malformed path ids (#15), case-sensitive login (#16).
// Already green: the rejected-upload temp cleanup (#5) — Nest 12's FileInterceptor removes the
// file when a pipe rejects — kept as a regression guard.
// Restore mid-download failure (#2) is covered by master's per-file transfer ledger
// (`backup-transfer` queues and the "resumes a failed restore" test in user-backup.spec.ts).
// Deliberately not here: the 65k-parameter batching (#8) and the worker-internal bugs (#10-#12)
// are not reachable from an HTTP/DB integration test.

const QUOTA_BYTES = 1024 * 1024;
process.env.STORAGE_QUOTA_BYTES = String(QUOTA_BYTES);

const PASSWORD = 'correcthorsebattery';
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function jobSig(sub: string, scope: string): string {
  return createHmac('sha256', TEST_WORKER_SECRET).update(`${sub}:${scope}`).digest('hex');
}

describe('open audit findings (fails first)', () => {
  let t: ApiTestApp;

  beforeAll(async () => {
    t = await createApiTestApp({ mockUser: null });
  }, 120_000);

  afterAll(async () => {
    await closeTestApp(t);
  });

  beforeEach(async () => {
    await resetDb(t);
    await t.app.get(BullMqService).redis.flushdb();
  });

  function authFor(user: {
    id: string;
    email: string;
    role: 'user' | 'admin';
  }): Record<string, string> {
    return t.authHeader(t.signToken({ id: user.id, email: user.email, role: user.role }));
  }

  async function seedVictim() {
    const user = await seedUser(t);
    const file = await seedFile(t, user.id);
    const asset = await seedAsset(t, user.id, file.id);
    return { user, file, asset };
  }

  function workerToken(user: { id: string; email: string; role: 'user' | 'admin' }) {
    return t.signWorkerToken({ id: user.id, email: user.email, role: user.role }, { act: true });
  }

  describe('#4 job binding', () => {
    it('an asset-scoped signature cannot purge the account through X-Job-Scope', async () => {
      const { user, asset } = await seedVictim();
      const res = await request(apiServer(t))
        .post(`/worker/users/${user.id}/purge`)
        .set(t.authHeader(workerToken(user)))
        .set('X-Job-Signature', jobSig(user.id, asset.id))
        .set('X-Job-Scope', asset.id)
        .send({ backupPrefix: 'backups/x/' });
      expect(res.status).toBe(403);
    });

    it('a user-secret act token (a renewed cookie) still needs a job signature', async () => {
      const { user } = await seedVictim();
      const renewed = t.signToken(
        { id: user.id, email: user.email, role: user.role },
        { act: true },
      );
      const res = await request(apiServer(t))
        .post(`/worker/users/${user.id}/purge`)
        .set(t.authHeader(renewed))
        .send({ backupPrefix: 'backups/x/' });
      expect(res.status).toBe(403);
    });

    it('an act token in the access cookie is never re-signed with the user secret', async () => {
      const { user, asset } = await seedVictim();
      const jwt = new JwtService({
        secret: TEST_WORKER_SECRET,
        signOptions: { algorithm: 'HS256' },
      });
      const now = Math.floor(Date.now() / 1000);
      const token = jwt.sign({
        sub: user.id,
        email: user.email,
        role: user.role,
        act: { sub: 'worker-service' },
        // past half of a 30-minute ttl: the sliding re-mint window
        iat: now - 1200,
        exp: now + 600,
      });

      const res = await request(apiServer(t))
        .get(`/api/v1/assets?ids=${asset.id}`)
        .set('Cookie', `photox_access=${token}`);

      expect(res.status).toBe(200);
      expect(res.headers['set-cookie']).toBeUndefined();
    });
  });

  describe('#15 malformed path ids', () => {
    it('reads as 404, not a Postgres uuid-cast 500', async () => {
      const user = await seedUser(t);
      const headers = authFor(user);
      for (const path of [
        '/api/v1/assets/not-a-uuid',
        '/api/v1/albums/not-a-uuid',
        '/api/v1/persons/not-a-uuid',
      ]) {
        const res = await request(apiServer(t)).get(path).set(headers);
        expect(res.status, path).toBe(404);
      }
    });
  });

  describe('#16 email identity', () => {
    it('login accepts the same address in a different case', async () => {
      const registered = await request(apiServer(t)).post('/api/v1/auth/register').send({
        email: 'Bob@Example.com',
        password: PASSWORD,
        displayName: 'Bob',
      });
      expect(registered.status).toBe(201);

      const login = await request(apiServer(t)).post('/api/v1/auth/login').send({
        email: 'bob@example.com',
        password: PASSWORD,
      });
      expect(login.status).toBe(200);
    });
  });

  describe('#5 multipart temp files', () => {
    it('a rejected upload leaves no file behind in tmpdir', async () => {
      const user = await seedUser(t);
      const marker = `photox-temp-leak-${randomUUID()}`;
      const bytes = Buffer.concat([PNG_MAGIC, Buffer.from(marker), Buffer.alloc(256, 0x41)]);

      const res = await request(apiServer(t))
        .post('/api/v1/files')
        .set(authFor(user))
        .field('takenAt', 'not-a-date')
        .attach('file', bytes, 'leak.png');
      expect(res.status).toBe(400);

      // the marker makes the search immune to temp files other spec files write in parallel
      const leftovers: string[] = [];
      for (const name of await readdir(tmpdir())) {
        const path = join(tmpdir(), name);
        try {
          const entry = await stat(path);
          if (!entry.isFile() || entry.size > 1024 * 1024) continue;
          if ((await readFile(path)).includes(marker)) leftovers.push(path);
        } catch {
          // vanished between readdir and stat (another test's cleanup)
        }
      }
      expect(leftovers).toEqual([]);
      for (const path of leftovers) await rm(path, { force: true });
    });
  });

  describe('#7 storage quota', () => {
    it('does not count derivative thumbnails as original bytes', async () => {
      const user = await seedUser(t);
      await t.fileRepo.save(
        t.fileRepo.create({
          userId: user.id,
          // a thumbnail FileRecord (purpose='original' by design) — must not consume quota
          storageKey: `derivatives/thumbnails/${user.id}/${randomUUID()}.webp`,
          originalName: 'thumb.webp',
          mimeType: 'image/webp',
          sizeBytes: QUOTA_BYTES - 1024,
          checksumSha256: randomUUID().replace(/-/g, '').padEnd(64, 'f'),
          purpose: 'original',
          assetId: null,
        }),
      );
      const png = await sharp(randomBytes(128 * 128 * 3), {
        raw: { width: 128, height: 128, channels: 3 },
      })
        .png()
        .toBuffer();
      expect(png.length).toBeGreaterThan(1024);

      const res = await request(apiServer(t))
        .post('/api/v1/files')
        .set(authFor(user))
        .attach('file', png, 'quota.png');
      expect(res.status).toBe(201);
    });
  });

  describe('#9 orphan sweep', () => {
    it('keeps the GeoNames cache under STORAGE_DIR/geo', async () => {
      const admin = await seedUser(t, { role: 'admin' });
      const geoDir = join(t.storageDir, 'geo');
      await mkdir(geoDir, { recursive: true });
      await writeFile(join(geoDir, 'geonames.zip'), 'cached-download');

      const res = await request(apiServer(t))
        .post('/api/v1/admin/cleanup-orphans/run')
        .set(authFor(admin));
      expect(res.status).toBe(200);
      expect(existsSync(join(geoDir, 'geonames.zip'))).toBe(true);
    });
  });

  describe('#6 upload assembly', () => {
    it('removes the partial assembled file when a part is missing', async () => {
      const user = await seedUser(t);
      const headers = authFor(user);
      const bytes = Buffer.concat([PNG_MAGIC, Buffer.alloc(1024, 0x42)]);

      const created = await request(apiServer(t))
        .post('/api/v1/uploads')
        .set(headers)
        .send({ sizeBytes: bytes.length, originalName: 'x.png' });
      expect(created.status).toBe(201);
      const uploadId = (created.body as { uploadId: string }).uploadId;

      await request(apiServer(t))
        .put(`/api/v1/uploads/${uploadId}/parts/0`)
        .set(headers)
        .set('Content-Type', 'application/octet-stream')
        .send(bytes)
        .expect(204);

      const sessionDir = join(t.storageDir, 'upload-sessions', user.id, uploadId);
      // simulate a crash between the part row write and the part file write
      await rm(join(sessionDir, 'part-0'), { force: true });

      const complete = await request(apiServer(t))
        .post(`/api/v1/uploads/${uploadId}/complete`)
        .set(headers);
      expect(complete.status).toBeGreaterThanOrEqual(500);

      const names = await readdir(sessionDir);
      expect(names.filter((name) => name.startsWith('assembled-'))).toEqual([]);
    });
  });
});
