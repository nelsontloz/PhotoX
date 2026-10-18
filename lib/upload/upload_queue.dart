import '../media/photo_observer.dart';
import 'database.dart';
import 'models.dart';

/// Persistence facade over [AppDatabase] used by the upload pipeline.
class UploadQueue {
  const UploadQueue(this.db);

  /// Drift database holding queued assets and part receipts.
  final AppDatabase db;

  /// Adds a discovered asset to the queue; a known [candidate] is ignored.
  Future<void> enqueue(AssetCandidate candidate) {
    // TODO(spec §3.3): insert as discovered, keyed by localId so a rescan
    // cannot enqueue the same asset twice.
    throw UnimplementedError('UploadQueue.enqueue');
  }

  /// Returns up to [limit] assets that are due for a network attempt.
  Future<List<QueuedAsset>> nextBatch(int limit) {
    // TODO(spec §3.3): order by nextAttemptAt, oldest first, skipping rows in
    // a terminal state.
    throw UnimplementedError('UploadQueue.nextBatch');
  }

  /// Persists the new [state] for one asset before the next attempt.
  Future<void> markState({
    required String localId,
    required UploadState state,
    int? attempts,
    DateTime? nextAttemptAt,
    String? lastError,
  }) {
    // TODO(spec §3.3): persist state + nextAttemptAt BEFORE each network
    // attempt so a killed process resumes instead of restarting.
    throw UnimplementedError('UploadQueue.markState');
  }

  /// Records that the server persisted one part of a session.
  Future<void> recordPartAck({
    required String uploadId,
    required int partIndex,
    required int bytes,
  }) {
    // TODO(spec §3.3): persist part receipts BEFORE each network attempt so a
    // restart can skip parts the server already has.
    throw UnimplementedError('UploadQueue.recordPartAck');
  }
}
