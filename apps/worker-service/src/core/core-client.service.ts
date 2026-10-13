import { Injectable, Logger } from '@nestjs/common'
import { JwtService, type JwtSignOptions } from '@nestjs/jwt'
import { UnrecoverableError } from 'bullmq'
import { loadEnv } from '@photox/shared-config'
import type {
  Asset,
  AssetListResponse,
  AssetThumbnail,
  DetectedFaceInput,
  FaceDetectionSettings,
  FaceDetectorKind,
  FaceDto,
  FileRecord,
  MetadataStatus,
  RegisterDetectionsRequestDto,
  RegisterEmbeddingRequestDto,
  RegisterOcrRequestDto,
  Role,
} from '@photox/shared-types'

export type MetadataPatch = Partial<
  Pick<
    Asset,
    | 'mimeType'
    | 'sizeBytes'
    | 'originalName'
    | 'width'
    | 'height'
    | 'durationSeconds'
    | 'fps'
    | 'codec'
    | 'hasAudio'
    | 'cameraMake'
    | 'cameraModel'
    | 'lensModel'
    | 'orientation'
    | 'iso'
    | 'fNumber'
    | 'exposureTime'
    | 'focalLength'
    | 'latitude'
    | 'longitude'
    | 'altitude'
    | 'metadata'
    | 'transcodeStatus'
    | 'thumbnailStatus'
    | 'transcodeFileId'
    | 'faceStatus'
    | 'faceCount'
  >
> & {
  // Date is not an Asset field: metadata jobs pass Date, JSON.stringify sends the same ISO wire string
  takenAt?: Date | null
  status?: MetadataStatus
  // set by process-embeddings on failure; core's UpdateMetadataDto must whitelist it (sibling lane)
  embeddingStatus?: MetadataStatus
  // 16-char lowercase dHash hex set by process-metadata; core's UpdateMetadataDto must whitelist it
  phash?: string
}

export type RegisterFileInput = Pick<
  FileRecord,
  'id' | 'originalName' | 'mimeType' | 'sizeBytes' | 'checksumSha256'
> & {
  kind: 'original' | 'thumbnail' | 'transcode'
  ext: string
  assetId?: string
}

export type RegisterThumbnailInput = Omit<AssetThumbnail, 'createdAt'>

export interface ClusterFace extends Omit<FaceDto, 'personId'> {
  personId: string | null
  embedding: number[]
}

export interface ApplyClusterCreate {
  clusterLabel: string
  faceIds: string[]
  coverFaceId?: string
}

export interface ApplyClusterAttach {
  personId: string
  faceIds: string[]
  coverFaceId?: string
}

export interface ApplyClustersPayload {
  creates: ApplyClusterCreate[]
  attaches: ApplyClusterAttach[]
}

export interface ApplyClustersResult {
  created: number
  assigned: number
}

const REQUEST_TIMEOUT_MS = 30_000
const ASSET_IDS_CHUNK = 100
// ponytail: keyset walk over GET /worker/faces (id ASC, cursor = last id); 500 matches core's default
const FACES_PAGE_LIMIT = 500
// ponytail: O(n²) DBSCAN ceiling — fail loudly above this, Phase 3 streams/pages the algorithm itself
const MAX_FACES_PER_USER = 10_000

/** Job-binding proof threaded from the BullMQ payload: the guard recomputes the HMAC per route. */
export interface JobBinding {
  sig?: string
  /** route target the guard cannot derive itself (thumbnail registerFile); else omit */
  scope?: string
}

@Injectable()
export class CoreClient {
  private readonly logger = new Logger(CoreClient.name)

  constructor(private readonly jwt: JwtService) {}

  // ponytail: per-job delegated JWT — core's worker guard scopes every call by sub, so worker
  // never needs DB access; only face-detection settings uses role 'admin'
  private signToken(sub: string, role: Role): string {
    return this.jwt.sign(
      // act (RFC 8693) marks every token as worker-origin — core's guard only lets act
      // tokens reach the admin allowlist in core's auth/open-routes.ts
      { sub, email: 'worker@internal', role, act: { sub: 'worker-service' } },
      {
        algorithm: 'HS256',
        expiresIn: loadEnv().AUTH_ACCESS_TTL as JwtSignOptions['expiresIn'],
      },
    )
  }

  async getFile(userId: string, fileId: string, binding?: JobBinding): Promise<FileRecord> {
    return this.request('GET', `/worker/files/${fileId}`, { sub: userId, ...binding })
  }

  async getAsset(userId: string, assetId: string, binding?: JobBinding): Promise<Asset> {
    return this.request('GET', `/worker/assets/${assetId}`, { sub: userId, ...binding })
  }

  async patchMetadata(
    userId: string,
    assetId: string,
    dto: MetadataPatch,
    binding?: JobBinding,
  ): Promise<void> {
    await this.request('PATCH', `/worker/assets/${assetId}/metadata`, {
      sub: userId,
      body: dto,
      ...binding,
    })
  }

  async registerFile(
    userId: string,
    dto: RegisterFileInput,
    binding?: JobBinding,
  ): Promise<FileRecord> {
    return this.request('POST', '/worker/files/register', { sub: userId, body: dto, ...binding })
  }

  async registerThumbnail(
    userId: string,
    assetId: string,
    dto: RegisterThumbnailInput,
    binding?: JobBinding,
  ): Promise<void> {
    await this.request('POST', `/worker/assets/${assetId}/thumbnails`, {
      sub: userId,
      body: dto,
      ...binding,
    })
  }

  async registerFaces(
    userId: string,
    assetId: string,
    faces: DetectedFaceInput[],
    detector: FaceDetectorKind,
    binding?: JobBinding,
  ): Promise<{ count: number }> {
    // the delegated token sub is the only identity core accepts; the body carries no userId
    // (forbidNonWhitelisted would 400 an extra field)
    return this.request('POST', `/worker/assets/${assetId}/faces`, {
      sub: userId,
      body: { faces, detector },
      ...binding,
    })
  }

  async registerEmbedding(
    userId: string,
    assetId: string,
    dto: RegisterEmbeddingRequestDto,
    binding?: JobBinding,
  ): Promise<void> {
    await this.request('POST', `/worker/assets/${assetId}/embedding`, {
      sub: userId,
      body: dto,
      ...binding,
    })
  }

  async registerOcr(
    userId: string,
    assetId: string,
    dto: RegisterOcrRequestDto,
    binding?: JobBinding,
  ): Promise<void> {
    await this.request('POST', `/worker/assets/${assetId}/ocr`, {
      sub: userId,
      body: dto,
      ...binding,
    })
  }

  async registerDetections(
    userId: string,
    assetId: string,
    dto: RegisterDetectionsRequestDto,
    binding?: JobBinding,
  ): Promise<void> {
    await this.request('POST', `/worker/assets/${assetId}/detections`, {
      sub: userId,
      body: dto,
      ...binding,
    })
  }

  async deleteAssetFaces(
    userId: string,
    assetId: string,
    binding?: JobBinding,
  ): Promise<{ deleted: number }> {
    return this.request('DELETE', `/worker/assets/${assetId}/faces`, { sub: userId, ...binding })
  }

  async getFacesForCluster(userId: string, binding?: JobBinding): Promise<ClusterFace[]> {
    // ponytail: same accumulate-loop style as getAssetsByIds below — each page is one request()
    // (30s timeout + 400/404/422→Unrecoverable mapping), cursor walks id ASC until nextCursor null
    const faces: ClusterFace[] = []
    let cursor: string | undefined
    let pageCount = 0
    let bytes = 0
    for (;;) {
      const query =
        `includeEmbeddings=true&excludeTrashed=true&limit=${FACES_PAGE_LIMIT}` +
        (cursor !== undefined ? `&cursor=${cursor}` : '')
      const res = await this.request<{ items: ClusterFace[]; nextCursor?: string | null }>(
        'GET',
        `/worker/faces?${query}`,
        { sub: userId, ...binding },
      )
      faces.push(...res.items)
      pageCount += 1
      bytes += Buffer.byteLength(JSON.stringify(res.items))
      if (faces.length > MAX_FACES_PER_USER) {
        this.logger.error(
          `Face cap exceeded: user=${userId} faceCount=${faces.length} ` +
            `pageCount=${pageCount} bytes=${bytes}`,
        )
        // deterministic overshoot — retries re-fetch the same pages, so fail without retry
        throw new UnrecoverableError(
          `Too many faces for user=${userId}: ${faces.length} > ${MAX_FACES_PER_USER}`,
        )
      }
      // deprecated fallback: old core serves { items } with no nextCursor — single page, done
      if (res.nextCursor === undefined || res.nextCursor === null) break
      cursor = res.nextCursor
    }
    this.logger.log(
      `Cluster faces fetched: user=${userId} faceCount=${faces.length} ` +
        `pageCount=${pageCount} bytes=${bytes}`,
    )
    return faces
  }

  // ponytail: E2 caps ids at 100 (header size); LEGACY_REEMBED_PER_RUN matches, chunk anyway for safety
  async getAssetsByIds(
    userId: string,
    ids: string[],
    binding?: JobBinding,
  ): Promise<Pick<Asset, 'id' | 'fileId'>[]> {
    const assets: Pick<Asset, 'id' | 'fileId'>[] = []
    for (let i = 0; i < ids.length; i += ASSET_IDS_CHUNK) {
      const res = await this.request<AssetListResponse>(
        'GET',
        `/worker/assets?ids=${ids.slice(i, i + ASSET_IDS_CHUNK).join(',')}`,
        { sub: userId, ...binding },
      )
      assets.push(...res.items)
    }
    return assets
  }

  async applyClusters(
    userId: string,
    payload: ApplyClustersPayload,
    binding?: JobBinding,
  ): Promise<ApplyClustersResult> {
    return this.request('POST', '/worker/persons/apply-clusters', {
      sub: userId,
      body: payload,
      ...binding,
    })
  }

  // ponytail: called after every cluster run (even when the plan was empty) — deletes persons whose
  // last live face left and unassigns any faces left behind in trash
  async pruneEmptyPersons(userId: string, binding?: JobBinding): Promise<{ deleted: number }> {
    return this.request('POST', '/worker/persons/prune-empty', { sub: userId, ...binding })
  }

  async deleteOwnedFile(userId: string, fileId: string, binding?: JobBinding): Promise<void> {
    await this.request('DELETE', `/worker/files/${fileId}`, { sub: userId, ...binding })
  }

  async getFaceDetectionSettings(): Promise<FaceDetectionSettings> {
    return this.request('GET', '/api/v1/admin/face-detection', {
      sub: 'worker-service',
      role: 'admin',
    })
  }

  private async request<T>(
    method: 'GET' | 'PATCH' | 'POST' | 'DELETE',
    path: string,
    opts: { sub: string; role?: Role; body?: unknown; sig?: string; scope?: string },
    timeoutMs = REQUEST_TIMEOUT_MS,
  ): Promise<T> {
    const token = this.signToken(opts.sub, opts.role ?? 'user')
    const hasBody = opts.body !== undefined

    let res: Response
    try {
      res = await fetch(`${loadEnv().CORE_URL}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          ...(hasBody ? { 'Content-Type': 'application/json' } : {}),
          // job binding for mutating /worker/* calls — the guard 403s without a valid one
          ...(opts.sig ? { 'X-Job-Signature': opts.sig } : {}),
          ...(opts.scope ? { 'X-Job-Scope': opts.scope } : {}),
        },
        body: hasBody ? JSON.stringify(opts.body) : undefined,
        signal: AbortSignal.timeout(timeoutMs),
      })
    } catch (err) {
      // network failure: plain Error so BullMQ's attempts:3 + backoff owns the retry
      throw err instanceof Error ? err : new Error(String(err))
    }

    if (res.ok) {
      if (res.status === 204) return undefined as T
      return (await res.json()) as T
    }

    const detail = await res.text().catch(() => '')
    const message = `Core ${method} ${path} failed: ${res.status}${detail ? ` — ${detail.slice(0, 300)}` : ''}`

    // bad payload / unknown or foreign resource: retrying cannot help
    if (res.status === 400 || res.status === 404 || res.status === 422) {
      throw new UnrecoverableError(message)
    }
    // 401/403/429/5xx are plain errors — BullMQ retries the job (attempts:3 + exponential backoff)
    throw new Error(message)
  }
}
