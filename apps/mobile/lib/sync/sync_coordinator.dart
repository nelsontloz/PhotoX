import 'dart:math';

import 'package:flutter/foundation.dart' show debugPrint, kDebugMode;

import '../core/api_client.dart';
import '../core/auth_models.dart';
import '../core/network_status.dart';
import '../core/refresh_lock.dart';
import '../media/media_filter.dart';
import '../media/photo_observer.dart';
import '../server/album_client.dart';
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

  /// Assets confirmed as added to an album this pass.
  int linked = 0;

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

  /// True when another isolate already runs a pass over this queue, so this
  /// one did nothing and changed nothing.
  bool alreadyRunning = false;

  /// True when uploads are held because `wifiOnly` is on and the link is
  /// metered. Discovery still ran.
  bool waitingForWifi = false;

  /// Last unexpected error, when the pass could not inspect or scan.
  String? error;

  @override
  String toString() =>
      'SyncReport(permission: $permission, scanned: $scanned, '
      'enqueued: $enqueued, uploaded: $uploaded, duplicates: $duplicates, '
      'linked: $linked, failed: $failed, skipped: $skipped, '
      'remaining: $remaining, '
      'authRequired: $authRequired, paused: $paused, '
      'waitingForWifi: $waitingForWifi, '
      'alreadyRunning: $alreadyRunning'
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
    this.albumClient,
    RefreshLock? passLock,
  }) : clock = clock ?? DateTime.now,
       passLock = passLock ?? MemoryRefreshLock();

  /// Queue persistence for discovery and per-asset state.
  final UploadQueue queue;

  /// Platform media discovery.
  final PhotoObserver observer;

  /// Per-asset upload pipeline.
  final Uploader uploader;

  /// User preferences (`includeVideos`, `paused`, `wifiOnly`, album scope).
  final SettingsStore settingsStore;

  /// Transport used only for the batch dedup pre-check.
  final UploadTransport dedupTransport;

  /// Backoff schedule for retryable failures.
  final RetryPolicy retryPolicy;

  /// Album calls that bind an upload to its folder's server album; null skips
  /// linking entirely (tests and any graph built without one).
  final AlbumClient? albumClient;

  /// Injectable wall clock so tests can assert scheduling.
  final DateTime Function() clock;

  /// Cross-isolate lease held for the duration of one pass.
  ///
  /// The UI isolate and the Workmanager isolate share one drift file and one
  /// queue, so two passes at once stomp each other's rows and spool files.
  /// AppServices wires the drift-backed implementation; the in-memory default
  /// only serialises passes inside one isolate.
  final RefreshLock passLock;

  /// How long this pass owns [passLock] before another isolate may take it.
  ///
  /// Renewed before every asset, so it only has to outlast one prepare+upload.
  /// It is also the wait a killed app leaves behind: a process that dies mid-
  /// pass keeps the row until it expires, and the next launch's pass is then
  /// skipped, so this must stay short (a real install force-stops the app).
  ///
  /// shortcut: no lease heartbeat during one upload, so an asset that runs
  /// longer than this can still be picked up by another pass on Android; renew
  /// from inside the uploader's part loop if that is ever observed.
  static const Duration passLease = Duration(minutes: 2);

  static int _ownerCounter = 0;
  final String _owner =
      'sync-${DateTime.now().microsecondsSinceEpoch}-${_ownerCounter++}';

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

    // The lease is taken before any write: a pass that does not own the queue
    // must not even normalise its rows, or it flips the other isolate's live
    // work back to `pending` and uploads the same asset twice.
    if (!await _holdLease()) {
      report.alreadyRunning = true;
      report.remaining = (await queue.stats()).pending;
      return report;
    }
    try {
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

      // No watermark means nothing has been scanned yet, so the first pass
      // reads the whole library: assets taken before install are backed up too.
      var watermark = _parseWatermark(await queue.getMeta(scanWatermarkKey));

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

        report.enqueued = await queue.enqueueAll(supported);
        if (kDebugMode) {
          // A pass that queues nothing looks identical to one that scanned
          // nothing; the window and the scope are the only way to tell.
          debugPrint(
            'photox scan: watermark=$watermark folders=$folderIds '
            'scanned=${report.scanned} supported=${supported.length} '
            'enqueued=${report.enqueued}',
          );
        }

        // Only eligible assets move the watermark, and only forward. An empty
        // (or fully filtered) scan must not skip assets added while it was
        // running, and an edited low-timestamp asset must not rewind the window.
        final newest = _newestTimestamp(supported);
        if (newest != null &&
            (watermark == null || newest.isAfter(watermark))) {
          watermark = newest;
          await queue.setMeta(
            scanWatermarkKey,
            watermark.toUtc().toIso8601String(),
          );
        }
      } finally {
        onDiscovery?.call(false);
      }

      // Album membership survives neither a crash nor an offline pass between
      // an upload and the album call, so every pass first re-links what the
      // last one left behind. Linking is a request: same link rule as uploads.
      final links = <String, Map<String, String>>{};
      if (!settings.wifiOnly || await _allowsUpload()) {
        await _collectUnlinked(links, settings);
      }

      final uploadBudgetStart = startedAt;
      var lostLease = false;
      while (!lostLease) {
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
          // Renewed per asset, because one prepare or upload can outlive the
          // lease; a lost lease means another isolate owns the queue now.
          if (!await _holdLease()) {
            lostLease = true;
            break;
          }
          try {
            prepared[item.localId] = await uploader.prepare(item);
          } on Object catch (error) {
            if (await _handleFailure(item, error, report)) break;
          }
        }
        if (report.authRequired || lostLease) break;

        final hits = await _precheck(prepared.values, report);
        if (report.authRequired) break;

        for (final item in batch) {
          if (_budgetExhausted(uploadBudgetStart, budget)) break;
          if (!await _holdLease()) {
            lostLease = true;
            break;
          }
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
            _collectLink(outcome, item, settings, links);
          } on Object catch (error) {
            if (await _handleFailure(item, error, report)) break;
          }
        }
        if (report.authRequired || report.paused) break;
      }

      await _flushLinks(links, report);

      report.remaining = (await queue.stats()).pending;
      return report;
    } finally {
      await passLock.release(_owner);
    }
  }

  /// Gives already-backed-up photos in [folderId] their folder attribution.
  ///
  /// A mapping only ever sees uploads made after it exists, so without this a
  /// folder backed up before it was mapped would never join its album. It scans
  /// without moving the watermark and uploads nothing: the rows it touches are
  /// already terminal, and the next pass's sweep links them.
  Future<void> adoptFolder(String folderId) async {
    final settings = await settingsStore.load();
    final List<AssetCandidate> scanned;
    try {
      scanned = await observer.scanNew(
        since: null,
        folderIds: <String>[folderId],
      );
    } on Object {
      // A folder that vanished keeps whatever it adopted before.
      return;
    }
    final supported = scanned
        .where(
          (candidate) => filter.isSupported(
            candidate,
            includeVideos: settings.includeVideos,
          ),
        )
        .toList(growable: false);
    await queue.enqueueAll(supported);
  }

  /// Takes or renews the cross-isolate pass lease; false when another pass
  /// holds it.
  Future<bool> _holdLease() => passLock.acquire(_owner, passLease);

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

  /// Adds the sweep's already-uploaded rows to [links], keyed album -> row.
  ///
  /// A read that fails costs the pass nothing: the upload loop still runs, and
  /// the next pass sweeps again.
  Future<void> _collectUnlinked(
    Map<String, Map<String, String>> links,
    AppSettings settings,
  ) async {
    if (albumClient == null) return;
    final List<QueuedAsset> rows;
    try {
      rows = await queue.unlinkedUploaded();
    } on Object {
      return;
    }
    for (final row in rows) {
      final assetId = row.serverAssetId;
      if (assetId == null) continue;
      _addLink(
        links,
        settings.folderAlbums[row.folderId],
        row.localId,
        assetId,
      );
    }
  }

  /// Collects one finished upload for its folder's album.
  ///
  /// A dedup hit carries the existing asset id too, and it must land in the
  /// album exactly like a fresh upload.
  void _collectLink(
    UploadOutcome outcome,
    QueuedAsset item,
    AppSettings settings,
    Map<String, Map<String, String>> links,
  ) {
    final assetId = outcome.serverAssetId;
    if (assetId == null) return;
    _addLink(
      links,
      settings.folderAlbums[item.folderId],
      item.localId,
      assetId,
    );
  }

  static void _addLink(
    Map<String, Map<String, String>> links,
    String? albumId,
    String localId,
    String assetId,
  ) {
    if (albumId == null) return;
    (links[albumId] ??= <String, String>{})[localId] = assetId;
  }

  /// Posts the pass's album memberships, then marks those rows linked.
  ///
  /// Only a finished call marks rows: any other failure (401/5xx/network)
  /// leaves them unlinked so the next pass retries, silently, because a lost
  /// link is not a user-facing error.
  Future<void> _flushLinks(
    Map<String, Map<String, String>> links,
    SyncReport report,
  ) async {
    final client = albumClient;
    if (client == null || links.isEmpty) return;
    final gone = <String>{};
    for (final entry in links.entries) {
      final albumId = entry.key;
      final rows = entry.value;
      if (rows.isEmpty) continue;
      try {
        await client.addAssets(albumId, rows.values.toList(growable: false));
        await queue.markAlbumLinked(rows.keys);
        report.linked += rows.length;
        continue;
      } on ApiException catch (error) {
        if (error.statusCode != 404) continue;
      } on Object {
        // Network or an unexpected shape: retried by the next pass's sweep.
        continue;
      }
      // A 404 batch is either a deleted album or one asset deleted since it
      // uploaded; only the album read tells them apart.
      bool alive;
      try {
        alive = await client.exists(albumId);
      } on Object {
        continue;
      }
      if (!alive) {
        gone.add(albumId);
        // Marked though nothing was added: the mapping is dropped, and a
        // re-map nulls these marks again, so the sweep never wedges on it.
        await queue.markAlbumLinked(rows.keys);
        continue;
      }
      // shortcut: retries one id at a time in this rare dead-asset case, up to
      // one request per row per pass; batching the per-id 404s would need core
      // to report which asset id failed.
      for (final row in rows.entries) {
        try {
          await client.addAssets(albumId, <String>[row.value]);
          await queue.markAlbumLinked(<String>[row.key]);
          report.linked++;
        } on ApiException catch (error) {
          // A per-id 404 means that asset is gone: it can never join, and
          // leaving it unlinked would crowd the 100-row sweep forever.
          if (error.statusCode != 404) break;
          await queue.markAlbumLinked(<String>[row.key]);
        } on Object {
          // Anything else aborts the rest unmarked so the next pass retries.
          break;
        }
      }
    }
    if (gone.isNotEmpty) await _forgetAlbumMappings(gone);
  }

  /// Drops every folder mapped to an album the server no longer has.
  ///
  /// Re-read before writing, so a mapping the user changed mid-pass survives.
  Future<void> _forgetAlbumMappings(Set<String> albumIds) async {
    try {
      final current = await settingsStore.load();
      final kept = <String, String>{
        for (final entry in current.folderAlbums.entries)
          if (!albumIds.contains(entry.value)) entry.key: entry.value,
      };
      if (kept.length == current.folderAlbums.length) return;
      await settingsStore.save(current.copyWith(folderAlbums: kept));
    } on Object {
      // The next pass hits the 404 again and retries the cleanup.
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
