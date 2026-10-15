import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import type { Repository } from 'typeorm'
import type {
  AdminUserDeleteResponse,
  AdminUserDeleteState,
  AdminUserDeleteStatus,
  AdminUserListResponse,
  AdminUserRow,
  AdminUserSortField,
} from '@photox/shared-types'
import { User } from '../entities/user.entity'
import { BullMqService } from '../../queue/bullmq.service'
import { USER_DELETE_QUEUE, UserDeleteService, userDeleteJobId } from './user-delete.service'

interface ListAdminUsersParams {
  limit: number
  offset: number
  q?: string
  sortField: AdminUserSortField
  sortDir: 'asc' | 'desc'
  role?: 'user' | 'admin'
}

@Injectable()
export class AdminService {
  constructor(
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    private readonly bullMq: BullMqService,
    private readonly deletes: UserDeleteService,
  ) {}

  async listUsers(params: ListAdminUsersParams): Promise<AdminUserListResponse> {
    const qb = this.userRepo
      .createQueryBuilder('u')
      .select(['u.id', 'u.displayName', 'u.email', 'u.role', 'u.createdAt'])

    if (params.q) {
      const like = `%${params.q}%`
      qb.andWhere('(u.email ILIKE :like OR u.displayName ILIKE :like)', { like })
    }
    if (params.role) {
      qb.andWhere('u.role = :role', { role: params.role })
    }
    qb.orderBy(`u.${params.sortField}`, params.sortDir.toUpperCase() as 'ASC' | 'DESC')
    qb.take(params.limit).skip(params.offset)

    const [rows, total] = await qb.getManyAndCount()

    const items: AdminUserRow[] = rows.map((u) => ({
      id: u.id,
      displayName: u.displayName,
      email: u.email,
      role: u.role,
      createdAt: u.createdAt.toISOString(),
    }))

    return { items, total, limit: params.limit, offset: params.offset }
  }

  /**
   * Guard chain for async deletion: 404 unknown target, 403 self-delete, 409 last
   * admin. Worker `act` tokens never reach here — the central JwtAuthGuard denies
   * act-carrying tokens on every /api/v1/admin/* route, none are allowlisted.
   */
  async requestUserDelete(
    targetUserId: string,
    requesterId: string,
  ): Promise<AdminUserDeleteResponse> {
    const user = await this.userRepo.findOne({ where: { id: targetUserId } })
    if (!user) throw new NotFoundException('User not found')
    if (requesterId === targetUserId) {
      throw new ForbiddenException('Cannot delete your own account')
    }
    if (user.role === 'admin') {
      const adminCount = await this.userRepo.count({ where: { role: 'admin' } })
      if (adminCount <= 1) throw new ConflictException('Cannot delete the last admin')
    }

    const jobId = userDeleteJobId(user.id)
    const prefix = this.deletes.computeBackupPrefix(user.email, user.id)
    // a retained terminal job with this id would swallow the enqueue (BullMQ dedups by
    // jobId), so a re-delete after a restore would silently no-op — drop it first
    await this.deletes.clearFinishedJob(user.id)
    // drain first so pending media jobs cannot retry-noise into 404s mid-delete
    await this.deletes.drainUserJobs(user.id)
    const enqueued = await this.bullMq.enqueue(
      USER_DELETE_QUEUE,
      'user-delete',
      { userId: user.id, email: user.email, backupPrefix: prefix },
      { jobId, removeOnComplete: true },
    )
    if (!enqueued) throw new ServiceUnavailableException('Failed to enqueue user deletion')
    this.deletes.markQueued(user.id, jobId, prefix)
    // the S3 backup prefix is deliberately left intact — never enumerated or deleted
    return { jobId, userId: user.id, backupKept: true, backupPrefix: prefix }
  }

  /**
   * Pollable deletion status (the UI polls this): BullMQ job state when the job record
   * exists, else the in-memory progress (covers failed jobs, which BullMQ drops via
   * removeOnFail). Unknown users 404 unless a finished run is recorded (the user row
   * is gone after a completed delete, so that state must stay readable).
   */
  async getUserDeleteStatus(targetUserId: string): Promise<AdminUserDeleteStatus> {
    const jobId = userDeleteJobId(targetUserId)
    const queue = this.bullMq.getQueue(USER_DELETE_QUEUE)
    const [job, counts] = await Promise.all([queue.getJob(jobId), queue.getJobCounts()])
    const progress = this.deletes.getProgress(targetUserId)

    if (job) {
      const raw = await job.getState()
      const state = mapJobState(raw)
      const data = job.data as { backupPrefix?: unknown } | null | undefined
      const fromProgress = progress?.backupPrefix
      const fromData = typeof data?.backupPrefix === 'string' ? data.backupPrefix : undefined
      const prefix = fromProgress ?? fromData ?? (await this.prefixForLiveUser(targetUserId))
      return {
        userId: targetUserId,
        jobId,
        state,
        backupKept: true,
        backupPrefix: prefix,
        queue: { ...counts },
      }
    }

    if (progress && (progress.state === 'completed' || progress.state === 'failed')) {
      return {
        userId: targetUserId,
        jobId: progress.jobId,
        state: progress.state,
        backupKept: true,
        backupPrefix: progress.backupPrefix,
        queue: { ...counts },
      }
    }

    const user = await this.userRepo.findOne({ where: { id: targetUserId } })
    if (!user) throw new NotFoundException('User not found')
    return {
      userId: targetUserId,
      jobId,
      state: progress?.state ?? 'unknown',
      backupKept: true,
      backupPrefix: progress?.backupPrefix ?? this.deletes.computeBackupPrefix(user.email, user.id),
      queue: { ...counts },
    }
  }

  private async prefixForLiveUser(userId: string): Promise<string> {
    const user = await this.userRepo.findOne({ where: { id: userId } })
    return user ? this.deletes.computeBackupPrefix(user.email, user.id) : ''
  }
}

function mapJobState(raw: string): AdminUserDeleteState {
  if (raw === 'completed') return 'completed'
  if (raw === 'failed') return 'failed'
  if (raw === 'active') return 'active'
  if (raw === 'delayed' || raw === 'waiting' || raw === 'prioritized' || raw === 'paused') {
    return 'queued'
  }
  return 'unknown'
}
