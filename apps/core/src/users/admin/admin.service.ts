import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import type { Repository } from 'typeorm'
import { backupPrefix, normalizeEmail } from '@photox/shared-config'
import type {
  AdminUserBackupSync,
  AdminUserDeleteResponse,
  AdminUserDeleteState,
  AdminUserDeleteStatus,
  AdminUserListResponse,
  AdminUserRow,
  AdminUserSortField,
  AdminUserUpdateResponse,
} from '@photox/shared-types'
import { isPostgresUniqueViolation } from '../../assets/assets.service'
import { UserBackupService } from '../../backup/user-backup.service'
import { User } from '../entities/user.entity'
import { AuthService } from '../auth.service'
import { hashPassword } from '../password'
import { BullMqService } from '../../queue/bullmq.service'
import { USER_DELETE_QUEUE, userDeleteJobId } from '@photox/shared-types'
import { UserDeleteService } from './user-delete.service'
import type { CreateAdminUserDto } from './dto/create-admin-user.body.dto'
import type { UpdateAdminUserDto } from './dto/update-admin-user.body.dto'

interface ListAdminUsersParams {
  limit: number
  offset: number
  q?: string
  sortField: AdminUserSortField
  sortDir: 'asc' | 'desc'
  role?: 'user' | 'admin'
}

/**
 * `backupPrefix` → `resolveBackupPrefix` → `loadEnv()` can throw (zod env error,
 * empty email/userId, empty userId). A fallback `to` must never turn an already
 * applied edit into a 500, so a failed computation degrades to `''`.
 */
function safeBackupPrefix(email: string, userId: string): string {
  try {
    return backupPrefix(email, userId)
  } catch {
    return ''
  }
}

/** Fallback sync result for a failed backup move; safeBackupPrefix keeps this non-throwing. */
function backupSyncFailure(user: Pick<User, 'id' | 'email'>, err: unknown): AdminUserBackupSync {
  return {
    synced: false,
    moved: false,
    to: safeBackupPrefix(user.email, user.id),
    error: err instanceof Error ? err.message : String(err),
  }
}

@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name)

  constructor(
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    private readonly bullMq: BullMqService,
    private readonly deletes: UserDeleteService,
    private readonly auth: AuthService,
    private readonly backups: UserBackupService,
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
   * Admin account edit. Only actually-changed fields are applied: an identical
   * resubmission (email compared normalized, displayName trimmed) is a 400 no-op
   * instead of a silent session wipe + S3 prefix move. Email/password changes
   * revoke every session (the guard's tokensValidAfter floor kills live access
   * tokens too); a displayName change never does. The row save and the revocation
   * commit in ONE transaction, so a failed revocation leaves the edit unapplied
   * and the admin's plain retry re-applies it. The S3 backup prefix is keyed by
   * email, so it is relocated after the commit — a failed move never fails the
   * edit (the response carries the error and POST :id/backup-sync retries).
   */
  async updateUser(
    targetUserId: string,
    patch: UpdateAdminUserDto,
    requesterId: string,
  ): Promise<AdminUserUpdateResponse> {
    const user = await this.userRepo.findOne({ where: { id: targetUserId } })
    if (!user) throw new NotFoundException('User not found')

    const changedFields: ('displayName' | 'email' | 'password')[] = []
    let newDisplayName: string | undefined
    let newEmail: string | undefined
    let newPassword: string | undefined

    if (patch.displayName !== undefined) {
      const value = patch.displayName.trim()
      if (value.length === 0) {
        throw new BadRequestException('displayName must not be blank')
      }
      if (value !== user.displayName) {
        newDisplayName = value
        changedFields.push('displayName')
      }
    }
    if (patch.email !== undefined) {
      // admin-set addresses are stored normalized; compare normalized so the same
      // address in different casing is a no-op rather than a needless revoke/move
      const value = normalizeEmail(patch.email)
      if (value !== normalizeEmail(user.email)) {
        newEmail = value
        changedFields.push('email')
      }
    }
    // passwords are hashed, so there is no value to compare against — always apply
    if (patch.password !== undefined) {
      newPassword = patch.password
      changedFields.push('password')
    }
    if (changedFields.length === 0) throw new BadRequestException('No changes to apply')

    if (newEmail !== undefined) {
      // LOWER() on both sides: registration stores raw emails while admin-set
      // addresses are normalized to lowercase, and the unique index on users.email
      // is case-sensitive — an exact-match pre-check would let `Taken@Example.com`
      // coexist with `taken@example.com`, two accounts colliding on the normalized
      // address that locateBackup matches on. The target's own row is excluded so
      // re-submitting the same address in another casing stays a no-op.
      // ponytail: LOWER(email) cannot use the plain unique index, so this is a
      // sequential scan — acceptable while the users table is small; upgrade path is
      // a functional index, i.e. CREATE UNIQUE INDEX ... ON users (LOWER(email)).
      const holder = await this.userRepo
        .createQueryBuilder('u')
        .where('LOWER(u.email) = LOWER(:email)', { email: newEmail })
        .andWhere('u.id != :id', { id: targetUserId })
        .getOne()
      if (holder) throw new ConflictException('Email already registered')
    }

    if (newDisplayName !== undefined) user.displayName = newDisplayName
    if (newEmail !== undefined) user.email = newEmail
    if (newPassword !== undefined) user.passwordHash = await hashPassword(newPassword)
    // The credential change and the session revocation are ONE transaction: a
    // committed save with a failed revocation would leave the new credential live
    // while old sessions survive, and the admin's retry would be a 400 no-op (no
    // recovery path). Atomicity rolls the edit back instead, so a plain retry
    // re-applies it. A displayName-only change never revokes.
    const revoke = newEmail !== undefined || newPassword !== undefined
    try {
      await this.userRepo.manager.transaction(async (m) => {
        await m.save(User, user)
        if (revoke) await this.auth.revokeAllSessions(user.id, m)
      })
    } catch (err) {
      // mapped OUTSIDE the transaction so a unique-violation race still answers 409
      // pre-check races a concurrent registration on the unique email index
      if (isPostgresUniqueViolation(err)) {
        throw new ConflictException('Email already registered')
      }
      throw err
    }

    // re-read so the response carries the post-revocation row (tokensValidAfter bump)
    const fresh = (await this.userRepo.findOne({ where: { id: user.id } })) ?? user

    let backup: AdminUserBackupSync
    try {
      backup = await this.backups.moveBackupPrefix(fresh)
    } catch (err) {
      // never fail the edit on backup storage — the UI can retry the move.
      // moveBackupPrefix itself never throws, but the fallback must not either:
      // backupPrefix can throw (loadEnv/empty email), so compute `to` defensively.
      backup = backupSyncFailure(fresh, err)
    }

    // never log the password value or any hash — field names only
    this.logger.log(`admin ${requesterId} updated user ${fresh.id}: ${changedFields.join(',')}`)

    return {
      user: {
        id: fresh.id,
        displayName: fresh.displayName,
        email: fresh.email,
        role: fresh.role,
        createdAt: fresh.createdAt.toISOString(),
        updatedAt: fresh.updatedAt.toISOString(),
      },
      backup,
    }
  }

  /**
   * Admin account creation. Ignores the `registration.enabled` switch on purpose — the
   * admin surface is the way to add accounts while public sign-up is off. No session is
   * minted and no backup work happens here (the prefix is created on first backup).
   */
  async createUser(body: CreateAdminUserDto): Promise<AdminUserRow> {
    const email = normalizeEmail(body.email)
    // LOWER() on both sides: open registration stores raw emails while admin-set
    // addresses are normalized — an exact-match pre-check would miss casing variants.
    const holder = await this.userRepo
      .createQueryBuilder('u')
      .where('LOWER(u.email) = LOWER(:email)', { email })
      .getOne()
    if (holder) throw new ConflictException('Email already registered')

    const user = this.userRepo.create({
      email,
      passwordHash: await hashPassword(body.password),
      displayName: body.displayName.trim(),
      role: body.role ?? 'user',
    })
    try {
      const saved = await this.userRepo.save(user)
      return {
        id: saved.id,
        displayName: saved.displayName,
        email: saved.email,
        role: saved.role,
        createdAt: saved.createdAt.toISOString(),
      }
    } catch (err) {
      // the pre-check races a concurrent registration on the unique email index
      if (isPostgresUniqueViolation(err)) {
        throw new ConflictException('Email already registered')
      }
      throw err
    }
  }

  /**
   * Idempotent "retry the backup move" for an account edit that could not reach S3.
   * moveBackupPrefix never throws: no existing prefix reports `{ synced: true }`, a
   * storage failure reports `{ synced: false, error }` — and if it ever did throw,
   * the retry endpoint reports the failure rather than 500ing.
   */
  async syncUserBackup(targetUserId: string): Promise<AdminUserBackupSync> {
    const user = await this.userRepo.findOne({ where: { id: targetUserId } })
    if (!user) throw new NotFoundException('User not found')
    try {
      return await this.backups.moveBackupPrefix(user)
    } catch (err) {
      return backupSyncFailure(user, err)
    }
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
    const prefix = backupPrefix(user.email, user.id)
    // a retained terminal job with this id would swallow the enqueue (BullMQ dedups by
    // jobId), so a re-delete after a restore would silently no-op — drop it first
    await this.deletes.clearFinishedJob(user.id)
    // pending per-user media jobs are drained by the worker's consumer at job start (the
    // worker owns those queues); core only enqueues the wipe here
    const enqueued = await this.bullMq.enqueue(
      USER_DELETE_QUEUE,
      'user-delete',
      { userId: user.id, email: user.email, backupPrefix: prefix },
      { jobId, removeOnComplete: true },
    )
    if (!enqueued) throw new ServiceUnavailableException('Failed to enqueue user deletion')
    this.deletes.setProgress(user.id, 'queued', jobId, prefix)
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
    const job = await this.bullMq.getJobSnapshot(USER_DELETE_QUEUE, jobId)
    const progress = this.deletes.getProgress(targetUserId)

    let state: AdminUserDeleteState = progress?.state ?? 'unknown'
    let prefix = progress?.backupPrefix ?? ''
    if (job) {
      state = mapJobState(job.state)
      const data = job.data as { backupPrefix?: unknown } | null | undefined
      const fromData = typeof data?.backupPrefix === 'string' ? data.backupPrefix : undefined
      prefix = progress?.backupPrefix ?? fromData ?? (await this.prefixForLiveUser(targetUserId))
    } else if (progress?.state !== 'completed' && progress?.state !== 'failed') {
      const user = await this.userRepo.findOne({ where: { id: targetUserId } })
      if (!user) throw new NotFoundException('User not found')
      prefix = progress?.backupPrefix ?? backupPrefix(user.email, user.id)
    }

    return { jobId, state, backupKept: true, backupPrefix: prefix }
  }

  private async prefixForLiveUser(userId: string): Promise<string> {
    const user = await this.userRepo.findOne({ where: { id: userId } })
    return user ? backupPrefix(user.email, user.id) : ''
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
