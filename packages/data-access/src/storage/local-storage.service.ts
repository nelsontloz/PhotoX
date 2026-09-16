import { Injectable } from '@nestjs/common'
import { createReadStream } from 'fs'
import { Readable } from 'stream'
import { copyFile, mkdir, rename, stat, unlink } from 'fs/promises'
import { dirname, join } from 'path'
import { randomUUID } from 'crypto'
import { loadEnv } from '@photox/shared-config'

@Injectable()
export class LocalStorageService {
  pathFor(storageKey: string): string {
    return join(loadEnv().STORAGE_DIR, storageKey)
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

  async delete(key: string): Promise<void> {
    try {
      await unlink(this.pathFor(key))
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
    }
  }
}
