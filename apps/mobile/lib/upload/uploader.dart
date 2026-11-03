import 'dart:convert';
import 'dart:io';
import 'dart:math';

import '../core/api_client.dart';
import '../core/app_config.dart';
import '../core/auth_models.dart';
import '../media/hasher.dart';
import '../media/photo_observer.dart';
import '../sync/transfer_progress.dart';
import 'database.dart';
import 'models.dart';
import 'transports.dart';
import 'upload_queue.dart';

/// Directory holding prepared asset bytes; wiped when the account signs out.
String get defaultSpoolDirectory =>
    '${Directory.systemTemp.path}/photox-upload-spool';

/// Deletes every spooled copy of a photo or video.
///
/// Best effort: a locked file must never fail a sign-out, and the next prepare
/// re-copies whatever it needs anyway.
Future<void> clearUploadSpool([String? directory]) async {
  final spool = Directory(directory ?? defaultSpoolDirectory);
  try {
    if (await spool.exists()) await spool.delete(recursive: true);
  } on FileSystemException {
    // Retried on the next sign-out.
  }
}

/// Bytes prepared for upload: a stable spool file plus its exact digest.
class PreparedUpload {
  const PreparedUpload({
    required this.localId,
    required this.sha256,
    required this.spoolPath,
    required this.sizeBytes,
    required this.protocol,
    required this.fileName,
    this.mimeType,
  });

  /// Platform asset id this spool belongs to.
  final String localId;

  /// Lowercase hex SHA-256 of the spool bytes.
  final String sha256;

  /// Stable path the exact bytes were copied to.
  final String spoolPath;

  /// Actual byte length of [spoolPath].
  final int sizeBytes;

  /// Protocol chosen from [sizeBytes].
  final UploadProtocol protocol;

  /// Original file name reported by the platform.
  final String fileName;

  /// MIME hint reported by the platform, when available.
  final String? mimeType;
}

/// Terminal or successful result of one queued asset.
class UploadOutcome {
  const UploadOutcome({
    required this.state,
    this.serverAssetId,
    this.serverFileId,
  });

  /// `uploaded` or `duplicate`.
  final UploadState state;

  /// Server asset id, when the server reported one.
  final String? serverAssetId;

  /// Server file-record id, when the server reported one.
  final String? serverFileId;

  bool get succeeded =>
      state == UploadState.uploaded || state == UploadState.duplicate;
}

/// Typed upload failure handed to the coordinator for scheduling.
class UploadFailure implements Exception {
  const UploadFailure({
    required this.message,
    required this.retryable,
    this.code,
    this.retryAfter,
    this.terminalState,
    this.statusCode,
  });

  final String message;

  /// Whether another attempt with backoff is appropriate.
  final bool retryable;

  /// Stable machine-readable code (`AUTH_REQUIRED`, `PARTS_PENDING`, ...).
  final String? code;

  /// Server-requested delay, honored exactly by the retry policy.
  final Duration? retryAfter;

  /// State to persist when no retry will be scheduled.
  final UploadState? terminalState;

  /// HTTP status that caused the failure, when it came from the API.
  final int? statusCode;

  bool get isAuthError => statusCode == 401 || code == 'AUTH_REQUIRED';

  @override
  String toString() {
    final codePart = code == null ? '' : ' [$code]';
    return 'UploadFailure$codePart: $message';
  }
}

/// Runs one queued asset through hashing, dedup and the upload path.
///
/// The queue row is the source of truth: every state that precedes a network
/// call is persisted first, so a killed process can resume without re-hashing
/// acknowledged bytes. The spool holds the exact bytes that are uploaded; no
/// transcode, resize or re-export ever happens here.
class Uploader {
  Uploader({
    required this.queue,
    required this.uploadTransport,
    required this.sessionTransport,
    required this.hasher,
    required this.observer,
    String? spoolDirectory,
    int? thresholdBytes,
    this.maxPartsPerPass = 8,
    this.progress,
  }) : spoolDirectory = spoolDirectory ?? defaultSpoolDirectory,
       thresholdBytes = thresholdBytes ?? AppConfig.singleUploadThresholdBytes;

  /// Queue writes for every asset.
  final UploadQueue queue;

  /// Single-request transport (also used for dedup by the coordinator).
  final UploadTransport uploadTransport;

  /// Resumable session transport.
  final SessionTransport sessionTransport;

  /// Content hasher used for the exact spool bytes.
  final Hasher hasher;

  /// Source of original asset bytes.
  final PhotoObserver observer;

  /// Directory holding stable per-asset spool files.
  final String spoolDirectory;

  /// Assets at or below this size use the single-request path.
  final int thresholdBytes;

  /// Maximum part PUTs per attempt, so a background window can stop and resume.
  ///
  /// Only the pass that owns a budget should use it: an unbounded foreground
  /// pass sends every part in one attempt instead of restarting at every
  /// boundary, which is where a large video used to stall.
  final int maxPartsPerPass;

  /// Live progress slot shared with the UI, when one is wired.
  final TransferProgress? progress;

  /// Spools whose bytes this isolate already verified, keyed by spool path.
  ///
  /// The value is the `length|sha256` signature that was checked, so a spool
  /// rewritten for an edited asset is verified again. Re-hashing a multi-gigabyte
  /// spool before every resumed part batch made a background pass spend its whole
  /// window reading the file it had just written.
  final Map<String, String> _verifiedSpools = <String, String>{};

  /// Verified entries kept before the cache starts over. A pass never needs
  /// more than a batch, and the spool for an asset is stable across passes.
  static const int _verifiedSpoolLimit = 1024;

  /// Copies [item]'s exact bytes into a stable spool and hashes them.
  ///
  /// A previously prepared spool is reused only when its file still exists,
  /// its length matches the recorded size and its bytes still hash to the
  /// recorded digest. Otherwise the source is streamed to a temporary file,
  /// flushed, hashed, and the queue is updated to `pending` with the digest and
  /// spool path before any network attempt.
  Future<PreparedUpload> prepare(QueuedAsset item) async {
    final reused = await _reusablePrepared(item);
    if (reused != null) return reused;

    await queue.markState(localId: item.localId, state: UploadState.hashing);

    final source = await observer.fileFor(item.localId);
    if (source == null) {
      throw const UploadFailure(
        message: 'asset bytes are not available',
        retryable: true,
        code: 'ASSET_UNAVAILABLE',
      );
    }

    progress?.begin(
      localId: item.localId,
      fileName: _fileName(item),
      totalBytes: item.sizeBytes,
      phase: TransferPhase.preparing,
    );

    final spool = File(_spoolPathFor(item.localId));
    final directory = spool.parent;
    if (!await directory.exists()) {
      await directory.create(recursive: true);
    }
    final temporary = File('${spool.path}.tmp');

    try {
      if (await temporary.exists()) await temporary.delete();
      await source.openRead().pipe(temporary.openWrite());
      // Closing is not durability: a crash can rename an unflushed temp and
      // leave a full-length spool of garbage, which reuse would then upload.
      final handle = await temporary.open(mode: FileMode.append);
      try {
        await handle.flush();
      } finally {
        await handle.close();
      }
      final length = await temporary.length();
      if (await spool.exists()) await spool.delete();
      await temporary.rename(spool.path);

      final sha256 = await hasher.sha256OfFile(spool.path);
      // The bytes were just hashed from disk, so this spool is verified as-is;
      // record it before anything can throw and force the work twice.
      final signature = await _spoolSignature(spool, length, sha256);
      if (signature != null) _rememberVerified(spool.path, signature);
      final protocol = _protocolFor(length);
      await queue.markState(
        localId: item.localId,
        state: UploadState.pending,
        sha256: sha256,
        spoolPath: spool.path,
        protocol: protocol,
        // The row may come from a library page, where the size is unknown (0);
        // record the real length so a resume can trust the spool afterwards.
        sizeBytes: length,
      );
      return PreparedUpload(
        localId: item.localId,
        sha256: sha256,
        spoolPath: spool.path,
        sizeBytes: length,
        protocol: protocol,
        fileName: _fileName(item),
        mimeType: _mimeType(item),
      );
    } on UploadFailure {
      rethrow;
    } on Object {
      if (await temporary.exists()) {
        try {
          await temporary.delete();
        } on FileSystemException {
          // Best effort cleanup; the next prepare retries from the source.
        }
      }
      rethrow;
    } finally {
      // Copying and hashing ends here either way; `process` starts a fresh
      // uploading slot so a failed prepare never leaves progress active.
      progress?.finish();
    }
  }

  /// Hashes (when needed), optionally skips a known duplicate and uploads.
  ///
  /// Returns [UploadOutcome] for `uploaded`/`duplicate`; throws
  /// [UploadFailure] for retryable or terminal failures so the coordinator can
  /// decide the next state. Every state transition is persisted before the
  /// corresponding network call.
  /// [maxParts] caps the part PUTs this attempt may send; `0` means "as many
  /// as the file needs". Omitted, [maxPartsPerPass] applies.
  Future<UploadOutcome> process(
    QueuedAsset item, {
    DedupHit? prechecked,
    int? maxParts,
  }) async {
    final prepared = await prepare(item);

    // Only a hit that already has an asset id is a complete backup. A file
    // record without an asset still needs an upload so the server can create
    // the asset; the 409 duplicate path remains the fallback.
    if (prechecked != null &&
        prechecked.exists &&
        prechecked.existingAssetId != null) {
      await queue.markState(
        localId: item.localId,
        state: UploadState.uploaded,
        serverAssetId: prechecked.existingAssetId,
        serverFileId: prechecked.existingFileId,
      );
      await _deleteSpool(prepared);
      return UploadOutcome(
        state: UploadState.uploaded,
        serverAssetId: prechecked.existingAssetId,
        serverFileId: prechecked.existingFileId,
      );
    }

    progress?.begin(
      localId: item.localId,
      fileName: prepared.fileName,
      totalBytes: prepared.sizeBytes,
      phase: TransferPhase.uploading,
    );
    try {
      if (prepared.sizeBytes <= thresholdBytes) {
        return await _processSingle(item, prepared);
      }
      return await _processSession(item, prepared, maxParts ?? maxPartsPerPass);
    } finally {
      // A failure or duplicate must never leave the bar spinning forever.
      progress?.finish();
    }
  }

  Future<PreparedUpload?> _reusablePrepared(QueuedAsset item) async {
    final sha256 = item.sha256;
    final spoolPath = item.spoolPath;
    if (sha256 == null || spoolPath == null) return null;
    final spool = File(spoolPath);
    try {
      if (!await spool.exists()) return null;
      final length = await spool.length();
      if (length != item.sizeBytes) return null;
      // Length proves nothing about the content: an unclean shutdown can leave
      // a full-length file whose pages never reached disk. Re-hash so a damaged
      // spool is re-copied from the library instead of uploaded as-is — but
      // only when the file changed since this isolate last checked it, or every
      // resumed part batch pays for the whole file again.
      final signature = await _spoolSignature(spool, length, sha256);
      if (signature == null) return null;
      if (_verifiedSpools[spoolPath] != signature) {
        if (await hasher.sha256OfFile(spoolPath) != sha256) return null;
        _rememberVerified(spoolPath, signature);
      }
      return PreparedUpload(
        localId: item.localId,
        sha256: sha256,
        spoolPath: spoolPath,
        sizeBytes: length,
        protocol: _protocolFor(length),
        fileName: _fileName(item),
        mimeType: _mimeType(item),
      );
    } on FileSystemException {
      return null;
    }
  }

  Future<UploadOutcome> _processSingle(
    QueuedAsset item,
    PreparedUpload prepared,
  ) async {
    await queue.markState(
      localId: item.localId,
      state: UploadState.uploading,
      protocol: UploadProtocol.single,
    );

    try {
      final asset = await uploadTransport.uploadFile(
        File(prepared.spoolPath),
        prepared.fileName,
        mimeType: prepared.mimeType,
        takenAt: item.takenAt,
      );
      await queue.markState(
        localId: item.localId,
        state: UploadState.uploaded,
        serverAssetId: asset.id,
        serverFileId: asset.fileId,
      );
      await _deleteSpool(prepared);
      return UploadOutcome(
        state: UploadState.uploaded,
        serverAssetId: asset.id,
        serverFileId: asset.fileId,
      );
    } on ApiException catch (error) {
      if (error.statusCode == 409) {
        await queue.markState(
          localId: item.localId,
          state: UploadState.duplicate,
          serverAssetId: error.existingAssetId,
          serverFileId: error.existingFileId,
        );
        await _deleteSpool(prepared);
        return UploadOutcome(
          state: UploadState.duplicate,
          serverAssetId: error.existingAssetId,
          serverFileId: error.existingFileId,
        );
      }
      final failure = _mapFailure(error);
      await _persistIfTerminal(item.localId, failure, prepared: prepared);
      throw failure;
    } on AuthException catch (error) {
      throw _authFailure(error);
    }
  }

  Future<UploadOutcome> _processSession(
    QueuedAsset item,
    PreparedUpload prepared,
    int maxParts,
  ) async {
    var row = item;
    var mayRecreate = true;
    var mayFillGap = true;
    var forceCreate = false;
    while (true) {
      try {
        UploadSessionStatus status;
        if (forceCreate || row.uploadId == null) {
          final created = await _createSession(row, prepared);
          row = created.row;
          forceCreate = false;
          status = UploadSessionStatus(
            status: created.result.status,
            chunkSizeBytes: created.result.chunkSizeBytes,
            totalParts: created.result.totalParts,
            receivedParts: const <int>[],
            receivedBytes: 0,
            expiresAt: created.result.expiresAt,
          );
        } else {
          await queue.markState(
            localId: row.localId,
            state: UploadState.uploading,
            protocol: UploadProtocol.session,
            uploadId: row.uploadId,
          );
          status = await _getStatusSafely(row.uploadId!);
        }

        if (status.status == 'completed') {
          return await _markUploaded(
            row,
            prepared,
            status.assetId,
            status.fileId,
          );
        }

        if (status.status == 'failed') {
          const failure = UploadFailure(
            message: 'upload session failed on the server',
            retryable: false,
            code: 'UNSUPPORTED_TYPE',
            terminalState: UploadState.failedPermanent,
          );
          await _persistIfTerminal(
            row.localId,
            failure,
            prepared: prepared,
            uploadId: row.uploadId,
          );
          throw failure;
        }

        await queue.markState(
          localId: row.localId,
          state: UploadState.uploading,
          protocol: UploadProtocol.session,
          uploadId: row.uploadId,
          partSize: status.chunkSizeBytes,
          partCount: status.totalParts,
        );

        final missing = _missingParts(status.totalParts, status.receivedParts);
        if (missing.isNotEmpty) {
          await _putParts(
            row.uploadId!,
            prepared,
            missing: missing,
            partSize: status.chunkSizeBytes,
            maxParts: maxParts,
          );
        }

        await queue.markState(
          localId: row.localId,
          state: UploadState.completing,
          protocol: UploadProtocol.session,
          uploadId: row.uploadId,
        );

        try {
          final result = await sessionTransport.complete(row.uploadId!);
          await queue.clearParts(row.uploadId!);
          return await _markUploaded(
            row,
            prepared,
            result.asset.id,
            result.asset.fileId,
          );
        } on ApiException catch (error) {
          if (_isPartsMissing(error)) {
            if (!mayFillGap) rethrow;
            mayFillGap = false;
            final fresh = await _getStatusSafely(row.uploadId!);
            if (fresh.status == 'completed') {
              return await _markUploaded(
                row,
                prepared,
                fresh.assetId,
                fresh.fileId,
              );
            }
            final gaps = _missingParts(fresh.totalParts, fresh.receivedParts);
            if (gaps.isNotEmpty) {
              await queue.markState(
                localId: row.localId,
                state: UploadState.uploading,
                protocol: UploadProtocol.session,
                uploadId: row.uploadId,
                partSize: fresh.chunkSizeBytes,
                partCount: fresh.totalParts,
              );
              await _putParts(
                row.uploadId!,
                prepared,
                missing: gaps,
                partSize: fresh.chunkSizeBytes,
                maxParts: maxParts,
              );
            }
            await queue.markState(
              localId: row.localId,
              state: UploadState.completing,
              protocol: UploadProtocol.session,
              uploadId: row.uploadId,
            );
            final result = await sessionTransport.complete(row.uploadId!);
            await queue.clearParts(row.uploadId!);
            return await _markUploaded(
              row,
              prepared,
              result.asset.id,
              result.asset.fileId,
            );
          }
          if (_isSessionGone(error)) throw const _SessionExpired();
          rethrow;
        }
      } on _SessionExpired {
        if (!mayRecreate) {
          const failure = UploadFailure(
            message: 'upload session expired and cannot be recreated',
            retryable: false,
            code: 'SESSION_EXPIRED',
            terminalState: UploadState.failedPermanent,
          );
          await _persistIfTerminal(
            row.localId,
            failure,
            prepared: prepared,
            uploadId: row.uploadId,
          );
          throw failure;
        }
        mayRecreate = false;
        final previous = row.uploadId;
        if (previous != null) await queue.clearParts(previous);
        forceCreate = true;
        continue;
      } on _PartsRemain {
        throw const UploadFailure(
          message: 'parts remain',
          retryable: true,
          code: 'PARTS_PENDING',
        );
      } on ApiException catch (error) {
        final failure = _mapFailure(error);
        await _persistIfTerminal(
          row.localId,
          failure,
          prepared: prepared,
          uploadId: row.uploadId,
        );
        throw failure;
      } on AuthException catch (error) {
        throw _authFailure(error);
      }
    }
  }

  Future<({QueuedAsset row, CreateSessionResult result})> _createSession(
    QueuedAsset row,
    PreparedUpload prepared,
  ) async {
    await queue.markState(
      localId: row.localId,
      state: UploadState.creating,
      protocol: UploadProtocol.session,
    );
    final created = await sessionTransport.createSession(
      sha256Hex: prepared.sha256,
      sizeBytes: prepared.sizeBytes,
      filename: prepared.fileName,
      takenAt: row.takenAt,
    );
    await queue.markState(
      localId: row.localId,
      state: UploadState.uploading,
      protocol: UploadProtocol.session,
      uploadId: created.uploadId,
      partSize: created.chunkSizeBytes,
      partCount: created.totalParts,
    );
    final fresh = await queue.byLocalId(row.localId);
    return (row: fresh ?? row, result: created);
  }

  Future<UploadSessionStatus> _getStatusSafely(String uploadId) async {
    try {
      return await sessionTransport.getStatus(uploadId);
    } on ApiException catch (error) {
      if (_isSessionGone(error)) throw const _SessionExpired();
      rethrow;
    }
  }

  /// Reads and PUTs the missing part indices, honouring [maxParts].
  Future<void> _putParts(
    String uploadId,
    PreparedUpload prepared, {
    required List<int> missing,
    required int partSize,
    required int maxParts,
  }) async {
    if (partSize <= 0) {
      throw const UploadFailure(
        message: 'server reported an invalid part size',
        retryable: true,
        code: 'INVALID_PART_SIZE',
      );
    }
    final file = File(prepared.spoolPath);
    final raf = await file.open();
    try {
      var sent = 0;
      for (final index in missing) {
        if (maxParts > 0 && sent >= maxParts) throw const _PartsRemain();
        final start = index * partSize;
        if (start >= prepared.sizeBytes) break;
        final length = min(partSize, prepared.sizeBytes - start);
        await raf.setPosition(start);
        final bytes = await raf.read(length);
        try {
          await sessionTransport.putPart(uploadId, index, bytes: bytes);
        } on ApiException catch (error) {
          if (_isSessionGone(error)) throw const _SessionExpired();
          rethrow;
        }
        await queue.recordPartAck(
          uploadId: uploadId,
          partIndex: index,
          bytes: bytes.length,
        );
        sent++;
      }
    } finally {
      await raf.close();
    }
  }

  Future<UploadOutcome> _markUploaded(
    QueuedAsset row,
    PreparedUpload prepared,
    String? assetId,
    String? fileId,
  ) async {
    await queue.markState(
      localId: row.localId,
      state: UploadState.uploaded,
      serverAssetId: assetId,
      serverFileId: fileId,
    );
    await _deleteSpool(prepared);
    return UploadOutcome(
      state: UploadState.uploaded,
      serverAssetId: assetId,
      serverFileId: fileId,
    );
  }

  /// Persists a terminal state, abandons any live session and drops the spool.
  ///
  /// Aborting is best effort: a failure there must never replace the original
  /// upload failure, and the spool is removed either way so a terminal row
  /// cannot pin disk space for bytes that will never be retried.
  Future<void> _persistIfTerminal(
    String localId,
    UploadFailure failure, {
    PreparedUpload? prepared,
    String? uploadId,
  }) async {
    if (failure.retryable) return;
    final state = failure.terminalState;
    if (state == null) return;
    await queue.markState(
      localId: localId,
      state: state,
      lastError: failure.message,
      errorCode: failure.code,
    );
    await _abortSession(uploadId);
    if (prepared != null) await _deleteSpool(prepared);
  }

  Future<void> _abortSession(String? uploadId) async {
    if (uploadId == null) return;
    try {
      await sessionTransport.abort(uploadId);
    } on Object {
      // Best effort: a stale session expires on its own. Never mask the
      // failure that made this row terminal.
    }
  }

  UploadFailure _mapFailure(ApiException error) {
    final status = error.statusCode;
    if (error.isAuthError || status == 401) {
      return UploadFailure(
        message: error.message,
        retryable: false,
        code: 'AUTH_REQUIRED',
        statusCode: status ?? 401,
      );
    }
    if (status == 409 && error.code == 'SESSION_LIMIT') {
      // The account currently has too many open sessions. The server drops
      // the oldest ones, so retry with backoff instead of failing the asset.
      return UploadFailure(
        message: error.message,
        retryable: true,
        code: 'SESSION_LIMIT',
        retryAfter: error.retryAfter,
        statusCode: status,
      );
    }
    if (status == 413) {
      // Only the server's own envelope means the account is out of space. A
      // 413 from anything in front of core (a tunnel or proxy body cap) is a
      // transport limit: the same file can still go through another path, so
      // it stays visible as an error instead of being written off as quota.
      final quota = error.code == 'QUOTA_EXCEEDED';
      return UploadFailure(
        message: error.message,
        retryable: false,
        code: error.code ?? 'HTTP_413',
        statusCode: status,
        terminalState: quota
            ? UploadState.skippedQuota
            : UploadState.failedPermanent,
      );
    }
    if (status == 400 || status == 404 || status == 422) {
      return UploadFailure(
        message: error.message,
        retryable: false,
        code: error.code ?? 'HTTP_$status',
        statusCode: status,
        terminalState: UploadState.failedPermanent,
      );
    }
    if (error.isRetryable) {
      return UploadFailure(
        message: error.message,
        retryable: true,
        code: error.code ?? 'HTTP_${status ?? 'NETWORK'}',
        statusCode: status,
        retryAfter: error.retryAfter,
      );
    }
    return UploadFailure(
      message: error.message,
      retryable: false,
      code: error.code ?? 'HTTP_${status ?? 'UNKNOWN'}',
      statusCode: status,
      terminalState: UploadState.failedPermanent,
    );
  }

  UploadFailure _authFailure(AuthException error) {
    return UploadFailure(
      message: error.message,
      retryable: false,
      code: 'AUTH_REQUIRED',
      statusCode: error.statusCode ?? 401,
    );
  }

  Future<void> _deleteSpool(PreparedUpload prepared) async {
    try {
      final spool = File(prepared.spoolPath);
      if (await spool.exists()) await spool.delete();
    } on FileSystemException {
      // A leftover spool is harmless; the next prepare overwrites it.
    }
  }

  String _spoolPathFor(String localId) {
    final digest = Hasher.sha256OfBytes(utf8.encode(localId));
    return '$spoolDirectory/$digest';
  }

  void _rememberVerified(String spoolPath, String signature) {
    if (_verifiedSpools.length >= _verifiedSpoolLimit) _verifiedSpools.clear();
    _verifiedSpools[spoolPath] = signature;
  }

  /// Identity of one verified spool: its length, when it was written, and the
  /// digest the queue recorded. A rewrite of the same length still misses.
  static Future<String?> _spoolSignature(
    File spool,
    int length,
    String sha256,
  ) async {
    try {
      final modified = await spool.lastModified();
      return '$length|${modified.millisecondsSinceEpoch}|$sha256';
    } on FileSystemException {
      return null;
    }
  }

  UploadProtocol _protocolFor(int sizeBytes) => sizeBytes <= thresholdBytes
      ? UploadProtocol.single
      : UploadProtocol.session;

  String _fileName(QueuedAsset item) {
    final stored = item.fileName;
    if (stored != null && stored.trim().isNotEmpty) return stored;
    final spoolName = item.spoolPath;
    if (spoolName != null) {
      final slash = spoolName.lastIndexOf('/');
      if (slash >= 0 && slash < spoolName.length - 1) {
        return spoolName.substring(slash + 1);
      }
    }
    return item.localId;
  }

  String? _mimeType(QueuedAsset item) {
    final stored = item.mimeType;
    if (stored == null || stored.trim().isEmpty) return null;
    return stored;
  }

  static List<int> _missingParts(int totalParts, List<int> receivedParts) {
    if (totalParts <= 0) return const <int>[];
    final received = receivedParts.toSet();
    return <int>[
      for (var index = 0; index < totalParts; index++)
        if (!received.contains(index)) index,
    ];
  }

  static bool _isSessionGone(ApiException error) =>
      error.statusCode == 404 || error.statusCode == 410;

  static bool _isPartsMissing(ApiException error) {
    if (error.statusCode != 409) return false;
    return error.code == 'PARTS_MISSING' || error.receivedParts != null;
  }
}

class _SessionExpired implements Exception {
  const _SessionExpired();
}

class _PartsRemain implements Exception {
  const _PartsRemain();
}
