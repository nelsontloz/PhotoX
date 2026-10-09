import { Injectable, UnprocessableEntityException } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { DataSource, type Repository } from 'typeorm'
import type { AssetDetectionsResponse } from '@photox/shared-types'
import { Asset } from '../database/entities'
import { assertAssetOwned } from '../common/asset-ownership'
import { AssetDetection } from '../database/entities/asset-detection.entity'
import type { DetectedObjectDto, RegisterDetectionsDto } from './dto/register-detections.dto'

const MAX_DETECTIONS = 200
const LABEL_MAX = 64

function isValidBox(box: unknown): boolean {
  if (typeof box !== 'object' || box === null) return false
  const b = box as Record<string, unknown>
  for (const key of ['x', 'y', 'w', 'h']) {
    if (typeof b[key] !== 'number' || !Number.isFinite(b[key])) return false
  }
  return (b.w as number) > 0 && (b.h as number) > 0
}

@Injectable()
export class DetectionsService {
  constructor(
    @InjectRepository(AssetDetection)
    private readonly repo: Repository<AssetDetection>,
    @InjectRepository(Asset)
    private readonly assetRepo: Repository<Asset>,
    private readonly dataSource: DataSource,
  ) {}

  async register(
    assetId: string,
    userId: string,
    dto: RegisterDetectionsDto,
  ): Promise<{ ok: true }> {
    await assertAssetOwned(this.assetRepo, userId, assetId)
    this.assertValid(dto)
    const rows = dto.detections.map((d) => ({
      assetId,
      label: d.label.trim(),
      confidence: d.confidence,
      box: d.box,
    }))
    // replace-semantics: one detection set per asset, so an empty array clears stale rows and a
    // re-run never mixes old and new boxes. The delete+insert is atomic.
    await this.dataSource.transaction(async (em) => {
      await em.delete(AssetDetection, { assetId })
      if (rows.length > 0) await em.insert(AssetDetection, rows)
    })
    return { ok: true }
  }

  async list(userId: string, assetId: string): Promise<AssetDetectionsResponse> {
    await assertAssetOwned(this.assetRepo, userId, assetId)
    const rows = await this.repo.find({ where: { assetId }, order: { confidence: 'DESC' } })
    return {
      detections: rows.map((r) => ({ label: r.label, confidence: r.confidence, box: r.box })),
    }
  }

  // untrusted wire body — validate the real values, not the DTO's declared types
  private assertValid(dto: RegisterDetectionsDto): void {
    const detections: unknown = dto.detections
    if (!Array.isArray(detections)) {
      throw new UnprocessableEntityException('detections must be an array')
    }
    if (detections.length > MAX_DETECTIONS) {
      throw new UnprocessableEntityException(
        `detections must contain at most ${MAX_DETECTIONS} items`,
      )
    }
    detections.forEach((raw, index) => {
      const detection = raw as Partial<DetectedObjectDto>
      const label: unknown = detection.label
      if (typeof label !== 'string' || label.trim().length === 0 || label.length > LABEL_MAX) {
        throw new UnprocessableEntityException(
          `detections[${index}].label must be 1-${LABEL_MAX} characters`,
        )
      }
      const confidence: unknown = detection.confidence
      if (
        typeof confidence !== 'number' ||
        !Number.isFinite(confidence) ||
        confidence < 0 ||
        confidence > 1
      ) {
        throw new UnprocessableEntityException(
          `detections[${index}].confidence must be between 0 and 1`,
        )
      }
      if (!isValidBox(detection.box)) {
        throw new UnprocessableEntityException(
          `detections[${index}].box must be finite numbers with w/h > 0`,
        )
      }
    })
  }
}
