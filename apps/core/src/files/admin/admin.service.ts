import { Injectable } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository } from 'typeorm'
import { FileRecord } from '../../database/entities'
import { LocalStorageService } from '@photox/shared-config'

@Injectable()
export class AdminService {
  constructor(
    @InjectRepository(FileRecord) private readonly fileRepo: Repository<FileRecord>,
    private readonly storage: LocalStorageService,
  ) {}

  async deleteFile(fileId: string): Promise<void> {
    const record = await this.fileRepo.findOne({ where: { id: fileId } })
    if (!record) return

    try {
      await this.storage.delete(record.storageKey)
    } catch (err) {
      console.error('[AdminService] Local storage delete failed', err)
    }

    await this.fileRepo.remove(record)
  }
}
