import { Injectable, Logger, OnModuleInit } from '@nestjs/common'
import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
  type GetObjectCommandOutput,
} from '@aws-sdk/client-s3'
import { Upload } from '@aws-sdk/lib-storage'
import { createReadStream, createWriteStream } from 'fs'
import { readFile, stat } from 'fs/promises'
import { loadEnv } from '@photox/shared-config'
import { Readable } from 'stream'
import { pipeline } from 'stream/promises'

// ponytail: 100MB single-PUT ceiling — manifests/thumbs go single-PUT, originals
// (videos up to the 4GiB upload cap) stream via lib-storage MPU. Floci single-op
// caps at 5GiB with disk-backed modes; memory mode caps ~2GiB heap.
const MULTIPART_THRESHOLD_BYTES = 100 * 1024 * 1024
// ponytail: bounded operation budget — the SDK client runs single-attempt
// (maxAttempts: 1) so this 1/2/4s ladder owns the whole retry budget
const RETRY_DELAYS_MS = [1000, 2000, 4000]
const DEFAULT_BUCKET = 'photox-dev-backups'

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

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
export class S3BackupService implements OnModuleInit {
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
      maxAttempts: 1,
    })
  }

  async onModuleInit(): Promise<void> {
    // ponytail: boot probe must not take core down when Floci is absent — warn
    // and let backup/restore calls re-ensure the bucket instead
    try {
      await this.ensureBucket()
    } catch (err) {
      this.logger.warn(
        `S3 backup bucket ensure failed at boot (retried on use): ${err instanceof Error ? err.message : String(err)}`,
      )
    }
  }

  getBucket(): string {
    return this.bucket
  }

  /** HeadBucket probe, creating the bucket when absent (race-tolerant). */
  async ensureBucket(): Promise<void> {
    try {
      await this.withRetry(
        () =>
          this.client.send(new HeadBucketCommand({ Bucket: this.bucket }), {
            abortSignal: AbortSignal.timeout(10_000),
          }),
        'HeadBucket',
      )
      return
    } catch (err) {
      if (!isNotFound(err)) throw err
    }
    try {
      await this.withRetry(
        () =>
          this.client.send(new CreateBucketCommand({ Bucket: this.bucket }), {
            abortSignal: AbortSignal.timeout(10_000),
          }),
        'CreateBucket',
      )
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
    await this.withRetry(
      () =>
        this.client.send(
          new PutObjectCommand({
            Bucket: this.bucket,
            Key: key,
            Body: body,
            ContentType: contentType,
          }),
          { abortSignal: AbortSignal.timeout(30_000) },
        ),
      `PutObject ${key}`,
    )
  }

  /**
   * Uploads a local file: single PUT at or under 100MB, lib-storage MPU above.
   * The whole call is retried (MPU restarts from scratch — Floci wipes in-progress
   * MPUs on restart/reset, and lib-storage aborts parts on failure by default).
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
    await this.withRetry(async () => {
      const upload = new Upload({
        client: this.client,
        params: {
          Bucket: this.bucket,
          Key: key,
          Body: createReadStream(localPath),
          ContentType: contentType,
        },
      })
      await upload.done()
    }, `MultipartUpload ${key}`)
  }

  /** Small-object fetch (manifests) — whole body buffered. */
  async getBuffer(key: string): Promise<Buffer> {
    const res = await this.withRetry(
      () =>
        this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }), {
          abortSignal: AbortSignal.timeout(30_000),
        }),
      `GetObject ${key}`,
    )
    const body = res.Body
    if (!body) throw new Error(`S3 GetObject ${key} returned no body`)
    return Buffer.from(await body.transformToByteArray())
  }

  /** Streams an object straight to disk (originals can be gigabytes — never buffer). */
  async downloadToFile(key: string, destPath: string): Promise<void> {
    await this.withRetry(async () => {
      const res: GetObjectCommandOutput = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      )
      const body = res.Body
      if (!body) throw new Error(`S3 GetObject ${key} returned no body`)
      // ponytail: node handler yields a Readable; stream it — no whole-file buffering
      await pipeline(Readable.fromWeb(body.transformToWebStream()), createWriteStream(destPath))
    }, `Download ${key}`)
  }

  /** All keys under a prefix (paginated). */
  async listKeys(prefix: string): Promise<string[]> {
    const keys: string[] = []
    let token: string | undefined
    for (;;) {
      const res = await this.withRetry(
        () =>
          this.client.send(
            new ListObjectsV2Command({
              Bucket: this.bucket,
              Prefix: prefix,
              ContinuationToken: token,
            }),
            { abortSignal: AbortSignal.timeout(30_000) },
          ),
        `ListObjects ${prefix}`,
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

  /** Deletes a single key (S3 deletes are idempotent — missing keys succeed). */
  async deleteKey(key: string): Promise<void> {
    await this.withRetry(
      () =>
        this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }), {
          abortSignal: AbortSignal.timeout(30_000),
        }),
      `DeleteObject ${key}`,
    )
  }

  /** Sequential prune of stale keys; logs the count. */
  async deleteKeys(keys: string[]): Promise<void> {
    for (const key of keys) await this.deleteKey(key)
    if (keys.length > 0) this.logger.log(`Deleted ${keys.length} stale backup key(s)`)
  }

  private async withRetry<T>(op: () => Promise<T>, label: string): Promise<T> {
    let last: unknown
    for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
      try {
        return await op()
      } catch (err) {
        last = err
        // missing keys/buckets are final — no point burning the ladder
        if (isNotFound(err)) throw err
        if (attempt === RETRY_DELAYS_MS.length) break
        this.logger.warn(`${label} attempt ${attempt + 1} failed (${errorName(err)}), retrying`)
        await sleep(RETRY_DELAYS_MS[attempt]!)
      }
    }
    throw last
  }
}
