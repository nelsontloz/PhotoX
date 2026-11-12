import { randomUUID } from 'node:crypto';
import { JwtService } from '@nestjs/jwt';
import { UnrecoverableError } from 'bullmq';
import { FACE_EMBEDDING_DIM } from '@photox/shared-types';
import { CoreClient } from './core-client.service';

const fetchMock = vi.fn();

function makeClient(): CoreClient {
  return new CoreClient(new JwtService({ secret: 'x'.repeat(32) }));
}

function jsonResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  };
}

describe('CoreClient', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('sends a per-user delegated bearer token and returns the body', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { id: 'file-1', userId: 'user-1' }));

    const file = await makeClient().getFile('user-1', 'file-1');

    expect(file).toEqual({ id: 'file-1', userId: 'user-1' });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://localhost:3000/worker/files/file-1');
    expect(init.method).toBe('GET');
    const token = (init.headers as Record<string, string>).Authorization!.replace('Bearer ', '');
    const payload = new JwtService({ secret: 'x'.repeat(32) }).verify<{
      sub: string;
      email: string;
      role: string;
      iat: number;
      exp: number;
    }>(token);
    expect(payload).toMatchObject({
      sub: 'user-1',
      email: 'worker@internal',
      role: 'user',
      act: { sub: 'worker-service' },
    });
    expect(payload.exp).toBeGreaterThan(payload.iat);
  });

  it('maps 404 to UnrecoverableError without retrying', async () => {
    fetchMock.mockResolvedValue(jsonResponse(404, { message: 'File not found' }));

    await expect(makeClient().getFile('user-1', 'file-1')).rejects.toBeInstanceOf(
      UnrecoverableError,
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([400, 413, 422])('maps %i to UnrecoverableError without retrying', async (status) => {
    fetchMock.mockResolvedValue(jsonResponse(status, { message: 'bad' }));

    await expect(makeClient().getAsset('user-1', 'asset-1')).rejects.toBeInstanceOf(
      UnrecoverableError,
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('fails fast on 401/403 without in-process retries', async () => {
    fetchMock.mockResolvedValue(jsonResponse(401, { message: 'Unauthorized' }));

    await expect(makeClient().getAsset('user-1', 'asset-1')).rejects.toThrow('401');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('throws a plain Error on 5xx without in-process retries (BullMQ owns retries)', async () => {
    fetchMock.mockResolvedValue(jsonResponse(503, { message: 'unavailable' }));

    await expect(makeClient().getAsset('user-1', 'asset-1')).rejects.toThrow('503');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('throws a plain Error on network failures immediately', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));

    await expect(makeClient().getAsset('user-1', 'asset-1')).rejects.toThrow('fetch failed');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('streams cluster faces from the worker endpoint into a walk', async () => {
    const embedding = new Array<number>(FACE_EMBEDDING_DIM).fill(0.1);
    fetchMock.mockResolvedValue(
      jsonResponse(200, {
        items: [
          {
            id: 'face-1',
            assetId: 'asset-1',
            box: { x: 0, y: 0, w: 1, h: 1 },
            confidence: 0.9,
            personId: null,
            embedding,
          },
        ],
      }),
    );

    const walk = await makeClient().getFacesForCluster('user-1', undefined, { minConfidence: 0.4 });

    expect(walk.unassigned.map((f) => f.id)).toEqual(['face-1']);
    expect(walk.total).toBe(1);
    expect(walk.truncated).toBe(false);
    expect(fetchMock.mock.calls[0]![0]).toBe(
      'http://localhost:3000/worker/faces?includeEmbeddings=true&excludeTrashed=true&limit=500',
    );
  });

  it('walks paginated faces with cursor until nextCursor is null', async () => {
    const embedding = new Array<number>(FACE_EMBEDDING_DIM).fill(0.1);
    const face = (id: string) => ({
      id,
      assetId: `asset-${id}`,
      box: { x: 0, y: 0, w: 1, h: 1 },
      confidence: 0.9,
      personId: null,
      embedding,
    });
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, { items: [face('face-1')], nextCursor: 'f1' }))
      .mockResolvedValueOnce(jsonResponse(200, { items: [face('face-2')], nextCursor: null }));

    const walk = await makeClient().getFacesForCluster('user-1', undefined, { minConfidence: 0.4 });

    expect(walk.unassigned.map((f) => f.id)).toEqual(['face-1', 'face-2']);
    expect(walk.total).toBe(2);
    const urls = fetchMock.mock.calls.map((call) => call[0] as string);
    expect(urls).toHaveLength(2);
    expect(urls[0]).not.toContain('cursor=');
    expect(urls[1]).toContain('cursor=f1');
  });

  it('caps unassigned faces per run and reports truncation instead of failing', async () => {
    const embedding = new Array<number>(FACE_EMBEDDING_DIM).fill(0.1);
    const face = (id: string) => ({
      id,
      assetId: `asset-${id}`,
      box: { x: 0, y: 0, w: 1, h: 1 },
      confidence: 0.9,
      personId: null,
      embedding,
    });
    fetchMock.mockResolvedValue(
      jsonResponse(200, { items: [face('f1'), face('f2'), face('f3')], nextCursor: null }),
    );

    const walk = await makeClient().getFacesForCluster('user-1', undefined, { cap: 2 });

    expect(walk.unassigned.map((f) => f.id)).toEqual(['f1', 'f2']);
    expect(walk.truncated).toBe(true);
    expect(walk.deferred).toBe(1);
    expect(walk.total).toBe(3);
  });

  it('accumulates person centroids and samples legacy asset ids', async () => {
    const current = new Array<number>(FACE_EMBEDDING_DIM).fill(0.1);
    const legacy = new Array<number>(1024).fill(0.1);
    fetchMock.mockResolvedValue(
      jsonResponse(200, {
        items: [
          {
            id: 'assigned',
            assetId: 'asset-a',
            box: { x: 0, y: 0, w: 1, h: 1 },
            confidence: 0.9,
            personId: 'person-1',
            embedding: [1, 0, ...current.slice(2)],
          },
          // low confidence: stored but never a centroid vote
          {
            id: 'low',
            assetId: 'asset-low',
            box: { x: 0, y: 0, w: 1, h: 1 },
            confidence: 0.2,
            personId: 'person-2',
            embedding: current,
          },
          {
            id: 'legacy',
            assetId: 'asset-legacy',
            box: { x: 0, y: 0, w: 1, h: 1 },
            confidence: 0.9,
            personId: null,
            embedding: legacy,
          },
          {
            id: 'unassigned',
            assetId: 'asset-u',
            box: { x: 0, y: 0, w: 1, h: 1 },
            confidence: 0.9,
            personId: null,
            embedding: current,
          },
        ],
      }),
    );

    const walk = await makeClient().getFacesForCluster('user-1', undefined, { minConfidence: 0.4 });

    expect(walk.centroids.get('person-1')).toEqual({
      sum: [1, 0, ...current.slice(2)],
      count: 1,
    });
    expect(walk.centroids.has('person-2')).toBe(false);
    expect(walk.legacyAssetIds).toEqual(['asset-legacy']);
    expect(walk.legacyCount).toBe(1);
    expect(walk.unassigned.map((f) => f.id)).toEqual(['unassigned']);
    expect(walk.total).toBe(4);
  });

  it('sends one lookup for the caller-capped id list', async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve(jsonResponse(200, { items: [], total: 0, limit: 0, offset: 0 })),
    );
    // contract: face.cluster caps at LEGACY_REEMBED_PER_RUN (100) before calling — no chunking here
    const ids = Array.from({ length: 100 }, () => randomUUID());

    await makeClient().getAssetsByIds('user-1', ids);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]![0]).toBe(
      `http://localhost:3000/worker/assets?ids=${ids.join(',')}`,
    );
  });

  it('applies a cluster plan with both arrays present and no null covers', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { created: 1, assigned: 2 }));

    const result = await makeClient().applyClusters('user-1', {
      creates: [{ clusterLabel: 'cluster-x', faceIds: ['f1', 'f2'] }],
      attaches: [],
    });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://localhost:3000/worker/persons/apply-clusters');
    const body = JSON.parse(init.body as string) as unknown;
    expect(body).toEqual({
      creates: [{ clusterLabel: 'cluster-x', faceIds: ['f1', 'f2'] }],
      attaches: [],
    });
    expect(result).toEqual({ created: 1, assigned: 2 });
  });

  it('replaces faces with the body carrying only the face list', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { count: 1 }));

    const result = await makeClient().replaceFaces('user-1', 'asset-1', [
      { box: { x: 1, y: 2, w: 3, h: 4 }, confidence: 0.9, embedding: [0.1, 0.2] },
    ]);

    expect(result).toEqual({ count: 1 });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://localhost:3000/worker/assets/asset-1/faces');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({
      faces: [{ box: { x: 1, y: 2, w: 3, h: 4 }, confidence: 0.9, embedding: [0.1, 0.2] }],
    });
  });
});
