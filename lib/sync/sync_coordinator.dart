import 'dart:math';

import '../core/api_client.dart';
import '../core/auth_models.dart';
import '../core/network_status.dart';
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

  /// True when the pass did nothing because backups are paused.
  bool paused = false;

  /// True when uploads are held because `wifiOnly` is on and the link is
  /// metered. Discovery still ran.
  bool waitingForWifi = false;

  /// Last unexpected error, when the pass could not inspect or scan.
  String? error;

  @override
  String toString() =>
      'SyncReport(permission: $permission, scanned: $scanned, '
      'enqueued: $enqueued, uploaded: $uploaded, duplicates: $duplicates, '
      'failed: $failed, skipped: $skipped, remaining: $remaining, '
      'authRequired: $authRequired, paused: $paused, '
      'waitingForWifi: $waitingForWifi'
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
    this.network = const ConnectivityNetworkStatus(),
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

  /// Link check for the `wifiOnly` preference during a foreground pass.
  final NetworkStatus network;

  /// Called with `true` when the library scan starts and `false` once its rows
  /// are queued, so the dashboard can show the scan instead of counts that
  /// still describe the previous scope. Set by the UI controller; null in the
  /// background isolate.
  void Function(bool discovering)? onDiscovery;

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

    // Paused means paused: no permission prompt, no scan, no upload.
    if (settings.paused) {
      report.paused = true;
      report.remaining = (await queue.stats()).pending;
      return report;
    }

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

    final folderIds = await _scanScope(settings);
    // The flag is cleared in `finally`: a failed scan must not leave the
    // dashboard waiting on a spinner forever.
    onDiscovery?.call(true);
    try {
      final List<AssetCandidate> scanned;
      try {
        scanned = await observer.scanNew(
          since: watermark,
          folderIds: folderIds,
        );
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

      // Only eligible assets move the watermark, and only forward. An empty
      // (or fully filtered) scan must not skip assets added while it was
      // running, and an edited low-timestamp asset must not rewind the window.
      final newest = _newestTimestamp(supported);
      if (newest != null && (watermark == null || newest.isAfter(watermark))) {
        watermark = newest;
        await queue.setMeta(
          scanWatermarkKey,
          watermark.toUtc().toIso8601String(),
        );
      }
    } finally {
      onDiscovery?.call(false);
    }

    final uploadBudgetStart = startedAt;
    while (true) {
      if (_budgetExhausted(uploadBudgetStart, budget)) break;

      // Pause and the link check are re-read every batch: both can change
      // while this pass is running.
      final current = await settingsStore.load();
      if (current.paused) {
        report.paused = true;
        break;
      }
      if (current.wifiOnly && !await _allowsUpload()) {
        report.waitingForWifi = true;
        break;
      }

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
        // A pause hit mid-batch stops after the asset that is already in
        // flight, so no acknowledged part or spool is thrown away.
        if ((await settingsStore.load()).paused) {
          report.paused = true;
          break;
        }
        final preparedItem = prepared[item.localId];
        if (preparedItem == null) continue;
        try {
          final outcome = await uploader.process(
            item,
            prechecked: hits[preparedItem.sha256],
            // A background pass stops at the part cap so its OS window can end
            // between parts. A foreground pass has no window to respect, so it
            // finishes the asset in one attempt instead of restarting at every
            // 64 MiB boundary.
            maxParts: budget == null ? 0 : uploader.maxPartsPerPass,
          );
          _countOutcome(outcome, report);
        } on Object catch (error) {
          if (await _handleFailure(item, error, report)) break;
        }
      }
      if (report.authRequired || report.paused) break;
    }

    report.remaining = (await queue.stats()).pending;
    return report;
  }

  /// Albums this pass scans; null means the whole library.
  ///
  /// Nothing chosen yet means the camera album. A broken album listing must
  /// never shrink discovery, so that falls back to the whole library too.
  Future<List<String>?> _scanScope(AppSettings settings) async {
    if (settings.uploadAllFolders) return null;
    if (settings.uploadFolderIds.isNotEmpty) return settings.uploadFolderIds;
    try {
      for (final folder in await observer.folders()) {
        if (folder.isCamera) return <String>[folder.id];
      }
    } on Object {
      // Fall through and scan everything.
    }
    return null;
  }

  /// True when the current link permits uploads under `wifiOnly`.
  ///
  /// A failing platform check counts as "not allowed": silently burning mobile
  /// data is worse than stalling, and the UI says why it is waiting.
  Future<bool> _allowsUpload() async {
    try {
      return await network.isUnmetered();
    } on Object {
      return false;
    }
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
        () => DedupCheck(checksumSha256: item.sha256),
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
