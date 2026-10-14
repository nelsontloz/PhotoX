import { ConflictException, Injectable, Logger } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { backupPrefix, loadEnv, LocalStorageService } from '@photox/shared-config'
import type { AdminUserDeleteState } from '@photox/shared-types'
import { readdir, rm } from 'fs/promises'
import type { Dirent } from 'fs'
import { join, relative, resolve } from 'path'
import { DataSource, In, Repository } from 'typeorm'
import { z } from 'zod'
import { Album } from '../../albums/entities/album.entity'
import { AlbumAsset } from '../../albums/entities/album-asset.entity'
import { Asset, Face, FileRecord, Person } from '../../database/entities'
import { Share } from '../../shares/entities/share.entity'
import { BullMqService } from '../../queue/bullmq.service'
import { User } from '../entities/user.entity'
import { RefreshToken } from '../entities/refresh-token.entity'

export const USER_DELETE_QUEUE = 'user-delete'

export const userDeleteJobId = (userId: string): string => `user-delete-${userId}`

export const userDeleteJobSchema = z.object({
  userId: z.string().uuid(),
  email: z.string().email(),
  backupPrefix: z.string().min(1),
})

// Per-user media queues whose pending jobs must not retry-noise into 404s after the
// rows are gone. JobId prefixes are the dedup contract (`<prefix>-<assetId>-<size>`,
// `video-<assetId>`, ...); the sweep matches on job DATA userId, so every present and
// future prefix in these queues is covered without enumerating them.
const USER_JOB_QUEUES = [
  'process-thumbnail',
  'process-video',
  'process-metadata',
  'process-faces',
  'process-faces-cluster',
  'process-embeddings',
  'process-ocr',
  'process-detect',
] as const

export interface UserDeleteProgress {
  userId: string
  jobId: string
  state: AdminUserDeleteState
  backupPrefix: string
  updatedAt: string
}

export interface UserDeleteResult {
  userId: string
  backupPrefix: string
  deletedFiles: number
  deletedStrays: number
  alreadyGone: boolean
}

/**
 * Full per-user wipe. Core-side only (core owns the DB + storage; the worker-service
 * must never gain DB access).
 *
 * HARD RULE — backups excluded: per-user backups live in external S3
 * (`backups/<email>__<userId>/`, see UserBackupService/S3BackupService). This service
 * MUST NOT call S3BackupService listKeys/deleteKeys/deleteKey/copyPrefix, MUST NOT
 * enumerate or delete manifest.json or originals — the prefix stays intact and the
 * response reports it (`backupKept: true`) for transparency. This service therefore
 * takes no S3 dependency at all (only the pure `backupPrefix()` path helper).
 *
 * DB order: sessions invalidate (refresh_tokens + tokensValidAfter bump, killing
 * in-flight access tokens) → shares → faces/persons → album_assets/albums → assets
 * (CASCADE drops asset_thumbnails/embeddings/ocr/detections; shares.assetId FK
 * cascades foreign shares on the user's assets) → files (original+transcode+thumbnail
 * FileRecords — thumb fileId has no FK, so keys are collected explicitly) → user row.
 * Global tables (places/app_settings) are untouched.
 *
 * Storage: every collected storageKey is deleted (ENOENT ignored), then stray keys
 * under originals/<uid>/, derivatives/thumbnails/<uid>/, derivatives/transcodes/<uid>/
 * are swept. STORAGE_DIR/models/ is never touched.
 */
@Injectable()
export class UserDeleteService {
  private readonly logger = new Logger(UserDeleteService.name)
  // ponytail: in-memory progress only (same pattern as UserBackupService.backupProgress)
  // — a restart wipes it and the BullMQ job record remains the durable source; never
  // treat it as history (upgrade path: persist to a job row)
  private readonly progress = new Map<string, UserDeleteProgress>()

  constructor(
    private readonly dataSource: DataSource,
    private readonly bullMq: BullMqService,
    private readonly storage: LocalStorageService,
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(FileRecord) private readonly files: Repository<FileRecord>,
  ) {}

  markQueued(userId: string, jobId: string, prefix: string): void {
    this.progress.set(userId, {
      userId,
      jobId,
      state: 'queued',
      backupPrefix: prefix,
      updatedAt: new Date().toISOString(),
    })
  }

  markActive(userId: string, prefix: string, jobId: string): void {
    this.progress.set(userId, {
      userId,
      jobId,
      state: 'active',
      backupPrefix: prefix,
      updatedAt: new Date().toISOString(),
    })
  }

  markFinished(userId: string, state: 'completed' | 'failed'): void {
    const current = this.progress.get(userId)
    this.progress.set(userId, {
      userId,
      jobId: current?.jobId ?? userDeleteJobId(userId),
      state,
      backupPrefix: current?.backupPrefix ?? '',
      updatedAt: new Date().toISOString(),
    })
  }

  getProgress(userId: string): UserDeleteProgress | undefined {
    const current = this.progress.get(userId)
    return current ? { ...current } : undefined
  }

  computeBackupPrefix(email: string, userId: string): string {
    return backupPrefix(email, userId)
  }

  /**
   * Best-effort removal of pending (waiting/delayed/prioritized) jobs scoped to the
   * user. Active jobs cannot be removed — they fail closed core-side once the rows are
   * gone. Runs both on enqueue and inside the job (jobs enqueued in between are caught).
   */
  async drainUserJobs(userId: string): Promise<number> {
    let removed = 0
    for (const name of USER_JOB_QUEUES) {
      try {
        const queue = this.bullMq.getQueue(name)
        const jobs = await queue.getJobs(['waiting', 'delayed', 'prioritized'])
        for (const job of jobs) {
          const data = job.data as { userId?: unknown } | null | undefined
          if (data?.userId !== userId) continue
          try {
            await job.remove()
            removed++
          } catch {
            // raced with a worker pickup — the job fails closed on the missing rows
          }
        }
      } catch (err) {
        this.logger.warn(
          `User-delete drain failed for queue ${name}: ${err instanceof Error ? err.message : String(err)}`,
        )
      }
    }
    if (removed > 0) this.logger.log(`User-delete drained ${removed} pending job(s)`)
    return removed
  }

  async runUserDelete(userId: string, fallbackPrefix: string): Promise<UserDeleteResult> {
    const user = await this.users.findOne({ where: { id: userId } })
    if (!user) {
      // idempotent retry: a previous attempt already dropped the row
      this.markFinished(userId, 'completed')
      return {
        userId,
        backupPrefix: fallbackPrefix,
        deletedFiles: 0,
        deletedStrays: 0,
        alreadyGone: true,
      }
    }
    const prefix = this.computeBackupPrefix(user.email, user.id)

    const assetRows = await this.dataSource
      .getRepository(Asset)
      .find({ where: { userId }, select: ['id'] })
    const assetIds = assetRows.map((a) => a.id)
    // thumb bytes live in FileRecords under the same userId (registerFile is owner-scoped
    // and thumb fileId carries no FK), so the files sweep below collects them explicitly
    const fileRows = await this.files.find({ where: { userId }, select: ['storageKey'] })
    const storageKeys = fileRows.map((f) => f.storageKey)

    await this.dataSource.transaction(async (m) => {
      // C3: last-admin re-check inside the txn — the request-time count in AdminService is
      // only the fast path; two concurrent deletes both passing it must not wipe all admins.
      const fresh = await m.findOne(User, { where: { id: userId } })
      if (!fresh) return
      if (fresh.role === 'admin') {
        const adminCount = await m.count(User, { where: { role: 'admin' } })
        if (adminCount <= 1) throw new ConflictException('Cannot delete the last admin')
      }
      // sessions first: refresh rows die and the floor kills in-flight access tokens
      await m.delete(RefreshToken, { userId })
      await m.update(User, userId, { tokensValidAfter: new Date() })
      await m.delete(Share, { userId })
      await m.delete(Face, { userId })
      await m.delete(Person, { userId })
      const albumIds = (await m.find(Album, { where: { userId }, select: ['id'] })).map((a) => a.id)
      if (albumIds.length > 0) await m.delete(AlbumAsset, { albumId: In(albumIds) })
      // the user's assets may sit in foreign albums — clear those links too
      if (assetIds.length > 0) await m.delete(AlbumAsset, { assetId: In(assetIds) })
      await m.delete(Album, { userId })
      // incl. trashed (no isTrashed filter — reuse hardDelete semantics); CASCADE drops
      // asset_thumbnails/embeddings/ocr/detections, shares.assetId FK drops foreign shares
      if (assetIds.length > 0) await m.delete(Asset, { id: In(assetIds) })
      await m.delete(FileRecord, { userId })
      await m.delete(User, userId)
    })

    let deletedFiles = 0
    for (const key of storageKeys) {
      try {
        await this.storage.delete(key)
        deletedFiles++
      } catch (err) {
        this.logger.warn(
          `User-delete storage delete failed for ${key}: ${err instanceof Error ? err.message : String(err)}`,
        )
      }
    }
    const deletedStrays = await this.sweepUserPrefixes(userId)

    this.markFinished(userId, 'completed')
    this.logger.log(
      `Deleted user ${userId} (${assetIds.length} assets, ${deletedFiles} files, ${deletedStrays} strays; backup ${prefix} kept)`,
    )
    return { userId, backupPrefix: prefix, deletedFiles, deletedStrays, alreadyGone: false }
  }

  /**
   * Sweep stray bytes under the user's three storage prefixes (crashed uploads, rows
   * already gone). ENOENT (nothing ever written) is the normal case. models/ is never
   * listed — the prefixes are user-scoped literals by construction.
   */
  private async sweepUserPrefixes(userId: string): Promise<number> {
    const root = resolve(loadEnv().STORAGE_DIR)
    const prefixes = [
      `originals/${userId}/`,
      `derivatives/thumbnails/${userId}/`,
      `derivatives/transcodes/${userId}/`,
    ]
    let strays = 0
    for (const prefix of prefixes) {
      let dir: string
      try {
        dir = this.storage.pathFor(prefix)
      } catch {
        continue
      }
      let entries: Dirent<string>[]
      try {
        entries = await readdir(dir, { recursive: true, withFileTypes: true })
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') continue
        throw err
      }
      for (const entry of entries) {
        if (!entry.isFile()) continue
        const key = relative(root, join(entry.parentPath, entry.name))
        try {
          await this.storage.delete(key)
          strays++
        } catch (err) {
          this.logger.warn(
            `User-delete stray delete failed for ${key}: ${err instanceof Error ? err.message : String(err)}`,
          )
        }
      }
      await rm(dir, { recursive: true, force: true }).catch(() => undefined)
    }
    return strays
  }
}
