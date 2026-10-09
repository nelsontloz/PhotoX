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

export interface EnqueuedRun {
  startedAt: string
  total: number
  enqueued: number
}

export interface LastRuns {
  face: EnqueuedRun & { detector: FaceDetectorKind }
  embedding: EnqueuedRun & { model: string }
  ocr: EnqueuedRun
  detections: EnqueuedRun
  metadata: EnqueuedRun
  places: { startedAt: string; total: number; updated: number }
}

export type LastRunKind = keyof LastRuns
export type LastRun<K extends LastRunKind> = LastRuns[K]

const isString = (value: unknown): boolean => typeof value === 'string'
const isNumber = (value: unknown): boolean => typeof value === 'number'

function isFaceDetectorKind(value: unknown): value is FaceDetectorKind {
  return typeof value === 'string' && (FACE_DETECTOR_KINDS as readonly string[]).includes(value)
}

const ENQUEUED_RUN_FIELDS = { startedAt: isString, total: isNumber, enqueued: isNumber }

/**
 * Per-kind app_settings key + field checks. A stored record is rebuilt from the listed fields only
 * (unknown keys are dropped); any field failing its check makes the whole record unreadable, same
 * as the old per-type guards.
 */
const LAST_RUN_FIELDS: Record<
  LastRunKind,
  { key: string; fields: Record<string, (value: unknown) => boolean> }
> = {
  face: {
    key: FACE_REPROCESS_LAST_RUN_KEY,
    fields: { ...ENQUEUED_RUN_FIELDS, detector: isFaceDetectorKind },
  },
  embedding: {
    key: EMBEDDING_REPROCESS_LAST_RUN_KEY,
    fields: { ...ENQUEUED_RUN_FIELDS, model: isString },
  },
  ocr: { key: OCR_REPROCESS_LAST_RUN_KEY, fields: ENQUEUED_RUN_FIELDS },
  detections: { key: DETECTIONS_REPROCESS_LAST_RUN_KEY, fields: ENQUEUED_RUN_FIELDS },
  metadata: { key: METADATA_REPROCESS_LAST_RUN_KEY, fields: ENQUEUED_RUN_FIELDS },
  places: {
    key: PLACES_BACKFILL_LAST_RUN_KEY,
    fields: { startedAt: isString, total: isNumber, updated: isNumber },
  },
}

function parseRun<T>(
  value: unknown,
  fields: Record<string, (value: unknown) => boolean>,
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

  async getLastRun<K extends LastRunKind>(kind: K): Promise<LastRun<K> | null> {
    const row = await this.repo.findOne({ where: { key: LAST_RUN_FIELDS[kind].key } })
    return parseRun<LastRun<K>>(row?.value, LAST_RUN_FIELDS[kind].fields)
  }

  async setLastRun<K extends LastRunKind>(kind: K, run: LastRun<K>): Promise<void> {
    await this.repo.upsert({ key: LAST_RUN_FIELDS[kind].key, value: run }, ['key'])
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
