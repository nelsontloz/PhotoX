import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, type Repository } from 'typeorm';
import type { AssetDetectionsResponse } from '@photox/shared-types';
import { AssetsService } from '../assets/assets.service';
import { AssetDetection } from '../database/entities/asset-detection.entity';
import type { RegisterDetectionsDto } from './dto/register-detections.dto';

@Injectable()
export class DetectionsService {
  constructor(
    @InjectRepository(AssetDetection)
    private readonly repo: Repository<AssetDetection>,
    private readonly dataSource: DataSource,
    private readonly assets: AssetsService,
  ) {}

  async register(
    assetId: string,
    userId: string,
    dto: RegisterDetectionsDto,
  ): Promise<{ ok: true }> {
    await this.assets.assertOwned(userId, assetId);
    const rows = dto.detections.map((d) => ({
      assetId,
      label: d.label.trim(),
      confidence: d.confidence,
      box: d.box,
    }));
    // replace-semantics: one detection set per asset, so an empty array clears stale rows and a
    // re-run never mixes old and new boxes. The delete+insert is atomic.
    await this.dataSource.transaction(async (em) => {
      await em.delete(AssetDetection, { assetId });
      if (rows.length > 0) await em.insert(AssetDetection, rows);
    });
    return { ok: true };
  }

  async list(userId: string, assetId: string): Promise<AssetDetectionsResponse> {
    await this.assets.assertOwned(userId, assetId);
    const rows = await this.repo.find({ where: { assetId }, order: { confidence: 'DESC' } });
    return {
      detections: rows.map((r) => ({ label: r.label, confidence: r.confidence, box: r.box })),
    };
  }
}
