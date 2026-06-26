import { Injectable } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository } from 'typeorm'
import { FileRecord } from '../entities/file-record.entity'

@Injectable()
export class AdminService {
  constructor(@InjectRepository(FileRecord) private readonly fileRepo: Repository<FileRecord>) {}

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
}
