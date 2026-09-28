import { Injectable } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository } from 'typeorm'
import { FileRecord } from '@photox/data-access'
import { LocalStorageService } from '@photox/shared-config'

@Injectable()
export class AdminService {
  constructor(
    @InjectRepository(FileRecord) private readonly fileRepo: Repository<FileRecord>,
    private readonly storage: LocalStorageService,
  ) {}

  async getStorageStatsByUser(userIds: string[]): Promise<Record<string, number>> {
    if (userIds.length === 0) return {}
    const rows = await this.fileRepo
      .createQueryBuilder('f')
      .select('f.userId', 'userId')
      .addSelect('COALESCE(SUM(f.sizeBytes), 0)', 'totalBytes')
      .where('f.userId IN (:...userIds)', { userIds })
      .groupBy('f.userId')
      .getRawMany<{ userId: string; totalBytes: string }>()

    const result: Record<string, number> = {}
    for (const row of rows) {
      result[row.userId] = Number(row.totalBytes)
    }
    return result
  }

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
