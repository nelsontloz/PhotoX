import { Logger } from '@nestjs/common';
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { loadEnv, type LocalStorageService } from '@photox/shared-config';
import { TRANSFER_QUEUES, type TransferClaim, type TransferKind } from '@photox/shared-types';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readFile, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { bindingOf, parseJobData, transferJobSchema } from './job-schemas';
import type { ProcessorDeps, ProcessorSpec } from './processor-spec';

// ponytail: single PUT at or below 100MB, lib-storage MPU above — same split as core's
// S3BackupService.putFile (videos can reach the 4GiB upload cap).
const MULTIPART_THRESHOLD_BYTES = 100 * 1024 * 1024;
// a hung socket must not pin a worker forever; an hour clears the 4GiB cap on any real disk
const TRANSFER_IO_TIMEOUT_MS = 60 * 60_000;
// core's finish DTO rejects an over-long error field
const ERROR_MAX_LENGTH = 512;
// backups only read local files; restores also write, so they get less parallelism
const TRANSFER_CONCURRENCY: Record<TransferKind, number> = { backup: 4, restore: 2 };

/** The two byte moves a transfer item needs; kept as an interface so specs can fake S3. */
export interface TransferStore {
  putFile(key: string, localPath: string, contentType?: string): Promise<void>;
  downloadToFile(key: string, destPath: string): Promise<void>;
}

// ponytail: these two methods are copied from core's S3BackupService because core cannot hand
// out an S3 handle; a third consumer promotes them to a shared package.
export class TransferS3Store implements TransferStore {
  private cached?: S3Client;

  private get client(): S3Client {
    if (!this.cached) {
      const env = loadEnv();
      this.cached = new S3Client({
        region: env.AWS_REGION,
        endpoint: env.S3_ENDPOINT,
        forcePathStyle: true,
        credentials: {
          accessKeyId: env.AWS_ACCESS_KEY_ID,
          secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
        },
        maxAttempts: 4,
      });
    }
    return this.cached;
  }

  async putFile(
    key: string,
    localPath: string,
    contentType = 'application/octet-stream',
  ): Promise<void> {
    const bucket = loadEnv().S3_BACKUP_BUCKET;
    const size = (await stat(localPath)).size;
    if (size <= MULTIPART_THRESHOLD_BYTES) {
      await this.client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: await readFile(localPath),
          ContentType: contentType,
        }),
        { abortSignal: AbortSignal.timeout(TRANSFER_IO_TIMEOUT_MS) },
      );
      return;
    }
    // the caller restarts a failed MPU from scratch (a Floci restart wipes the parts), so no
    // in-method retry: core's `retry` answer owns that
    await new Upload({
      client: this.client,
      params: {
        Bucket: bucket,
        Key: key,
        Body: createReadStream(localPath),
        ContentType: contentType,
      },
    }).done();
  }

  async downloadToFile(key: string, destPath: string): Promise<void> {
    const res = await this.client.send(
      new GetObjectCommand({ Bucket: loadEnv().S3_BACKUP_BUCKET, Key: key }),
      { abortSignal: AbortSignal.timeout(TRANSFER_IO_TIMEOUT_MS) },
    );
    const body = res.Body;
    if (!body) throw new Error(`S3 GetObject ${key} returned no body`);
    await pipeline(Readable.fromWeb(body.transformToWebStream()), createWriteStream(destPath));
  }
}

let store: TransferS3Store | undefined;

export function getTransferStore(): TransferS3Store {
  store ??= new TransferS3Store();
  return store;
}

async function sha256File(path: string): Promise<string> {
  const hash = createHash('sha256');
  await pipeline(createReadStream(path), hash);
  return hash.digest('hex');
}

/** One item's bytes. Pure I/O: core's claim/finish calls own the ledger and the retries. */
export async function runTransferItem(
  claim: TransferClaim,
  deps: { storage: LocalStorageService; store: TransferStore },
): Promise<void> {
  if (claim.kind === 'backup') {
    await deps.store.putFile(
      claim.s3Key,
      deps.storage.pathFor(claim.storageKey),
      claim.mimeType ?? undefined,
    );
    return;
  }
  // same temp-dir contract as the old core executor: the ledger owns backup-runs/<runId>
  const dir = deps.storage.pathFor(join('backup-runs', claim.runId, 'tmp'));
  await mkdir(dir, { recursive: true });
  const tmp = join(dir, `${claim.fileId}.${randomUUID()}.part`);
  try {
    await deps.store.downloadToFile(claim.s3Key, tmp);
    if (claim.checksumSha256) {
      const actual = await sha256File(tmp);
      if (actual !== claim.checksumSha256) {
        throw new Error(`checksum mismatch for ${claim.fileId}`);
      }
    }
    // atomic save consumes the temp file; a failure leaves the item retryable
    await deps.storage.save(claim.storageKey, tmp);
  } finally {
    // a cleanup failure must not mask the transfer error it would replace
    await rm(tmp, { force: true }).catch(() => undefined);
  }
}

/**
 * Consumer factory for one transfer queue. Core decides the ledger transition: the finish
 * answer's `retry` is what throws, so BullMQ's backoff stays the only retry loop.
 */
export function createTransferProcessor(
  kind: TransferKind,
  // injectable so the spec never constructs a real S3 client
  storeFactory: () => TransferStore = getTransferStore,
): (deps: ProcessorDeps) => ProcessorSpec {
  const queue = TRANSFER_QUEUES[kind];
  const logger = new Logger(`TransferProcessor:${kind}`);

  return ({ core, storage }) => ({
    queue,
    workerOptions: { concurrency: TRANSFER_CONCURRENCY[kind] },
    run: async (job) => {
      const data = parseJobData(transferJobSchema, job.data, queue);
      const binding = bindingOf(data);
      const attempt = job.attemptsMade + 1;
      const claim = await core.claimTransfer(
        kind,
        data.userId,
        data.runId,
        data.itemId,
        attempt,
        binding,
      );
      // terminal run/item or an item another job already settled: nothing to move
      if (!claim) return;

      try {
        await runTransferItem(claim, { storage, store: storeFactory() });
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        const errorCode = (err as NodeJS.ErrnoException).code ?? (err as { name?: string }).name;
        const res = await core.finishTransfer(
          kind,
          data.userId,
          data.runId,
          data.itemId,
          {
            attempt,
            ok: false,
            errorMessage: errorMessage.slice(0, ERROR_MAX_LENGTH),
            errorCode,
          },
          binding,
        );
        // core already settled it (permanent failure / paused run) — retrying cannot help
        if (!res.retry) {
          logger.warn(
            `Transfer ${kind} item ${data.itemId} failed for run ${data.runId}: ${errorMessage}`,
          );
          return;
        }
        throw err;
      }

      await core.finishTransfer(
        kind,
        data.userId,
        data.runId,
        data.itemId,
        {
          attempt,
          ok: true,
        },
        binding,
      );
    },
  });
}
