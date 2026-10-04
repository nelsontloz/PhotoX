import { Injectable } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { access } from 'fs/promises'
import { IsNull, Repository } from 'typeorm'
import { envFaceDetectorKind, resolveFaceDetectorModelPath } from '@photox/shared-config'
import {
  FACE_DETECTOR_KINDS,
  type FaceDetectionSettings,
  type FaceDetectorKind,
} from '@photox/shared-types'
import { AppSetting, Face } from '../database/entities'

export const FACE_DETECTOR_SETTING_KEY = 'face.detector'
export const FACE_REPROCESS_LAST_RUN_KEY = 'face.reprocess.lastRun'
export const EMBEDDING_REPROCESS_LAST_RUN_KEY = 'embedding.reprocess.lastRun'
export const OCR_REPROCESS_LAST_RUN_KEY = 'ocr.reprocess.lastRun'
export const DETECTIONS_REPROCESS_LAST_RUN_KEY = 'detections.reprocess.lastRun'
export const PLACES_BACKFILL_LAST_RUN_KEY = 'places.backfill.lastRun'
export const METADATA_REPROCESS_LAST_RUN_KEY = 'metadata.reprocess.lastRun'

export interface FaceReprocessLastRun {
  startedAt: string
  total: number
  enqueued: number
  detector: FaceDetectorKind
}

export interface EmbeddingReprocessLastRun {
  startedAt: string
  total: number
  enqueued: number
  model: string
}

export interface OcrReprocessLastRun {
  startedAt: string
  total: number
  enqueued: number
}

export interface DetectionsReprocessLastRun {
  startedAt: string
  total: number
  enqueued: number
}

export interface PlacesBackfillLastRun {
  startedAt: string
  total: number
  updated: number
}

export interface MetadataReprocessLastRun {
  startedAt: string
  total: number
  enqueued: number
}

function isFaceDetectorKind(value: unknown): value is FaceDetectorKind {
  return typeof value === 'string' && (FACE_DETECTOR_KINDS as readonly string[]).includes(value)
}

const isString = (value: unknown): boolean => typeof value === 'string'
const isNumber = (value: unknown): boolean => typeof value === 'number'

/**
 * Rebuilds a last-run record from the listed fields only (unknown stored keys are dropped); any
 * field failing its check makes the whole record unreadable, same as the old per-type guards.
 */
function parseRun<T>(
  value: unknown,
  fields: Record<string, (field: unknown) => boolean>,
): T | null {
  if (typeof value !== 'object' || value === null) return null
  const row = value as Record<string, unknown>
  const run: Record<string, unknown> = {}
  for (const [key, check] of Object.entries(fields)) {
    if (!check(row[key])) return null
    run[key] = row[key]
  }
  return run as T
}

const parseFaceLastRun = (value: unknown): FaceReprocessLastRun | null =>
  parseRun<FaceReprocessLastRun>(value, {
    startedAt: isString,
    total: isNumber,
    enqueued: isNumber,
    detector: isFaceDetectorKind,
  })

const parseEmbeddingLastRun = (value: unknown): EmbeddingReprocessLastRun | null =>
  parseRun<EmbeddingReprocessLastRun>(value, {
    startedAt: isString,
    total: isNumber,
    enqueued: isNumber,
    model: isString,
  })

const parseOcrLastRun = (value: unknown): OcrReprocessLastRun | null =>
  parseRun<OcrReprocessLastRun>(value, {
    startedAt: isString,
    total: isNumber,
    enqueued: isNumber,
  })

const parseDetectionsLastRun = (value: unknown): DetectionsReprocessLastRun | null =>
  parseRun<DetectionsReprocessLastRun>(value, {
    startedAt: isString,
    total: isNumber,
    enqueued: isNumber,
  })

const parsePlacesBackfillLastRun = (value: unknown): PlacesBackfillLastRun | null =>
  parseRun<PlacesBackfillLastRun>(value, {
    startedAt: isString,
    total: isNumber,
    updated: isNumber,
  })

const parseMetadataReprocessLastRun = (value: unknown): MetadataReprocessLastRun | null =>
  parseRun<MetadataReprocessLastRun>(value, {
    startedAt: isString,
    total: isNumber,
    enqueued: isNumber,
  })

@Injectable()
export class SettingsService {
  constructor(
    @InjectRepository(AppSetting)
    private readonly repo: Repository<AppSetting>,
    @InjectRepository(Face)
    private readonly faceRepo: Repository<Face>,
  ) {}

  envDefaultDetector(): FaceDetectorKind {
    return envFaceDetectorKind()
  }

  async getFaceDetector(): Promise<FaceDetectorKind> {
    const row = await this.repo.findOne({ where: { key: FACE_DETECTOR_SETTING_KEY } })
    return isFaceDetectorKind(row?.value) ? row.value : this.envDefaultDetector()
  }

  async getSettings(): Promise<FaceDetectionSettings> {
    const [detector, scrfd, facesByDetector] = await Promise.all([
      this.getFaceDetector(),
      this.scrfdModelAvailable(),
      this.countFacesByDetector(),
    ])
    return { detector, envDefault: this.envDefaultDetector(), models: { scrfd }, facesByDetector }
  }

  async setFaceDetector(kind: FaceDetectorKind): Promise<void> {
    await this.repo.upsert({ key: FACE_DETECTOR_SETTING_KEY, value: kind }, ['key'])
  }

  getFaceReprocessLastRun(): Promise<FaceReprocessLastRun | null> {
    return this.getLastRun(FACE_REPROCESS_LAST_RUN_KEY, parseFaceLastRun)
  }

  setFaceReprocessLastRun(run: FaceReprocessLastRun): Promise<void> {
    return this.setLastRun(FACE_REPROCESS_LAST_RUN_KEY, run)
  }

  getEmbeddingReprocessLastRun(): Promise<EmbeddingReprocessLastRun | null> {
    return this.getLastRun(EMBEDDING_REPROCESS_LAST_RUN_KEY, parseEmbeddingLastRun)
  }

  setEmbeddingReprocessLastRun(run: EmbeddingReprocessLastRun): Promise<void> {
    return this.setLastRun(EMBEDDING_REPROCESS_LAST_RUN_KEY, run)
  }

  getOcrReprocessLastRun(): Promise<OcrReprocessLastRun | null> {
    return this.getLastRun(OCR_REPROCESS_LAST_RUN_KEY, parseOcrLastRun)
  }

  setOcrReprocessLastRun(run: OcrReprocessLastRun): Promise<void> {
    return this.setLastRun(OCR_REPROCESS_LAST_RUN_KEY, run)
  }

  getDetectionsReprocessLastRun(): Promise<DetectionsReprocessLastRun | null> {
    return this.getLastRun(DETECTIONS_REPROCESS_LAST_RUN_KEY, parseDetectionsLastRun)
  }

  setDetectionsReprocessLastRun(run: DetectionsReprocessLastRun): Promise<void> {
    return this.setLastRun(DETECTIONS_REPROCESS_LAST_RUN_KEY, run)
  }

  getPlacesBackfillLastRun(): Promise<PlacesBackfillLastRun | null> {
    return this.getLastRun(PLACES_BACKFILL_LAST_RUN_KEY, parsePlacesBackfillLastRun)
  }

  setPlacesBackfillLastRun(run: PlacesBackfillLastRun): Promise<void> {
    return this.setLastRun(PLACES_BACKFILL_LAST_RUN_KEY, run)
  }

  getMetadataReprocessLastRun(): Promise<MetadataReprocessLastRun | null> {
    return this.getLastRun(METADATA_REPROCESS_LAST_RUN_KEY, parseMetadataReprocessLastRun)
  }

  setMetadataReprocessLastRun(run: MetadataReprocessLastRun): Promise<void> {
    return this.setLastRun(METADATA_REPROCESS_LAST_RUN_KEY, run)
  }

  private async getLastRun<T>(key: string, parse: (value: unknown) => T | null): Promise<T | null> {
    const row = await this.repo.findOne({ where: { key } })
    return parse(row?.value)
  }

  private async setLastRun(key: string, run: object): Promise<void> {
    await this.repo.upsert({ key, value: run }, ['key'])
  }

  private async countFacesByDetector(): Promise<FaceDetectionSettings['facesByDetector']> {
    const [human, scrfd, unset] = await Promise.all([
      this.faceRepo.count({ where: { detector: 'human' } }),
      this.faceRepo.count({ where: { detector: 'scrfd' } }),
      this.faceRepo.count({ where: { detector: IsNull() } }),
    ])
    return { human, scrfd, unset }
  }

  private async scrfdModelAvailable(): Promise<boolean> {
    try {
      await access(resolveFaceDetectorModelPath())
      return true
    } catch {
      return false
    }
  }
}
