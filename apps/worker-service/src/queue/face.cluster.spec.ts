import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FACE_EMBEDDING_DIM } from '@photox/shared-types';
import { FaceClusterService, dbscan } from './face.cluster';
import { FakeCoreClient, makeAsset } from '../../test/fake-core-client';
import type { ClusterFace, ClusterFaceWalk } from '../core/core-client.service';

const DBSCAN_EPS = 0.35;
const DBSCAN_MIN_PTS = 2;

const emb512 = (...pairs: [number, number][]): number[] => {
  const v = new Array<number>(FACE_EMBEDDING_DIM).fill(0);
  for (const [i, val] of pairs) v[i] = val;
  return v;
};

describe('FaceClusterService.cluster', () => {
  const userId = 'user-1';
  const face = (
    id: string,
    embedding: number[],
    personId: string | null = null,
    confidence = 0.9,
    size = 100,
  ): ClusterFace => ({
    id,
    assetId: `asset-${id}`,
    box: { x: 0, y: 0, w: size, h: size },
    embedding,
    confidence,
    personId,
  });

  let fake: FakeCoreClient;
  let enqueueMock: ReturnType<typeof vi.fn>;
  let service: FaceClusterService;

  beforeEach(() => {
    fake = new FakeCoreClient();
    fake.clusterFaces.push(
      face('face-assigned', emb512([0, 1]), 'person-existing'),
      face('face-a', emb512([1, 1]), null, 0.9, 120),
      face('face-b', emb512([1, 1])),
    );
    enqueueMock = vi.fn().mockResolvedValue(undefined);
    service = new FaceClusterService({ enqueue: enqueueMock } as never, fake as never);
  });

  it('clusters only unassigned faces and never touches manually assigned ones', async () => {
    await service.cluster(userId);

    expect(fake.applyClustersCalls).toHaveLength(1);
    const plan = fake.applyClustersCalls[0]!;
    expect(plan.attaches).toEqual([]);
    expect(plan.creates).toHaveLength(1);
    expect(plan.creates[0]!.faceIds).toEqual(['face-a', 'face-b']);
    expect(plan.creates[0]!.coverFaceId).toBe('face-a');
    expect(plan.creates[0]!.clusterLabel).toMatch(
      /^cluster-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    expect(fake.clusterFaces.find((f) => f.id === 'face-assigned')!.personId).toBe(
      'person-existing',
    );
    // no truncation: nothing to chain
    expect(enqueueMock).not.toHaveBeenCalled();
  });

  it('attaches a cluster to the nearest existing person with the largest-box cover', async () => {
    fake.clusterFaces.splice(0, fake.clusterFaces.length);
    fake.clusterFaces.push(
      face('face-known-a', emb512([1, 1]), 'person-existing', 0.9, 50),
      face('face-known-b', emb512([1, 1]), 'person-existing', 0.9, 50),
      face('face-a', emb512([1, 1]), null, 0.9, 120),
      face('face-b', emb512([1, 1])),
    );

    await service.cluster(userId);

    const plan = fake.applyClustersCalls[0]!;
    expect(plan.creates).toEqual([]);
    expect(plan.attaches).toEqual([
      { personId: 'person-existing', faceIds: ['face-a', 'face-b'], coverFaceId: 'face-a' },
    ]);
  });

  it('merges a later cluster into an earlier pending create instead of attaching by fake id', async () => {
    // adjacent vectors chain (-10°→10° ≈ 0.06, 10°→45° ≈ 0.18, 45°→65° ≈ 0.06, each ≤ eps), so all
    // four faces land in one DBSCAN cluster and a single create — no cross distances above eps
    const dir = (deg: number) => {
      const rad = (deg * Math.PI) / 180;
      return emb512([0, Math.cos(rad)], [1, Math.sin(rad)]);
    };
    fake.clusterFaces.splice(0, fake.clusterFaces.length);
    fake.clusterFaces.push(
      face('face-a1', dir(-10), null, 0.9, 100),
      face('face-a2', dir(10), null, 0.9, 100),
      face('face-b1', dir(45), null, 0.9, 120),
      face('face-b2', dir(65), null, 0.9, 90),
    );

    await service.cluster(userId);

    expect(fake.applyClustersCalls).toHaveLength(1);
    const plan = fake.applyClustersCalls[0]!;
    expect(plan.attaches).toEqual([]);
    expect(plan.creates).toHaveLength(1);
    expect(new Set(plan.creates[0]!.faceIds)).toEqual(
      new Set(['face-a1', 'face-a2', 'face-b1', 'face-b2']),
    );
    expect(plan.creates[0]!.coverFaceId).toBe('face-b1');
  });

  it('blocks attach when two existing persons are near-tied for the candidate', async () => {
    // candidate sits at 12.5°, equidistant (~0.024) from person-1 at 0° and person-2 at 25°:
    // runner-up margin ~0 < CLUSTER_MATCH_MARGIN, so the cluster stays a create (over-split)
    const dir = (deg: number) => {
      const rad = (deg * Math.PI) / 180;
      return emb512([0, Math.cos(rad)], [1, Math.sin(rad)]);
    };
    fake.clusterFaces.splice(0, fake.clusterFaces.length);
    fake.clusterFaces.push(
      face('face-p1', dir(0), 'person-1'),
      face('face-p2', dir(25), 'person-2'),
      face('face-c1', dir(12.5), null, 0.9, 120),
      face('face-c2', dir(12.5)),
    );

    await service.cluster(userId);

    expect(fake.applyClustersCalls).toHaveLength(1);
    const plan = fake.applyClustersCalls[0]!;
    expect(plan.attaches).toEqual([]);
    expect(plan.creates).toHaveLength(1);
    expect(new Set(plan.creates[0]!.faceIds)).toEqual(new Set(['face-c1', 'face-c2']));
  });

  it('attaches when the nearest person clearly beats the runner-up', async () => {
    // candidate at 5°: person-1 at 0° is ~0.004 away, person-2 at 60° is ~0.43 away — clear winner
    const dir = (deg: number) => {
      const rad = (deg * Math.PI) / 180;
      return emb512([0, Math.cos(rad)], [1, Math.sin(rad)]);
    };
    fake.clusterFaces.splice(0, fake.clusterFaces.length);
    fake.clusterFaces.push(
      face('face-p1', dir(0), 'person-1'),
      face('face-p2', dir(60), 'person-2'),
      face('face-c1', dir(5), null, 0.9, 120),
      face('face-c2', dir(5)),
    );

    await service.cluster(userId);

    expect(fake.applyClustersCalls).toHaveLength(1);
    const plan = fake.applyClustersCalls[0]!;
    expect(plan.creates).toEqual([]);
    expect(plan.attaches).toEqual([
      { personId: 'person-1', faceIds: ['face-c1', 'face-c2'], coverFaceId: 'face-c1' },
    ]);
  });

  it('reassigns a lone noise face just inside the noise threshold', async () => {
    // cosine distance 1 - cos(41°) ≈ 0.245: inside NOISE_ASSIGN_EPS 0.30, sole person so no runner-up
    const dir = (deg: number) => {
      const rad = (deg * Math.PI) / 180;
      return emb512([0, Math.cos(rad)], [1, Math.sin(rad)]);
    };
    fake.clusterFaces.splice(0, fake.clusterFaces.length);
    fake.clusterFaces.push(
      face('face-known', dir(0), 'person-existing'),
      face('face-noise', dir(41)),
    );

    await service.cluster(userId);

    expect(fake.applyClustersCalls).toHaveLength(1);
    const plan = fake.applyClustersCalls[0]!;
    expect(plan.creates).toEqual([]);
    expect(plan.attaches).toEqual([{ personId: 'person-existing', faceIds: ['face-noise'] }]);
  });

  it('does not merge different people across runs', async () => {
    fake.clusterFaces.splice(0, fake.clusterFaces.length);
    fake.clusterFaces.push(face('face-a1', emb512([0, 1])), face('face-a2', emb512([0, 1])));
    await service.cluster(userId);
    expect(fake.applyClustersCalls).toHaveLength(1);
    const firstPersonId = fake.clusterFaces[0]!.personId;
    expect(firstPersonId).not.toBeNull();

    fake.clusterFaces.push(face('face-b1', emb512([1, 1])), face('face-b2', emb512([1, 1])));
    await service.cluster(userId);

    expect(fake.applyClustersCalls).toHaveLength(2);
    expect(fake.applyClustersCalls[1]!.creates).toHaveLength(1);
    expect(fake.applyClustersCalls[1]!.attaches).toEqual([]);
    const bFaces = fake.clusterFaces.filter((f) => f.id === 'face-b1' || f.id === 'face-b2');
    expect(bFaces[0]!.personId).not.toBeNull();
    expect(bFaces[0]!.personId).toBe(bFaces[1]!.personId);
    expect(bFaces[0]!.personId).not.toBe(firstPersonId);
  });

  it('keeps singleton noise faces unassigned beyond the tight noise threshold', async () => {
    // cosine distance 0.6 from the existing centroid: outside NOISE_ASSIGN_EPS 0.30 and DBSCAN 0.35
    fake.clusterFaces.splice(0, fake.clusterFaces.length);
    fake.clusterFaces.push(
      face('face-known', emb512([0, 1]), 'person-existing'),
      face('face-noise', emb512([0, 0.4], [1, 0.9165])),
    );
    await service.cluster(userId);

    expect(fake.applyClustersCalls).toHaveLength(0);
    expect(fake.clusterFaces.find((f) => f.id === 'face-noise')!.personId).toBeNull();
  });

  it('ignores low-confidence faces for clustering but leaves them stored', async () => {
    fake.clusterFaces.splice(0, fake.clusterFaces.length);
    fake.clusterFaces.push(
      face('face-lo-a', emb512([1, 1]), null, 0.2),
      face('face-lo-b', emb512([1, 1]), null, 0.2),
    );
    await service.cluster(userId);

    expect(fake.applyClustersCalls).toHaveLength(0);
    expect(fake.clusterFaces.every((f) => f.personId === null)).toBe(true);
  });

  it('skips legacy-dim rows and re-enqueues their assets for re-embed', async () => {
    fake.clusterFaces.splice(0, fake.clusterFaces.length);
    fake.clusterFaces.push(
      { ...face('face-old-assigned', [1, 0, 0, 0], 'person-existing') },
      { ...face('face-old-a', [0, 1, 0, 0]), assetId: 'asset-legacy' },
      { ...face('face-old-b', [0, 1, 0, 0]), assetId: 'asset-legacy' },
    );
    fake.assets.set(
      'asset-legacy',
      makeAsset({ id: 'asset-legacy', userId, fileId: 'file-legacy' }),
    );
    await service.cluster(userId);

    expect(fake.applyClustersCalls).toHaveLength(0);
    expect(
      fake.clusterFaces.every((f) => f.personId === null || f.id === 'face-old-assigned'),
    ).toBe(true);
    expect(fake.callsOf('getAssetsByIds').map((c) => c.args[1])).toEqual([['asset-legacy']]);
    expect(enqueueMock).toHaveBeenCalledTimes(1);
    expect(enqueueMock).toHaveBeenCalledWith(
      'process-faces',
      're-embed',
      {
        assetId: 'asset-legacy',
        fileId: 'file-legacy',
        userId,
      },
      expect.objectContaining({ jobId: 'face-reembed-asset-legacy', removeOnComplete: true }),
    );
  });

  it('defers over-cap faces to exactly one chained continuation without losing the plan', async () => {
    const unassigned = [face('face-a', emb512([0, 1])), face('face-b', emb512([0, 1]))];
    const walk: ClusterFaceWalk = {
      unassigned,
      centroids: new Map(),
      legacyAssetIds: [],
      legacyCount: 0,
      truncated: true,
      deferred: 8_000,
      total: 18_002,
    };
    vi.spyOn(fake, 'getFacesForCluster').mockResolvedValue(walk);

    await service.cluster(userId);

    // the deferred remainder never becomes a failure: this run's plan still applies
    expect(fake.applyClustersCalls).toHaveLength(1);
    expect(fake.applyClustersCalls[0]!.creates[0]!.faceIds).toEqual(['face-a', 'face-b']);

    expect(enqueueMock).toHaveBeenCalledTimes(1);
    const call = enqueueMock.mock.calls[0] as unknown as [
      string,
      string,
      { userId: string },
      { jobId?: string; removeOnComplete?: boolean; delay?: number },
    ];
    expect(call.slice(0, 3)).toEqual(['process-faces-cluster', 'cluster', { userId }]);
    expect(call[3].jobId).toMatch(/^cluster-user-1-cont-\d+$/);
    expect(call[3].removeOnComplete).toBe(true);
    expect(call[3].delay).toBe(2_000);
  });

  it('does not chain a continuation when the walk was not truncated', async () => {
    fake.clusterFaces.splice(0, fake.clusterFaces.length);
    fake.clusterFaces.push(face('face-a1', emb512([0, 1])), face('face-a2', emb512([0, 1])));

    await service.cluster(userId);

    expect(fake.applyClustersCalls).toHaveLength(1);
    expect(enqueueMock).not.toHaveBeenCalled();
  });
});

function referenceCosineDistance(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 1;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    const ai = a[i]!;
    const bi = b[i]!;
    dot += ai * bi;
    normA += ai * ai;
    normB += bi * bi;
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  if (denom === 0) return 1;
  return 1 - dot / denom;
}

// frozen copy of the pre-refactor synchronous loop — the async dbscan must match it label for label
function referenceDbscan(points: number[][], eps: number, minPts: number): number[] {
  const n = points.length;
  const UNVISITED = -2;
  const NOISE = -1;
  const labels = new Array<number>(n).fill(UNVISITED);
  let clusterId = 0;

  for (let i = 0; i < n; i++) {
    if (labels[i] !== UNVISITED) continue;

    const neighbors: number[] = [];
    for (let j = 0; j < n; j++) {
      if (referenceCosineDistance(points[i]!, points[j]!) <= eps) neighbors.push(j);
    }

    if (neighbors.length < minPts) {
      labels[i] = NOISE;
      continue;
    }

    labels[i] = clusterId;
    const queue = [...neighbors];
    const seen = new Set(neighbors);

    while (queue.length > 0) {
      const q = queue.pop()!;
      if (labels[q] === NOISE) labels[q] = clusterId;
      if (labels[q] === UNVISITED) labels[q] = clusterId;
      if (labels[q] !== clusterId) continue;

      const qNeighbors: number[] = [];
      for (let j = 0; j < n; j++) {
        if (referenceCosineDistance(points[q]!, points[j]!) <= eps) qNeighbors.push(j);
      }

      if (qNeighbors.length >= minPts) {
        for (const nn of qNeighbors) {
          if (!seen.has(nn)) {
            seen.add(nn);
            queue.push(nn);
          }
        }
      }
    }

    clusterId++;
  }

  return labels;
}

describe('dbscan', () => {
  function seeded(seed: number): () => number {
    let state = seed >>> 0;
    return () => {
      state = (state * 1664525 + 1013904223) >>> 0;
      return state / 2 ** 32;
    };
  }

  it('labels match the original synchronous implementation on a random fixture', async () => {
    const rand = seeded(42);
    const points: number[][] = [];
    // three tight clusters on orthogonal axes plus one-hot points on unused axes (all noise)
    for (let c = 0; c < 3; c++) {
      for (let k = 0; k < 25; k++) {
        const v = Array.from({ length: 12 }, () => rand() * 0.2);
        v[c] = 1;
        points.push(v);
      }
    }
    for (let k = 0; k < 9; k++) {
      const v = new Array<number>(12).fill(0);
      v[3 + k] = 1;
      points.push(v);
    }

    const expected = referenceDbscan(points, DBSCAN_EPS, DBSCAN_MIN_PTS);
    const labels = await dbscan(points, DBSCAN_EPS, DBSCAN_MIN_PTS);

    expect(new Set(expected)).toEqual(new Set([0, 1, 2, -1]));
    expect(labels).toEqual(expected);
  });

  it('yields to the event loop every yieldEvery work iterations', async () => {
    // one-hot vectors: every pairwise distance is 1, so the whole fixture is noise and the work
    // count is exactly one tick per outer iteration
    const points = Array.from({ length: 100 }, (_, i) => {
      const v = new Array<number>(100).fill(0);
      v[i] = 1;
      return v;
    });
    const pause = vi.fn(() => Promise.resolve());

    const labels = await dbscan(points, DBSCAN_EPS, DBSCAN_MIN_PTS, { yieldEvery: 16, pause });

    expect(labels.every((label) => label === -1)).toBe(true);
    expect(pause).toHaveBeenCalledTimes(Math.floor(100 / 16));
  });
});
