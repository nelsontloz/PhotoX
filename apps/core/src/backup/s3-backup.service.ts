import { Injectable, Logger } from '@nestjs/common'
import {
  CopyObjectCommand,
  CreateBucketCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
  type GetObjectCommandOutput,
} from '@aws-sdk/client-s3'
import { Upload } from '@aws-sdk/lib-storage'
import { randomUUID } from 'node:crypto'
import { createReadStream, createWriteStream } from 'fs'
import { readFile, rename, rm, stat } from 'fs/promises'
import { loadEnv } from '@photox/shared-config'
import { Readable } from 'stream'
import { pipeline } from 'stream/promises'

// ponytail: 100MB single-PUT ceiling — manifests/thumbs go single-PUT, originals
// (videos up to the 4GiB upload cap) stream via lib-storage MPU. Floci single-op
// caps at 5GiB with disk-backed modes; memory mode caps ~2GiB heap.
const MULTIPART_THRESHOLD_BYTES = 100 * 1024 * 1024
// DeleteObjects caps a single request at 1000 keys
const DELETE_BATCH_SIZE = 1000
const DEFAULT_BUCKET = 'photox-dev-backups'

/** S3 missing-key/bucket probe shared with UserBackupService.backupStatus (A4). */
export function isNotFound(err: unknown): boolean {
  const name = (err as { name?: string }).name
  return name === 'NotFound' || name === 'NoSuchKey' || name === 'NoSuchBucket'
}

function errorName(err: unknown): string {
  return (err as { name?: string }).name ?? 'Unknown'
}

/**
 * Thin S3 operator for per-user backups against Floci (docker-only dev S3).
 * Single endpoint (S3_ENDPOINT, server-side ops) + path-style addressing.
 */
@Injectable()
export class S3BackupService {
  private readonly logger = new Logger(S3BackupService.name)
  private readonly client: S3Client
  private readonly bucket: string

  constructor() {
    const env = loadEnv()
    const endpoint = env.S3_ENDPOINT
    // ponytail: fail closed on an unconfigured production — all-default S3 env in
    // prod means nobody wired backups; crash loudly instead of silently pointing
    // at localhost. An explicitly set S3_ENDPOINT (e.g. the e2e stack's
    // http://floci:4566, which also runs NODE_ENV=production with placeholder
    // creds) opts out of the crash and gets a loud warning instead — Floci
    // accepts any creds with auth verification off, and bucket-per-env stays the
    // operator's job.
    const allDefaults =
      env.S3_BACKUP_BUCKET === DEFAULT_BUCKET &&
      env.AWS_ACCESS_KEY_ID === 'test' &&
      env.AWS_SECRET_ACCESS_KEY === 'test' &&
      process.env.S3_ENDPOINT === undefined
    if (process.env.NODE_ENV === 'production' && allDefaults) {
      throw new Error(
        'S3 backup is unconfigured for production: S3_BACKUP_BUCKET/AWS_* still hold ' +
          'dev defaults with no explicit S3_ENDPOINT — refusing to start',
      )
    }
    if (
      env.S3_BACKUP_BUCKET === DEFAULT_BUCKET ||
      env.AWS_ACCESS_KEY_ID === 'test' ||
      env.AWS_SECRET_ACCESS_KEY === 'test'
    ) {
      this.logger.warn(
        'S3 backup uses dev placeholder bucket/credentials — dev/Floci only, never production',
      )
    }
    this.bucket = env.S3_BACKUP_BUCKET
    this.client = new S3Client({
      region: env.AWS_REGION,
      endpoint,
      forcePathStyle: true,
      credentials: {
        accessKeyId: env.AWS_ACCESS_KEY_ID,
        secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
      },
      // SDK-owned retry budget for transient failures; missing keys/buckets are final (the
      // standard retry mode does not retry 404s)
      maxAttempts: 4,
    })
  }

  /** HeadBucket probe, creating the bucket when absent (race-tolerant). */
  async ensureBucket(): Promise<void> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }), {
        abortSignal: AbortSignal.timeout(10_000),
      })
      return
    } catch (err) {
      if (!isNotFound(err)) throw err
    }
    try {
      await this.client.send(new CreateBucketCommand({ Bucket: this.bucket }), {
        abortSignal: AbortSignal.timeout(10_000),
      })
    } catch (err) {
      // another replica (or an overlapping probe) created it first
      if (errorName(err) !== 'BucketAlreadyOwnedByYou' && errorName(err) !== 'BucketAlreadyExists')
        throw err
    }
  }

  async putObject(
    key: string,
    body: Buffer,
    contentType = 'application/octet-stream',
  ): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
      }),
      { abortSignal: AbortSignal.timeout(30_000) },
    )
  }

  /**
   * Uploads a local file: single PUT at or under 100MB, lib-storage MPU above.
   * The SDK retries individual parts, but a Floci restart wipes the in-progress MPU —
   * the retried part then fails for good, so restart the whole upload once from scratch.
   */
  async putFile(
    key: string,
    localPath: string,
    contentType = 'application/octet-stream',
  ): Promise<void> {
    const size = (await stat(localPath)).size
    if (size <= MULTIPART_THRESHOLD_BYTES) {
      await this.putObject(key, await readFile(localPath), contentType)
      return
    }
    const upload = async (): Promise<void> => {
      await new Upload({
        client: this.client,
        params: {
          Bucket: this.bucket,
          Key: key,
          Body: createReadStream(localPath),
          ContentType: contentType,
        },
      }).done()
    }
    try {
      await upload()
    } catch {
      await upload()
    }
  }

  /** Small-object fetch (manifests) — whole body buffered. */
  async getBuffer(key: string): Promise<Buffer> {
    const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }), {
      abortSignal: AbortSignal.timeout(30_000),
    })
    const body = res.Body
    if (!body) throw new Error(`S3 GetObject ${key} returned no body`)
    return Buffer.from(await body.transformToByteArray())
  }

  /** Existence probe for an unreadable object. */
  async headObject(key: string): Promise<void> {
    await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }), {
      abortSignal: AbortSignal.timeout(30_000),
    })
  }

  /** Streams an object straight to disk (originals can be gigabytes — never buffer). */
  async downloadToFile(key: string, destPath: string): Promise<void> {
    const download = async (): Promise<void> => {
      const res: GetObjectCommandOutput = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      )
      const body = res.Body
      if (!body) throw new Error(`S3 GetObject ${key} returned no body`)
      // ponytail: node handler yields a Readable; stream it — no whole-file buffering
      const tmp = `${destPath}.${randomUUID()}.part`
      try {
        await pipeline(Readable.fromWeb(body.transformToWebStream()), createWriteStream(tmp))
        await rename(tmp, destPath)
      } catch (err) {
        // a failed attempt must leave neither a partial destination nor a temp file behind
        await rm(tmp, { force: true }).catch(() => undefined)
        throw err
      }
    }
    try {
      await download()
    } catch (err) {
      // the SDK retries requests, not a dropped response body — restart the whole GET once
      if (isNotFound(err)) throw err
      await download()
    }
  }

  /** All keys under a prefix (paginated). */
  async listKeys(prefix: string): Promise<string[]> {
    const keys: string[] = []
    let token: string | undefined
    for (;;) {
      const res = await this.client.send(
        new ListObjectsV2Command({
          Bucket: this.bucket,
          Prefix: prefix,
          ContinuationToken: token,
        }),
        { abortSignal: AbortSignal.timeout(30_000) },
      )
      for (const obj of res.Contents ?? []) {
        if (obj.Key) keys.push(obj.Key)
      }
      if (!res.IsTruncated) break
      token = res.NextContinuationToken
      if (!token) break
    }
    return keys
  }

  /** Batched prune of stale keys (≤1000 per DeleteObjects call); logs the count. */
  async deleteKeys(keys: string[]): Promise<void> {
    for (let i = 0; i < keys.length; i += DELETE_BATCH_SIZE) {
      const res = await this.client.send(
        new DeleteObjectsCommand({
          Bucket: this.bucket,
          Delete: { Objects: keys.slice(i, i + DELETE_BATCH_SIZE).map((Key) => ({ Key })) },
        }),
        { abortSignal: AbortSignal.timeout(30_000) },
      )
      // a per-key failure comes back as a 200 with an Errors list, not a thrown error
      if (res.Errors && res.Errors.length > 0) {
        throw new Error(`S3 DeleteObjects failed for key ${res.Errors[0]?.Key ?? 'unknown'}`)
      }
    }
    if (keys.length > 0) this.logger.log(`Deleted ${keys.length} stale backup key(s)`)
  }

  /**
   * Server-side copy of one key (lazy email-change rename). CopySource is the
   * bucket + per-segment-encoded key; MetadataDirective COPY preserves metadata.
   */
  async copyKey(srcKey: string, dstKey: string): Promise<void> {
    const encoded = srcKey
      .split('/')
      .map((segment) => encodeURIComponent(segment))
      .join('/')
    await this.client.send(
      new CopyObjectCommand({
        Bucket: this.bucket,
        Key: dstKey,
        CopySource: `${this.bucket}/${encoded}`,
        MetadataDirective: 'COPY',
      }),
      { abortSignal: AbortSignal.timeout(30_000) },
    )
  }

  /**
   * Server-side copy of every key under srcPrefix into dstPrefix (suffix-mapped),
   * skipping manifests (rewritten fresh by backupUser). Sequential to stay inside
   * the Floci single-op budget; logs the copy/skip counts per prefix.
   */
  async copyPrefix(srcPrefix: string, dstPrefix: string): Promise<void> {
    const keys = await this.listKeys(srcPrefix)
    let copied = 0
    let skipped = 0
    for (const key of keys) {
      if (key.endsWith('/manifest.json')) {
        skipped += 1
        continue
      }
      await this.copyKey(key, `${dstPrefix}${key.slice(srcPrefix.length)}`)
      copied += 1
    }
    if (copied > 0 || skipped > 0) {
      this.logger.log(
        `Copied prefix ${srcPrefix} -> ${dstPrefix} (${copied} copied, ${skipped} skipped)`,
      )
    }
  }
}
