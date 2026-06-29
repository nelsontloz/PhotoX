import { Injectable, NotFoundException } from '@nestjs/common'
import { HttpService } from '@nestjs/axios'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository } from 'typeorm'
import { firstValueFrom } from 'rxjs'
import sharp from 'sharp'
import { Face } from './entities/face.entity'
import { Asset } from '../entities/asset.entity'
import { SERVICE_URLS } from '@photox/shared-config'

const DEFAULT_SIZE = 240
const MAX_SIZE = 600

@Injectable()
export class FaceThumbService {
  constructor(
    @InjectRepository(Face)
    private readonly faceRepo: Repository<Face>,
    @InjectRepository(Asset)
    private readonly assetRepo: Repository<Asset>,
    private readonly http: HttpService,
  ) {}

  // ponytail: synchronous crop on demand. Caching the resulting jpeg (e.g. via a `face_thumbs` table or MinIO) is the upgrade path when traffic warrants.
  async getThumb(faceId: string, userId: string, size: number): Promise<Buffer> {
    const target = Math.max(
      32,
      Math.min(MAX_SIZE, Math.floor(Number.isFinite(size) ? size : DEFAULT_SIZE)),
    )
    const face = await this.faceRepo.findOne({ where: { id: faceId, userId } })
    if (!face) throw new NotFoundException('Face not found')

    const asset = await this.assetRepo.findOne({ where: { id: face.assetId, userId } })
    if (!asset) throw new NotFoundException('Asset not found')

    const url = `${SERVICE_URLS['file-storage-service']}/v1/files/${asset.fileId}/stream`
    const upstream = await firstValueFrom(
      this.http.get<ArrayBuffer>(url, { responseType: 'arraybuffer', timeout: 30_000 }),
    )
    const buf = Buffer.from(upstream.data)

    const meta = await sharp(buf).metadata()
    const imgW = meta.width ?? 0
    const imgH = meta.height ?? 0
    if (!imgW || !imgH) throw new NotFoundException('Source image unreadable')

    const pad = 0.35
    const left = Math.max(0, Math.floor(face.box.x - face.box.w * pad))
    const top = Math.max(0, Math.floor(face.box.y - face.box.h * pad))
    const width = Math.min(imgW - left, Math.ceil(face.box.w * (1 + pad * 2)))
    const height = Math.min(imgH - top, Math.ceil(face.box.h * (1 + pad * 2)))
    if (width <= 0 || height <= 0) throw new NotFoundException('Face box out of bounds')

    return sharp(buf)
      .extract({ left, top, width, height })
      .resize({ width: target, height: target, fit: 'cover' })
      .jpeg({ quality: 82 })
      .toBuffer()
  }
}
