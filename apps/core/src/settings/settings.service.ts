import { Injectable } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { access } from 'fs/promises'
import { Repository } from 'typeorm'
import { resolveFaceDetectorModelPath } from '@photox/shared-config'
import type { FaceDetectionSettings } from '@photox/shared-types'
import { AppSetting } from '../database/entities'

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
  face: EnqueuedRun
  embedding: EnqueuedRun & { model: string }
  ocr: EnqueuedRun
  detections: EnqueuedRun
  metadata: EnqueuedRun
  places: { startedAt: string; total: number; updated: number }
}

export type LastRunKind = keyof LastRuns
export type LastRun<K extends LastRunKind> = LastRuns[K]

/** app_settings key per last-run kind; records are only written by setLastRun below. */
const LAST_RUN_KEYS: Record<LastRunKind, string> = {
  face: FACE_REPROCESS_LAST_RUN_KEY,
  embedding: EMBEDDING_REPROCESS_LAST_RUN_KEY,
  ocr: OCR_REPROCESS_LAST_RUN_KEY,
  detections: DETECTIONS_REPROCESS_LAST_RUN_KEY,
  metadata: METADATA_REPROCESS_LAST_RUN_KEY,
  places: PLACES_BACKFILL_LAST_RUN_KEY,
}

@Injectable()
export class SettingsService {
  constructor(
    @InjectRepository(AppSetting)
    private readonly repo: Repository<AppSetting>,
  ) {}

  async getSettings(): Promise<FaceDetectionSettings> {
    return { modelAvailable: await this.scrfdModelAvailable() }
  }

  async getLastRun<K extends LastRunKind>(kind: K): Promise<LastRun<K> | null> {
    const row = await this.repo.findOne({ where: { key: LAST_RUN_KEYS[kind] } })
    // ponytail: shallow guard only — the stored JSON comes from setLastRun's typed values, so a
    // wrong envelope reading back as null is enough; add per-field checks back only if rows can
    // originate outside this service.
    const value: unknown = row?.value
    if (typeof value !== 'object' || value === null) return null
    const run = value as Partial<EnqueuedRun & { updated: number }>
    const hasEnvelope =
      typeof run.startedAt === 'string' &&
      typeof run.total === 'number' &&
      (typeof run.enqueued === 'number' || typeof run.updated === 'number')
    return hasEnvelope ? (value as LastRun<K>) : null
  }

  async setLastRun<K extends LastRunKind>(kind: K, run: LastRun<K>): Promise<void> {
    await this.repo.upsert({ key: LAST_RUN_KEYS[kind], value: run }, ['key'])
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
