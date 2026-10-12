import { Injectable } from '@nestjs/common'
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

@Injectable()
export class CoreClient {
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

  async getFile(userId: string, fileId: string): Promise<FileRecord> {
    return this.request('GET', `/worker/files/${fileId}`, { sub: userId })
  }

  async getAsset(userId: string, assetId: string): Promise<Asset> {
    return this.request('GET', `/worker/assets/${assetId}`, { sub: userId })
  }

  async patchMetadata(userId: string, assetId: string, dto: MetadataPatch): Promise<void> {
    await this.request('PATCH', `/worker/assets/${assetId}/metadata`, { sub: userId, body: dto })
  }

  async registerFile(userId: string, dto: RegisterFileInput): Promise<FileRecord> {
    return this.request('POST', '/worker/files/register', { sub: userId, body: dto })
  }

  async registerThumbnail(
    userId: string,
    assetId: string,
    dto: RegisterThumbnailInput,
  ): Promise<void> {
    await this.request('POST', `/worker/assets/${assetId}/thumbnails`, { sub: userId, body: dto })
  }

  async registerFaces(
    userId: string,
    assetId: string,
    faces: DetectedFaceInput[],
    detector: FaceDetectorKind,
  ): Promise<{ count: number }> {
    // the delegated token sub is the only identity core accepts; the body carries no userId
    // (forbidNonWhitelisted would 400 an extra field)
    return this.request('POST', `/worker/assets/${assetId}/faces`, {
      sub: userId,
      body: { faces, detector },
    })
  }

  async registerEmbedding(
    userId: string,
    assetId: string,
    dto: RegisterEmbeddingRequestDto,
  ): Promise<void> {
    await this.request('POST', `/worker/assets/${assetId}/embedding`, { sub: userId, body: dto })
  }

  async registerOcr(userId: string, assetId: string, dto: RegisterOcrRequestDto): Promise<void> {
    await this.request('POST', `/worker/assets/${assetId}/ocr`, { sub: userId, body: dto })
  }

  async registerDetections(
    userId: string,
    assetId: string,
    dto: RegisterDetectionsRequestDto,
  ): Promise<void> {
    await this.request('POST', `/worker/assets/${assetId}/detections`, { sub: userId, body: dto })
  }

  async deleteAssetFaces(userId: string, assetId: string): Promise<{ deleted: number }> {
    return this.request('DELETE', `/worker/assets/${assetId}/faces`, { sub: userId })
  }

  async getFacesForCluster(userId: string): Promise<ClusterFace[]> {
    // cluster votes on embeddings and ignores trashed assets — same params as the pre-#156
    // user-side call this replaces
    const res = await this.request<{ items: ClusterFace[] }>(
      'GET',
      '/worker/faces?includeEmbeddings=true&excludeTrashed=true',
      { sub: userId },
    )
    return res.items
  }

  // ponytail: E2 caps ids at 100 (header size); LEGACY_REEMBED_PER_RUN matches, chunk anyway for safety
  async getAssetsByIds(userId: string, ids: string[]): Promise<Pick<Asset, 'id' | 'fileId'>[]> {
    const assets: Pick<Asset, 'id' | 'fileId'>[] = []
    for (let i = 0; i < ids.length; i += ASSET_IDS_CHUNK) {
      const res = await this.request<AssetListResponse>(
        'GET',
        `/worker/assets?ids=${ids.slice(i, i + ASSET_IDS_CHUNK).join(',')}`,
        { sub: userId },
      )
      assets.push(...res.items)
    }
    return assets
  }

  async applyClusters(userId: string, payload: ApplyClustersPayload): Promise<ApplyClustersResult> {
    return this.request('POST', '/worker/persons/apply-clusters', { sub: userId, body: payload })
  }

  // ponytail: called after every cluster run (even when the plan was empty) — deletes persons whose
  // last live face left and unassigns any faces left behind in trash
  async pruneEmptyPersons(userId: string): Promise<{ deleted: number }> {
    return this.request('POST', '/worker/persons/prune-empty', { sub: userId })
  }

  async deleteOwnedFile(userId: string, fileId: string): Promise<void> {
    await this.request('DELETE', `/worker/files/${fileId}`, { sub: userId })
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
    opts: { sub: string; role?: Role; body?: unknown },
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
