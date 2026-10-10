import { Injectable, NotFoundException } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository } from 'typeorm'
import { readFile } from 'fs/promises'
import sharp from 'sharp'
import { Face } from '../database/entities'
import { Asset } from '../database/entities'
import { FileRecord } from '../database/entities'
import { findOwnedOr404 } from '../common/asset-ownership'
import { LocalStorageService } from '@photox/shared-config'

const DEFAULT_SIZE = 240
const MAX_SIZE = 600

@Injectable()
export class FaceThumbService {
  constructor(
    @InjectRepository(Face)
    private readonly faceRepo: Repository<Face>,
    @InjectRepository(Asset)
    private readonly assetRepo: Repository<Asset>,
    @InjectRepository(FileRecord)
    private readonly fileRepo: Repository<FileRecord>,
    private readonly storage: LocalStorageService,
  ) {}

  // ponytail: synchronous crop on demand. Caching the resulting jpeg (e.g. via a `face_thumbs` table or local disk) is the upgrade path when traffic warrants.
  async getThumb(faceId: string, userId: string, size: number): Promise<Buffer> {
    const target = Math.max(
      32,
      Math.min(MAX_SIZE, Math.floor(Number.isFinite(size) ? size : DEFAULT_SIZE)),
    )
    const face = await findOwnedOr404(this.faceRepo, faceId, userId, 'Face')
    const asset = await findOwnedOr404(this.assetRepo, face.assetId, userId, 'Asset')
    const record = await findOwnedOr404(this.fileRepo, asset.fileId, userId, 'File')
    const buf = await readFile(this.storage.pathFor(record.storageKey))

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
