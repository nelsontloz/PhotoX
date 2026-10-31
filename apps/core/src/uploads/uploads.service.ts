import {
  BadRequestException,
  ConflictException,
  GoneException,
  Injectable,
  Logger,
  NotFoundException,
  PayloadTooLargeException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  DataSource,
  In,
  LessThanOrEqual,
  type FindOptionsWhere,
  type QueryRunner,
  type Repository,
} from 'typeorm';
import { isUUID } from 'class-validator';
import { createHash, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { finished } from 'node:stream/promises';
import { LocalStorageService, loadEnv } from '@photox/shared-config';
import type {
  Asset as AssetResponse,
  UploadCompleteResponse,
  UploadSessionCreated,
  UploadSessionErrorBody,
  UploadSessionErrorCode,
  UploadSessionStatus,
  UploadSessionStatusResponse,
} from '@photox/shared-types';
import { Asset, UploadSession, UploadSessionPart } from '../database/entities';
import { AssetsService, isPostgresUniqueViolation } from '../assets/assets.service';
// value import: Nest resolves the constructor parameter type at runtime
import { kindFromMime, sniffMime, UserFilesService } from '../files/user/user-files.service';
import type { CreateUploadSessionBodyDto } from './dto/create-upload-session.body.dto';

// Resumable chunked upload sessions (`api/v1/uploads`): create with the total size, PUT 8 MiB
// parts in any order, then `complete` assembles them into one temp file, dedups by checksum and
// hands off to the shared persistOriginal/createAsset/enqueue path. Nothing about the client's
// bytes is trusted: storage keys are built from ids only (originalName is a display hint), the
// MIME type is sniffed from the assembled head and the checksum is recomputed.
export const UPLOAD_CHUNK_SIZE_BYTES = 8 * 1024 * 1024;
export const UPLOAD_MAX_SIZE_BYTES = 4 * 1024 * 1024 * 1024;
export const UPLOAD_MAX_ACTIVE_SESSIONS = 5;
export const UPLOAD_PENDING_TTL_MS = 24 * 60 * 60 * 1000;
export const UPLOAD_ASSEMBLED_TTL_MS = 6 * 60 * 60 * 1000;

// STORAGE_DIR/upload-sessions/<userId>/<sessionId>/part-<index>; the transient assembled-* file
// lives in the same directory so persistOriginal's rename stays on one filesystem.
const UPLOAD_SESSIONS_KEY = 'upload-sessions';

// statuses that still hold a slot in the per-user active-session cap
const ACTIVE_STATUSES: UploadSessionStatus[] = ['pending', 'assembling', 'assembled'];

// P0-B envelope style: machine-readable `code` (plus extras such as receivedParts) next to
// statusCode/message on the exception body the HttpExceptionFilter serializes verbatim
export function uploadErrorBody(
  statusCode: number,
  message: string,
  code: UploadSessionErrorCode,
  extra?: Record<string, unknown>,
): UploadSessionErrorBody {
  return { statusCode, message, code, ...extra };
}

function sessionExpiredError(): GoneException {
  return new GoneException(uploadErrorBody(410, 'Upload session expired', 'SESSION_EXPIRED'));
}

function unsupportedTypeError(): BadRequestException {
  return new BadRequestException(uploadErrorBody(400, 'Unsupported file type', 'UNSUPPORTED_TYPE'));
}

function partConflictError(message: string): ConflictException {
  return new ConflictException(uploadErrorBody(409, message, 'PART_CONFLICT'));
}

// what a locked complete() decided to do once the session row was inspected
type CompletePlan =
  | { kind: 'replay'; asset: AssetResponse; deduplicated: boolean }
  | {
      kind: 'fresh';
      fileId: string;
      assetId: string;
      assetKind: 'photo' | 'video';
      asset: AssetResponse;
      deduplicated: boolean;
    };

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

@Injectable()
export class UploadsService {
  private readonly logger = new Logger(UploadsService.name);

  constructor(
    @InjectRepository(UploadSession)
    private readonly sessionRepo: Repository<UploadSession>,
    @InjectRepository(UploadSessionPart)
    private readonly partRepo: Repository<UploadSessionPart>,
    @InjectRepository(Asset)
    private readonly assetRepo: Repository<Asset>,
    private readonly dataSource: DataSource,
    private readonly storage: LocalStorageService,
    private readonly userFiles: UserFilesService,
    private readonly assets: AssetsService,
  ) {}

  // POST /api/v1/uploads
  async create(userId: string, body: CreateUploadSessionBodyDto): Promise<UploadSessionCreated> {
    if (
      !Number.isSafeInteger(body.sizeBytes) ||
      body.sizeBytes < 1 ||
      body.sizeBytes > UPLOAD_MAX_SIZE_BYTES
    ) {
      this.logger.warn(
        `[UploadsService] upload rejected user=${userId} size=${body.sizeBytes} (SIZE_LIMIT)`,
      );
      throw new PayloadTooLargeException(
        uploadErrorBody(
          413,
          `sizeBytes must be between 1 and ${UPLOAD_MAX_SIZE_BYTES}`,
          'SIZE_LIMIT',
        ),
      );
    }

    // ponytail: advisory only — the authoritative quota check runs inside persistOriginal at
    // complete (dedup fast path first), so a session created near the ceiling can still fail 413
    // there. Rejecting early spares the client 4 GiB of pointless upload.
    const quota = loadEnv().STORAGE_QUOTA_BYTES;
    if (quota !== undefined) {
      const { usedBytes } = await this.userFiles.storageQuota(userId);
      if (usedBytes + body.sizeBytes > quota) {
        this.logger.warn(
          `[UploadsService] upload rejected user=${userId} size=${body.sizeBytes} (QUOTA_EXCEEDED)`,
        );
        throw new PayloadTooLargeException(
          uploadErrorBody(413, 'Storage quota exceeded', 'QUOTA_EXCEEDED'),
        );
      }
    }

    // lazy expiry first: an abandoned session must never hold a cap slot against a new one
    await this.purgeExpired(userId);
    const active = await this.sessionRepo.count({
      where: { userId, status: In(ACTIVE_STATUSES) },
    });
    if (active >= UPLOAD_MAX_ACTIVE_SESSIONS) {
      this.logger.warn(`[UploadsService] upload rejected user=${userId} (SESSION_LIMIT)`);
      throw new ConflictException(
        uploadErrorBody(
          409,
          `Too many active upload sessions (limit ${UPLOAD_MAX_ACTIVE_SESSIONS})`,
          'SESSION_LIMIT',
        ),
      );
    }

    const session = new UploadSession();
    session.id = randomUUID();
    session.userId = userId;
    session.status = 'pending';
    session.chunkSizeBytes = UPLOAD_CHUNK_SIZE_BYTES;
    session.totalParts = Math.ceil(body.sizeBytes / UPLOAD_CHUNK_SIZE_BYTES);
    session.expectedSizeBytes = body.sizeBytes;
    session.checksumSha256 = body.checksumSha256?.toLowerCase() ?? null;
    session.originalName = body.originalName;
    session.title = body.title ?? null;
    session.description = body.description ?? null;
    session.takenAt = body.takenAt ? new Date(body.takenAt) : null;
    session.expiresAt = new Date(Date.now() + UPLOAD_PENDING_TTL_MS);
    session.completedFileId = null;
    session.completedAssetId = null;
    await this.sessionRepo.save(session);
    this.logger.log(
      `[UploadsService] upload started session=${session.id} user=${userId} parts=${session.totalParts} size=${body.sizeBytes}`,
    );

    return {
      uploadId: session.id,
      chunkSizeBytes: session.chunkSizeBytes,
      totalParts: session.totalParts,
      expiresAt: session.expiresAt.toISOString(),
      status: session.status,
    };
  }

  // GET /api/v1/uploads/:id
  async status(userId: string, uploadId: string): Promise<UploadSessionStatusResponse> {
    const session = await this.loadOwned(userId, uploadId);
    // lazy expiry: a session nobody came back to is parked the moment it is asked about
    if (session.status === 'expired' || this.isStale(session)) {
      if (session.status !== 'expired') await this.expireStale(session);
      throw sessionExpiredError();
    }
    const parts = await this.partRepo.find({ where: { sessionId: session.id } });
    return this.statusResponse(session, parts);
  }

  // PUT /api/v1/uploads/:id/parts/:index — body is the raw chunk (≤ chunkSizeBytes)
  async putPart(
    userId: string,
    uploadId: string,
    indexRaw: string,
    body: Buffer,
    declaredSha256: string | null,
  ): Promise<void> {
    if (!/^\d+$/.test(indexRaw)) {
      throw new BadRequestException(
        uploadErrorBody(
          400,
          `Part index must be a non-negative integer, got ${indexRaw}`,
          'INDEX_RANGE',
        ),
      );
    }
    const partIndex = Number(indexRaw);
    if (!isUUID(uploadId)) throw new NotFoundException('Upload session not found');
    const checksum = createHash('sha256').update(body).digest('hex');

    return this.withLockedSession(userId, uploadId, async (runner, session) => {
      if (session.status === 'expired' || this.isStale(session)) {
        await this.expireLocked(runner, session);
        throw sessionExpiredError();
      }
      if (session.status !== 'pending' && session.status !== 'assembling') {
        // `assembled`/`completed`/`failed` are past the point of accepting bytes; the frozen
        // error-code list has no state-conflict code, so PART_CONFLICT carries the refusal
        throw partConflictError(`Upload session is ${session.status} and accepts no more parts`);
      }
      if (partIndex >= session.totalParts) {
        throw new BadRequestException(
          uploadErrorBody(400, `Part index out of range: ${partIndex}`, 'INDEX_RANGE'),
        );
      }
      const sizeBytes = body.length;
      if (sizeBytes === 0 || sizeBytes > session.chunkSizeBytes) {
        throw new BadRequestException(
          uploadErrorBody(
            400,
            `Part must be 1..${session.chunkSizeBytes} bytes, got ${sizeBytes}`,
            'PART_TOO_LARGE',
          ),
        );
      }
      // the declared hash is a transport check on the bytes we just received; the row keeps the
      // recomputed digest (the authoritative one used for idempotent re-PUTs)
      if (declaredSha256 && declaredSha256.toLowerCase() !== checksum) {
        throw partConflictError('X-Part-Sha256 does not match the uploaded bytes');
      }

      const existing = await runner.manager.findOne(UploadSessionPart, {
        where: { sessionId: session.id, partIndex },
      });
      if (existing) {
        if (existing.sizeBytes !== sizeBytes || existing.checksumSha256 !== checksum) {
          throw partConflictError(`Part ${partIndex} already stored with different bytes`);
        }
        // identical replay: no row write. Rewrite the bytes only when the file vanished
        // (crash between an earlier row write and the file write) so the assembly stays whole
        await this.ensurePartFile(session, partIndex, body);
        return;
      }

      // row first: a concurrent same-index PUT loses the PK race before any bytes are written,
      // so the loser can never overwrite the winner's part file with different bytes
      try {
        await runner.manager.insert(UploadSessionPart, {
          sessionId: session.id,
          partIndex,
          sizeBytes,
          checksumSha256: checksum,
        });
      } catch (err) {
        // concurrent same-index PUT won the PK: adopt its row when the bytes agree, else conflict.
        // The winner writes its file before committing, so a committed winner row implies bytes.
        if (!isPostgresUniqueViolation(err)) throw err;
        const winner = await runner.manager.findOne(UploadSessionPart, {
          where: { sessionId: session.id, partIndex },
        });
        if (winner?.sizeBytes !== sizeBytes || winner?.checksumSha256 !== checksum) {
          throw partConflictError(`Part ${partIndex} already stored with different bytes`);
        }
        return;
      }

      // only now write the bytes: a failure throws, rolling the insert back so no row is left
      // pointing at a missing file
      await this.writePartFile(session, partIndex, body);
    });
  }

  // POST /api/v1/uploads/:id/complete
  async complete(userId: string, uploadId: string): Promise<UploadCompleteResponse> {
    if (!isUUID(uploadId)) throw new NotFoundException('Upload session not found');

    return this.withLockedSession(userId, uploadId, async (runner, session) => {
      if (session.status === 'completed') {
        const assetId = session.completedAssetId;
        if (!assetId) throw new NotFoundException('Upload session not found');
        // duplicate complete: no bytes stored, the asset is the one this session already made
        return { asset: await this.assets.getOne(userId, assetId), deduplicated: true };
      }
      if (session.status === 'expired') throw sessionExpiredError();
      if (session.status === 'failed') {
        throw new BadRequestException(
          uploadErrorBody(400, 'Upload session failed: unsupported file type', 'UNSUPPORTED_TYPE'),
        );
      }
      if (session.status === 'assembled') {
        const fileId = session.completedFileId;
        const assetId = session.completedAssetId;
        if (!fileId || !assetId) {
          throw new ServiceUnavailableException(
            uploadErrorBody(503, 'Upload session is incomplete, please retry', 'ENQUEUE_FAILED'),
          );
        }
        // release the lock before enqueuing: the rows are durable, the retry half is idempotent
        // (same jobIds) and a Redis outage must not keep the session row locked
        await runner.commitTransaction();
        const record = await this.userFiles.getOne(userId, fileId);
        const assetKind = kindFromMime(record.mimeType);
        if (!assetKind) throw unsupportedTypeError();
        return this.runEnqueues(userId, session, fileId, assetId, assetKind);
      }

      // pending | assembling
      if (this.isStale(session)) {
        await this.expireLocked(runner, session);
        throw sessionExpiredError();
      }
      const plan = await this.finalizeAssembly(runner, session, userId);
      // durable from here: `assembled` + the completed ids survive an enqueue failure below
      await runner.commitTransaction();
      if (plan.kind === 'replay') {
        await this.removeSessionDir(session);
        this.logger.log(
          `[UploadsService] upload finished session=${session.id} asset=${plan.asset.id} deduplicated=true`,
        );
        return { asset: plan.asset, deduplicated: plan.deduplicated };
      }
      return this.runEnqueues(
        userId,
        session,
        plan.fileId,
        plan.assetId,
        plan.assetKind,
        plan.asset,
        plan.deduplicated,
      );
    });
  }

  // DELETE /api/v1/uploads/:id — idempotent: parts CASCADE with the row, bytes are removed here
  async remove(userId: string, uploadId: string): Promise<void> {
    if (!isUUID(uploadId)) return;
    const session = await this.sessionRepo.findOne({ where: { id: uploadId, userId } });
    if (!session) return;
    await this.sessionRepo.delete({ id: session.id });
    await this.removeSessionDir(session);
    this.logger.log(`[UploadsService] upload aborted session=${session.id} user=${userId}`);
  }

  /**
   * Parks sessions past their TTL as `expired` and drops their bytes. Without `userId` this is the
   * sweeper entry point, called through pg_try_advisory_lock (see UploadSessionsSweeper) so one
   * instance runs it; with `userId` it is the lazy per-user expiry from create(). Rows are kept —
   * a GET then answers 410 SESSION_EXPIRED instead of a bare 404, telling the client to start
   * over. `assembled` uses updatedAt because there is no assembledAt column.
   */
  async purgeExpired(userId?: string): Promise<{ expired: number }> {
    const now = Date.now();
    const where: FindOptionsWhere<UploadSession>[] = [
      { status: In(['pending', 'assembling']), expiresAt: LessThanOrEqual(new Date(now)) },
      {
        status: 'assembled',
        updatedAt: LessThanOrEqual(new Date(now - UPLOAD_ASSEMBLED_TTL_MS)),
      },
    ];
    if (userId === undefined) {
      // a failed session's parts are only useful inside one pending TTL (a later DELETE) —
      // past that they are garbage, so park the session alongside the expired ones. A
      // user-scoped call must leave that user's failed sessions alone.
      where.push({
        status: 'failed',
        updatedAt: LessThanOrEqual(new Date(now - UPLOAD_PENDING_TTL_MS)),
      });
    } else {
      for (const condition of where) condition.userId = userId;
    }
    const stale = await this.sessionRepo.find({ where });
    for (const session of stale) {
      // bytes before row: a crash between the two makes the next sweep re-run the idempotent rm
      await this.removeSessionDir(session);
      await this.sessionRepo.update({ id: session.id }, { status: 'expired' });
    }
    if (stale.length > 0) {
      this.logger.warn(`[UploadsService] expired ${stale.length} abandoned upload session(s)`);
    }
    return { expired: stale.length };
  }

  /**
   * Runs `fn` under a `SELECT ... FOR UPDATE` lock on the session row, so concurrent completes
   * (and part PUTs) of one session serialize instead of racing the assembly. `fn` may commit
   * early — that is how complete() makes the `assembled` stamp durable before enqueuing.
   */
  private async withLockedSession<T>(
    userId: string,
    uploadId: string,
    fn: (runner: QueryRunner, session: UploadSession) => Promise<T>,
  ): Promise<T> {
    const runner = this.dataSource.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();
    try {
      const session = await runner.manager.findOne(UploadSession, {
        where: { id: uploadId, userId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!session) throw new NotFoundException('Upload session not found');
      const result = await fn(runner, session);
      if (runner.isTransactionActive) await runner.commitTransaction();
      return result;
    } catch (err) {
      if (runner.isTransactionActive) await runner.rollbackTransaction().catch(() => undefined);
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `[UploadsService] upload failed session=${uploadId} user=${userId}: ${message}`,
      );
      throw err;
    } finally {
      await runner.release();
    }
  }

  /**
   * Assembly half of complete(), under the session lock: writes go through `runner.manager`, so
   * the caller decides when the `assembled`/`completed` stamps become durable. The assembled temp
   * file is always removed here (persistOriginal unlinks it itself — rm(force) is a no-op then).
   */
  private async finalizeAssembly(
    runner: QueryRunner,
    session: UploadSession,
    userId: string,
  ): Promise<CompletePlan> {
    // visible to a crash mid-assembly: a retry finds `assembling` and re-runs this from scratch
    await runner.manager.update(UploadSession, { id: session.id }, { status: 'assembling' });

    const parts = await runner.manager.find(UploadSessionPart, {
      where: { sessionId: session.id },
    });
    const receivedParts = parts.map((p) => p.partIndex).sort((a, b) => a - b);
    const receivedBytes = parts.reduce((sum, part) => sum + part.sizeBytes, 0);
    const expectedBytes = Number(session.expectedSizeBytes);
    const indicesComplete =
      receivedParts.length === session.totalParts && receivedParts.every((value, i) => value === i);
    if (!indicesComplete || receivedBytes !== expectedBytes) {
      throw new ConflictException(
        uploadErrorBody(409, 'Upload is missing parts', 'PARTS_MISSING', { receivedParts }),
      );
    }

    let assembledPath: string | null = null;
    try {
      const assembled = await this.assembleParts(session);
      assembledPath = assembled.path;

      const declared = session.checksumSha256?.toLowerCase() ?? null;
      if (declared && declared !== assembled.sha256) {
        // no persist, no part cleanup: the client may re-PUT a corrupt part and retry
        throw new UnprocessableEntityException(
          uploadErrorBody(
            422,
            'Assembled file checksum does not match the declared checksum',
            'CHECKSUM_MISMATCH',
          ),
        );
      }

      if (!(await sniffMime(assembled.path))) {
        // terminal for this session shape: the same bytes would sniff unsupported again
        await runner.manager.update(UploadSession, { id: session.id }, { status: 'failed' });
        await runner.commitTransaction();
        throw unsupportedTypeError();
      }

      // consume-once: persistOriginal unlinks the assembled file (its own sniff/dedup/quota/save)
      let persisted: Awaited<ReturnType<UserFilesService['persistOriginal']>>;
      try {
        persisted = await this.userFiles.persistOriginal(userId, {
          path: assembled.path,
          originalname: session.originalName,
          size: expectedBytes,
        });
      } catch (err) {
        // the legacy path 413s with a bare message; carry the same envelope as the advisory
        // create-time check so clients see one QUOTA_EXCEEDED code either way
        if (err instanceof PayloadTooLargeException) {
          throw new PayloadTooLargeException(
            uploadErrorBody(413, 'Storage quota exceeded', 'QUOTA_EXCEEDED'),
          );
        }
        throw err;
      }
      const { record, created } = persisted;
      this.logger.log(
        `[UploadsService] file saved session=${session.id} file=${record.id} deduplicated=${!created}`,
      );
      const assetKind = kindFromMime(record.mimeType);
      if (!assetKind) throw unsupportedTypeError();

      if (!created) {
        // these exact bytes are already owned: hand back a pre-existing asset instead of
        // creating a second one for the same file row (legacy POST /files 409s here)
        const existing = await this.assetRepo.findOne({ where: { fileId: record.id, userId } });
        if (existing) {
          await runner.manager.update(
            UploadSession,
            { id: session.id },
            { status: 'completed', completedFileId: record.id, completedAssetId: existing.id },
          );
          return {
            kind: 'replay',
            asset: await this.assets.getOne(userId, existing.id),
            deduplicated: true,
          };
        }
      }

      const asset = await this.userFiles.createAsset(userId, record, assetKind, {
        title: session.title ?? undefined,
        description: session.description ?? undefined,
        takenAt: session.takenAt?.toISOString(),
        originalName: session.originalName,
        sizeBytes: expectedBytes,
      });
      await runner.manager.update(
        UploadSession,
        { id: session.id },
        { status: 'assembled', completedFileId: record.id, completedAssetId: asset.id },
      );
      return {
        kind: 'fresh',
        fileId: record.id,
        assetId: asset.id,
        assetKind,
        asset,
        deduplicated: !created,
      };
    } finally {
      if (assembledPath) await rm(assembledPath, { force: true }).catch(() => undefined);
    }
  }

  /**
   * Enqueue half of complete(): the asset + file rows exist, only the processing jobs are
   * outstanding. A failure leaves the session `assembled` (503) so a retry re-runs exactly this.
   * thumb/video/embed/detect re-enqueues reuse the same jobIds — an enqueue that failed stored
   * no job, and jobId dedup swallows the ones that already landed. process-metadata and
   * process-faces enqueue without explicit jobIds, so an assembled-retry can double-enqueue them;
   * that is harmless because both processors are idempotent (metadata patches, faces delete +
   * re-save).
   */
  private async runEnqueues(
    userId: string,
    session: UploadSession,
    fileId: string,
    assetId: string,
    assetKind: 'photo' | 'video',
    asset?: AssetResponse,
    deduplicated = false,
  ): Promise<UploadCompleteResponse> {
    try {
      await this.userFiles.enqueueAssetJobs(userId, { id: fileId }, assetKind, assetId);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`[UploadsService] enqueue failed for session ${session.id}: ${message}`);
      throw new ServiceUnavailableException(
        uploadErrorBody(503, 'Failed to enqueue background processing jobs', 'ENQUEUE_FAILED'),
      );
    }
    await this.sessionRepo.update({ id: session.id }, { status: 'completed' });
    await this.removeSessionDir(session);
    this.logger.log(`[UploadsService] upload finished session=${session.id} asset=${assetId}`);
    return { asset: asset ?? (await this.assets.getOne(userId, assetId)), deduplicated };
  }

  /**
   * Streams part-0..n into one temp file in the session directory, computing SHA-256 on the way.
   * Constant memory (64 KiB stream chunks), never a Buffer of the whole file.
   */
  private async assembleParts(session: UploadSession): Promise<{ path: string; sha256: string }> {
    const dir = this.sessionDir(session.userId, session.id);
    await mkdir(dir, { recursive: true });
    const path = join(dir, `assembled-${randomUUID()}`);
    const out = createWriteStream(path);
    const closed = finished(out);
    const hash = createHash('sha256');
    for (let index = 0; index < session.totalParts; index++) {
      const reader = createReadStream(join(dir, `part-${index}`)) as AsyncIterable<Buffer>;
      for await (const chunk of reader) {
        hash.update(chunk);
        if (!out.write(chunk)) await once(out, 'drain');
      }
    }
    out.end();
    await closed;
    return { path, sha256: hash.digest('hex') };
  }

  private statusResponse(
    session: UploadSession,
    parts: UploadSessionPart[],
  ): UploadSessionStatusResponse {
    // receivedBytes/receivedParts are derived from the part rows (derivation cannot drift under
    // retries or a same-index race). expiresAt is the effective expiry: the pending window, or
    // the shorter assembled retry window.
    return {
      status: session.status,
      chunkSizeBytes: session.chunkSizeBytes,
      totalParts: session.totalParts,
      receivedParts: parts.map((part) => part.partIndex).sort((a, b) => a - b),
      receivedBytes: parts.reduce((sum, part) => sum + part.sizeBytes, 0),
      expiresAt: this.expiresAtOf(session).toISOString(),
      ...(session.completedAssetId ? { assetId: session.completedAssetId } : {}),
      ...(session.completedFileId ? { fileId: session.completedFileId } : {}),
    };
  }

  private async loadOwned(userId: string, uploadId: string): Promise<UploadSession> {
    // a malformed id must read as missing — the uuid cast would 500 it instead
    if (!isUUID(uploadId)) throw new NotFoundException('Upload session not found');
    const session = await this.sessionRepo.findOne({ where: { id: uploadId, userId } });
    if (!session) throw new NotFoundException('Upload session not found');
    return session;
  }

  /** pending/assembling die at expiresAt; `assembled` gets the shorter 6h retry window. */
  private expiresAtOf(session: UploadSession): Date {
    if (session.status === 'assembled') {
      const from = session.updatedAt ? session.updatedAt.getTime() : session.expiresAt.getTime();
      return new Date(from + UPLOAD_ASSEMBLED_TTL_MS);
    }
    return session.expiresAt;
  }

  private isStale(session: UploadSession): boolean {
    if (
      session.status === 'completed' ||
      session.status === 'failed' ||
      session.status === 'expired'
    ) {
      return false;
    }
    return this.expiresAtOf(session).getTime() <= Date.now();
  }

  /** Lazy expiry on a session row read outside a transaction (GET): park it and drop its bytes. */
  private async expireStale(session: UploadSession): Promise<void> {
    // bytes before row: a crash between the two makes the next sweep re-run the idempotent rm
    await this.removeSessionDir(session);
    await this.sessionRepo.update({ id: session.id }, { status: 'expired' });
    session.status = 'expired';
  }

  /** Lazy expiry under the session lock (PUT/complete) — the update must ride the same runner. */
  private async expireLocked(runner: QueryRunner, session: UploadSession): Promise<void> {
    if (session.status !== 'expired') {
      await runner.manager.update(UploadSession, { id: session.id }, { status: 'expired' });
      session.status = 'expired';
      await runner.commitTransaction();
    }
    await this.removeSessionDir(session);
  }

  private sessionDir(userId: string, sessionId: string): string {
    return this.storage.pathFor(join(UPLOAD_SESSIONS_KEY, userId, sessionId));
  }

  private partPath(session: UploadSession, partIndex: number): string {
    return join(this.sessionDir(session.userId, session.id), `part-${partIndex}`);
  }

  /** writeFile to a unique temp name + rename: a crash mid-write never leaves a partial part. */
  private async writePartFile(
    session: UploadSession,
    partIndex: number,
    body: Buffer,
  ): Promise<void> {
    const dir = this.sessionDir(session.userId, session.id);
    await mkdir(dir, { recursive: true });
    const dest = this.partPath(session, partIndex);
    const tmp = `${dest}.${randomUUID()}.tmp`;
    try {
      await writeFile(tmp, body);
      await rename(tmp, dest);
    } catch (err) {
      // a failed write/rename must not leave the temp file behind
      await rm(tmp, { force: true }).catch(() => undefined);
      throw err;
    }
  }

  private async ensurePartFile(
    session: UploadSession,
    partIndex: number,
    body: Buffer,
  ): Promise<void> {
    if (await pathExists(this.partPath(session, partIndex))) return;
    await this.writePartFile(session, partIndex, body);
  }

  /** Best-effort byte cleanup: the DB row is the durable record, a failed rm only leaks disk. */
  private async removeSessionDir(session: UploadSession): Promise<void> {
    try {
      await rm(this.sessionDir(session.userId, session.id), { recursive: true, force: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`[UploadsService] failed to remove session dir ${session.id}: ${message}`);
    }
  }
}
