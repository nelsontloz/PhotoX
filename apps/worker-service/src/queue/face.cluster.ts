import { Injectable, Logger } from '@nestjs/common'
import { randomUUID } from 'crypto'
import type { Job } from 'bullmq'
import { FACE_EMBEDDING_DIM } from '@photox/shared-types'
import type { FaceDetectorKind } from '@photox/shared-types'
import { BullMqService } from './bullmq.service'
import { parseJobData, clusterJobSchema, type ClusterJob } from './job-schemas'
import type {
  ApplyClusterAttach,
  ApplyClusterCreate,
  ClusterFace,
} from '../core/core-client.service'
import { CoreClient } from '../core/core-client.service'

// ponytail: ArcFace-family tuning — DBSCAN_EPS 0.35 means similarity >= 0.65; this is a pair radius,
// not a transitivity radius, so old 0.55 (similarity 0.45) chained different people through
// near-neighbours. Centroid matching is the merge guard now, not a looser eps
const DBSCAN_EPS = 0.35
const DBSCAN_MIN_PTS = 2
// ponytail: NOISE_ASSIGN_EPS 0.30 (similarity 0.70) is stricter than DBSCAN_EPS 0.35 — singleton
// noise faces only join an existing person centroid when clearly inside the clustering radius;
// looser values re-merged distinct people
const NOISE_ASSIGN_EPS = 0.3
// ponytail: a cluster centroid attaches to the nearest existing person within CLUSTER_MATCH_EPS 0.30
// (similarity 0.70) AND only if it beats the runner-up by CLUSTER_MATCH_MARGIN — near-ties between two
// persons stay over-split (merging people is curated separately) instead of silently attaching to the
// wrong one; no match gets a random run-local label, else `cluster-N` labels merged people across runs
const CLUSTER_MATCH_EPS = 0.3
const CLUSTER_MATCH_MARGIN = 0.05
// ponytail: low-confidence detections stay stored but don't vote in clustering or centroids
const CLUSTER_MIN_CONFIDENCE = 0.4
// ponytail: cap legacy re-embed enqueues per run — rest follow on later runs, no storm on big libraries
const LEGACY_REEMBED_PER_RUN = 100

function cosineDistance(a: number[], b: number[]): number {
  // ponytail: cross-dim rows (legacy 1024-dim vs current 512-dim) are incomparable — max distance, never match
  if (a.length !== b.length || a.length === 0) return 1
  let dot = 0
  let normA = 0
  let normB = 0
  for (let i = 0; i < a.length; i++) {
    const ai = a[i]!
    const bi = b[i]!
    dot += ai * bi
    normA += ai * ai
    normB += bi * bi
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB)
  if (denom === 0) return 1
  return 1 - dot / denom
}

function centroidOf(embeddings: number[][]): number[] {
  const dim = embeddings[0]!.length
  const centroid = new Array<number>(dim).fill(0)
  for (const e of embeddings) {
    for (let i = 0; i < dim; i++) centroid[i]! += e[i]!
  }
  for (let i = 0; i < dim; i++) centroid[i]! /= embeddings.length
  return centroid
}

// ponytail: O(n²) in-memory DBSCAN — fine for v1 personal photo library (hundreds, not thousands of faces).
// Upgrade path: use pgvector HNSW nearest-neighbor queries in media-service when N > ~10k faces per user.
function dbscan(points: number[][], eps: number, minPts: number): number[] {
  const n = points.length
  const UNVISITED = -2
  const NOISE = -1
  const labels = new Array<number>(n).fill(UNVISITED)
  let clusterId = 0

  for (let i = 0; i < n; i++) {
    if (labels[i] !== UNVISITED) continue

    const neighbors: number[] = []
    for (let j = 0; j < n; j++) {
      if (cosineDistance(points[i]!, points[j]!) <= eps) {
        neighbors.push(j)
      }
    }

    if (neighbors.length < minPts) {
      labels[i] = NOISE
      continue
    }

    labels[i] = clusterId
    const queue = [...neighbors]
    const seen = new Set(neighbors)

    while (queue.length > 0) {
      const q = queue.pop()!

      if (labels[q] === NOISE) labels[q] = clusterId
      if (labels[q] === UNVISITED) labels[q] = clusterId
      if (labels[q] !== clusterId) continue

      const qNeighbors: number[] = []
      for (let j = 0; j < n; j++) {
        if (cosineDistance(points[q]!, points[j]!) <= eps) {
          qNeighbors.push(j)
        }
      }

      if (qNeighbors.length >= minPts) {
        for (const nn of qNeighbors) {
          if (!seen.has(nn)) {
            seen.add(nn)
            queue.push(nn)
          }
        }
      }
    }

    clusterId++
  }

  return labels
}

@Injectable()
export class FaceClusterService {
  private readonly logger = new Logger(FaceClusterService.name)

  constructor(
    private readonly bullMq: BullMqService,
    private readonly core: CoreClient,
  ) {}

  start() {
    this.bullMq.createWorker<ClusterJob>('process-faces-cluster', (job) => this.processJob(job), {
      concurrency: 1,
    })
    this.logger.log('Face cluster processor listening for jobs')
  }

  private async processJob(job: Job<ClusterJob>) {
    const { userId, reason } = parseJobData(clusterJobSchema, job.data, 'process-faces-cluster')
    this.logger.log(`Clustering faces: user=${userId}, reason=${reason ?? 'unknown'}`)
    await this.cluster(userId)
    this.logger.log(`Clustering complete: user=${userId}`)
  }

  async cluster(userId: string): Promise<void> {
    // core's E1 endpoint excludes trashed assets (trashed faces stay stored, just don't vote)
    const faces = await this.core.getFacesForCluster(userId)

    if (faces.length === 0) {
      this.logger.log(`No faces for user=${userId}`)
      return
    }

    // ponytail: legacy-dim rows (pre-buffalo_l 1024-dim) are incomparable — never cluster or cast
    // in place; unassigned ones get their assets re-enqueued for re-embed (processor deletes +
    // re-saves at 512-dim), assigned ones stay frozen until their asset re-embeds
    const legacyUnassigned = faces.filter(
      (f) => f.personId === null && f.embedding.length !== FACE_EMBEDDING_DIM,
    )
    if (legacyUnassigned.length > 0) {
      const assetIds = [...new Set(legacyUnassigned.map((f) => f.assetId))].slice(
        0,
        LEGACY_REEMBED_PER_RUN,
      )
      // ponytail: stamp the configured detector into re-embed jobs — settings fetched only when
      // there is re-embed work to enqueue
      const settings = await this.core.getFaceDetectionSettings()
      await this.enqueueReembed(assetIds, userId, settings.detector)
      this.logger.log(
        `Skipped ${legacyUnassigned.length} legacy-dim faces, re-embed enqueued for ` +
          `${assetIds.length} assets: user=${userId}`,
      )
    }

    const unassigned = faces.filter(
      (f) =>
        f.personId === null &&
        f.confidence >= CLUSTER_MIN_CONFIDENCE &&
        f.embedding.length === FACE_EMBEDDING_DIM,
    )

    if (unassigned.length === 0) {
      this.logger.log(`No unassigned faces for user=${userId}, skipping clustering`)
      return
    }

    const embeddings = unassigned.map((f) => f.embedding)
    const labels = dbscan(embeddings, DBSCAN_EPS, DBSCAN_MIN_PTS)

    const clusters = new Map<number, ClusterFace[]>()
    const noiseFaces: ClusterFace[] = []
    for (let i = 0; i < unassigned.length; i++) {
      const label = labels[i]!
      if (label === -1) {
        noiseFaces.push(unassigned[i]!)
        continue
      }
      const arr = clusters.get(label) ?? []
      arr.push(unassigned[i]!)
      clusters.set(label, arr)
    }

    if (clusters.size === 0) {
      this.logger.log(`No clusters for user=${userId}, all faces are noise`)
    }

    // ponytail: centroids from high-confidence current-dim faces only — low-conf and legacy
    // faces stay stored, just don't vote
    const personCentroids = new Map<string, number[]>()
    const facesByPerson = new Map<string, ClusterFace[]>()
    for (const f of faces) {
      if (
        f.personId === null ||
        f.confidence < CLUSTER_MIN_CONFIDENCE ||
        f.embedding.length !== FACE_EMBEDDING_DIM
      )
        continue
      const arr = facesByPerson.get(f.personId) ?? []
      arr.push(f)
      facesByPerson.set(f.personId, arr)
    }
    const refreshCentroid = (pid: string) => {
      const pfs = facesByPerson.get(pid) ?? []
      if (pfs.length === 0) personCentroids.delete(pid)
      else personCentroids.set(pid, centroidOf(pfs.map((f) => f.embedding)))
    }
    for (const pid of facesByPerson.keys()) refreshCentroid(pid)

    const nearestPerson = (
      embedding: number[],
    ): { id: string; dist: number; runnerUp: number } | null => {
      let best: { id: string; dist: number; runnerUp: number } | null = null
      for (const [pid, centroid] of personCentroids) {
        const d = cosineDistance(embedding, centroid)
        if (best === null) {
          best = { id: pid, dist: d, runnerUp: Infinity }
        } else if (d < best.dist) {
          best = { id: pid, dist: d, runnerUp: best.dist }
        } else if (d < best.runnerUp) {
          best.runnerUp = d
        }
      }
      return best
    }

    // write phase: build one atomic plan for E3 instead of per-face DB writes
    const creates: ApplyClusterCreate[] = []
    const attaches: ApplyClusterAttach[] = []
    // ponytail: a create's label doubles as its in-run centroid key — E3 creates have no DB id yet
    const pendingCreates = new Map<string, ApplyClusterCreate>()

    // ponytail: post-DBSCAN noise reassignment — singleton faces with no close neighbor get matched to the nearest existing person centroid within NOISE_ASSIGN_EPS. This catches the common case where one photo of an already-known person has no nearby face to chain off.
    let noiseReassigned = 0
    for (const face of noiseFaces) {
      const best = nearestPerson(face.embedding)
      if (
        best !== null &&
        best.dist <= NOISE_ASSIGN_EPS &&
        best.runnerUp - best.dist >= CLUSTER_MATCH_MARGIN
      ) {
        face.personId = best.id
        facesByPerson.get(best.id)!.push(face)
        refreshCentroid(best.id)
        // noise attaches carry no cover (parity with the old per-face update)
        const attach = attaches.find((a) => a.personId === best.id && a.coverFaceId === undefined)
        if (attach) attach.faceIds.push(face.id)
        else attaches.push({ personId: best.id, faceIds: [face.id] })
        noiseReassigned++
      }
    }

    for (const facesInCluster of clusters.values()) {
      const newCentroid = centroidOf(facesInCluster.map((f) => f.embedding))
      const best = nearestPerson(newCentroid)
      const personId =
        best !== null &&
        best.dist <= CLUSTER_MATCH_EPS &&
        best.runnerUp - best.dist >= CLUSTER_MATCH_MARGIN
          ? best.id
          : null

      const coverFace = facesInCluster.reduce((bestFace, f) =>
        f.box.w * f.box.h > bestFace.box.w * bestFace.box.h ? f : bestFace,
      )

      if (personId === null) {
        const clusterLabel = `cluster-${randomUUID()}`
        const create: ApplyClusterCreate = {
          clusterLabel,
          faceIds: facesInCluster.map((f) => f.id),
          coverFaceId: coverFace.id,
        }
        creates.push(create)
        pendingCreates.set(clusterLabel, create)
        personCentroids.set(clusterLabel, newCentroid)
        facesByPerson.set(clusterLabel, [])
        for (const face of facesInCluster) {
          face.personId = clusterLabel
          facesByPerson.get(clusterLabel)!.push(face)
        }
        refreshCentroid(clusterLabel)
        continue
      }

      const pending = pendingCreates.get(personId)
      if (pending) {
        // ponytail: old code attached to the person created earlier in the same run; E3 can't
        // reference a create's id, so merge into that create — same final DB state
        pending.faceIds.push(...facesInCluster.map((f) => f.id))
        pending.coverFaceId = coverFace.id
      } else {
        attaches.push({
          personId,
          faceIds: facesInCluster.map((f) => f.id),
          coverFaceId: coverFace.id,
        })
      }

      for (const face of facesInCluster) {
        face.personId = personId
        facesByPerson.get(personId)!.push(face)
      }
      // ponytail: refresh so later clusters in the same run match against faces attached earlier
      refreshCentroid(personId)
    }

    if (creates.length === 0 && attaches.length === 0) {
      this.logger.log(`No cluster plan for user=${userId}, nothing to apply`)
      return
    }

    const result = await this.core.applyClusters(userId, { creates, attaches })
    this.logger.log(
      `Clustered ${unassigned.length} unassigned faces into ${clusters.size} groups ` +
        `(${noiseReassigned} noise faces reassigned to existing persons) for user=${userId}; ` +
        `applied created=${result.created}, assigned=${result.assigned}`,
    )
  }

  private async enqueueReembed(
    assetIds: string[],
    userId: string,
    detector: FaceDetectorKind,
  ): Promise<void> {
    const assets = await this.core.getAssetsByIds(userId, assetIds)
    for (const a of assets) {
      await this.bullMq.enqueue(
        'process-faces',
        're-embed',
        { assetId: a.id, fileId: a.fileId, userId, reason: 're-embed', detector },
        {
          jobId: `face-reembed-${a.id}`,
          attempts: 3,
          backoff: { type: 'exponential' },
          removeOnFail: true,
        },
      )
    }
  }
}
