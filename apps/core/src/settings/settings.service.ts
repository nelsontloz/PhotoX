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

interface LastRuns {
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

/** app_settings key per last-run kind; records are only written by setLastRun below. */
const LAST_RUN_KEYS: Record<LastRunKind, string> = {
  face: FACE_REPROCESS_LAST_RUN_KEY,
  embedding: EMBEDDING_REPROCESS_LAST_RUN_KEY,
  ocr: OCR_REPROCESS_LAST_RUN_KEY,
  detections: DETECTIONS_REPROCESS_LAST_RUN_KEY,
  metadata: METADATA_REPROCESS_LAST_RUN_KEY,
  places: PLACES_BACKFILL_LAST_RUN_KEY,
}

// ponytail: shallow guard only — the stored JSON comes from setLastRun's typed values, so a wrong
// envelope reading back as null is enough; add per-field checks back only if rows can originate
// outside this service.
function parseRun<T>(value: unknown): T | null {
  if (typeof value !== 'object' || value === null) return null
  const run = value as Partial<EnqueuedRun & { updated: number }>
  const hasEnvelope =
    isString(run.startedAt) &&
    isNumber(run.total) &&
    (isNumber(run.enqueued) || isNumber(run.updated))
  return hasEnvelope ? (value as T) : null
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
    const row = await this.repo.findOne({ where: { key: LAST_RUN_KEYS[kind] } })
    return parseRun<LastRun<K>>(row?.value)
  }

  async setLastRun<K extends LastRunKind>(kind: K, run: LastRun<K>): Promise<void> {
    await this.repo.upsert({ key: LAST_RUN_KEYS[kind], value: run }, ['key'])
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
