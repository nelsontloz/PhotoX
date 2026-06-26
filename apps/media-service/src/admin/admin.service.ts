import { Injectable } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { type Repository } from 'typeorm'
import { Asset } from '../entities/asset.entity'

@Injectable()
export class AdminService {
  constructor(@InjectRepository(Asset) private readonly assetRepo: Repository<Asset>) {}

  async getAssetStatsByUser(userIds: string[]): Promise<Record<string, number>> {
    if (userIds.length === 0) return {}
    const rows = await this.assetRepo
      .createQueryBuilder('a')
      .select('a.userId', 'userId')
      .addSelect('COUNT(*)', 'count')
      .where('a.userId IN (:...userIds)', { userIds })
      .groupBy('a.userId')
      .getRawMany<{ userId: string; count: string }>()

    const result: Record<string, number> = {}
    for (const row of rows) {
      result[row.userId] = Number(row.count)
    }
    return result
  }
}
