import { Controller, Get, Post, Delete, Param, Body, HttpCode, HttpStatus } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository, DataSource } from 'typeorm'
import { AssetThumbnail } from '../entities/asset-thumbnail.entity'

@ApiTags('internal')
@Controller('v1')
export class InternalController {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(AssetThumbnail)
    private readonly thumbRepo: Repository<AssetThumbnail>,
  ) {}

  @Get('file-ids')
  async getFileIds(): Promise<string[]> {
    const rows: { fileId: string }[] = await this.dataSource.query(`
      SELECT "fileId" AS "fileId" FROM assets
      UNION
      SELECT "transcodeFileId" AS "fileId" FROM assets WHERE "transcodeFileId" IS NOT NULL
      UNION
      SELECT "fileId" AS "fileId" FROM asset_thumbnails
    `)
    return rows.map((r) => r.fileId)
  }

  @Post('thumbnails/orphan-rows')
  async getOrphanThumbnailRows(
    @Body() body: { existingFileIds: string[] },
  ): Promise<{ assetId: string; size: string; fileId: string }[]> {
    const ids = body.existingFileIds?.filter(Boolean) ?? []
    if (ids.length === 0) return []
    return this.thumbRepo
      .createQueryBuilder('t')
      .select(['t."assetId"', 't.size', 't."fileId"'])
      .where('t."fileId" NOT IN (:...ids)', { ids })
      .getRawMany()
  }

  @Delete('thumbnails/:assetId/:size')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteThumbnail(
    @Param('assetId') assetId: string,
    @Param('size') size: string,
  ): Promise<void> {
    await this.thumbRepo.delete({ assetId, size })
  }
}
