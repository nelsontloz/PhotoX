import { Injectable } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import type { Repository, SelectQueryBuilder } from 'typeorm'
import type { AdminUserListResponse, AdminUserRow, AdminUserSortField } from '@photox/shared-types'
import { User } from '../entities/user.entity'

export interface ListAdminUsersParams {
  limit: number
  offset: number
  q?: string
  sortField: AdminUserSortField
  sortDir: 'asc' | 'desc'
  role?: 'user' | 'admin'
}

@Injectable()
export class AdminService {
  constructor(@InjectRepository(User) private readonly userRepo: Repository<User>) {}

  async listUsers(params: ListAdminUsersParams): Promise<AdminUserListResponse> {
    const qb = this.userRepo
      .createQueryBuilder('u')
      .select(['u.id', 'u.displayName', 'u.email', 'u.role', 'u.createdAt'])

    this.applyFilters(qb, params)
    qb.orderBy(`u.${params.sortField}`, params.sortDir.toUpperCase() as 'ASC' | 'DESC')
    qb.take(params.limit).skip(params.offset)

    const [rows, total] = await qb.getManyAndCount()

    const items: AdminUserRow[] = rows.map((u) => ({
      id: u.id,
      displayName: u.displayName,
      email: u.email,
      role: u.role,
      createdAt: u.createdAt.toISOString(),
      assetCount: 0,
      bytesUsed: 0,
    }))

    return { items, total, limit: params.limit, offset: params.offset }
  }

  private applyFilters(qb: SelectQueryBuilder<User>, params: ListAdminUsersParams): void {
    if (params.q) {
      const like = `%${params.q}%`
      qb.andWhere('(u.email ILIKE :like OR u.displayName ILIKE :like)', { like })
    }
    if (params.role) {
      qb.andWhere('u.role = :role', { role: params.role })
    }
  }

  static parseSort(sort: string | undefined): { field: AdminUserSortField; dir: 'asc' | 'desc' } {
    if (!sort) return { field: 'createdAt', dir: 'desc' }
    const [field, dir] = sort.split(':') as [AdminUserSortField, 'asc' | 'desc']
    return { field, dir: dir === 'asc' ? 'asc' : 'desc' }
  }
}
