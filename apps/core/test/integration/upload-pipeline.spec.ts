import request from 'supertest';
import sharp from 'sharp';
import { closeTestApp, createApiTestApp, resetDb, seedFile, seedUser, apiServer } from './helpers';
import type { ApiTestApp } from './helpers';

// ponytail red test for h2-storage-compute-quota: no per-user quota exists yet, and the key is not
// in packages/shared-config/src/env.ts — STORAGE_QUOTA_BYTES is the proposed name (Gate1 cuts:
// env/const quota, original-only, AFTER dedup, compare used+size>quota). Set BEFORE
// createApiTestApp so an init-time loadEnv() read picks it up; a per-request process.env read
// sees it too. 1 MiB keeps every other single-upload test in this file under quota while the
// quota tests prefill near the ceiling via seedFile (direct DB insert, bypasses the guard).
const STORAGE_QUOTA_BYTES = 1024 * 1024;
process.env.STORAGE_QUOTA_BYTES = String(STORAGE_QUOTA_BYTES);

async function pngBytes(): Promise<Buffer> {
  return sharp({ create: { width: 64, height: 64, channels: 3, background: 'red' } })
    .png()
    .toBuffer();
}

async function waitForJobId(
  t: ApiTestApp,
  queueName: string,
  jobId: string,
  timeoutMs = 10_000,
): Promise<boolean> {
  const start = Date.now();
  const queue = t.getQueue(queueName);
  while (Date.now() - start < timeoutMs) {
    const job = await queue.getJob(jobId);
    if (job) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  return false;
}

async function waitForJobWithAsset(
  t: ApiTestApp,
  queueName: string,
  assetId: string,
  timeoutMs = 10_000,
): Promise<boolean> {
  const start = Date.now();
  const queue = t.getQueue(queueName);
  while (Date.now() - start < timeoutMs) {
    const jobs = await queue.getJobs(['waiting', 'active', 'delayed']);
    if (jobs.some((j) => (j.data as { assetId?: string }).assetId === assetId)) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  return false;
}

describe('upload pipeline', () => {
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

  it('uploads photo, creates rows and enqueues jobs', async () => {
    const user = await seedUser(t);
    const token = t.signToken({ id: user.id, email: user.email, role: user.role });
    const bytes = await pngBytes();
    const res = await request(apiServer(t))
      .post('/api/v1/files')
      .set(t.authHeader(token))
      .attach('file', bytes, 'photo.png')
      .field('kind', 'photo');
    expect(res.status).toBe(201);
    const asset = res.body as unknown as { id: string; fileId: string; kind: string };
    expect(asset.kind).toBe('photo');
    const fileRow = await t.fileRepo.findOne({ where: { id: asset.fileId } });
    expect(fileRow).toBeTruthy();
    const assetRow = await t.assetRepo.findOne({ where: { id: asset.id } });
    expect(assetRow).toBeTruthy();
    for (const size of ['sm', 'md', 'lg', 'xl']) {
      expect(await waitForJobId(t, 'process-thumbnail', `thumb-${asset.id}-${size}`)).toBe(true);
    }
    expect(await waitForJobWithAsset(t, 'process-metadata', asset.id)).toBe(true);
    expect(await waitForJobWithAsset(t, 'process-faces', asset.id)).toBe(true);
  });

  it('uploads video with a real mp4 header and enqueues video job', async () => {
    const user = await seedUser(t);
    const token = t.signToken({ id: user.id, email: user.email, role: user.role });
    // minimal ftyp header — magic-byte sniffing rejects arbitrary bytes
    const mp4Header = Buffer.from('000000186674797069736f6d', 'hex');
    const res = await request(apiServer(t))
      .post('/api/v1/files')
      .set(t.authHeader(token))
      .attach('file', mp4Header, {
        filename: 'video.mp4',
        contentType: 'video/mp4',
      });
    expect(res.status).toBe(201);
    const asset = res.body as unknown as { id: string; kind: string };
    expect(asset.kind).toBe('video');
    expect(await waitForJobId(t, 'process-video', `video-${asset.id}`)).toBe(true);
  });

  it('rejects duplicates with 409 shape', async () => {
    const user = await seedUser(t);
    const token = t.signToken({ id: user.id, email: user.email, role: user.role });
    const bytes = await pngBytes();
    const first = await request(apiServer(t))
      .post('/api/v1/files')
      .set(t.authHeader(token))
      .attach('file', bytes, 'dup.png');
    expect(first.status).toBe(201);
    const firstAsset = first.body as unknown as { id: string; fileId: string };
    const second = await request(apiServer(t))
      .post('/api/v1/files')
      .set(t.authHeader(token))
      .attach('file', bytes, 'dup.png');
    expect(second.status).toBe(409);
    const body = second.body as unknown as {
      statusCode: number;
      message: string;
      existingAssetId: string;
      existingFileId: string;
    };
    // additive envelope: statusCode/message join the pre-existing ids
    expect(body.statusCode).toBe(409);
    expect(body.message).toBe('File already uploaded');
    expect(body.existingAssetId).toBe(firstAsset.id);
    expect(body.existingFileId).toBe(firstAsset.fileId);
  });

  it('rejects non-image/video mime with 400', async () => {
    const user = await seedUser(t);
    const token = t.signToken({ id: user.id, email: user.email, role: user.role });
    const res = await request(apiServer(t))
      .post('/api/v1/files')
      .set(t.authHeader(token))
      .attach('file', Buffer.from('pdf-bytes'), {
        filename: 'doc.pdf',
        contentType: 'application/pdf',
      });
    expect(res.status).toBe(400);
  });

  it('rejects svg upload before anything is persisted', async () => {
    const user = await seedUser(t);
    const token = t.signToken({ id: user.id, email: user.email, role: user.role });
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>');
    const res = await request(apiServer(t))
      .post('/api/v1/files')
      .set(t.authHeader(token))
      .attach('file', svg, { filename: 'evil.svg', contentType: 'image/svg+xml' });
    expect(res.status).toBe(400);
    expect(await t.fileRepo.count()).toBe(0);
  });

  it('rejects upload exceeding per-user storage quota with 413 and persists nothing', async () => {
    const user = await seedUser(t);
    const token = t.signToken({ id: user.id, email: user.email, role: user.role });
    const png = await pngBytes();
    // prefill to 1 byte under quota so these exact new bytes tip used+size over the ceiling
    await seedFile(t, user.id, { bytes: Buffer.alloc(STORAGE_QUOTA_BYTES - png.length + 1, 'a') });
    const filesBefore = await t.fileRepo.count();
    const res = await request(apiServer(t))
      .post('/api/v1/files')
      .set(t.authHeader(token))
      .attach('file', png, 'over-quota.png')
      .field('kind', 'photo');
    // 413, not 429: quota exhaustion has no time-based retry. No guard exists yet → 201 (red).
    expect(res.status).toBe(413);
    expect(await t.fileRepo.count()).toBe(filesBefore);
    const thumbJobs = await t
      .getQueue('process-thumbnail')
      .getJobs(['waiting', 'active', 'delayed']);
    expect(
      thumbJobs.filter((j) => (j.data as { userId?: string }).userId === user.id),
    ).toHaveLength(0);
  });

  it('dedup re-upload of owned bytes still returns 409 when over quota', async () => {
    // documents the AFTER-dedup requirement: re-linking owned bytes costs zero bytes, so the
    // quota check must run after the dedup fast-path, not before it. Passes already; pins the
    // behavior so the quota guard cannot break it.
    const user = await seedUser(t);
    const token = t.signToken({ id: user.id, email: user.email, role: user.role });
    const png = await pngBytes();
    const first = await request(apiServer(t))
      .post('/api/v1/files')
      .set(t.authHeader(token))
      .attach('file', png, 'reuse.png');
    expect(first.status).toBe(201);
    // push usage over quota through the DB backdoor (the guard would reject this via API)
    await seedFile(t, user.id, { bytes: Buffer.alloc(STORAGE_QUOTA_BYTES, 'b') });
    const filesBefore = await t.fileRepo.count();
    const second = await request(apiServer(t))
      .post('/api/v1/files')
      .set(t.authHeader(token))
      .attach('file', png, 'reuse.png');
    expect(second.status).toBe(409);
    expect(await t.fileRepo.count()).toBe(filesBefore);
  });

  it('POST /api/v1/files/exists answers 200, not the POST-default 201', async () => {
    const user = await seedUser(t);
    const token = t.signToken({ id: user.id, email: user.email, role: user.role });
    const missing = 'f'.repeat(64);
    const res = await request(apiServer(t))
      .post('/api/v1/files/exists')
      .set(t.authHeader(token))
      .send({ items: [{ checksumSha256: missing }] });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ items: [{ checksumSha256: missing, exists: false }] });
  });

  it('stores the sniffed mime even when the client contentType lies', async () => {
    const user = await seedUser(t);
    const token = t.signToken({ id: user.id, email: user.email, role: user.role });
    const res = await request(apiServer(t))
      .post('/api/v1/files')
      .set(t.authHeader(token))
      .attach('file', await pngBytes(), { filename: 'lie.bin', contentType: 'image/svg+xml' });
    expect(res.status).toBe(201);
    const asset = res.body as unknown as { fileId: string; kind: string };
    expect(asset.kind).toBe('photo');
    const fileRow = await t.fileRepo.findOneOrFail({ where: { id: asset.fileId } });
    expect(fileRow.mimeType).toBe('image/png');
  });

  it('accepts an iPhone heic photo and stores image/heic', async () => {
    const user = await seedUser(t);
    const token = t.signToken({ id: user.id, email: user.email, role: user.role });
    // minimal ISO-BMFF header: ftyp box with major brand 'heic'
    const heicHeader = Buffer.from('000000186674797068656963', 'hex');
    const res = await request(apiServer(t))
      .post('/api/v1/files')
      .set(t.authHeader(token))
      .attach('file', heicHeader, { filename: 'photo.heic', contentType: 'image/heic' });
    expect(res.status).toBe(201);
    const asset = res.body as unknown as { fileId: string; kind: string };
    expect(asset.kind).toBe('photo');
    const fileRow = await t.fileRepo.findOneOrFail({ where: { id: asset.fileId } });
    expect(fileRow.mimeType).toBe('image/heic');
  });

  it('accepts an iPhone quicktime mov and stores video/quicktime', async () => {
    const user = await seedUser(t);
    const token = t.signToken({ id: user.id, email: user.email, role: user.role });
    // minimal ISO-BMFF header: ftyp box with major brand 'qt  '
    const movHeader = Buffer.from('000000186674797071742020', 'hex');
    const res = await request(apiServer(t))
      .post('/api/v1/files')
      .set(t.authHeader(token))
      .attach('file', movHeader, { filename: 'clip.mov', contentType: 'video/quicktime' });
    expect(res.status).toBe(201);
    const asset = res.body as unknown as { fileId: string; kind: string };
    expect(asset.kind).toBe('video');
    const fileRow = await t.fileRepo.findOneOrFail({ where: { id: asset.fileId } });
    expect(fileRow.mimeType).toBe('video/quicktime');
  });
});
