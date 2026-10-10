import { Injectable, UnprocessableEntityException } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import type { Repository } from 'typeorm'
import { Asset } from '../database/entities'
import { AssetOcr } from '../database/entities/asset-ocr.entity'
import { findOwnedOr404 } from '../common/asset-ownership'
import type { RegisterOcrDto } from './dto/register-ocr.dto'

const TEXT_MAX = 50_000
const LANG_MIN = 2
const LANG_MAX = 8

@Injectable()
export class OcrService {
  constructor(
    @InjectRepository(AssetOcr)
    private readonly repo: Repository<AssetOcr>,
    @InjectRepository(Asset)
    private readonly assetRepo: Repository<Asset>,
  ) {}

  async register(assetId: string, userId: string, dto: RegisterOcrDto): Promise<{ ok: true }> {
    await findOwnedOr404(this.assetRepo, assetId, userId, 'Asset')
    this.assertValid(dto)
    // asset_ocr PK IS assetId: exactly one concatenated row per asset, so the search FTS
    // LEFT JOIN cannot fan out. Re-runs overwrite; empty results are rejected upstream (422)
    // rather than stored, so a no-text asset simply has no OCR row.
    await this.repo.upsert(
      [
        {
          assetId,
          text: dto.text.trim(),
          lang: dto.lang ?? null,
          confidence: dto.confidence ?? null,
        },
      ],
      ['assetId'],
    )
    return { ok: true }
  }

  // untrusted wire body — validate the real values, not the DTO's declared types
  private assertValid(dto: RegisterOcrDto): void {
    const text: unknown = dto.text
    const trimmed = typeof text === 'string' ? text.trim() : ''
    if (trimmed.length === 0 || trimmed.length > TEXT_MAX) {
      throw new UnprocessableEntityException(`text must be 1-${TEXT_MAX} non-whitespace characters`)
    }

    const lang: unknown = dto.lang
    if (lang !== null && lang !== undefined) {
      if (typeof lang !== 'string' || lang.length < LANG_MIN || lang.length > LANG_MAX) {
        throw new UnprocessableEntityException(`lang must be ${LANG_MIN}-${LANG_MAX} characters`)
      }
    }

    const confidence: unknown = dto.confidence
    if (confidence !== null && confidence !== undefined) {
      if (
        typeof confidence !== 'number' ||
        !Number.isFinite(confidence) ||
        confidence < 0 ||
        confidence > 1
      ) {
        throw new UnprocessableEntityException('confidence must be between 0 and 1')
      }
    }
  }
}
