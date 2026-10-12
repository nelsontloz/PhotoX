import { Injectable, Logger } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository } from 'typeorm'
import { FileRecord } from '../../database/entities'
import { LocalStorageService } from '@photox/shared-config'
import { findOwnedOr404 } from '../../common/asset-ownership'

@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name)

  constructor(
    @InjectRepository(FileRecord) private readonly fileRepo: Repository<FileRecord>,
    private readonly storage: LocalStorageService,
  ) {}

  // Without an owner scope this deletes any file idempotently (human admin path). The worker
  // path always passes the job's userId, so a poisoned cleanup-asset { fileId } 404s instead of
  // deleting another user's bytes.
  async deleteFile(fileId: string, ownerId?: string): Promise<void> {
    const record =
      ownerId === undefined
        ? await this.fileRepo.findOne({ where: { id: fileId } })
        : await findOwnedOr404(this.fileRepo, fileId, ownerId, 'File')
    if (!record) return

    if (ownerId !== undefined) this.logger.log(`Scoped file delete ${fileId} for user ${ownerId}`)

    try {
      await this.storage.delete(record.storageKey)
    } catch (err) {
      console.error('[AdminService] Local storage delete failed', err)
    }

    await this.fileRepo.remove(record)
  }
}
