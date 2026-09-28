import { Injectable } from '@nestjs/common'
import { createReadStream } from 'fs'
import { Readable } from 'stream'
import { copyFile, mkdir, rename, stat, unlink } from 'fs/promises'
import { dirname, resolve, sep } from 'path'
import { randomUUID } from 'crypto'
import { loadEnv } from './env'

@Injectable()
export class LocalStorageService {
  buildKey(
    kind: 'original' | 'thumbnail' | 'transcode',
    userId: string,
    fileId: string,
    ext: string,
  ): string {
    const cleanExt = ext.replace(/^\.+/, '')
    if (kind === 'original') return `originals/${userId}/${fileId}.${cleanExt}`
    if (kind === 'thumbnail') return `derivatives/thumbnails/${userId}/${fileId}.${cleanExt}`
    return `derivatives/transcodes/${userId}/${fileId}.${cleanExt}`
  }

  pathFor(storageKey: string): string {
    const root = resolve(loadEnv().STORAGE_DIR)
    const full = resolve(root, storageKey)
    // ponytail: single containment choke point; all fs methods route through here
    if (!full.startsWith(root + sep)) throw new Error(`Invalid storage key: ${storageKey}`)
    return full
  }

  async ensureDir(): Promise<void> {
    await mkdir(loadEnv().STORAGE_DIR, { recursive: true })
  }

  async save(key: string, tmpPath: string): Promise<void> {
    const dest = this.pathFor(key)
    await mkdir(dirname(dest), { recursive: true })
    const tmp = `${dest}.${randomUUID()}.tmp`
    try {
      await rename(tmpPath, tmp)
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EXDEV') throw err
      await copyFile(tmpPath, tmp)
      await unlink(tmpPath).catch(() => undefined)
    }
    await rename(tmp, dest)
  }

  createReadStream(key: string, range?: { start?: number; end?: number }): Readable {
    return createReadStream(this.pathFor(key), range)
  }

  async stat(key: string) {
    return stat(this.pathFor(key))
  }

  async exists(key: string): Promise<boolean> {
    try {
      await stat(this.pathFor(key))
      return true
    } catch {
      return false
    }
  }

  async delete(key: string): Promise<void> {
    try {
      await unlink(this.pathFor(key))
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
    }
  }
}
