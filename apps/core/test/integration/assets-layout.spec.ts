import request from 'supertest';
import { randomUUID } from 'node:crypto';
import {
  closeTestApp,
  createApiTestApp,
  resetDb,
  seedAsset,
  seedFile,
  seedUser,
  apiServer,
} from './helpers';
import type { ApiTestApp } from './helpers';

describe('assets layout', () => {
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

  it('returns only own non-trashed assets, coalesced and newest first', async () => {
    const user = await seedUser(t);
    const other = await seedUser(t);
    const token = t.signToken({ id: user.id, email: user.email, role: user.role });

    const dimsFile = await seedFile(t, user.id);
    const withDims = await seedAsset(t, user.id, dimsFile.id);
    await t.assetRepo.update(withDims.id, {
      takenAt: new Date('2024-03-02T10:00:00.000Z'),
      width: 4032,
      height: 3024,
    });

    const nullFile = await seedFile(t, user.id);
    const nullDims = await seedAsset(t, user.id, nullFile.id);
    await t.dataSource.query('UPDATE assets SET "uploadedAt" = $1 WHERE id = $2', [
      new Date('2024-01-05T08:30:00.000Z'),
      nullDims.id,
    ]);

    const trashedFile = await seedFile(t, user.id);
    const trashed = await seedAsset(t, user.id, trashedFile.id, { isTrashed: true });
    await t.assetRepo.update(trashed.id, { takenAt: new Date('2024-04-01T00:00:00.000Z') });

    const otherFile = await seedFile(t, other.id);
    const otherAsset = await seedAsset(t, other.id, otherFile.id);
    await t.assetRepo.update(otherAsset.id, { takenAt: new Date('2024-05-01T00:00:00.000Z') });

    const items = await wholeLayout(t, token);

    expect(items).toEqual([
      { t: '2024-03-02T10:00:00.000Z', w: 4032, h: 3024 },
      { t: '2024-01-05T08:30:00.000Z', w: 1, h: 1 },
    ]);
  });

  it('moves the touched window version and tiebreaks equal timestamps by newest upload', async () => {
    const user = await seedUser(t);
    const token = t.signToken({ id: user.id, email: user.email, role: user.role });

    const dimsFile = await seedFile(t, user.id);
    const withDims = await seedAsset(t, user.id, dimsFile.id);
    await t.assetRepo.update(withDims.id, {
      takenAt: new Date('2024-03-02T10:00:00.000Z'),
      width: 4032,
      height: 3024,
    });

    const before = await monthsOf(t, token);
    const marchVersion = before.get('2024-03')?.version;

    // any layout-visible mutation bumps updatedAt → the March window version moves
    await tick();
    await t.assetRepo.update(withDims.id, { width: 1000 });
    const after = await monthsOf(t, token);
    expect(after.get('2024-03')?.version).not.toBe(marchVersion);

    // tiebreak: equal effective timestamps fall back to newest uploadedAt first
    const olderFile = await seedFile(t, user.id);
    const older = await seedAsset(t, user.id, olderFile.id, { width: 10 });
    const newerFile = await seedFile(t, user.id);
    const newer = await seedAsset(t, user.id, newerFile.id, { width: 20 });
    const sameTaken = new Date('2024-02-01T00:00:00.000Z');
    await t.assetRepo.update(older.id, { takenAt: sameTaken });
    await t.assetRepo.update(newer.id, { takenAt: sameTaken });
    await t.dataSource.query('UPDATE assets SET "uploadedAt" = $1 WHERE id = $2', [
      new Date('2024-01-01T00:00:00.000Z'),
      older.id,
    ]);
    await t.dataSource.query('UPDATE assets SET "uploadedAt" = $1 WHERE id = $2', [
      new Date('2024-06-01T00:00:00.000Z'),
      newer.id,
    ]);

    const tiedItems = (await wholeLayout(t, token)).filter((i) => i.t === sameTaken.toISOString());
    expect(tiedItems).toEqual([
      { t: sameTaken.toISOString(), w: 20, h: 1 },
      { t: sameTaken.toISOString(), w: 10, h: 1 },
    ]);
  });

  it('scopes layout to a person, and to the requesting user', async () => {
    const user = await seedUser(t);
    const other = await seedUser(t);
    const token = t.signToken({ id: user.id, email: user.email, role: user.role });

    const faceFile = await seedFile(t, user.id);
    const withFace = await seedAsset(t, user.id, faceFile.id);
    await t.assetRepo.update(withFace.id, {
      takenAt: new Date('2024-03-02T10:00:00.000Z'),
      width: 4032,
      height: 3024,
    });

    const plainFile = await seedFile(t, user.id);
    const plain = await seedAsset(t, user.id, plainFile.id);
    await t.assetRepo.update(plain.id, { takenAt: new Date('2024-01-05T08:30:00.000Z') });

    const person = await t.personRepo.save(
      t.personRepo.create({
        userId: user.id,
        name: null,
        clusterLabel: `c-${randomUUID()}`,
        faceCount: 1,
      }),
    );
    await t.faceRepo.save(
      t.faceRepo.create({
        assetId: withFace.id,
        userId: user.id,
        box: { x: 1, y: 1, w: 10, h: 10 },
        confidence: 0.9,
        embedding: [0.1, 0.2, 0.3],
        personId: person.id,
      }),
    );

    const otherFile = await seedFile(t, other.id);
    const otherAsset = await seedAsset(t, other.id, otherFile.id);
    const otherPerson = await t.personRepo.save(
      t.personRepo.create({
        userId: other.id,
        name: null,
        clusterLabel: `c-${randomUUID()}`,
        faceCount: 1,
      }),
    );
    await t.faceRepo.save(
      t.faceRepo.create({
        assetId: otherAsset.id,
        userId: other.id,
        box: { x: 1, y: 1, w: 10, h: 10 },
        confidence: 0.9,
        embedding: [0.1, 0.2, 0.3],
        personId: otherPerson.id,
      }),
    );

    const filtered = await wholeLayout(t, token, { personId: person.id });
    expect(filtered).toEqual([{ t: '2024-03-02T10:00:00.000Z', w: 4032, h: 3024 }]);

    const all = await wholeLayout(t, token);
    expect(all).toHaveLength(2);

    const foreign = await wholeLayout(t, token, { personId: otherPerson.id });
    expect(foreign).toEqual([]);
  });

  it('scopes layout to favorites and to an album', async () => {
    const user = await seedUser(t);
    const other = await seedUser(t);
    const token = t.signToken({ id: user.id, email: user.email, role: user.role });

    const favFile = await seedFile(t, user.id);
    const favorite = await seedAsset(t, user.id, favFile.id);
    await t.assetRepo.update(favorite.id, {
      takenAt: new Date('2024-03-02T10:00:00.000Z'),
      width: 4032,
      height: 3024,
      favorite: true,
    });

    const memberFile = await seedFile(t, user.id);
    const member = await seedAsset(t, user.id, memberFile.id);
    await t.assetRepo.update(member.id, { takenAt: new Date('2024-02-01T00:00:00.000Z') });

    const plainFile = await seedFile(t, user.id);
    const plain = await seedAsset(t, user.id, plainFile.id);
    await t.assetRepo.update(plain.id, { takenAt: new Date('2024-01-05T08:30:00.000Z') });

    const album = await t.albumRepo.save(
      t.albumRepo.create({ userId: user.id, name: 'Trip', description: null }),
    );
    await t.albumAssetRepo.save(t.albumAssetRepo.create({ albumId: album.id, assetId: member.id }));

    const otherFile = await seedFile(t, other.id);
    const otherAsset = await seedAsset(t, other.id, otherFile.id);
    const otherAlbum = await t.albumRepo.save(
      t.albumRepo.create({ userId: other.id, name: 'Theirs', description: null }),
    );
    await t.albumAssetRepo.save(
      t.albumAssetRepo.create({ albumId: otherAlbum.id, assetId: otherAsset.id }),
    );

    const favs = await wholeLayout(t, token, { favorite: 'true' });
    expect(favs).toEqual([{ t: '2024-03-02T10:00:00.000Z', w: 4032, h: 3024 }]);

    const inAlbum = await wholeLayout(t, token, { albumId: album.id });
    expect(inAlbum).toEqual([{ t: '2024-02-01T00:00:00.000Z', w: 1, h: 1 }]);

    const all = await wholeLayout(t, token);
    expect(all).toHaveLength(3);

    const foreign = await wholeLayout(t, token, { albumId: otherAlbum.id });
    expect(foreign).toEqual([]);
  });

  it('groups month windows by the requested timezone', async () => {
    const user = await seedUser(t);
    const token = t.signToken({ id: user.id, email: user.email, role: user.role });

    // 23:30 local on the last day of March in New York: already April in UTC
    await seedTimedAsset(t, user.id, '2024-04-01T03:30:00.000Z');
    await seedTimedAsset(t, user.id, '2024-02-15T12:00:00.000Z');

    const ny = await request(apiServer(t))
      .get('/api/v1/timeline/index')
      .query({ tz: 'America/New_York' })
      .set(t.authHeader(token));
    expect(ny.status).toBe(200);
    expect(ny.headers['cache-control']).toBe('private, no-store');
    expect(ny.headers.vary).toBe('Authorization');
    expect(ny.headers.etag).toBeUndefined();

    const nyMonths = (ny.body as { months: MonthWindow[] }).months;
    expect(nyMonths.map((m) => m.key)).toEqual(['2024-03', '2024-02']);
    expect(nyMonths[0]).toMatchObject({
      key: '2024-03',
      from: '2024-03-01T05:00:00.000Z', // March 1 00:00 EST
      to: '2024-04-01T04:00:00.000Z', // April 1 00:00 EDT
      count: 1,
    });
    expect(nyMonths[0]?.version).toMatch(/^1-\d+-0-0$/);

    // no tz → UTC months, so the boundary item moves to April
    const utc = await request(apiServer(t)).get('/api/v1/timeline/index').set(t.authHeader(token));
    const utcMonths = (utc.body as { months: MonthWindow[] }).months;
    expect(utcMonths.map((m) => m.key)).toEqual(['2024-04', '2024-02']);
    expect(utcMonths[0]).toMatchObject({
      from: '2024-04-01T00:00:00.000Z',
      to: '2024-05-01T00:00:00.000Z',
    });
  });

  it('returns an empty month index for an empty library', async () => {
    const user = await seedUser(t);
    const token = t.signToken({ id: user.id, email: user.email, role: user.role });

    const res = await request(apiServer(t)).get('/api/v1/timeline/index').set(t.authHeader(token));

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ months: [] });
  });

  it('moves only the affected window version on add, edit, trash and restore', async () => {
    const user = await seedUser(t);
    const token = t.signToken({ id: user.id, email: user.email, role: user.role });

    const m1 = await seedTimedAsset(t, user.id, '2024-03-10T12:00:00.000Z');
    const m2 = await seedTimedAsset(t, user.id, '2024-03-20T12:00:00.000Z');
    await seedTimedAsset(t, user.id, '2024-04-10T12:00:00.000Z');

    const base = await monthsOf(t, token);
    expect(base.get('2024-03')).toMatchObject({ count: 2 });
    expect(base.get('2024-04')).toMatchObject({ count: 1 });

    // add: a new window appears, the others keep their version
    await tick();
    await seedTimedAsset(t, user.id, '2024-05-10T12:00:00.000Z');
    const added = await monthsOf(t, token);
    expect([...added.keys()]).toEqual(['2024-05', '2024-04', '2024-03']);
    expect(added.get('2024-03')?.version).toBe(base.get('2024-03')?.version);
    expect(added.get('2024-04')?.version).toBe(base.get('2024-04')?.version);

    // width edit: assets.updatedAt moves, so only March's version moves
    await tick();
    await t.assetRepo.update(m1.id, { width: 4321 });
    const resized = await monthsOf(t, token);
    expect(resized.get('2024-03')?.version).not.toBe(added.get('2024-03')?.version);
    expect(resized.get('2024-04')?.version).toBe(added.get('2024-04')?.version);
    expect(resized.get('2024-05')?.version).toBe(added.get('2024-05')?.version);

    // takenAt edit inside the same month: still only March
    await tick();
    await t.assetRepo.update(m2.id, { takenAt: new Date('2024-03-25T12:00:00.000Z') });
    const moved = await monthsOf(t, token);
    expect(moved.get('2024-03')).toMatchObject({ count: 2 });
    expect(moved.get('2024-03')?.version).not.toBe(resized.get('2024-03')?.version);
    expect(moved.get('2024-04')?.version).toBe(resized.get('2024-04')?.version);

    // trash + restore: same window, new count each time
    await tick();
    await t.assetRepo.update(m1.id, { isTrashed: true, trashedAt: new Date() });
    const trashed = await monthsOf(t, token);
    expect(trashed.get('2024-03')).toMatchObject({ count: 1 });
    expect(trashed.get('2024-03')?.version).not.toBe(moved.get('2024-03')?.version);
    expect(trashed.get('2024-04')?.version).toBe(moved.get('2024-04')?.version);

    await tick();
    await t.assetRepo.update(m1.id, { isTrashed: false, trashedAt: null });
    const restored = await monthsOf(t, token);
    expect(restored.get('2024-03')).toMatchObject({ count: 2 });
    expect(restored.get('2024-03')?.version).not.toBe(trashed.get('2024-03')?.version);
    expect(restored.get('2024-04')?.version).toBe(moved.get('2024-04')?.version);
    expect(restored.get('2024-05')?.version).toBe(added.get('2024-05')?.version);
  });

  it('moves both window versions and the item when takenAt crosses a month', async () => {
    const user = await seedUser(t);
    const token = t.signToken({ id: user.id, email: user.email, role: user.role });

    const march = await seedTimedAsset(t, user.id, '2024-03-10T12:00:00.000Z', 100);
    await seedTimedAsset(t, user.id, '2024-04-10T12:00:00.000Z', 101);

    const base = await monthsOf(t, token);
    expect(base.get('2024-03')).toMatchObject({ count: 1 });
    expect(base.get('2024-04')).toMatchObject({ count: 1 });
    const aprilWindow = base.get('2024-04');
    if (!aprilWindow) throw new Error('missing April window');

    await tick();
    await t.assetRepo.update(march.id, { takenAt: new Date('2024-04-15T12:00:00.000Z') });
    const moved = await monthsOf(t, token);

    // March emptied out of the index, April absorbed the item: the count alone guarantees the
    // version moved on both sides, and the page must show the item under its new window.
    expect(moved.get('2024-03')).toBeUndefined();
    expect(moved.get('2024-04')).toMatchObject({ count: 2 });
    expect(moved.get('2024-04')?.version).not.toBe(aprilWindow.version);

    const page = await request(apiServer(t))
      .get('/api/v1/timeline/window')
      .query({ from: aprilWindow.from, to: aprilWindow.to })
      .set(t.authHeader(token));
    expect(page.status).toBe(200);
    expect(page.body).toMatchObject({
      total: 2,
      nextOffset: null,
      version: moved.get('2024-04')?.version,
    });
    expect((page.body as { items: { t: string; w: number }[] }).items).toEqual([
      { t: '2024-04-15T12:00:00.000Z', w: 100, h: 100 },
      { t: '2024-04-10T12:00:00.000Z', w: 101, h: 100 },
    ]);
  });

  it('moves the window version on hidden-album toggles and membership changes', async () => {
    const user = await seedUser(t);
    const token = t.signToken({ id: user.id, email: user.email, role: user.role });

    const m1 = await seedTimedAsset(t, user.id, '2024-03-10T12:00:00.000Z');
    const m2 = await seedTimedAsset(t, user.id, '2024-03-20T12:00:00.000Z');
    await seedTimedAsset(t, user.id, '2024-03-25T12:00:00.000Z');
    await seedTimedAsset(t, user.id, '2024-04-10T12:00:00.000Z');

    const album = await t.albumRepo.save(
      t.albumRepo.create({ userId: user.id, name: 'Hidden', description: null }),
    );
    await t.albumAssetRepo.save(t.albumAssetRepo.create({ albumId: album.id, assetId: m2.id }));

    const base = await monthsOf(t, token);
    expect(base.get('2024-03')).toMatchObject({ count: 3 });

    // hide the album: m2 leaves the timeline, no asset row changed
    await tick();
    await t.albumRepo.update(album.id, { hiddenFromTimeline: true });
    const hidden = await monthsOf(t, token);
    expect(hidden.get('2024-03')).toMatchObject({ count: 2 });
    expect(hidden.get('2024-03')?.version).not.toBe(base.get('2024-03')?.version);
    expect(hidden.get('2024-04')?.version).toBe(base.get('2024-04')?.version);
    expect(hidden.get('2024-03')?.version).toMatch(/^2-\d+-1-\d+$/);

    // add another member to the hidden album
    await tick();
    await t.albumAssetRepo.save(t.albumAssetRepo.create({ albumId: album.id, assetId: m1.id }));
    const memberAdded = await monthsOf(t, token);
    expect(memberAdded.get('2024-03')).toMatchObject({ count: 1 });
    expect(memberAdded.get('2024-03')?.version).not.toBe(hidden.get('2024-03')?.version);
    expect(memberAdded.get('2024-04')?.version).toBe(base.get('2024-04')?.version);

    // remove it again
    await tick();
    await t.albumAssetRepo.delete({ albumId: album.id, assetId: m1.id });
    const memberRemoved = await monthsOf(t, token);
    expect(memberRemoved.get('2024-03')).toMatchObject({ count: 2 });
    expect(memberRemoved.get('2024-03')?.version).not.toBe(memberAdded.get('2024-03')?.version);

    // unhide: the visible set is back to the original, so the version returns to the baseline one
    await tick();
    await t.albumRepo.update(album.id, { hiddenFromTimeline: false });
    const shown = await monthsOf(t, token);
    expect(shown.get('2024-03')).toMatchObject({ count: 3 });
    expect(shown.get('2024-03')?.version).toBe(base.get('2024-03')?.version);
    expect(shown.get('2024-04')?.version).toBe(base.get('2024-04')?.version);
  });

  it('moves an album window version on membership changes and bypasses the hidden filter', async () => {
    const user = await seedUser(t);
    const token = t.signToken({ id: user.id, email: user.email, role: user.role });

    const m1 = await seedTimedAsset(t, user.id, '2024-03-10T12:00:00.000Z');
    const m2 = await seedTimedAsset(t, user.id, '2024-03-20T12:00:00.000Z');
    const april = await seedTimedAsset(t, user.id, '2024-04-10T12:00:00.000Z');

    const album = await t.albumRepo.save(
      t.albumRepo.create({ userId: user.id, name: 'Trip', description: null }),
    );
    await t.albumAssetRepo.save(t.albumAssetRepo.create({ albumId: album.id, assetId: m1.id }));

    const base = await monthsOf(t, token, { albumId: album.id });
    expect([...base.keys()]).toEqual(['2024-03']);
    expect(base.get('2024-03')).toMatchObject({ count: 1 });
    // albumMaxAddedMs is appended only for album views
    expect(base.get('2024-03')?.version).toMatch(/^1-\d+-0-0-\d+$/);

    await tick();
    await t.albumAssetRepo.save(t.albumAssetRepo.create({ albumId: album.id, assetId: m2.id }));
    const added = await monthsOf(t, token, { albumId: album.id });
    expect(added.get('2024-03')).toMatchObject({ count: 2 });
    expect(added.get('2024-03')?.version).not.toBe(base.get('2024-03')?.version);

    await tick();
    await t.albumAssetRepo.save(t.albumAssetRepo.create({ albumId: album.id, assetId: april.id }));
    const grew = await monthsOf(t, token, { albumId: album.id });
    expect([...grew.keys()]).toEqual(['2024-04', '2024-03']);
    expect(grew.get('2024-03')?.version).toBe(added.get('2024-03')?.version);

    // an explicit album view keeps listing a hidden album's assets
    await t.albumRepo.update(album.id, { hiddenFromTimeline: true });
    const stillListed = await monthsOf(t, token, { albumId: album.id });
    expect(stillListed.get('2024-03')).toMatchObject({ count: 2 });
    // ... and the same assets are gone from the timeline index
    const timeline = await monthsOf(t, token);
    expect(timeline.get('2024-03')).toBeUndefined();

    await tick();
    await t.albumAssetRepo.delete({ albumId: album.id, assetId: m2.id });
    const removed = await monthsOf(t, token, { albumId: album.id });
    expect(removed.get('2024-03')).toMatchObject({ count: 1 });
    expect(removed.get('2024-03')?.version).not.toBe(stillListed.get('2024-03')?.version);
  });

  it('pages a month window with half-open bounds, version and nextOffset', async () => {
    const user = await seedUser(t);
    const token = t.signToken({ id: user.id, email: user.email, role: user.role });

    const from = new Date('2024-03-01T00:00:00.000Z');
    const to = new Date('2024-04-01T00:00:00.000Z');
    await seedTimedAsset(t, user.id, '2024-02-29T23:59:59.999Z'); // before the window
    await seedTimedAsset(t, user.id, '2024-03-01T00:00:00.000Z', 101); // == from: included
    await seedTimedAsset(t, user.id, '2024-03-15T12:00:00.000Z', 102);
    await seedTimedAsset(t, user.id, '2024-03-31T23:59:59.999Z', 103);
    await seedTimedAsset(t, user.id, '2024-04-01T00:00:00.000Z', 104); // == to: excluded

    const index = await monthsOf(t, token);
    const window = index.get('2024-03');
    expect(window).toMatchObject({ count: 3 });

    const first = await request(apiServer(t))
      .get('/api/v1/timeline/window')
      .query({ from: from.toISOString(), to: to.toISOString(), limit: 2 })
      .set(t.authHeader(token));
    expect(first.status).toBe(200);
    expect(first.headers['cache-control']).toBe('private, no-cache');
    expect(first.headers.vary).toBe('Authorization');
    expect(first.body).toMatchObject({
      from: from.toISOString(),
      to: to.toISOString(),
      version: window?.version,
      total: 3,
      nextOffset: 2,
    });
    expect((first.body as { items: unknown[] }).items).toEqual([
      { t: '2024-03-31T23:59:59.999Z', w: 103, h: 100 },
      { t: '2024-03-15T12:00:00.000Z', w: 102, h: 100 },
    ]);

    const second = await request(apiServer(t))
      .get('/api/v1/timeline/window')
      .query({ from: from.toISOString(), to: to.toISOString(), offset: 2, limit: 2 })
      .set(t.authHeader(token));
    expect(second.status).toBe(200);
    expect(second.body).toMatchObject({ total: 3, nextOffset: null, version: window?.version });
    expect((second.body as { items: { w: number }[] }).items).toEqual([
      { t: '2024-03-01T00:00:00.000Z', w: 101, h: 100 },
    ]);
  });

  it('rejects malformed window requests', async () => {
    const user = await seedUser(t);
    const token = t.signToken({ id: user.id, email: user.email, role: user.role });
    const get = (query: Record<string, string>) =>
      request(apiServer(t)).get('/api/v1/timeline/window').query(query).set(t.authHeader(token));

    expect(
      (
        await get({
          from: '2024-03-01T00:00:00.000Z',
          to: '2024-04-01T00:00:00.000Z',
          limit: '5001',
        })
      ).status,
    ).toBe(400);
    expect((await get({ from: '2024-03-01T00:00:00.000Z' })).status).toBe(400);
    expect((await get({ to: '2024-04-01T00:00:00.000Z' })).status).toBe(400);
    expect((await get({ offset: '2' })).status).toBe(400);
    expect((await get({ offset: '0' })).status).toBe(400);
    expect((await get({ limit: '10' })).status).toBe(400);

    const badTz = await request(apiServer(t))
      .get('/api/v1/timeline/index')
      .query({ tz: 'Not/AZone' })
      .set(t.authHeader(token));
    expect(badTz.status).toBe(400);

    // one DTO per resource: the other family's params are a 400, never silently ignored
    const wrongFamily = (path: string, query: Record<string, string>) =>
      request(apiServer(t)).get(path).query(query).set(t.authHeader(token));
    expect(
      (
        await wrongFamily('/api/v1/timeline/window', {
          tz: 'UTC',
          from: '2024-03-01T00:00:00.000Z',
          to: '2024-04-01T00:00:00.000Z',
        })
      ).status,
    ).toBe(400);
    expect(
      (await wrongFamily('/api/v1/timeline/index', { from: '2024-03-01T00:00:00.000Z' })).status,
    ).toBe(400);
  });

  it('keeps the index stable across reads and ignores person clustering', async () => {
    const user = await seedUser(t);
    const token = t.signToken({ id: user.id, email: user.email, role: user.role });
    const asset = await seedTimedAsset(t, user.id, '2024-03-02T10:00:00.000Z');

    const before = await monthsOf(t, token);
    // the token is an equality signal only: nothing mutated, so nothing may move
    expect([...(await monthsOf(t, token)).entries()]).toEqual([...before.entries()]);

    // clustering writes faces/persons, never `assets.updatedAt` — `personId` views are
    // memory-only on the client precisely because this window version cannot see it
    const person = await t.personRepo.save(
      t.personRepo.create({
        userId: user.id,
        name: null,
        clusterLabel: `c-${randomUUID()}`,
        faceCount: 1,
      }),
    );
    await t.faceRepo.save(
      t.faceRepo.create({
        assetId: asset.id,
        userId: user.id,
        box: { x: 1, y: 1, w: 10, h: 10 },
        confidence: 0.9,
        embedding: [0.1, 0.2, 0.3],
        personId: person.id,
      }),
    );

    expect([...(await monthsOf(t, token)).entries()]).toEqual([...before.entries()]);
  });
});

interface MonthWindow {
  key: string;
  from: string;
  to: string;
  count: number;
  version: string;
}

async function seedTimedAsset(
  t: ApiTestApp,
  userId: string,
  takenAt: string,
  width = 100,
): Promise<{ id: string }> {
  const file = await seedFile(t, userId);
  const asset = await seedAsset(t, userId, file.id);
  await t.assetRepo.update(asset.id, { takenAt: new Date(takenAt), width, height: 100 });
  return asset;
}

async function monthsOf(
  t: ApiTestApp,
  token: string,
  query: Record<string, string> = {},
): Promise<Map<string, MonthWindow>> {
  const res = await request(apiServer(t))
    .get('/api/v1/timeline/index')
    .query(query)
    .set(t.authHeader(token));
  expect(res.status).toBe(200);
  const body = res.body as { months: MonthWindow[] };
  return new Map(body.months.map((m) => [m.key, m]));
}

interface LayoutItem {
  t: string;
  w: number;
  h: number;
}

/**
 * Whole-library layout in timeline order: `/timeline/window` only serves one window page, so read
 * the month index and walk every window's pages, concatenating the items.
 */
async function wholeLayout(
  t: ApiTestApp,
  token: string,
  filters: Record<string, string> = {},
): Promise<LayoutItem[]> {
  const windows = [...(await monthsOf(t, token, filters)).values()];
  const items: LayoutItem[] = [];
  for (const window of windows) {
    let offset = 0;
    for (;;) {
      const res = await request(apiServer(t))
        .get('/api/v1/timeline/window')
        .query({ ...filters, from: window.from, to: window.to, offset, limit: 2000 })
        .set(t.authHeader(token));
      expect(res.status).toBe(200);
      const body = res.body as { items: LayoutItem[]; nextOffset: number | null };
      items.push(...body.items);
      if (body.nextOffset === null) break;
      offset = body.nextOffset;
    }
  }
  return items;
}

// versions carry millisecond timestamps; mutations that reuse the same millisecond are invisible
function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 5));
}
