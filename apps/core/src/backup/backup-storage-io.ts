import { ServiceUnavailableException } from '@nestjs/common';
import { createHash, randomUUID } from 'crypto';
import { createReadStream } from 'fs';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { pipeline } from 'stream/promises';
import type { LocalStorageService } from '@photox/shared-config';
import { userBackupManifestSchema, type ManifestReadResult } from './backup.types';
import { isNotFound, type S3BackupService } from './s3-backup.service';

export async function sha256File(path: string): Promise<string> {
  const hash = createHash('sha256');
  await pipeline(createReadStream(path), hash);
  return hash.digest('hex');
}

export class BackupStorageIo {
  constructor(
    private readonly s3: S3BackupService,
    private readonly storage: LocalStorageService,
  ) {}

  /** Maps an S3 ensureBucket failure to the documented 503. */
  async ensureStorage(): Promise<void> {
    try {
      await this.s3.ensureBucket();
    } catch {
      throw new ServiceUnavailableException('Backup storage (S3) unreachable');
    }
  }

  /**
   * Fetches + schema-validates one backup manifest. Never throws: a missing
   * object, unreadable bytes or corrupt JSON/schema each come back tagged (with
   * the raw cause for callers that log the error name), so every caller keeps
   * its own mapping (null, 404/503, 422).
   */
  async readManifest(key: string): Promise<ManifestReadResult> {
    let raw: Buffer;
    try {
      raw = await this.s3.getBuffer(key);
    } catch (err) {
      return { error: isNotFound(err) ? 'missing' : 'unreadable', cause: err };
    }
    try {
      return { manifest: userBackupManifestSchema.parse(JSON.parse(raw.toString('utf-8'))) };
    } catch (err) {
      return { error: 'corrupt', cause: err };
    }
  }

  /**
   * Streams S3 objects into local storage through a scratch dir (originals can
   * be gigabytes — never buffered). `skipExisting` leaves already-present keys
   * alone (retry-friendly merge); restore always writes because rows are fresh.
   */
  async downloadToStorage(
    items: { id: string; storageKey: string; sourceKey: string }[],
    tmpPrefix: string,
    skipExisting = false,
  ): Promise<void> {
    const tmpRoot = await mkdtemp(join(tmpdir(), tmpPrefix));
    try {
      for (const item of items) {
        if (skipExisting && (await this.storage.exists(item.storageKey))) continue;
        const tmp = join(tmpRoot, `${item.id}.${randomUUID()}.tmp`);
        await this.s3.downloadToFile(item.sourceKey, tmp);
        await this.storage.save(item.storageKey, tmp);
      }
    } finally {
      await rm(tmpRoot, { recursive: true, force: true });
    }
  }
}
