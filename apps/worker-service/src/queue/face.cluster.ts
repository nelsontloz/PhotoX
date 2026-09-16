import { Injectable, Logger } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { In, Repository } from 'typeorm'
import { randomUUID } from 'crypto'
import type { Job } from 'bullmq'
import { Asset, Face, FACE_EMBEDDING_DIM, Person } from '@photox/data-access'
import { BullMqService } from './bullmq.service'

interface ClusterJob {
  userId: string
  reason?: 'face-detected' | 'manual'
}

// ponytail: ArcFace-family tuning — same-person cosine distance typically ~0.3-0.6, so eps sits
// above the old faceres 0.3x values; centroid matching (not tighter eps) is the merge guard now
const DBSCAN_EPS = 0.55
const DBSCAN_MIN_PTS = 2
// ponytail: NOISE_ASSIGN_EPS <= DBSCAN_EPS invariant — singleton noise faces only join an existing person centroid strictly inside the clustering radius; looser values re-merged distinct people
const NOISE_ASSIGN_EPS = 0.5
// ponytail: new clusters attach to the nearest existing person centroid within CLUSTER_MATCH_EPS, else get a random label — run-local `cluster-N` labels merged different people across runs
const CLUSTER_MATCH_EPS = 0.5
// ponytail: low-confidence detections stay stored but don't vote in clustering or centroids
const CLUSTER_MIN_CONFIDENCE = 0.4
// ponytail: cap legacy re-embed enqueues per run — rest follow on later runs, no storm on big libraries
const LEGACY_REEMBED_PER_RUN = 100

interface FaceItem {
  id: string
  assetId: string
  box: { x: number; y: number; w: number; h: number }
  embedding: number[]
  confidence: number
  personId: string | null
}

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
    @InjectRepository(Face)
    private readonly faceRepo: Repository<Face>,
    @InjectRepository(Person)
    private readonly personRepo: Repository<Person>,
    private readonly bullMq: BullMqService,
    @InjectRepository(Asset)
    private readonly assetRepo: Repository<Asset>,
  ) {}

  start() {
    this.bullMq.createWorker<ClusterJob>('process-faces-cluster', (job) => this.processJob(job), {
      concurrency: 1,
    })
    this.logger.log('Face cluster processor listening for jobs')
  }

  private async processJob(job: Job<ClusterJob>) {
    const { userId, reason } = job.data
    this.logger.log(`Clustering faces: user=${userId}, reason=${reason ?? 'unknown'}`)
    await this.cluster(userId)
    this.logger.log(`Clustering complete: user=${userId}`)
  }

  async cluster(userId: string): Promise<void> {
    // ponytail: innerJoin drops trashed assets — trashed faces stay stored, just don't vote
    const rows = await this.faceRepo
      .createQueryBuilder('f')
      .innerJoin('assets', 'a', 'a.id = f."assetId"')
      .where('f."userId" = :userId', { userId })
      .andWhere('a."isTrashed" = :isTrashed', { isTrashed: false })
      .getMany()
    const faces: FaceItem[] = rows.map((f) => ({
      id: f.id,
      assetId: f.assetId,
      box: f.box,
      embedding: f.embedding,
      confidence: f.confidence,
      personId: f.personId ?? null,
    }))

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
      await this.enqueueReembed(assetIds, userId)
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

    const clusters = new Map<number, FaceItem[]>()
    const noiseFaces: FaceItem[] = []
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
    const facesByPerson = new Map<string, FaceItem[]>()
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

    const nearestPerson = (embedding: number[]): { id: string; dist: number } | null => {
      let best: { id: string; dist: number } | null = null
      for (const [pid, centroid] of personCentroids) {
        const d = cosineDistance(embedding, centroid)
        if (best === null || d < best.dist) best = { id: pid, dist: d }
      }
      return best
    }

    // ponytail: post-DBSCAN noise reassignment — singleton faces with no close neighbor get matched to the nearest existing person centroid within NOISE_ASSIGN_EPS. This catches the common case where one photo of an already-known person has no nearby face to chain off.
    let noiseReassigned = 0
    for (const face of noiseFaces) {
      const best = nearestPerson(face.embedding)
      if (best !== null && best.dist <= NOISE_ASSIGN_EPS) {
        await this.faceRepo.update({ id: face.id, userId }, { personId: best.id })
        face.personId = best.id
        facesByPerson.get(best.id)!.push(face)
        refreshCentroid(best.id)
        await this.refreshFaceCount(best.id, userId)
        noiseReassigned++
      }
    }

    for (const facesInCluster of clusters.values()) {
      const newCentroid = centroidOf(facesInCluster.map((f) => f.embedding))
      const best = nearestPerson(newCentroid)
      let personId: string | null = best !== null && best.dist <= CLUSTER_MATCH_EPS ? best.id : null

      if (personId === null) {
        const saved = await this.personRepo.save(
          this.personRepo.create({
            userId,
            name: null,
            clusterLabel: `cluster-${randomUUID()}`,
            faceCount: 0,
          }),
        )
        personId = saved.id
        personCentroids.set(personId, newCentroid)
        facesByPerson.set(personId, [])
      }

      for (const face of facesInCluster) {
        await this.faceRepo.update({ id: face.id, userId }, { personId })
        face.personId = personId
        facesByPerson.get(personId)!.push(face)
      }
      // ponytail: refresh so later clusters in the same run match against faces attached earlier
      refreshCentroid(personId)
      await this.refreshFaceCount(personId, userId)

      const coverFace = facesInCluster.reduce((bestFace, f) =>
        f.box.w * f.box.h > bestFace.box.w * bestFace.box.h ? f : bestFace,
      )
      await this.personRepo.update({ id: personId, userId }, { coverFaceId: coverFace.id })
    }

    this.logger.log(
      `Clustered ${unassigned.length} unassigned faces into ${clusters.size} groups (${noiseReassigned} noise faces reassigned to existing persons) for user=${userId}`,
    )
  }

  private async enqueueReembed(assetIds: string[], userId: string): Promise<void> {
    const assets = await this.assetRepo.find({ where: { id: In(assetIds), userId } })
    for (const a of assets) {
      await this.bullMq.enqueue(
        'process-faces',
        're-embed',
        { assetId: a.id, fileId: a.fileId, userId, reason: 're-embed' },
        {
          jobId: `face-reembed-${a.id}`,
          attempts: 3,
          backoff: { type: 'exponential' },
          removeOnFail: true,
        },
      )
    }
  }

  private async refreshFaceCount(personId: string, userId: string): Promise<void> {
    const result = await this.faceRepo
      .createQueryBuilder('f')
      .innerJoin('assets', 'a', 'a.id = f."assetId"')
      .select('COUNT(*)')
      .where('f."personId" = :personId', { personId })
      .andWhere('f."userId" = :userId', { userId })
      .andWhere('a."isTrashed" = :isTrashed', { isTrashed: false })
      .getRawOne<{ count: string }>()
    await this.personRepo.update(
      { id: personId, userId },
      { faceCount: Number(result?.count ?? 0) },
    )
  }
}
