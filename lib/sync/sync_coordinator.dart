import 'dart:math';

import '../core/api_client.dart';
import '../core/auth_models.dart';
import '../media/media_filter.dart';
import '../media/photo_observer.dart';
import '../settings/settings_store.dart';
import '../upload/database.dart';
import '../upload/models.dart';
import '../upload/retry_policy.dart';
import '../upload/transports.dart';
import '../upload/upload_queue.dart';
import '../upload/uploader.dart';

/// Outcome of one sync pass, suitable for the home screen and logs.
class SyncReport {
  SyncReport({required this.permission});

  /// Permission observed at the start of the pass.
  PhotoPermission permission;

  /// Assets the platform returned for the watermark window.
  int scanned = 0;

  /// Newly inserted queue rows.
  int enqueued = 0;

  /// Assets the server confirmed as stored.
  int uploaded = 0;

  /// Assets skipped because the bytes already existed server-side.
  int duplicates = 0;

  /// Assets that gave up permanently (including quota skips).
  int failed = 0;

  /// Assets skipped because the server quota was exhausted.
  int skipped = 0;

  /// Non-terminal rows still waiting after the pass.
  int remaining = 0;

  /// True when the pass stopped because the token pair is unusable.
  bool authRequired = false;

  /// Last unexpected error, when the pass could not inspect or scan.
  String? error;

  @override
  String toString() =>
      'SyncReport(permission: $permission, scanned: $scanned, '
      'enqueued: $enqueued, uploaded: $uploaded, duplicates: $duplicates, '
      'failed: $failed, skipped: $skipped, remaining: $remaining, '
      'authRequired: $authRequired'
      '${error == null ? '' : ', error: $error'})';
}

/// Runs discovery and upload passes over the local queue.
///
/// The queue is the only source of truth for resume decisions. A pass never
/// throws for a single bad asset: retryable failures are scheduled through
/// [RetryPolicy] and terminal failures are persisted, so the next pass picks
/// up exactly where this one stopped.
class SyncCoordinator {
  SyncCoordinator({
    required this.queue,
    required this.observer,
    required this.uploader,
    required this.settingsStore,
    required this.dedupTransport,
    required this.retryPolicy,
    DateTime Function()? clock,
    this.filter = const MediaFilter(),
  }) : clock = clock ?? DateTime.now;

  /// Queue persistence for discovery and per-asset state.
  final UploadQueue queue;

  /// Platform media discovery.
  final PhotoObserver observer;

  /// Per-asset upload pipeline.
  final Uploader uploader;

  /// User preferences (`includeVideos`, `backfill`).
  final SettingsStore settingsStore;

  /// Transport used only for the batch dedup pre-check.
  final UploadTransport dedupTransport;

  /// Backoff schedule for retryable failures.
  final RetryPolicy retryPolicy;

  /// Injectable wall clock so tests can assert scheduling.
  final DateTime Function() clock;

  /// Client-side container/MIME filter.
  final MediaFilter filter;

  /// Queue metadata key holding the ISO-8601 watermark.
  static const String scanWatermarkKey = 'scanWatermark';

  /// Scans for new assets, enqueues them and uploads due work.
  ///
  /// [batchSize] caps rows fetched per batch. [budget] stops the upload loop
  /// (but not discovery) once the pass has consumed that much wall time, which
  /// matters for the opportunistic background worker.
  Future<SyncReport> run({int batchSize = 20, Duration? budget}) async {
    final startedAt = clock();
    final report = SyncReport(permission: PhotoPermission.notDetermined);

    await queue.resetInterrupted();
    final settings = await settingsStore.load();

    final permission = await observer.ensurePermission();
    report.permission = permission;
    if (permission != PhotoPermission.authorized &&
        permission != PhotoPermission.limited) {
      return report;
    }

    var watermark = _parseWatermark(await queue.getMeta(scanWatermarkKey));
    if (!settings.backfill && watermark == null) {
      watermark = clock();
      await queue.setMeta(
        scanWatermarkKey,
        watermark.toUtc().toIso8601String(),
      );
    }

    final List<AssetCandidate> scanned;
    try {
      scanned = await observer.scanNew(since: watermark);
    } on Object catch (error) {
      report.error = error.toString();
      return report;
    }
    report.scanned = scanned.length;

    final supported = scanned
        .where(
          (candidate) => filter.isSupported(
            candidate,
            includeVideos: settings.includeVideos,
          ),
        )
        .toList(growable: false);

    final existing = await _existingIds(
      supported.map((candidate) => candidate.localId).toList(growable: false),
    );
    await queue.enqueueAll(supported);
    report.enqueued = supported
        .where((candidate) => !existing.contains(candidate.localId))
        .length;

    // Only eligible assets move the watermark, and only forward. An empty (or
    // fully filtered) scan must not skip assets added while it was running,
    // and an edited low-timestamp asset must not rewind the window.
    final newest = _newestTimestamp(supported);
    if (newest != null && (watermark == null || newest.isAfter(watermark))) {
      watermark = newest;
      await queue.setMeta(
        scanWatermarkKey,
        watermark.toUtc().toIso8601String(),
      );
    }

    final uploadBudgetStart = startedAt;
    while (true) {
      if (_budgetExhausted(uploadBudgetStart, budget)) break;

      final batch = await queue.nextBatch(batchSize, now: clock());
      if (batch.isEmpty) break;

      final prepared = <String, PreparedUpload>{};
      for (final item in batch) {
        try {
          prepared[item.localId] = await uploader.prepare(item);
        } on Object catch (error) {
          if (await _handleFailure(item, error, report)) break;
        }
      }
      if (report.authRequired) break;

      final hits = await _precheck(prepared.values, report);
      if (report.authRequired) break;

      for (final item in batch) {
        if (_budgetExhausted(uploadBudgetStart, budget)) break;
        final preparedItem = prepared[item.localId];
        if (preparedItem == null) continue;
        try {
          final outcome = await uploader.process(
            item,
            prechecked: hits[preparedItem.sha256],
          );
          _countOutcome(outcome, report);
        } on Object catch (error) {
          if (await _handleFailure(item, error, report)) break;
        }
      }
      if (report.authRequired) break;
    }

    report.remaining = (await queue.stats()).pending;
    return report;
  }

  void _countOutcome(UploadOutcome outcome, SyncReport report) {
    switch (outcome.state) {
      case UploadState.uploaded:
        report.uploaded++;
      case UploadState.duplicate:
        report.duplicates++;
      default:
        break;
    }
  }

  /// Persists retry/terminal state. Returns true when the pass must stop.
  Future<bool> _handleFailure(
    QueuedAsset item,
    Object error,
    SyncReport report,
  ) async {
    if (error is AuthException) {
      report.authRequired = true;
      await queue.markState(
        localId: item.localId,
        state: UploadState.pending,
        lastError: error.message,
        errorCode: error.code,
      );
      return true;
    }

    if (error is UploadFailure) {
      if (error.isAuthError) {
        report.authRequired = true;
        await queue.markState(
          localId: item.localId,
          state: UploadState.pending,
          lastError: error.message,
          errorCode: error.code,
        );
        return true;
      }
      if (error.code == 'PARTS_PENDING') {
        // Sending a bounded number of parts is progress, not a failed attempt.
        // Requeue immediately without touching attempts or scheduling backoff.
        await queue.markPartsPending(item.localId);
        return false;
      }
      if (error.retryable) {
        final attempt = item.attempts + 1;
        final next = clock().add(
          retryPolicy.delayFor(attempt, retryAfter: error.retryAfter),
        );
        await queue.markState(
          localId: item.localId,
          state: UploadState.failedRetryable,
          attempts: attempt,
          nextAttemptAt: next,
          lastError: error.message,
          errorCode: error.code,
        );
        return false;
      }
      final terminal = error.terminalState ?? UploadState.failedPermanent;
      await queue.markState(
        localId: item.localId,
        state: terminal,
        lastError: error.message,
        errorCode: error.code,
      );
      if (terminal == UploadState.skippedQuota) {
        report.skipped++;
      } else {
        report.failed++;
      }
      return false;
    }

    // Unexpected failure: schedule it instead of aborting the whole pass.
    final attempt = item.attempts + 1;
    final next = clock().add(retryPolicy.delayFor(attempt));
    await queue.markState(
      localId: item.localId,
      state: UploadState.failedRetryable,
      attempts: attempt,
      nextAttemptAt: next,
      lastError: error.toString(),
      errorCode: 'UNEXPECTED',
    );
    report.error = error.toString();
    return false;
  }

  /// One best-effort batch dedup pre-check; transport errors fall back to the
  /// server's own duplicate detection on upload.
  Future<Map<String, DedupHit>> _precheck(
    Iterable<PreparedUpload> prepared,
    SyncReport report,
  ) async {
    final checks = <String, DedupCheck>{};
    for (final item in prepared) {
      checks.putIfAbsent(
        item.sha256,
        () =>
            DedupCheck(checksumSha256: item.sha256, sizeBytes: item.sizeBytes),
      );
    }
    if (checks.isEmpty) return <String, DedupHit>{};

    final hits = <String, DedupHit>{};
    final values = checks.values.toList(growable: false);
    for (var start = 0; start < values.length; start += 100) {
      final chunk = values.sublist(start, min(start + 100, values.length));
      try {
        final response = await dedupTransport.exists(chunk);
        for (final hit in response) {
          hits[hit.checksumSha256] = hit;
        }
      } on AuthException catch (error) {
        report.authRequired = true;
        report.error = error.message;
        return hits;
      } on ApiException catch (error) {
        if (error.isAuthError) {
          report.authRequired = true;
          report.error = error.message;
          return hits;
        }
        // Fall through: uploads still detect duplicates via 409.
      } on Object {
        // Dedup is an optimization; a broken pre-check must not stop uploads.
      }
    }
    return hits;
  }

  Future<Set<String>> _existingIds(List<String> ids) async {
    if (ids.isEmpty) return <String>{};
    final found = <String>{};
    for (var start = 0; start < ids.length; start += 500) {
      final chunk = ids.sublist(start, min(start + 500, ids.length));
      final rows = await (queue.db.select(
        queue.db.queuedAssets,
      )..where((table) => table.localId.isIn(chunk))).get();
      found.addAll(rows.map((row) => row.localId));
    }
    return found;
  }

  DateTime? _newestTimestamp(List<AssetCandidate> candidates) {
    DateTime? newest;
    for (final candidate in candidates) {
      for (final value in <DateTime?>[
        candidate.modifiedAt,
        candidate.takenAt,
      ]) {
        if (value == null) continue;
        if (newest == null || value.isAfter(newest)) newest = value;
      }
    }
    return newest;
  }

  bool _budgetExhausted(DateTime start, Duration? budget) =>
      budget != null &&
      !clock().difference(start).isNegative &&
      clock().difference(start) >= budget;

  DateTime? _parseWatermark(String? raw) {
    if (raw == null || raw.isEmpty) return null;
    return DateTime.tryParse(raw);
  }
}
