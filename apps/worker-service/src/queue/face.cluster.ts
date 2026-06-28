import { Injectable, Logger } from '@nestjs/common'
import { HttpService } from '@nestjs/axios'
import { firstValueFrom } from 'rxjs'
import { SERVICE_URLS } from '@photox/shared-config'

// ponytail: eps/minPts tunable; eps=0.4 cosine distance ≈ cosine similarity 0.6 — empirically good for human face embeddings
const DBSCAN_EPS = 0.4
const DBSCAN_MIN_PTS = 2

interface FaceItem {
  id: string
  assetId: string
  box: { x: number; y: number; w: number; h: number }
  embedding: number[]
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

  constructor(private readonly http: HttpService) {}

  async cluster(userId: string): Promise<void> {
    const facesUrl = `${SERVICE_URLS['media-service']}/v1/faces?userId=${encodeURIComponent(userId)}&includeEmbeddings=true`
    const res = await firstValueFrom(this.http.get<{ items: FaceItem[] }>(facesUrl, { timeout: 30_000 }))
    const faces = res.data.items

    if (faces.length === 0) {
      this.logger.log(`No faces for user=${userId}`)
      return
    }

    const embeddings = faces.map((f) => f.embedding)
    const labels = dbscan(embeddings, DBSCAN_EPS, DBSCAN_MIN_PTS)

    const clusters = new Map<number, FaceItem[]>()
    for (let i = 0; i < faces.length; i++) {
      const label = labels[i]!
      if (label === -1) continue
      const arr = clusters.get(label) ?? []
      arr.push(faces[i]!)
      clusters.set(label, arr)
    }

    if (clusters.size === 0) {
      this.logger.log(`No clusters for user=${userId}, all faces are noise`)
      return
    }

    const personsUrl = `${SERVICE_URLS['media-service']}/v1/persons?userId=${encodeURIComponent(userId)}`
    const personsRes = await firstValueFrom(
      this.http.get<{ items: PersonItem[] }>(personsUrl, { timeout: 10_000 }),
    )
    const existingPersons = personsRes.data.items

    const labelToPersonId = new Map<string, string>()
    for (const p of existingPersons) {
      labelToPersonId.set(p.clusterLabel, p.id)
    }

    let nextClusterIdx = 0
    for (const [label] of clusters) {
      while (labelToPersonId.has(`cluster-${nextClusterIdx}`)) nextClusterIdx++
      const key = `cluster-${label}`
      if (!labelToPersonId.has(key)) {
        labelToPersonId.set(key, `cluster-${nextClusterIdx}`)
        nextClusterIdx++
      }
    }

    for (const [clusterLabel, facesInCluster] of clusters) {
      const key = `cluster-${clusterLabel}`
      let personId = labelToPersonId.get(key)

      if (!personId) {
        const createUrl = `${SERVICE_URLS['media-service']}/v1/persons`
        const createRes = await firstValueFrom(
          this.http.post<{ id: string }>(createUrl, { userId, name: key, clusterLabel: key }),
        )
        personId = createRes.data.id
        labelToPersonId.set(key, personId)
      }

      for (const face of facesInCluster) {
        const patchFaceUrl = `${SERVICE_URLS['media-service']}/v1/faces/${face.id}/person`
        await firstValueFrom(
          this.http.patch(patchFaceUrl, { userId, personId }),
        )
      }

      const coverFace = facesInCluster.reduce((best, f) =>
        f.box.w * f.box.h > best.box.w * best.box.h ? f : best,
      )
      const coverUrl = `${SERVICE_URLS['media-service']}/v1/persons/${personId}/cover`
      await firstValueFrom(
        this.http.patch(coverUrl, { userId, faceId: coverFace.id }),
      )
    }

    this.logger.log(`Clustered ${faces.length} faces into ${clusters.size} groups for user=${userId}`)
  }
}
