import { UnrecoverableError } from 'bullmq'
import type { LocalStorageService } from '@photox/shared-config'
import type {
  Asset,
  DetectedFaceInput,
  FileRecord,
  RegisterDetectionsRequestDto,
  RegisterEmbeddingRequestDto,
  RegisterOcrRequestDto,
} from '@photox/shared-types'
import type {
  ApplyClustersPayload,
  ApplyClustersResult,
  ClusterFace,
  JobBinding,
  MetadataPatch,
  RegisterFileInput,
  RegisterThumbnailInput,
} from '../src/core/core-client.service'

export interface CallRecord {
  method: string
  args: unknown[]
  binding?: JobBinding
}

export function makeFileRecord(
  overrides: Partial<FileRecord> & Pick<FileRecord, 'id' | 'userId'>,
): FileRecord {
  return {
    storageKey: `fake/${overrides.id}`,
    originalName: 'source.bin',
    mimeType: 'application/octet-stream',
    sizeBytes: 0,
    checksumSha256: '0'.repeat(64),
    purpose: 'original',
    assetId: null,
    createdAt: new Date().toISOString(),
    ...overrides,
  }
}

export function makeAsset(
  overrides: Partial<Asset> & Pick<Asset, 'id' | 'userId' | 'fileId'>,
): Asset {
  return {
    kind: 'photo',
    uploadedAt: new Date().toISOString(),
    isTrashed: false,
    trashedAt: null,
    title: null,
    description: null,
    takenAt: null,
    favorite: false,
    mimeType: null,
    sizeBytes: null,
    originalName: null,
    width: null,
    height: null,
    durationSeconds: null,
    cameraMake: null,
    cameraModel: null,
    lensModel: null,
    orientation: null,
    iso: null,
    fNumber: null,
    exposureTime: null,
    focalLength: null,
    latitude: null,
    longitude: null,
    altitude: null,
    fps: null,
    codec: null,
    hasAudio: null,
    metadata: null,
    metadataStatus: 'pending',
    metadataExtractedAt: null,
    transcodeStatus: null,
    transcodeFileId: null,
    thumbnailStatus: null,
    faceStatus: null,
    faceCount: 0,
    ...overrides,
  }
}

// ponytail: stateful in-memory CoreClient stand-in — patchMetadata mutates the fixture so the
// thumbnail video defer re-fetch observes metadataStatus flips; registerFile can exercise the 200
// dedupe path
export class FakeCoreClient {
  readonly files = new Map<string, FileRecord>()
  readonly assets = new Map<string, Asset>()
  readonly calls: CallRecord[] = []
  readonly thumbnails: (RegisterThumbnailInput & { assetId: string })[] = []
  readonly faces = new Map<string, DetectedFaceInput[]>()
  readonly deleteFacesCalls: string[] = []
  readonly clusterFaces: ClusterFace[] = []
  readonly applyClustersCalls: ApplyClustersPayload[] = []
  dedupeRegistrations = false

  private readonly registeredByChecksum = new Map<string, string>()
  private readonly storage: LocalStorageService | undefined
  private personSeq = 0

  constructor(storage?: LocalStorageService) {
    this.storage = storage
  }

  reset(): void {
    this.files.clear()
    this.assets.clear()
    this.calls.length = 0
    this.thumbnails.length = 0
    this.faces.clear()
    this.deleteFacesCalls.length = 0
    this.clusterFaces.length = 0
    this.applyClustersCalls.length = 0
    this.registeredByChecksum.clear()
    this.dedupeRegistrations = false
    this.personSeq = 0
  }

  callsOf(method: string): CallRecord[] {
    return this.calls.filter((c) => c.method === method)
  }

  getFile(userId: string, fileId: string, binding?: JobBinding): Promise<FileRecord> {
    this.calls.push({ method: 'getFile', args: [userId, fileId], binding })
    const file = this.files.get(fileId)
    if (file?.userId !== userId) {
      return Promise.reject(new UnrecoverableError(`File not found: ${fileId}`))
    }
    return Promise.resolve({ ...file })
  }

  getAsset(userId: string, assetId: string, binding?: JobBinding): Promise<Asset> {
    this.calls.push({ method: 'getAsset', args: [userId, assetId], binding })
    const asset = this.assets.get(assetId)
    if (asset?.userId !== userId) {
      return Promise.reject(new UnrecoverableError(`Asset not found: ${assetId}`))
    }
    return Promise.resolve({ ...asset })
  }

  patchMetadata(
    userId: string,
    assetId: string,
    dto: MetadataPatch,
    binding?: JobBinding,
  ): Promise<void> {
    this.calls.push({ method: 'patchMetadata', args: [assetId, dto], binding })
    const asset = this.assets.get(assetId)
    if (asset?.userId !== userId) {
      return Promise.reject(new UnrecoverableError(`Asset not found: ${assetId}`))
    }
    if (dto.status !== undefined) {
      asset.metadataStatus = dto.status
      asset.metadataExtractedAt = new Date().toISOString()
    }
    const target = asset as unknown as Record<string, unknown>
    for (const [key, value] of Object.entries(dto)) {
      if (key === 'status') continue
      // mirror the JSON wire: Dates land as ISO strings
      target[key] = value instanceof Date ? value.toISOString() : value
    }
    return Promise.resolve()
  }

  registerFile(userId: string, dto: RegisterFileInput, binding?: JobBinding): Promise<FileRecord> {
    this.calls.push({ method: 'registerFile', args: [dto], binding })
    const purpose = dto.kind === 'transcode' ? 'transcode' : 'original'
    const dedupeKey = `${dto.checksumSha256}:${purpose}:${dto.assetId ?? ''}`
    const existingId = this.dedupeRegistrations
      ? this.registeredByChecksum.get(dedupeKey)
      : undefined
    if (!existingId) this.registeredByChecksum.set(dedupeKey, dto.id)

    const id = existingId ?? dto.id
    const record: FileRecord = {
      id,
      userId,
      storageKey: this.storage
        ? this.storage.buildKey(dto.kind, userId, id, dto.ext)
        : `fake/${id}`,
      originalName: dto.originalName,
      mimeType: dto.mimeType,
      sizeBytes: dto.sizeBytes,
      checksumSha256: dto.checksumSha256,
      purpose,
      assetId: dto.assetId ?? null,
      createdAt: new Date().toISOString(),
    }
    this.files.set(id, record)
    return Promise.resolve({ ...record })
  }

  registerThumbnail(
    userId: string,
    assetId: string,
    dto: RegisterThumbnailInput,
    binding?: JobBinding,
  ): Promise<void> {
    this.calls.push({ method: 'registerThumbnail', args: [assetId, dto], binding })
    const err = this.assetError(userId, assetId)
    if (err) return Promise.reject(err)
    this.thumbnails.push({ assetId, ...dto })
    return Promise.resolve()
  }

  registerFaces(
    userId: string,
    assetId: string,
    faces: DetectedFaceInput[],
    binding?: JobBinding,
  ): Promise<{ count: number }> {
    this.calls.push({ method: 'registerFaces', args: [assetId, faces], binding })
    const err = this.assetError(userId, assetId)
    if (err) return Promise.reject(err)
    this.faces.set(assetId, [...(this.faces.get(assetId) ?? []), ...faces])
    return Promise.resolve({ count: faces.length })
  }

  registerEmbedding(
    userId: string,
    assetId: string,
    dto: RegisterEmbeddingRequestDto,
    binding?: JobBinding,
  ): Promise<void> {
    this.calls.push({ method: 'registerEmbedding', args: [assetId, dto], binding })
    const err = this.assetError(userId, assetId)
    if (err) return Promise.reject(err)
    return Promise.resolve()
  }

  registerOcr(
    userId: string,
    assetId: string,
    dto: RegisterOcrRequestDto,
    binding?: JobBinding,
  ): Promise<void> {
    this.calls.push({ method: 'registerOcr', args: [assetId, dto], binding })
    const err = this.assetError(userId, assetId)
    if (err) return Promise.reject(err)
    return Promise.resolve()
  }

  registerDetections(
    userId: string,
    assetId: string,
    dto: RegisterDetectionsRequestDto,
    binding?: JobBinding,
  ): Promise<void> {
    this.calls.push({ method: 'registerDetections', args: [assetId, dto], binding })
    const err = this.assetError(userId, assetId)
    if (err) return Promise.reject(err)
    return Promise.resolve()
  }

  deleteAssetFaces(
    userId: string,
    assetId: string,
    binding?: JobBinding,
  ): Promise<{ deleted: number }> {
    this.calls.push({ method: 'deleteAssetFaces', args: [assetId], binding })
    const err = this.assetError(userId, assetId)
    if (err) return Promise.reject(err)
    const deleted = this.faces.get(assetId)?.length ?? 0
    this.faces.delete(assetId)
    this.deleteFacesCalls.push(assetId)
    return Promise.resolve({ deleted })
  }

  getFacesForCluster(userId: string, binding?: JobBinding): Promise<ClusterFace[]> {
    this.calls.push({ method: 'getFacesForCluster', args: [userId], binding })
    return Promise.resolve(this.clusterFaces.map((f) => ({ ...f })))
  }

  getAssetsByIds(
    userId: string,
    ids: string[],
    binding?: JobBinding,
  ): Promise<Pick<Asset, 'id' | 'fileId'>[]> {
    this.calls.push({ method: 'getAssetsByIds', args: [userId, ids], binding })
    return Promise.resolve(
      ids
        .map((id) => this.assets.get(id))
        .filter((a): a is Asset => a?.userId === userId)
        .map((a) => ({ id: a.id, fileId: a.fileId })),
    )
  }

  applyClusters(
    userId: string,
    payload: ApplyClustersPayload,
    binding?: JobBinding,
  ): Promise<ApplyClustersResult> {
    this.calls.push({ method: 'applyClusters', args: [userId, payload], binding })
    this.applyClustersCalls.push(payload)
    // mirror core's writes so a re-run sees the faces as assigned
    for (const create of payload.creates) {
      this.personSeq++
      const personId = `fake-person-${this.personSeq}`
      for (const faceId of create.faceIds) this.assignClusterFace(faceId, personId)
    }
    for (const attach of payload.attaches) {
      for (const faceId of attach.faceIds) this.assignClusterFace(faceId, attach.personId)
    }
    const faceIds = [...payload.creates, ...payload.attaches].flatMap((i) => i.faceIds)
    return Promise.resolve({ created: payload.creates.length, assigned: new Set(faceIds).size })
  }

  pruneEmptyPersons(userId: string, binding?: JobBinding): Promise<{ deleted: number }> {
    this.calls.push({ method: 'pruneEmptyPersons', args: [userId], binding })
    return Promise.resolve({ deleted: 0 })
  }

  purgeUser(userId: string, backupPrefix: string, binding?: JobBinding): Promise<void> {
    this.calls.push({ method: 'purgeUser', args: [userId, backupPrefix], binding })
    return Promise.resolve()
  }

  private assignClusterFace(faceId: string, personId: string): void {
    const face = this.clusterFaces.find((f) => f.id === faceId)
    if (face) face.personId = personId
  }

  private assetError(userId: string, assetId: string): UnrecoverableError | null {
    const asset = this.assets.get(assetId)
    if (asset?.userId === userId) return null
    return new UnrecoverableError(`Asset not found: ${assetId}`)
  }
}
