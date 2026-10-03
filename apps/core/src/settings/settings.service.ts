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

function isFaceDetectorKind(value: unknown): value is FaceDetectorKind {
  return typeof value === 'string' && (FACE_DETECTOR_KINDS as readonly string[]).includes(value)
}

function parseLastRun(value: unknown): FaceReprocessLastRun | null {
  if (typeof value !== 'object' || value === null) return null
  const row = value as Record<string, unknown>
  if (
    typeof row.startedAt !== 'string' ||
    typeof row.total !== 'number' ||
    typeof row.enqueued !== 'number' ||
    !isFaceDetectorKind(row.detector)
  ) {
    return null
  }
  return {
    startedAt: row.startedAt,
    total: row.total,
    enqueued: row.enqueued,
    detector: row.detector,
  }
}

function parseEmbeddingLastRun(value: unknown): EmbeddingReprocessLastRun | null {
  if (typeof value !== 'object' || value === null) return null
  const row = value as Record<string, unknown>
  if (
    typeof row.startedAt !== 'string' ||
    typeof row.total !== 'number' ||
    typeof row.enqueued !== 'number' ||
    typeof row.model !== 'string'
  ) {
    return null
  }
  return { startedAt: row.startedAt, total: row.total, enqueued: row.enqueued, model: row.model }
}

function parseOcrLastRun(value: unknown): OcrReprocessLastRun | null {
  if (typeof value !== 'object' || value === null) return null
  const row = value as Record<string, unknown>
  if (
    typeof row.startedAt !== 'string' ||
    typeof row.total !== 'number' ||
    typeof row.enqueued !== 'number'
  ) {
    return null
  }
  return { startedAt: row.startedAt, total: row.total, enqueued: row.enqueued }
}

function parseDetectionsLastRun(value: unknown): DetectionsReprocessLastRun | null {
  if (typeof value !== 'object' || value === null) return null
  const row = value as Record<string, unknown>
  if (
    typeof row.startedAt !== 'string' ||
    typeof row.total !== 'number' ||
    typeof row.enqueued !== 'number'
  ) {
    return null
  }
  return { startedAt: row.startedAt, total: row.total, enqueued: row.enqueued }
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

  async getFaceReprocessLastRun(): Promise<FaceReprocessLastRun | null> {
    const row = await this.repo.findOne({ where: { key: FACE_REPROCESS_LAST_RUN_KEY } })
    return parseLastRun(row?.value)
  }

  async setFaceReprocessLastRun(run: FaceReprocessLastRun): Promise<void> {
    await this.repo.upsert({ key: FACE_REPROCESS_LAST_RUN_KEY, value: run }, ['key'])
  }

  async getEmbeddingReprocessLastRun(): Promise<EmbeddingReprocessLastRun | null> {
    const row = await this.repo.findOne({ where: { key: EMBEDDING_REPROCESS_LAST_RUN_KEY } })
    return parseEmbeddingLastRun(row?.value)
  }

  async setEmbeddingReprocessLastRun(run: EmbeddingReprocessLastRun): Promise<void> {
    await this.repo.upsert({ key: EMBEDDING_REPROCESS_LAST_RUN_KEY, value: run }, ['key'])
  }

  async getOcrReprocessLastRun(): Promise<OcrReprocessLastRun | null> {
    const row = await this.repo.findOne({ where: { key: OCR_REPROCESS_LAST_RUN_KEY } })
    return parseOcrLastRun(row?.value)
  }

  async setOcrReprocessLastRun(run: OcrReprocessLastRun): Promise<void> {
    await this.repo.upsert({ key: OCR_REPROCESS_LAST_RUN_KEY, value: run }, ['key'])
  }

  async getDetectionsReprocessLastRun(): Promise<DetectionsReprocessLastRun | null> {
    const row = await this.repo.findOne({ where: { key: DETECTIONS_REPROCESS_LAST_RUN_KEY } })
    return parseDetectionsLastRun(row?.value)
  }

  async setDetectionsReprocessLastRun(run: DetectionsReprocessLastRun): Promise<void> {
    await this.repo.upsert({ key: DETECTIONS_REPROCESS_LAST_RUN_KEY, value: run }, ['key'])
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
