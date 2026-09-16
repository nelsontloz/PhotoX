import { Injectable, Logger } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository } from 'typeorm'
import type { Job } from 'bullmq'
import { Face, Person } from '@photox/data-access'
import { BullMqService } from './bullmq.service'

interface ClusterJob {
  userId: string
  reason?: 'face-detected' | 'manual'
}

// ponytail: eps/minPts tunable; eps=0.4 cosine distance ≈ cosine similarity 0.6 — empirically good for human face embeddings
const DBSCAN_EPS = 0.4
const DBSCAN_MIN_PTS = 2
// ponytail: slightly more lenient than DBSCAN_EPS — lets singleton noise faces match an existing person centroid within NOISE_ASSIGN_EPS. This catches the common case where one photo of an already-known person has no nearby face to chain off.
const NOISE_ASSIGN_EPS = 0.5

interface FaceItem {
  id: string
  assetId: string
  box: { x: number; y: number; w: number; h: number }
  embedding: number[]
  personId: string | null
}

interface PersonItem {
  id: string
  clusterLabel: string
}

function cosineDistance(a: number[], b: number[]): number {
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
    const rows = await this.faceRepo.find({ where: { userId } })
    const faces: FaceItem[] = rows.map((f) => ({
      id: f.id,
      assetId: f.assetId,
      box: f.box,
      embedding: f.embedding,
      personId: f.personId ?? null,
    }))

    if (faces.length === 0) {
      this.logger.log(`No faces for user=${userId}`)
      return
    }

    const unassigned = faces.filter((f) => f.personId === null)

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

    // ponytail: post-DBSCAN noise reassignment — singleton faces with no close neighbor get matched to the nearest existing person centroid within NOISE_ASSIGN_EPS. This catches the common case where one photo of an already-known person has no nearby face to chain off.
    const personCentroids = new Map<string, number[]>()
    const facesByPerson = new Map<string, FaceItem[]>()
    for (const f of faces) {
      if (f.personId === null) continue
      const arr = facesByPerson.get(f.personId) ?? []
      arr.push(f)
      facesByPerson.set(f.personId, arr)
    }
    for (const [pid, pfs] of facesByPerson) {
      if (pfs.length === 0) continue
      const dim = pfs[0]!.embedding.length
      const centroid = new Array<number>(dim).fill(0)
      for (const f of pfs) {
        for (let i = 0; i < dim; i++) centroid[i]! += f.embedding[i]!
      }
      for (let i = 0; i < dim; i++) centroid[i]! /= pfs.length
      personCentroids.set(pid, centroid)
    }

    let noiseReassigned = 0
    for (const face of noiseFaces) {
      let bestPersonId: string | null = null
      let bestDist = Infinity
      for (const [pid, centroid] of personCentroids) {
        const d = cosineDistance(face.embedding, centroid)
        if (d < bestDist) {
          bestDist = d
          bestPersonId = pid
        }
      }
      if (bestPersonId !== null && bestDist <= NOISE_ASSIGN_EPS) {
        await this.faceRepo.update({ id: face.id, userId }, { personId: bestPersonId })
        await this.refreshFaceCount(bestPersonId, userId)
        noiseReassigned++
      }
    }

    const existingPersons: PersonItem[] = (
      await this.personRepo.find({ where: { userId } })
    ).map((p) => ({ id: p.id, clusterLabel: p.clusterLabel ?? '' }))

    const labelToPersonId = new Map<string, string>()
    for (const p of existingPersons) {
      labelToPersonId.set(p.clusterLabel, p.id)
    }

    for (const [clusterLabel, facesInCluster] of clusters) {
      const key = `cluster-${clusterLabel}`
      let personId = labelToPersonId.get(key)

      if (!personId) {
        const saved = await this.personRepo.save(
          this.personRepo.create({ userId, name: null, clusterLabel: key, faceCount: 0 }),
        )
        personId = saved.id
        labelToPersonId.set(key, personId)
      }

      for (const face of facesInCluster) {
        await this.faceRepo.update({ id: face.id, userId }, { personId })
      }
      await this.refreshFaceCount(personId, userId)

      const coverFace = facesInCluster.reduce((best, f) =>
        f.box.w * f.box.h > best.box.w * best.box.h ? f : best,
      )
      await this.personRepo.update({ id: personId, userId }, { coverFaceId: coverFace.id })
    }

    this.logger.log(
      `Clustered ${unassigned.length} unassigned faces into ${clusters.size} groups (${noiseReassigned} noise faces reassigned to existing persons) for user=${userId}`,
    )
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
    await this.personRepo.update({ id: personId, userId }, { faceCount: Number(result?.count ?? 0) })
  }
}
