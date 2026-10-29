import 'dart:math' show min;

import 'package:drift/drift.dart';

import '../media/photo_observer.dart';
import 'database.dart';
import 'models.dart';

/// Aggregate queue counts shown on the home screen.
class QueueStats {
  const QueueStats({
    required this.pending,
    required this.uploaded,
    required this.duplicate,
    required this.failed,
    this.photos = 0,
    this.videos = 0,
  });

  /// Assets still waiting for work, including retryable failures.
  final int pending;

  /// Assets the server confirmed as stored.
  final int uploaded;

  /// Assets skipped because the bytes already existed server-side.
  final int duplicate;

  /// Assets that gave up permanently (including quota skips).
  final int failed;

  /// Photo rows ever queued (terminal rows included).
  final int photos;

  /// Video rows ever queued (terminal rows included).
  final int videos;

  /// Rows still in play, for an overall progress denominator.
  int get total => photos + videos;

  /// Rows that will never be retried again (uploaded or known duplicates).
  int get completed => uploaded + duplicate;

  /// Overall progress, `0`..`1`.
  double get fraction => total == 0 ? 0 : (completed / total).clamp(0.0, 1.0);

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      (other is QueueStats &&
          other.pending == pending &&
          other.uploaded == uploaded &&
          other.duplicate == duplicate &&
          other.failed == failed &&
          other.photos == photos &&
          other.videos == videos);

  @override
  int get hashCode =>
      Object.hash(pending, uploaded, duplicate, failed, photos, videos);

  @override
  String toString() =>
      'QueueStats(pending: $pending, uploaded: $uploaded, '
      'duplicate: $duplicate, failed: $failed, photos: $photos, '
      'videos: $videos)';
}

/// Persistence facade over [AppDatabase] used by the upload pipeline.
///
/// Every method that changes more than one row runs in a transaction (or a
/// batch), so a killed process never observes half an update. The queue never
/// touches the network; callers persist the state change *before* the request.
class UploadQueue {
  const UploadQueue(this.db);

  /// Drift database holding queued assets and part receipts.
  final AppDatabase db;

  /// Namespace used by [getMeta] / [setMeta] / [deleteMeta].
  static const String metaNamespace = 'meta';

  /// States from which the queue never schedules another attempt.
  static const List<String> terminalStates = <String>[
    'uploaded',
    'duplicate',
    'failedPermanent',
    'excluded',
    'skippedQuota',
  ];

  /// States that mean "a worker currently owns this row".
  static const List<String> _interruptedStates = <String>[
    'creating',
    'uploading',
    'completing',
  ];

  static const List<String> _pendingStates = <String>[
    'discovered',
    'hashing',
    'pending',
    'creating',
    'uploading',
    'completing',
    'failedRetryable',
  ];

  static const List<String> _failedStates = <String>[
    'failedPermanent',
    'skippedQuota',
  ];

  /// Adds one discovered asset; existing rows only refresh scan metadata.
  Future<void> enqueue(AssetCandidate candidate) => enqueueAll([candidate]);

  /// Adds every candidate atomically, refreshing mutable scan metadata.
  ///
  /// Existing rows always receive [AssetCandidate.sizeBytes], [takenAt],
  /// [modifiedAt], [fileName] and [mimeType] from the latest scan. When the
  /// size or modification time changed, the row is cleared back to
  /// [UploadState.discovered]: digest, spool path, session id, part geometry,
  /// protocol, attempts and server ids are all reset so the new bytes are
  /// re-hashed and re-uploaded. A cleared row must never reuse the previous
  /// spool, because that spool holds the bytes of the *old* file version.
  /// Unchanged rows keep their progress untouched.
  Future<void> enqueueAll(Iterable<AssetCandidate> candidates) async {
    final list = candidates.toList(growable: false);
    if (list.isEmpty) return;
    final discoveredAt = DateTime.now();
    final ids = list.map((candidate) => candidate.localId).toSet().toList();

    await db.transaction(() async {
      // Chunk the lookup: a library scan can exceed SQLite's variable limit.
      final byId = <String, QueuedAsset>{};
      for (var start = 0; start < ids.length; start += 500) {
        final chunk = ids.sublist(start, min(start + 500, ids.length));
        final rows = await (db.select(
          db.queuedAssets,
        )..where((t) => t.localId.isIn(chunk))).get();
        for (final row in rows) {
          byId[row.localId] = row;
        }
      }

      await db.batch((batch) {
        for (final candidate in list) {
          final previous = byId[candidate.localId];
          if (previous == null) {
            batch.insert(
              db.queuedAssets,
              QueuedAssetsCompanion.insert(
                localId: candidate.localId,
                platform: candidate.platform,
                kind: candidate.kind.name,
                sizeBytes: candidate.sizeBytes,
                takenAt: Value(candidate.takenAt),
                fileName: Value(candidate.fileName),
                mimeType: Value(candidate.mimeType),
                modifiedAt: Value(candidate.modifiedAt),
                state: UploadState.discovered.name,
                discoveredAt: Value(discoveredAt),
              ),
              // A changing library can repeat an id across pages.
              mode: InsertMode.insertOrIgnore,
            );
            continue;
          }

          final contentChanged =
              previous.sizeBytes != candidate.sizeBytes ||
              !_sameStoredInstant(previous.modifiedAt, candidate.modifiedAt);
          batch.update(
            db.queuedAssets,
            contentChanged
                ? QueuedAssetsCompanion(
                    platform: Value(candidate.platform),
                    kind: Value(candidate.kind.name),
                    sizeBytes: Value(candidate.sizeBytes),
                    takenAt: Value(candidate.takenAt),
                    modifiedAt: Value(candidate.modifiedAt),
                    fileName: Value(candidate.fileName),
                    mimeType: Value(candidate.mimeType),
                    state: Value(UploadState.discovered.name),
                    sha256: const Value(null),
                    spoolPath: const Value(null),
                    uploadId: const Value(null),
                    partSize: const Value(null),
                    partCount: const Value(null),
                    protocol: const Value(null),
                    attempts: const Value(0),
                    nextAttemptAt: const Value(null),
                    lastError: const Value(null),
                    errorCode: const Value(null),
                    serverAssetId: const Value(null),
                    serverFileId: const Value(null),
                  )
                : QueuedAssetsCompanion(
                    platform: Value(candidate.platform),
                    kind: Value(candidate.kind.name),
                    sizeBytes: Value(candidate.sizeBytes),
                    takenAt: Value(candidate.takenAt),
                    modifiedAt: Value(candidate.modifiedAt),
                    fileName: Value(candidate.fileName),
                    mimeType: Value(candidate.mimeType),
                  ),
            where: (t) => t.localId.equals(candidate.localId),
          );
        }
      });
    });
  }

  /// Drift stores `DateTime` with second precision, so compare that way.
  static bool _sameStoredInstant(DateTime? left, DateTime? right) {
    if (left == null || right == null) return left == null && right == null;
    return left.millisecondsSinceEpoch ~/ 1000 ==
        right.millisecondsSinceEpoch ~/ 1000;
  }

  /// Returns up to [limit] assets that are due for a network attempt.
  ///
  /// [now] defaults to the wall clock; tests inject it. Ordering is oldest due
  /// first (rows without a `nextAttemptAt` are immediately due), then by
  /// discovery order so a batch is deterministic.
  Future<List<QueuedAsset>> nextBatch(int limit, {DateTime? now}) {
    if (limit <= 0) return Future<List<QueuedAsset>>.value(const []);
    final at = now ?? DateTime.now();
    final query = db.select(db.queuedAssets)
      ..where(
        (t) =>
            t.state.isNotIn(terminalStates) &
            (t.nextAttemptAt.isNull() |
                t.nextAttemptAt.isSmallerOrEqualValue(at)),
      )
      ..orderBy([
        (t) =>
            OrderingTerm(expression: t.nextAttemptAt, nulls: NullsOrder.first),
        (t) => OrderingTerm(expression: t.discoveredAt),
        (t) => OrderingTerm(expression: t.localId),
      ])
      ..limit(limit);
    return query.get();
  }

  /// Reads one asset by platform id, or null when it is not queued.
  Future<QueuedAsset?> byLocalId(String localId) {
    return (db.select(
      db.queuedAssets,
    )..where((t) => t.localId.equals(localId))).getSingleOrNull();
  }

  /// Reads every asset currently in one of [states].
  Future<List<QueuedAsset>> byStates(Iterable<UploadState> states) {
    final names = states.map((state) => state.name).toList();
    if (names.isEmpty) return Future<List<QueuedAsset>>.value(const []);
    return (db.select(
      db.queuedAssets,
    )..where((t) => t.state.isIn(names))).get();
  }

  /// Persists the new [state] for one asset before the next attempt.
  ///
  /// A null optional field leaves the stored value untouched. Network-owned
  /// states also stamp [QueuedAssets.lastAttemptAt] so a restart can tell an
  /// interrupted attempt from one that never started.
  Future<void> markState({
    required String localId,
    required UploadState state,
    String? sha256,
    String? spoolPath,
    UploadProtocol? protocol,
    String? uploadId,
    int? partSize,
    int? partCount,
    String? serverAssetId,
    String? serverFileId,
    int? attempts,
    DateTime? nextAttemptAt,
    String? lastError,
    String? errorCode,
  }) {
    final isNetworkAttempt = _interruptedStates.contains(state.name);
    return (db.update(
      db.queuedAssets,
    )..where((t) => t.localId.equals(localId))).write(
      QueuedAssetsCompanion(
        state: Value(state.name),
        sha256: Value.absentIfNull(sha256),
        spoolPath: Value.absentIfNull(spoolPath),
        protocol: Value.absentIfNull(protocol?.name),
        uploadId: Value.absentIfNull(uploadId),
        partSize: Value.absentIfNull(partSize),
        partCount: Value.absentIfNull(partCount),
        serverAssetId: Value.absentIfNull(serverAssetId),
        serverFileId: Value.absentIfNull(serverFileId),
        attempts: Value.absentIfNull(attempts),
        nextAttemptAt: Value.absentIfNull(nextAttemptAt),
        lastError: Value.absentIfNull(lastError),
        errorCode: Value.absentIfNull(errorCode),
        lastAttemptAt: Value.absentIfNull(
          isNetworkAttempt ? DateTime.now() : null,
        ),
      ),
    );
  }

  /// Requeues a session that still has parts to send.
  ///
  /// Unlike a retryable failure this is forward progress, so [attempts] is
  /// kept unchanged and no backoff is scheduled: the next pass continues the
  /// same session immediately.
  Future<void> markPartsPending(String localId) {
    return (db.update(
      db.queuedAssets,
    )..where((t) => t.localId.equals(localId))).write(
      QueuedAssetsCompanion(
        state: Value(UploadState.pending.name),
        nextAttemptAt: const Value(null),
        lastError: const Value(null),
        errorCode: const Value(null),
      ),
    );
  }

  /// Records that the server persisted one part of a session.
  Future<void> recordPartAck({
    required String uploadId,
    required int partIndex,
    required int bytes,
    String? sha256,
  }) {
    return db
        .into(db.uploadParts)
        .insertOnConflictUpdate(
          UploadPartsCompanion.insert(
            uploadId: uploadId,
            partIndex: partIndex,
            bytes: bytes,
            sha256: Value.absentIfNull(sha256),
            acknowledgedAt: Value(DateTime.now()),
          ),
        );
  }

  /// Returns the acknowledged part receipts for [uploadId], ascending.
  Future<List<UploadPart>> partsFor(String uploadId) {
    return (db.select(db.uploadParts)
          ..where((t) => t.uploadId.equals(uploadId))
          ..orderBy([(t) => OrderingTerm(expression: t.partIndex)]))
        .get();
  }

  /// Forgets every part receipt for [uploadId] (e.g. session recreated).
  Future<void> clearParts(String uploadId) {
    return (db.delete(
      db.uploadParts,
    )..where((t) => t.uploadId.equals(uploadId))).go();
  }

  /// Moves rows owned by a dead worker back to `pending`.
  Future<void> resetInterrupted() {
    return (db.update(db.queuedAssets)
          ..where((t) => t.state.isIn(_interruptedStates)))
        .write(QueuedAssetsCompanion(state: Value(UploadState.pending.name)));
  }

  /// Puts every failed row back in the queue, returning how many moved.
  ///
  /// The digest and spool survive, so a 160 MB video is not re-hashed just to
  /// retry a rejected request; the session geometry is dropped so the next
  /// attempt opens a fresh session instead of resuming a dead one.
  Future<int> retryFailed() {
    return (db.update(db.queuedAssets)
          ..where((t) => t.state.isIn(_failedStates)))
        .write(
          QueuedAssetsCompanion(
            state: Value(UploadState.pending.name),
            attempts: const Value(0),
            nextAttemptAt: const Value(null),
            lastError: const Value(null),
            errorCode: const Value(null),
            uploadId: const Value(null),
            partSize: const Value(null),
            partCount: const Value(null),
            protocol: const Value(null),
          ),
        );
  }

  /// Deletes every row that still has work left, returning how many went.
  ///
  /// Only un-uploaded work is dropped: uploaded, duplicate and skipped rows
  /// are history and stay, so the counters keep describing past backups.
  Future<int> clearNonTerminal() {
    return db.transaction(() async {
      return (db.delete(
        db.queuedAssets,
      )..where((t) => t.state.isNotIn(terminalStates))).go();
    });
  }

  /// Counts assets by coarse UI-facing status.
  Future<QueueStats> stats() {
    return db.transaction(() async {
      final pending = await _countWhere(
        db.queuedAssets.state.isIn(_pendingStates),
      );
      final uploaded = await _countWhere(
        db.queuedAssets.state.equals(UploadState.uploaded.name),
      );
      final duplicate = await _countWhere(
        db.queuedAssets.state.equals(UploadState.duplicate.name),
      );
      final failed = await _countWhere(
        db.queuedAssets.state.isIn(_failedStates),
      );
      final photos = await _countWhere(
        db.queuedAssets.kind.equals(MediaKind.photo.name),
      );
      final videos = await _countWhere(
        db.queuedAssets.kind.equals(MediaKind.video.name),
      );
      return QueueStats(
        pending: pending,
        uploaded: uploaded,
        duplicate: duplicate,
        failed: failed,
        photos: photos,
        videos: videos,
      );
    });
  }

  /// Reads a [metaNamespace] string, or null when the key is absent.
  Future<String?> getMeta(String key) {
    return (db.select(db.keyValues)
          ..where((t) => t.namespace.equals(metaNamespace) & t.key.equals(key)))
        .getSingleOrNull()
        .then((row) => row?.value);
  }

  /// Writes a [metaNamespace] string, overwriting any previous value.
  Future<void> setMeta(String key, String value) {
    return db
        .into(db.keyValues)
        .insertOnConflictUpdate(
          KeyValuesCompanion.insert(
            namespace: metaNamespace,
            key: key,
            value: value,
            updatedAt: DateTime.now(),
          ),
        );
  }

  /// Deletes one [metaNamespace] key; absent keys are a no-op.
  Future<void> deleteMeta(String key) {
    return (db.delete(db.keyValues)
          ..where((t) => t.namespace.equals(metaNamespace) & t.key.equals(key)))
        .go();
  }

  Future<int> _countWhere(Expression<bool> predicate) async {
    final count = db.queuedAssets.localId.count();
    final query = db.selectOnly(db.queuedAssets)
      ..addColumns([count])
      ..where(predicate);
    final row = await query.getSingle();
    return row.read(count) ?? 0;
  }
}
