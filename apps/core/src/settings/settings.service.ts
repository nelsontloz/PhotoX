import { Injectable } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { access } from 'fs/promises'
import { Repository } from 'typeorm'
import { envFaceDetectorKind, resolveFaceDetectorModelPath } from '@photox/shared-config'
import {
  FACE_DETECTOR_KINDS,
  type FaceDetectionSettings,
  type FaceDetectorKind,
} from '@photox/shared-types'
import { AppSetting } from '../database/entities'

export const FACE_DETECTOR_SETTING_KEY = 'face.detector'

function isFaceDetectorKind(value: unknown): value is FaceDetectorKind {
  return typeof value === 'string' && (FACE_DETECTOR_KINDS as readonly string[]).includes(value)
}

@Injectable()
export class SettingsService {
  constructor(
    @InjectRepository(AppSetting)
    private readonly repo: Repository<AppSetting>,
  ) {}

  envDefaultDetector(): FaceDetectorKind {
    return envFaceDetectorKind()
  }

  async getFaceDetector(): Promise<FaceDetectorKind> {
    const row = await this.repo.findOne({ where: { key: FACE_DETECTOR_SETTING_KEY } })
    return isFaceDetectorKind(row?.value) ? row.value : this.envDefaultDetector()
  }

  async getSettings(): Promise<FaceDetectionSettings> {
    const [detector, scrfd] = await Promise.all([
      this.getFaceDetector(),
      this.scrfdModelAvailable(),
    ])
    return { detector, envDefault: this.envDefaultDetector(), models: { scrfd } }
  }

  async setFaceDetector(kind: FaceDetectorKind): Promise<void> {
    await this.repo.upsert({ key: FACE_DETECTOR_SETTING_KEY, value: kind }, ['key'])
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
