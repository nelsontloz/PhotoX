import 'dart:async';
import 'dart:io';
import 'dart:typed_data';

import 'package:flutter/foundation.dart'
    show debugPrint, kDebugMode, listEquals;
import 'package:flutter/widgets.dart';

import 'background/scheduler.dart';
import 'core/api_client.dart';
import 'core/app_config.dart';
import 'core/auth_manager.dart';
import 'core/auth_models.dart';
import 'library/album_progress.dart';
import 'library/album_scope.dart';
import 'library/backup_status.dart';
import 'media/media_filter.dart';
import 'media/photo_observer.dart';
import 'server/server_asset.dart';
import 'server/server_assets_client.dart';
import 'settings/settings_store.dart';
import 'sync/sync_coordinator.dart';
import 'sync/transfer_progress.dart';
import 'upload/models.dart';
import 'upload/upload_queue.dart';
import 'upload/uploader.dart';

/// State and actions the app shell needs from the sync stack.
///
/// The interface exists so widget tests can drive the screens without a
/// database, network or platform plugins; [PhotoXController] is the real
/// implementation wired by the app services graph.
abstract class AppController extends ChangeNotifier {
  /// Whether a token pair is held (the access token may be expired).
  bool get isSignedIn;

  /// True while an account action (sign-in, sign-out, settings write) runs.
  bool get busy;

  /// True while a sync pass is running.
  bool get syncing;

  /// True while a pass is scanning the library, before its first upload.
  bool get discovering;

  /// True when the last pass found the stored session unusable.
  bool get authRequired;

  /// Photo-library permission observed by the most recent pass.
  PhotoPermission get permission;

  /// Reads the photo-library permission without running a backup pass.
  ///
  /// The library grid needs the current answer even while backups are paused or
  /// a long pass is still uploading, which is before any pass report exists.
  Future<void> refreshPermission();

  /// Albums the device exposes, so the user can choose the backup scope.
  Future<List<MediaFolder>> folders();

  /// Encoded preview of [localId] at roughly [size] pixels, or null when none
  /// is available. The grid asks for its own tile size; callers that draw
  /// something small keep the default.
  Future<Uint8List?> thumbnail(String localId, {int size = 128});

  /// Display-resolution preview for the full-screen viewer.
  ///
  /// Larger than [thumbnail] because it fills the screen, still a platform
  /// thumbnail: the original bytes are never exported just to look at a photo.
  Future<Uint8List?> preview(String localId);

  /// Badge and last failure for one asset, read fresh from the queue.
  Future<BackupDetail> backupDetail(AssetCandidate asset);

  /// Playable bytes for a video, or null when the platform cannot produce them.
  ///
  /// [onProgress] reports `0`..`1` while an iCloud-only video downloads.
  Future<File?> playableVideo(
    String localId, {
    void Function(double progress)? onProgress,
  });

  /// Newest-first page of the device library, for the on-device browser.
  ///
  /// [folderId] limits the page to that album; null pages the whole library.
  Future<List<AssetCandidate>> libraryPage({
    required int offset,
    int limit = 200,
    String? folderId,
  });

  /// Assets the platform counts in [folderId], or the whole library when null.
  Future<int> libraryCount({String? folderId});

  /// Backed-up tally for one device album, read from the device and the queue.
  ///
  /// Side-effect free: it never queues, notifies or bumps the revision. A
  /// platform read that throws propagates to the caller.
  Future<AlbumProgress> albumProgress(String folderId);

  /// Queue state of the listed device assets, keyed by platform id.
  ///
  /// Ids with no row are absent: this phone never queued those assets.
  Future<Map<String, UploadState>> backupStates(List<String> localIds);

  /// Newest-first page of the server's library, for the merged grid.
  ///
  /// [dateTo] is an exclusive upper bound on the date a tile sorts by, which is
  /// how the caller walks further back without a date window.
  Future<ServerAssetPage> serverPage({
    DateTime? dateTo,
    int offset = 0,
    int limit = ServerAssetsClient.maxLimit,
  });

  /// Server asset id of every listed device asset the server already holds.
  ///
  /// Ids with no server copy are absent: the row uploaded nowhere yet, or its
  /// bytes failed to reach the server.
  Future<Map<String, String>> serverIds(List<String> localIds);

  /// Encoded thumbnail of one server file, or null when that file is gone.
  ///
  /// Memoised for the session: flipping through the grid asks for the same
  /// tiles again, and the bytes never change once written.
  Future<Uint8List?> serverThumb(String fileId);

  /// Bumped whenever queued assets changed state, so the grid re-reads its page
  /// instead of holding the whole queue in memory.
  int get queueRevision;

  /// Queues [assets] ahead of the scan scope and starts a pass.
  ///
  /// Assets the server would reject (unsupported containers, videos while
  /// videos are off) are dropped rather than queued to fail. Assets that
  /// already gave up, or are waiting out a backoff, are retried right away.
  Future<void> backUpNow(List<AssetCandidate> assets);

  /// Aggregate queue counts.
  QueueStats get stats;

  /// Live progress of the asset currently being prepared or uploaded.
  TransferProgress get progress;

  /// Summary of the most recent pass, or null before the first one.
  SyncReport? get lastReport;

  /// Last unexpected error, already phrased for the user.
  String? get error;

  /// Current persisted preferences.
  AppSettings get settings;

  /// True when backups are stopped by the user; passes hold until [resume].
  bool get paused;

  /// Stops backups after the asset currently in flight.
  Future<void> pause();

  /// Clears the pause and starts a pass immediately.
  Future<void> resume();

  /// Restores auth, loads settings and queue counts, then starts a pass when
  /// the user is already signed in.
  Future<void> initialize();

  /// Signs in and, on success, starts an immediate sync pass.
  ///
  /// [serverUrl] is the address the user confirmed on the sign-in form; an
  /// empty or unchanged value keeps the stored one.
  Future<void> signIn(String email, String password, String serverUrl);

  /// Revokes the session, cancels background work and resets counters.
  Future<void> signOut();

  /// Starts a sync pass; joins one that is already running instead of queueing.
  Future<void> syncNow();

  /// Puts every failed or quota-skipped asset back in the queue and syncs.
  Future<void> retryFailed();

  /// Persists [settings] and re-registers background work with the new
  /// constraints.
  Future<void> updateSettings(AppSettings settings);
}

/// [AppController] backed by the real auth, queue and scheduler stack.
///
/// Owns no widgets: the shell rebuilds from [notifyListeners], and resume
/// passes are driven by [WidgetsBindingObserver] so a foreground app syncs
/// without waiting for the next OS window.
class PhotoXController extends AppController with WidgetsBindingObserver {
  PhotoXController({
    required this.auth,
    required this.api,
    required this.queue,
    required this.coordinator,
    required this.settingsStore,
    required this.scheduler,
    required this.observer,
    required this.progress,
    ServerAssetsClient? serverAssets,
    Future<void> Function()? clearSpool,
  }) : serverAssets = serverAssets ?? ServerAssetsClient(api),
       clearSpool = clearSpool ?? clearUploadSpool {
    _completedTransfers = progress.completedTransfers;
    progress.addListener(_onProgress);
    coordinator.onDiscovery = _onDiscovery;
  }

  /// Token owner; also the source of [isSignedIn].
  final AuthManager auth;

  /// Signed transport; retargeted when the server address changes.
  final ApiClient api;

  /// Reads the server's asset library; shares [api], so it uses the same auth,
  /// retries and base address.
  final ServerAssetsClient serverAssets;

  /// Queue persistence used for the home-screen counters.
  final UploadQueue queue;

  /// Runs discovery and upload passes.
  final SyncCoordinator coordinator;

  /// Persistence for user preferences.
  final SettingsStore settingsStore;

  /// OS schedule used by [signOut] and settings changes.
  final BackgroundScheduler scheduler;

  /// Platform library used by [folders].
  final PhotoObserver observer;

  /// Live progress of the asset currently in flight.
  @override
  final TransferProgress progress;

  /// Deletes spooled asset bytes; swappable so tests never touch the real
  /// temp directory.
  final Future<void> Function() clearSpool;

  static const QueueStats _emptyStats = QueueStats(
    pending: 0,
    uploaded: 0,
    duplicate: 0,
    failed: 0,
  );

  bool _busy = false;
  bool _syncing = false;
  bool _discovering = false;
  bool _authRequired = false;
  PhotoPermission _permission = PhotoPermission.notDetermined;
  QueueStats _stats = _emptyStats;
  SyncReport? _lastReport;
  String? _error;
  AppSettings _settings = const AppSettings();

  /// Bumped whenever a queued asset's state may have changed; the library grid
  /// watches it to re-read the states of the page it shows.
  int _revision = 0;

  /// Shared by [backUpNow] and discovery so both accept the same containers.
  static const MediaFilter _filter = MediaFilter();

  /// Last [TransferProgress.completedTransfers] value already handled.
  int _completedTransfers = 0;

  /// Asset and phase the shell was last told about, so byte ticks stay silent.
  String? _progressAsset;

  TransferPhase _progressPhase = TransferPhase.idle;

  /// True while a progress-triggered stats reload is running.
  bool _reloadingStats = false;

  /// Most server thumbnails kept for the session; a couple of screenfuls.
  static const int _serverThumbCacheSize = 40;

  /// Session memo of server thumbnails, oldest insertion first.
  final Map<String, Uint8List?> _serverThumbs = <String, Uint8List?>{};

  /// The in-flight pass, so callers join instead of stacking passes.
  Future<void>? _pass;

  /// Bumped by [signOut] so an in-flight pass cannot restore stale state after
  /// the account it belongs to is gone.
  int _generation = 0;

  bool _observing = false;
  bool _disposed = false;

  @override
  bool get isSignedIn => auth.isSignedIn;

  @override
  bool get busy => _busy;

  @override
  bool get syncing => _syncing;

  @override
  bool get discovering => _discovering;

  @override
  bool get authRequired => _authRequired;

  @override
  PhotoPermission get permission => _permission;

  @override
  Future<void> refreshPermission() async {
    if (!auth.isSignedIn) return;
    final PhotoPermission permission;
    try {
      permission = await observer.ensurePermission();
    } on Object {
      // A platform refusal is not a crash; the gate keeps the last answer.
      return;
    }
    if (_disposed || permission == _permission) return;
    _permission = permission;
    _notify();
  }

  @override
  Future<List<MediaFolder>> folders() => observer.folders();

  @override
  Future<Uint8List?> thumbnail(String localId, {int size = 128}) =>
      observer.thumbnailFor(localId, size: size);

  @override
  Future<Uint8List?> preview(String localId) =>
      observer.thumbnailFor(localId, size: 1024);

  @override
  Future<BackupDetail> backupDetail(AssetCandidate asset) async {
    final row = await queue.byLocalId(asset.localId);
    return BackupDetail(
      // An unknown state string reads as "no row": a downgrade must not throw.
      status: resolveBackupStatus(
        state: row == null ? null : UploadState.values.asNameMap()[row.state],
        asset: asset,
        settings: _settings,
      ),
      error: row?.lastError,
    );
  }

  @override
  Future<File?> playableVideo(
    String localId, {
    void Function(double progress)? onProgress,
  }) => observer.playableVideo(localId, onProgress: onProgress);

  @override
  Future<List<AssetCandidate>> libraryPage({
    required int offset,
    int limit = 200,
    String? folderId,
  }) => observer.page(offset: offset, limit: limit, folderId: folderId);

  @override
  Future<int> libraryCount({String? folderId}) =>
      observer.libraryCount(folderId: folderId);

  @override
  Future<AlbumProgress> albumProgress(String folderId) => tallyAlbumProgress(
    count: () => observer.libraryCount(folderId: folderId),
    page: (offset, limit) =>
        observer.page(offset: offset, limit: limit, folderId: folderId),
    states: queue.statesFor,
    settings: _settings,
  );

  @override
  Future<Map<String, UploadState>> backupStates(List<String> localIds) =>
      queue.statesFor(localIds);

  @override
  Future<ServerAssetPage> serverPage({
    DateTime? dateTo,
    int offset = 0,
    int limit = ServerAssetsClient.maxLimit,
  }) => serverAssets.list(dateTo: dateTo, offset: offset, limit: limit);

  @override
  Future<Map<String, String>> serverIds(List<String> localIds) =>
      queue.serverIdsFor(localIds);

  @override
  Future<Uint8List?> serverThumb(String fileId) async {
    if (_serverThumbs.containsKey(fileId)) return _serverThumbs[fileId];
    final bytes = await serverAssets.thumbnail(fileId);
    _serverThumbs[fileId] = bytes;
    if (_serverThumbs.length > _serverThumbCacheSize) {
      _serverThumbs.remove(_serverThumbs.keys.first);
    }
    return bytes;
  }

  @override
  int get queueRevision => _revision;

  @override
  QueueStats get stats => _stats;

  @override
  SyncReport? get lastReport => _lastReport;

  @override
  String? get error => _error;

  @override
  AppSettings get settings => _settings;

  @override
  bool get paused => _settings.paused;

  @override
  Future<void> pause() async {
    if (_settings.paused) return;
    // Persisted first: the running pass reads the flag between assets.
    final next = _settings.copyWith(paused: true);
    await settingsStore.save(next);
    _settings = next;
    _notify();
  }

  @override
  Future<void> resume() async {
    if (_settings.paused) {
      final next = _settings.copyWith(paused: false);
      await settingsStore.save(next);
      _settings = next;
      _notify();
    }
    await syncNow();
  }

  /// Persists a server address typed on the sign-in form and retargets both
  /// transports, so this session and the next background isolate agree.
  Future<void> _applyServerUrl(String serverUrl) async {
    final target = normalizeServerUrl(serverUrl);
    if (target == null) return;
    // Applied even when unchanged: the transports may still carry the
    // compile-time default, and pointing them at the stored address is free.
    auth.baseUrl = target;
    api.baseUrl = target;
    if (target == _settings.apiBaseUrl) return;
    final next = _settings.copyWith(apiBaseUrl: target);
    await settingsStore.save(next);
    _settings = next;
  }

  @override
  Future<void> initialize() async {
    if (!_observing) {
      _observing = true;
      WidgetsBinding.instance.addObserver(this);
      auth.addListener(_onAuthChanged);
    }
    await auth.restore();
    _settings = await settingsStore.load();
    _stats = await queue.stats();
    _notify();
    if (auth.isSignedIn) {
      // Before the pass: a deleted album would otherwise scan nothing for it.
      await _pruneScope();
      // Before the pass: the library grid hides itself behind the permission
      // gate, and a pass over a large backlog takes minutes to report one.
      unawaited(refreshPermission());
    }
    if (auth.isSignedIn && !_settings.paused) {
      // Not awaited: the first frame must not wait for a full pass.
      unawaited(syncNow());
    }
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state != AppLifecycleState.resumed || !auth.isSignedIn) return;
    // Access can be granted or revoked in OS settings while the app sleeps.
    unawaited(refreshPermission());
    if (!_settings.paused) unawaited(syncNow());
  }

  @override
  Future<void> syncNow() {
    final inFlight = _pass;
    if (inFlight != null) return inFlight;
    if (!auth.isSignedIn) return Future<void>.value();
    final future = _runPass().whenComplete(() => _pass = null);
    _pass = future;
    return future;
  }

  @override
  Future<void> retryFailed() async {
    if (_busy) return;
    try {
      await queue.retryFailed();
    } on Object {
      _error = 'Could not requeue the failed items. Try again.';
      _notify();
      return;
    }
    _stats = await queue.stats();
    _revision++;
    _notify();
    await syncNow();
  }

  @override
  Future<void> backUpNow(List<AssetCandidate> assets) async {
    final eligible = assets
        .where(
          (asset) => _filter.isSupported(
            asset,
            includeVideos: _settings.includeVideos,
          ),
        )
        .toList(growable: false);
    if (eligible.isEmpty) return;

    try {
      await queue.enqueueAll(eligible);
      // A failed row keeps its state through enqueueAll, and a retrying row
      // keeps its backoff, so without this the tap would upload nothing.
      await queue.requeueNow(eligible.map((asset) => asset.localId));
    } on Object {
      _error = 'Could not queue those items. Try again.';
      _notify();
      return;
    }
    _stats = await queue.stats();
    _revision++;
    _notify();
    // A pass may already be past its upload loop; run one after it.
    await _syncAfterCurrent();
  }

  @override
  Future<void> signIn(String email, String password, String serverUrl) async {
    if (_busy) return;
    _busy = true;
    _error = null;
    _notify();

    var signedIn = false;
    String? scheduleError;
    try {
      await _applyServerUrl(serverUrl);
      await auth.signIn(email: email, password: password);
      // Only once the credentials were accepted: a typo must not cost the
      // previous session its queue. A new session still never inherits the old
      // account's work, so rows left by a sign-out that died halfway must not
      // upload to this account.
      await _wipeAccountData();
      _authRequired = false;
      signedIn = true;
      // signOut() cancels every scheduled task, so signing back in must
      // re-register them or background sync stays dead until a restart.
      try {
        await scheduler.updateSettings(_settings);
      } on Object {
        // The session is valid; a scheduler failure must never lose the login.
        scheduleError =
            'Signed in, but background sync could not be scheduled.';
      }
    } on AuthException catch (error) {
      // The server message ("Invalid credentials", ...) is what the login
      // screen shows; it is already phrased for the user.
      _error = error.message;
    } finally {
      _busy = false;
      _notify();
    }

    if (signedIn) {
      // Not awaited: the first frame must not wait for a full pass.
      unawaited(syncNow());
      if (scheduleError != null) {
        // Assigned after syncNow() because starting a pass clears `_error`;
        // the user must still see that scheduling failed.
        _error = scheduleError;
        _notify();
      }
    }
  }

  @override
  Future<void> signOut() async {
    if (_busy) return;
    _busy = true;
    _generation++;
    _notify();
    try {
      await auth.signOut();
      // Nothing should keep waking the device for a signed-out account.
      await scheduler.cancelAll();
      // The account is gone, so its queue, receipts, watermark and spooled
      // photo bytes go too; the next login starts from an empty library scan.
      await _wipeAccountData();
      _authRequired = false;
      _error = null;
      _lastReport = null;
      _stats = _emptyStats;
    } on Object {
      _error = 'Could not sign out. Try again.';
      rethrow;
    } finally {
      _busy = false;
      _notify();
    }
  }

  /// Forgets every trace of the account that just ended.
  ///
  /// Queue rows, part receipts, the scan watermark, the refresh lock and every
  /// spooled copy of a photo go. Preferences survive so the login screen still
  /// prefills the server address, except the pause flag: a stale pause would
  /// silently stop the next account's first pass.
  Future<void> _wipeAccountData() async {
    await queue.wipeAccountData();
    await clearSpool();
    progress.reset();
    // Another account's library will not share a single thumbnail.
    _serverThumbs.clear();
    _completedTransfers = 0;
    _progressAsset = null;
    _progressPhase = TransferPhase.idle;
    _lastReport = null;
    _permission = PhotoPermission.notDetermined;
    _stats = _emptyStats;
    _revision++;
    if (_settings.paused) {
      final next = _settings.copyWith(paused: false);
      await settingsStore.save(next);
      _settings = next;
    }
  }

  @override
  Future<void> updateSettings(AppSettings next) async {
    if (_busy) return;
    final scopeChanged = _scopeChanged(next);
    _busy = true;
    _notify();
    try {
      await settingsStore.save(next);
      // Constraints are enforced by the OS, never by Dart: re-register so
      // wifi/charging changes take effect on the next scheduled run.
      await scheduler.updateSettings(next);
      // Only expose the new settings once both the save and re-register
      // succeeded, so a failed write leaves the UI on the persisted values.
      _settings = next;
      if (scopeChanged) {
        await _resetScope();
      }
    } finally {
      _busy = false;
      _notify();
    }
    if (scopeChanged) {
      // Rows queued under the old scope would otherwise keep uploading.
      unawaited(_syncAfterCurrent());
    }
  }

  /// Drops stored album ids the device no longer has.
  ///
  /// Best-effort: a failing album listing leaves the stored scope alone,
  /// because guessing would shrink the backup set. [updateSettings] is the
  /// only write path so the watermark reset and rescan stay in one place.
  Future<void> _pruneScope() async {
    if (_settings.uploadAllFolders || _settings.uploadFolderIds.isEmpty) return;
    final List<MediaFolder> live;
    try {
      live = await observer.folders();
    } on Object {
      return;
    }
    final kept = pruneMissingFolders(_settings.uploadFolderIds, live);
    if (listEquals(kept, _settings.uploadFolderIds)) return;
    try {
      await updateSettings(_settings.copyWith(uploadFolderIds: kept));
    } on Object {
      // A cleanup that cannot be persisted must not stop a launch.
    }
  }

  /// True when [next] changes what discovery looks for: the album scope or
  /// whether videos count. Both need the watermark cleared, because assets the
  /// old settings skipped sit behind it.
  bool _scopeChanged(AppSettings next) =>
      next.uploadAllFolders != _settings.uploadAllFolders ||
      next.includeVideos != _settings.includeVideos ||
      !listEquals(next.uploadFolderIds, _settings.uploadFolderIds);

  /// Forgets queued work discovered under the previous folder scope.
  Future<void> _resetScope() async {
    // Empty parses back as "no watermark", so the new scope scans from zero.
    await queue.setMeta(SyncCoordinator.scanWatermarkKey, '');
    await queue.clearNonTerminal();
    _stats = await queue.stats();
    _revision++;
    _notify();
  }

  /// Runs a pass after any in-flight pass, because [syncNow] joins one instead
  /// of starting another.
  Future<void> _syncAfterCurrent() async {
    final inFlight = _pass;
    if (inFlight != null) await inFlight;
    await syncNow();
  }

  @override
  void dispose() {
    _disposed = true;
    coordinator.onDiscovery = null;
    progress.removeListener(_onProgress);
    auth.removeListener(_onAuthChanged);
    if (_observing) {
      WidgetsBinding.instance.removeObserver(this);
      _observing = false;
    }
    super.dispose();
  }

  Future<void> _runPass() async {
    final generation = _generation;
    _syncing = true;
    _error = null;
    _notify();
    try {
      final report = await coordinator.run();
      // A sign-out happened while the pass was running: its results describe
      // an account that is gone, so never write them back.
      if (generation != _generation) return;
      // Another isolate owns the queue right now and did nothing that this
      // pass could report; keep the state the last real pass left behind.
      if (report.alreadyRunning) return;
      final stats = await queue.stats();
      // Without this, a pass that scans nothing looks identical to one that
      // found nothing worth queueing.
      if (kDebugMode) debugPrint('photox pass: $report');
      _lastReport = report;
      _permission = report.permission;
      _authRequired = report.authRequired;
      final reportError = report.error;
      if (reportError != null && reportError.isNotEmpty) _error = reportError;
      _stats = stats;
    } on AuthException catch (error) {
      if (generation != _generation) return;
      _authRequired = true;
      _error = error.message;
    } on ApiException catch (error) {
      if (generation != _generation) return;
      if (error.isAuthError) {
        _authRequired = true;
        _error = error.message;
      } else {
        _error = 'Sync could not finish. Check your connection and try again.';
      }
    } on Object {
      if (generation != _generation) return;
      _error = 'Sync could not finish. Check your connection and try again.';
    } finally {
      _syncing = false;
      // Discovery and uploads both move rows, so the grid re-reads its page.
      _revision++;
      _notify();
    }
  }

  void _onAuthChanged() => _notify();

  /// Mirrors the coordinator's scan phase, so the dashboard shows "reading"
  /// instead of counts that still describe the previous folder scope.
  ///
  /// Discovery is what queues the new scope's rows, so the counts are re-read
  /// before the spinner goes away: they are correct the moment it ends.
  void _onDiscovery(bool discovering) {
    if (discovering == _discovering) return;
    if (discovering) {
      _discovering = true;
      _notify();
      return;
    }
    unawaited(_finishDiscovery());
  }

  Future<void> _finishDiscovery() async {
    try {
      _stats = await queue.stats();
    } on Object {
      // A queue read must never leave the dashboard stuck on a spinner.
    }
    _discovering = false;
    _revision++;
    _notify();
  }

  /// Forwards the start and end of a transfer to the shell and refreshes the
  /// counters when an asset finishes.
  ///
  /// Byte ticks are not forwarded: the widgets that draw them listen to
  /// [progress] directly, so a tick repaints a bar or a tile instead of the
  /// whole shell (and, before this, the entire library grid).
  void _onProgress() {
    final finished = progress.completedTransfers != _completedTransfers;
    if (finished) {
      _completedTransfers = progress.completedTransfers;
      unawaited(_reloadStats());
    }
    if (!finished &&
        progress.localId == _progressAsset &&
        progress.phase == _progressPhase) {
      return;
    }
    _progressAsset = progress.localId;
    _progressPhase = progress.phase;
    _notify();
  }

  Future<void> _reloadStats() async {
    if (_reloadingStats) return;
    _reloadingStats = true;
    try {
      _stats = await queue.stats();
      _revision++;
      _notify();
    } on Object {
      // A queue read must never escape into the progress listener.
    } finally {
      _reloadingStats = false;
    }
  }

  void _notify() {
    if (_disposed) return;
    notifyListeners();
  }
}
