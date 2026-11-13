import request from 'supertest';
import {
  apiServer,
  closeTestApp,
  createApiTestApp,
  resetDb,
  seedAsset,
  seedFile,
  seedThumbnail,
  seedUser,
} from './helpers';
import type { ApiTestApp } from './helpers';

const ORIGINAL_BYTES = Buffer.from('original-bytes');
const TRANSCODE_BYTES = Buffer.from('transcode-bytes');

function expectBytes(body: unknown, expected: Buffer) {
  expect(Buffer.isBuffer(body)).toBe(true);
  expect(Buffer.compare(body as Buffer, expected)).toBe(0);
}

describe('asset content routes', () => {
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

  async function seedOwnedAsset(opts: { transcode?: 'owned' | 'foreign' | 'none' } = {}) {
    const user = await seedUser(t);
    const original = await seedFile(t, user.id, { bytes: ORIGINAL_BYTES });
    let transcodeFileId: string | undefined;
    if (opts.transcode === 'owned') {
      const transcode = await seedFile(t, user.id, {
        bytes: TRANSCODE_BYTES,
        mimeType: 'video/webm',
        originalName: 'clip.webm',
      });
      transcodeFileId = transcode.id;
    } else if (opts.transcode === 'foreign') {
      // a poisoned pointer: the row exists but belongs to someone else
      const other = await seedUser(t);
      const foreign = await seedFile(t, other.id, { bytes: TRANSCODE_BYTES });
      transcodeFileId = foreign.id;
    }
    const asset = await seedAsset(t, user.id, original.id, {
      kind: 'video',
      transcodeStatus: transcodeFileId ? 'ready' : null,
      transcodeFileId,
    });
    return { user, asset, auth: t.authHeader(t.signToken(user)) };
  }

  it('serves the original when no transcode exists, with immutable caching and no disposition', async () => {
    const { asset, auth } = await seedOwnedAsset();

    const res = await request(apiServer(t)).get(`/api/v1/assets/${asset.id}/content`).set(auth);

    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('private, max-age=31536000, immutable');
    expect(res.headers['content-disposition']).toBeUndefined();
    expect(res.headers['accept-ranges']).toBe('bytes');
    expectBytes(res.body, ORIGINAL_BYTES);
  });

  it('serves the transcode for the display variant once the worker registered one', async () => {
    const { asset, auth } = await seedOwnedAsset({ transcode: 'owned' });

    const res = await request(apiServer(t)).get(`/api/v1/assets/${asset.id}/content`).set(auth);

    expect(res.status).toBe(200);
    expectBytes(res.body, TRANSCODE_BYTES);
  });

  it('falls back to the original when the transcode pointer belongs to another user', async () => {
    const { asset, auth } = await seedOwnedAsset({ transcode: 'foreign' });

    const res = await request(apiServer(t)).get(`/api/v1/assets/${asset.id}/content`).set(auth);

    expect(res.status).toBe(200);
    expectBytes(res.body, ORIGINAL_BYTES);
  });

  it('serves the original on ?variant=original even when a transcode exists', async () => {
    const { asset, auth } = await seedOwnedAsset({ transcode: 'owned' });

    const res = await request(apiServer(t))
      .get(`/api/v1/assets/${asset.id}/content?variant=original`)
      .set(auth);

    expect(res.status).toBe(200);
    expectBytes(res.body, ORIGINAL_BYTES);
  });

  it('ignores the `v` cache token when resolving bytes', async () => {
    const { asset, auth } = await seedOwnedAsset({ transcode: 'owned' });

    const res = await request(apiServer(t))
      .get(`/api/v1/assets/${asset.id}/content?v=stale-token`)
      .set(auth);

    expect(res.status).toBe(200);
    expectBytes(res.body, TRANSCODE_BYTES);
  });

  it('rejects an unknown variant with 400', async () => {
    const { asset, auth } = await seedOwnedAsset();

    const res = await request(apiServer(t))
      .get(`/api/v1/assets/${asset.id}/content?variant=nope`)
      .set(auth);

    expect(res.status).toBe(400);
  });

  it('404s a trashed asset — the bytes follow the asset lifecycle, not the file row', async () => {
    const { asset, auth } = await seedOwnedAsset();
    await t.assetRepo.update({ id: asset.id }, { isTrashed: true });

    const res = await request(apiServer(t)).get(`/api/v1/assets/${asset.id}/content`).set(auth);

    expect(res.status).toBe(404);
  });

  it('404s another user’s asset', async () => {
    const { asset } = await seedOwnedAsset();
    const other = await seedUser(t);
    const auth = t.authHeader(t.signToken(other));

    const res = await request(apiServer(t)).get(`/api/v1/assets/${asset.id}/content`).set(auth);

    expect(res.status).toBe(404);
  });

  it('404s a malformed asset id instead of surfacing the uuid cast as a 500', async () => {
    const { auth } = await seedOwnedAsset();

    const res = await request(apiServer(t)).get('/api/v1/assets/not-a-uuid/content').set(auth);

    expect(res.status).toBe(404);
  });

  it('downloads the original as an attachment', async () => {
    const { asset, auth } = await seedOwnedAsset({ transcode: 'owned' });

    const res = await request(apiServer(t))
      .get(`/api/v1/assets/${asset.id}/content/download`)
      .set(auth);

    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toMatch(/^attachment; filename="photo\.png"/);
    expectBytes(res.body, ORIGINAL_BYTES);
  });

  it('exposes the display cache token as contentVersion on the asset payload', async () => {
    const { asset, auth } = await seedOwnedAsset({ transcode: 'owned' });

    const res = await request(apiServer(t)).get(`/api/v1/assets/${asset.id}`).set(auth);

    expect(res.status).toBe(200);
    const payload = res.body as { contentVersion: string; fileId: string };
    expect(payload.contentVersion).toBe(asset.transcodeFileId);
    expect(payload.fileId).toBe(asset.fileId);
  });

  describe('public share content', () => {
    async function seedAlbumShare() {
      const { user, asset, auth } = await seedOwnedAsset();
      const album = await t.albumRepo.save(t.albumRepo.create({ userId: user.id, name: 'Trip' }));
      await t.albumAssetRepo.save(
        t.albumAssetRepo.create({ albumId: album.id, assetId: asset.id }),
      );
      const created = await request(apiServer(t))
        .post('/api/v1/shares')
        .set(auth)
        .send({ albumId: album.id });
      expect(created.status).toBe(201);
      const { token } = created.body as { token: string };
      return { user, asset, album, token, auth };
    }

    it('serves an album member’s content by token without any credential', async () => {
      const { asset, token } = await seedAlbumShare();

      const res = await request(apiServer(t)).get(`/api/share/${token}/assets/${asset.id}/content`);

      expect(res.status).toBe(200);
      expectBytes(res.body, ORIGINAL_BYTES);
    });

    it('serves the ?size=sm thumbnail for an album grid', async () => {
      const { asset, token } = await seedAlbumShare();
      const thumb = await seedThumbnail(t, asset.id, { size: 'sm' });
      const thumbFile = await t.fileRepo.findOneOrFail({ where: { id: thumb.fileId } });

      const res = await request(apiServer(t)).get(
        `/api/share/${token}/assets/${asset.id}/content?size=sm`,
      );

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toBe('image/jpeg');
      expect(res.headers.etag).toBe(`"${thumbFile.checksumSha256}"`);
    });

    it('404s a non-member asset id', async () => {
      const { user, token } = await seedAlbumShare();
      const otherFile = await seedFile(t, user.id);
      const otherAsset = await seedAsset(t, user.id, otherFile.id);

      const res = await request(apiServer(t)).get(
        `/api/share/${token}/assets/${otherAsset.id}/content`,
      );

      expect(res.status).toBe(404);
    });

    it('404s a trashed member', async () => {
      const { asset, token } = await seedAlbumShare();
      await t.assetRepo.update({ id: asset.id }, { isTrashed: true });

      const res = await request(apiServer(t)).get(`/api/share/${token}/assets/${asset.id}/content`);

      expect(res.status).toBe(404);
    });

    it('serves a single-asset share through /content', async () => {
      const { asset, auth } = await seedOwnedAsset();
      const created = await request(apiServer(t))
        .post('/api/v1/shares')
        .set(auth)
        .send({ assetId: asset.id });
      expect(created.status).toBe(201);
      const { token } = created.body as { token: string };

      const meta = await request(apiServer(t)).get(`/api/share/${token}`);
      expect(meta.status).toBe(200);
      const shared = meta.body as { asset: { contentVersion: string } };
      expect(shared.asset.contentVersion).toBe(asset.fileId);

      const res = await request(apiServer(t)).get(`/api/share/${token}/content`);
      expect(res.status).toBe(200);
      expectBytes(res.body, ORIGINAL_BYTES);
    });
  });
});
