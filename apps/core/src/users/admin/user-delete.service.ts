import { ConflictException, Injectable, Logger } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { backupPrefix, loadEnv, LocalStorageService } from '@photox/shared-config'
import { USER_DELETE_QUEUE, userDeleteJobId, type AdminUserDeleteState } from '@photox/shared-types'
import { readdir, rm } from 'fs/promises'
import type { Dirent } from 'fs'
import { join, relative, resolve } from 'path'
import { DataSource, In, Repository } from 'typeorm'
import { Album } from '../../albums/entities/album.entity'
import { AlbumAsset } from '../../albums/entities/album-asset.entity'
import { Asset, Face, FileRecord, Person } from '../../database/entities'
import { Share } from '../../shares/entities/share.entity'
import { BackupMerge } from '../../backup/entities/backup-merge.entity'
import { BullMqService } from '../../queue/bullmq.service'
import { User } from '../entities/user.entity'
import { RefreshToken } from '../entities/refresh-token.entity'

export interface UserDeleteProgress {
  jobId: string
  state: AdminUserDeleteState
  backupPrefix: string
}

export interface UserDeleteResult {
  userId: string
  backupPrefix: string
  deletedFiles: number
  deletedStrays: number
}

/**
 * Full per-user wipe. Executed in core (core owns the DB + storage; the worker-service
 * must never gain DB access) but driven by the worker's `user-delete` consumer through
 * `POST /worker/users/:id/purge` — core no longer consumes any queue itself.
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

  // one setter for every lifecycle write; jobId/prefix default to the recorded run (a
  // finished step has no ids of its own) or to the deterministic job id / unknown prefix
  setProgress(userId: string, state: AdminUserDeleteState, jobId?: string, prefix?: string): void {
    const current = this.progress.get(userId)
    this.progress.set(userId, {
      jobId: jobId ?? current?.jobId ?? userDeleteJobId(userId),
      state,
      backupPrefix: prefix ?? current?.backupPrefix ?? '',
    })
  }

  getProgress(userId: string): UserDeleteProgress | undefined {
    const current = this.progress.get(userId)
    return current ? { ...current } : undefined
  }

  /**
   * Drop a retained terminal (completed/failed) delete job for the user. BullMQ dedups
   * by jobId, so such a job would silently swallow the next enqueue for the same id
   * (restores re-create the account with its original userId), leaving the UI polling a
   * stale `completed` while the row never dies. In-flight jobs are left alone.
   */
  async clearFinishedJob(userId: string): Promise<boolean> {
    const jobId = userDeleteJobId(userId)
    try {
      const job = await this.bullMq.getQueue(USER_DELETE_QUEUE).getJob(jobId)
      if (!job) return false
      const state = await job.getState()
      if (state !== 'completed' && state !== 'failed') return false
      await job.remove()
      return true
    } catch (err) {
      this.logger.warn(
        `User-delete stale job clear failed for ${userId}: ${err instanceof Error ? err.message : String(err)}`,
      )
      return false
    }
  }

  /**
   * Worker-triggered wipe for `POST /worker/users/:id/purge`. Progress is recorded here
   * because core runs the work, so the admin status poll (and its completed-after-the-row-is-
   * gone case) is unchanged. Idempotent: a retried job finds no user row and returns cleanly.
   */
  async purge(userId: string, fallbackPrefix: string, jobId?: string): Promise<UserDeleteResult> {
    this.setProgress(userId, 'active', jobId, fallbackPrefix)
    try {
      return await this.runUserDelete(userId, fallbackPrefix)
    } catch (err) {
      this.setProgress(userId, 'failed')
      throw err
    }
  }

  async runUserDelete(userId: string, fallbackPrefix: string): Promise<UserDeleteResult> {
    const user = await this.users.findOne({ where: { id: userId } })
    if (!user) {
      // idempotent retry: a previous attempt already dropped the row. The row sweep still
      // runs — a crash between the txn commit and the byte deletions must not orphan files
      // with no later retry able to reach them.
      const deletedStrays = await this.sweepUserPrefixes(userId)
      this.setProgress(userId, 'completed')
      return {
        userId,
        backupPrefix: fallbackPrefix,
        deletedFiles: 0,
        deletedStrays,
      }
    }
    const prefix = backupPrefix(user.email, user.id)

    const assetRows = await this.dataSource
      .getRepository(Asset)
      .find({ where: { userId }, select: { id: true } })
    const assetIds = assetRows.map((a) => a.id)
    // thumb bytes live in FileRecords under the same userId (registerFile is owner-scoped
    // and thumb fileId carries no FK), so the files sweep below collects them explicitly
    const fileRows = await this.files.find({ where: { userId }, select: { storageKey: true } })
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
      // merge ledger rows are metadata about the deleted target account; the S3
      // legacy backup itself stays in place (backups are never deleted here)
      await m.delete(BackupMerge, { targetUserId: userId })
      await m.delete(Face, { userId })
      await m.delete(Person, { userId })
      const albumIds = (await m.find(Album, { where: { userId }, select: { id: true } })).map(
        (a) => a.id,
      )
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

    this.setProgress(userId, 'completed')
    this.logger.log(
      `Deleted user ${userId} (${assetIds.length} assets, ${deletedFiles} files, ${deletedStrays} strays; backup ${prefix} kept)`,
    )
    return { userId, backupPrefix: prefix, deletedFiles, deletedStrays }
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
