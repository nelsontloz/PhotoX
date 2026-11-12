import { Injectable, Logger } from '@nestjs/common';
import { JwtService, type JwtSignOptions } from '@nestjs/jwt';
import { UnrecoverableError } from 'bullmq';
import { loadEnv } from '@photox/shared-config';
import { FACE_EMBEDDING_DIM } from '@photox/shared-types';
import type {
  Asset,
  AssetListResponse,
  AssetThumbnail,
  DetectedFaceInput,
  FaceDto,
  FileRecord,
  MetadataStatus,
  RegisterDetectionsRequestDto,
  RegisterEmbeddingRequestDto,
  UserDeleteFinishRequest,
  UserDeleteStepResult,
} from '@photox/shared-types';

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
  takenAt?: Date | null;
  status?: MetadataStatus;
  // set by process-embeddings on failure; core's UpdateMetadataDto must whitelist it (sibling lane)
  embeddingStatus?: MetadataStatus;
  // 16-char lowercase dHash hex set by process-metadata; core's UpdateMetadataDto must whitelist it
  phash?: string;
};

export type RegisterFileInput = Pick<
  FileRecord,
  'id' | 'originalName' | 'mimeType' | 'sizeBytes' | 'checksumSha256'
> & {
  kind: 'original' | 'thumbnail' | 'transcode';
  ext: string;
  assetId?: string;
};

export type RegisterThumbnailInput = Omit<AssetThumbnail, 'createdAt'>;

export interface ClusterFace extends Omit<FaceDto, 'personId'> {
  personId: string | null;
  embedding: number[];
}

export interface ApplyClusterCreate {
  clusterLabel: string;
  faceIds: string[];
  coverFaceId?: string;
}

export interface ApplyClusterAttach {
  personId: string;
  faceIds: string[];
  coverFaceId?: string;
}

export interface ApplyClustersPayload {
  creates: ApplyClusterCreate[];
  attaches: ApplyClusterAttach[];
}

export interface ApplyClustersResult {
  created: number;
  assigned: number;
}

/** Running sum/count for one person, so a walk never has to retain assigned faces' embeddings. */
export interface ClusterCentroid {
  sum: number[];
  count: number;
}

export interface ClusterFaceWalk {
  /** unassigned clonable faces (current dim, >= minConfidence), at most `cap` */
  unassigned: ClusterFace[];
  /** assigned faces' running sums, keyed by person id */
  centroids: Map<string, ClusterCentroid>;
  /** deduped asset ids of unassigned legacy-dim faces (sampled, not exhaustive) */
  legacyAssetIds: string[];
  /** number of unassigned legacy-dim faces seen (may exceed legacyAssetIds.length) */
  legacyCount: number;
  /** more clonable unassigned faces exist than the cap allowed */
  truncated: boolean;
  /** how many clonable unassigned faces the cap left for later runs */
  deferred: number;
  /** every face seen, assigned or not */
  total: number;
}

export function addToCentroid(
  centroids: Map<string, ClusterCentroid>,
  personId: string,
  embedding: number[],
): void {
  let acc = centroids.get(personId);
  if (!acc) {
    acc = { sum: new Array<number>(embedding.length).fill(0), count: 0 };
    centroids.set(personId, acc);
  }
  for (let i = 0; i < acc.sum.length; i++) acc.sum[i]! += embedding[i]!;
  acc.count++;
}

/** Mean of a running accumulator; callers must ensure count > 0. */
export function centroidMean(acc: ClusterCentroid): number[] {
  return acc.sum.map((v) => v / acc.count);
}

const REQUEST_TIMEOUT_MS = 30_000;
// one wipe step can delete a 200-asset batch with its cascades; both calls are idempotent, but
// an abort mid-step still costs a whole job attempt
const PURGE_TIMEOUT_MS = 15 * 60_000;
// ponytail: keyset walk over GET /worker/faces (id ASC, cursor = last id); 500 matches core's default
const FACES_PAGE_LIMIT = 500;
// ponytail: per-run cap on the unassigned set DBSCAN sees. Each run assigns faces, so the next
// run's first cap-sized unassigned batch is different work; the cluster service chains a continuation.
const MAX_UNASSIGNED_FACES_PER_RUN = 10_000;
// face.cluster only re-enqueues LEGACY_REEMBED_PER_RUN assets per run, so this sample is enough
const LEGACY_ASSET_SAMPLE = 100;

/** Job-binding proof threaded from the BullMQ payload: the guard recomputes the HMAC per route. */
export interface JobBinding {
  sig?: string;
  /** route target the guard cannot derive itself (thumbnail registerFile); else omit */
  scope?: string;
}

@Injectable()
export class CoreClient {
  private readonly logger = new Logger(CoreClient.name);

  constructor(private readonly jwt: JwtService) {}

  // ponytail: per-job delegated JWT — core's worker guard scopes every call by sub, so worker
  // never needs DB access. Worker tokens are always role 'user'.
  private signToken(sub: string): string {
    return this.jwt.sign(
      // act (RFC 8693) marks every token as worker-origin — core's guard only lets act
      // tokens reach the admin allowlist in core's auth/open-routes.ts
      { sub, email: 'worker@internal', role: 'user', act: { sub: 'worker-service' } },
      {
        algorithm: 'HS256',
        expiresIn: loadEnv().AUTH_ACCESS_TTL as JwtSignOptions['expiresIn'],
      },
    );
  }

  async getFile(userId: string, fileId: string, binding?: JobBinding): Promise<FileRecord> {
    return this.request('GET', `/worker/files/${fileId}`, { sub: userId, ...binding });
  }

  async getAsset(userId: string, assetId: string, binding?: JobBinding): Promise<Asset> {
    return this.request('GET', `/worker/assets/${assetId}`, { sub: userId, ...binding });
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
    });
  }

  async registerFile(
    userId: string,
    dto: RegisterFileInput,
    binding?: JobBinding,
  ): Promise<FileRecord> {
    return this.request('POST', '/worker/files/register', { sub: userId, body: dto, ...binding });
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
    });
  }

  /**
   * Replace the asset's whole face set. The POST is atomic in core (delete + insert in one
   * transaction), so it must be called even when `faces` is empty to clear stale rows, and a
   * retry can never leave the asset faceless.
   */
  async replaceFaces(
    userId: string,
    assetId: string,
    faces: DetectedFaceInput[],
    binding?: JobBinding,
  ): Promise<{ count: number }> {
    // the delegated token sub is the only identity core accepts; the body carries no userId
    // (forbidNonWhitelisted would 400 an extra field)
    return this.request('POST', `/worker/assets/${assetId}/faces`, {
      sub: userId,
      body: { faces },
      ...binding,
    });
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
    });
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
    });
  }

  /**
   * Streaming walk for face clustering: paged like before, but nothing unbounded is retained.
   * Assigned high-confidence current-dim faces feed per-person sum/count centroids, unassigned
   * clonable faces stop collecting at `cap` (the caller chains a continuation), and unassigned
   * legacy-dim faces surface as asset ids for re-embed.
   */
  async getFacesForCluster(
    userId: string,
    binding?: JobBinding,
    opts: { minConfidence?: number; cap?: number } = {},
  ): Promise<ClusterFaceWalk> {
    const minConfidence = opts.minConfidence ?? 0;
    const cap = opts.cap ?? MAX_UNASSIGNED_FACES_PER_RUN;
    const unassigned: ClusterFace[] = [];
    const centroids = new Map<string, ClusterCentroid>();
    const legacyAssets = new Set<string>();
    let legacyCount = 0;
    let deferred = 0;
    let total = 0;
    let pageCount = 0;
    let cursor: string | undefined;

    for (;;) {
      const query =
        `includeEmbeddings=true&excludeTrashed=true&limit=${FACES_PAGE_LIMIT}` +
        (cursor !== undefined ? `&cursor=${cursor}` : '');
      const res = await this.request<{ items: ClusterFace[]; nextCursor?: string | null }>(
        'GET',
        `/worker/faces?${query}`,
        { sub: userId, ...binding },
      );
      pageCount += 1;
      for (const face of res.items) {
        total += 1;
        if (face.personId !== null) {
          if (face.confidence >= minConfidence && face.embedding.length === FACE_EMBEDDING_DIM) {
            addToCentroid(centroids, face.personId, face.embedding);
          }
        } else if (face.embedding.length !== FACE_EMBEDDING_DIM) {
          // legacy-dim rows (pre-buffalo_l 1024-dim) are incomparable — never cluster; the caller
          // re-enqueues their assets for re-embed
          legacyCount += 1;
          if (legacyAssets.size < LEGACY_ASSET_SAMPLE) legacyAssets.add(face.assetId);
        } else if (face.confidence >= minConfidence) {
          if (unassigned.length < cap) unassigned.push(face);
          else deferred += 1;
        }
      }
      // deprecated fallback: old core serves { items } with no nextCursor — single page, done
      if (res.nextCursor === undefined || res.nextCursor === null) break;
      cursor = res.nextCursor;
    }

    this.logger.log(
      `Cluster faces fetched: user=${userId} total=${total} pageCount=${pageCount} ` +
        `unassigned=${unassigned.length} persons=${centroids.size} truncated=${deferred > 0}`,
    );
    return {
      unassigned,
      centroids,
      legacyAssetIds: [...legacyAssets],
      legacyCount,
      truncated: deferred > 0,
      deferred,
      total,
    };
  }

  // one request: the only caller (face.cluster's LEGACY_REEMBED_PER_RUN) caps ids at 100, which
  // E2 accepts inside the header budget — a larger list must be split by the caller
  async getAssetsByIds(
    userId: string,
    ids: string[],
    binding?: JobBinding,
  ): Promise<Pick<Asset, 'id' | 'fileId'>[]> {
    const res = await this.request<AssetListResponse>(
      'GET',
      `/worker/assets?ids=${ids.join(',')}`,
      { sub: userId, ...binding },
    );
    return res.items;
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
    });
  }

  // ponytail: called after every cluster run (even when the plan was empty) — deletes persons whose
  // last live face left and unassigns any faces left behind in trash
  async pruneEmptyPersons(userId: string, binding?: JobBinding): Promise<{ deleted: number }> {
    return this.request('POST', '/worker/persons/prune-empty', { sub: userId, ...binding });
  }

  /** One bounded step of the account wipe (the worker has no DB access). Idempotent. */
  async purgeStep(
    userId: string,
    backupPrefix: string,
    binding?: JobBinding,
  ): Promise<UserDeleteStepResult> {
    return this.request(
      'POST',
      `/worker/users/${userId}/purge/step`,
      { sub: userId, body: { backupPrefix }, ...binding },
      PURGE_TIMEOUT_MS,
    );
  }

  /** Terminal report after the worker's storage sweep; `error` marks the rows half unfinished. */
  async purgeFinish(
    userId: string,
    report: UserDeleteFinishRequest,
    binding?: JobBinding,
  ): Promise<{ state: string }> {
    return this.request(
      'POST',
      `/worker/users/${userId}/purge/finish`,
      { sub: userId, body: report, ...binding },
      PURGE_TIMEOUT_MS,
    );
  }

  private async request<T>(
    method: 'GET' | 'PATCH' | 'POST' | 'DELETE',
    path: string,
    opts: { sub: string; body?: unknown; sig?: string; scope?: string },
    timeoutMs = REQUEST_TIMEOUT_MS,
  ): Promise<T> {
    const token = this.signToken(opts.sub);
    const hasBody = opts.body !== undefined;

    let res: Response;
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
      });
    } catch (err) {
      // network failure: plain Error so BullMQ's attempts:3 + backoff owns the retry
      throw err instanceof Error ? err : new Error(String(err));
    }

    if (res.ok) {
      if (res.status === 204) return undefined as T;
      return (await res.json()) as T;
    }

    const detail = await res.text().catch(() => '');
    const message = `Core ${method} ${path} failed: ${res.status}${detail ? ` — ${detail.slice(0, 300)}` : ''}`;

    // bad payload / unknown or foreign resource: retrying cannot help. 413 is permanent for
    // this body too — a face set above the limit would be rejected identically on every attempt.
    if (res.status === 400 || res.status === 404 || res.status === 413 || res.status === 422) {
      throw new UnrecoverableError(message);
    }
    // 401/403/429/5xx are plain errors — BullMQ retries the job (attempts:3 + exponential backoff)
    throw new Error(message);
  }
}
