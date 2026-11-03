import 'app_controller.dart';
import 'background/scheduler.dart';
import 'core/api_client.dart';
import 'core/auth_manager.dart';
import 'core/refresh_lock.dart';
import 'core/token_store.dart';
import 'media/hasher.dart';
import 'media/photo_manager_observer.dart';
import 'media/photo_observer.dart';
import 'server/server_assets_client.dart';
import 'settings/settings_store.dart';
import 'sync/sync_coordinator.dart';
import 'sync/transfer_progress.dart';
import 'upload/database.dart';
import 'upload/retry_policy.dart';
import 'upload/session_client.dart';
import 'upload/transports.dart';
import 'upload/upload_queue.dart';
import 'upload/uploader.dart';

/// Wired object graph for one isolate.
///
/// The UI isolate calls [initialize]; the Workmanager callback uses
/// [initializeBackground]. Both isolates share the same drift database file;
/// refresh rotation and the sync pass are each serialized through a
/// [DriftRefreshLock], so the two never rotate the token pair in parallel and
/// never run two passes over the same queue.
///
/// Call exactly one of the builders once per isolate and [dispose] it when the
/// isolate is done.
class AppServices {
  AppServices({
    required this.db,
    required this.queue,
    required this.auth,
    required this.api,
    required this.sessions,
    required this.serverAssets,
    required this.observer,
    required this.coordinator,
    required this.scheduler,
    this.controller,
  });

  /// Shared drift database (queue, settings, refresh lock).
  final AppDatabase db;

  /// Persistence facade over [db] used by the upload pipeline.
  final UploadQueue queue;

  /// Token owner; one instance per isolate, serialized across isolates by the
  /// drift refresh lock.
  final AuthManager auth;

  /// Signed transport for the core API.
  final ApiClient api;

  /// Resumable session client layered on [api].
  final SessionClient sessions;

  /// The server's own asset library, for the merged grid.
  final ServerAssetsClient serverAssets;

  /// Platform media discovery.
  final PhotoObserver observer;

  /// Discovery + upload pass runner.
  final SyncCoordinator coordinator;

  /// OS background schedules.
  final BackgroundScheduler scheduler;

  /// UI-facing controller; null in the background isolate.
  final PhotoXController? controller;

  /// Builds the UI-isolate graph and completes [PhotoXController.initialize].
  ///
  /// [database], [auth], [observer] and [scheduler] are construction seams for
  /// tests; production callers pass none of them.
  static Future<AppServices> initialize({
    AppDatabase? database,
    AuthManager? auth,
    PhotoObserver? observer,
    BackgroundScheduler? scheduler,
  }) async {
    final db = database ?? AppDatabase();
    final services = _build(
      withController: true,
      database: db,
      baseUrl: await _baseUrl(db),
      auth: auth,
      observer: observer,
      scheduler: scheduler,
    );
    await services.controller!.initialize();
    return services;
  }

  /// Builds the background-worker graph: same stack minus everything that
  /// only makes sense with a UI (controller, lifecycle observer).
  static Future<AppServices> initializeBackground({
    AppDatabase? database,
    AuthManager? auth,
    PhotoObserver? observer,
  }) async {
    final db = database ?? AppDatabase();
    return _build(
      withController: false,
      database: db,
      // The worker isolate must hit the same server the user configured.
      baseUrl: await _baseUrl(db),
      auth: auth,
      observer: observer,
    );
  }

  /// Server the user configured at setup, or null to fall back to
  /// [AppConfig.apiBaseUrl] (nothing stored yet).
  static Future<String?> _baseUrl(AppDatabase db) async {
    final url = (await SettingsStore(db).load()).apiBaseUrl;
    return url.isEmpty ? null : url;
  }

  bool _disposed = false;

  /// Releases the platform resources held by this graph.
  ///
  /// The secure storage and the auth transport need no explicit teardown; the
  /// API pools connections, PhotoKit/MediaStore keeps a change callback,
  /// SQLite keeps the file handle and the auth manager owns listeners, so all
  /// of them are released here. Idempotent: tests may dispose the graph twice.
  Future<void> dispose() async {
    if (_disposed) return;
    _disposed = true;
    controller?.dispose();
    api.close();
    await observer.dispose();
    await db.close();
    auth.dispose();
  }

  static AppServices _build({
    required bool withController,
    String? baseUrl,
    AppDatabase? database,
    AuthManager? auth,
    PhotoObserver? observer,
    BackgroundScheduler? scheduler,
  }) {
    final db = database ?? AppDatabase();
    final authManager =
        auth ??
        AuthManager(
          store: SecureTokenStore(),
          refreshLock: DriftRefreshLock(db),
          baseUrl: baseUrl,
        );
    final progress = TransferProgress();
    final api = ApiClient(
      auth: authManager,
      baseUrl: baseUrl,
      progress: progress,
    );
    final sessions = SessionClient(api);
    final serverAssets = ServerAssetsClient(api);
    final mediaObserver = observer ?? PhotoManagerObserver();
    final queue = UploadQueue(db);
    final settingsStore = SettingsStore(db);
    final uploader = Uploader(
      queue: queue,
      uploadTransport: ApiUploadTransport(api),
      sessionTransport: SessionApiTransport(sessions),
      hasher: const Hasher(),
      observer: mediaObserver,
      progress: progress,
    );
    final coordinator = SyncCoordinator(
      queue: queue,
      observer: mediaObserver,
      uploader: uploader,
      settingsStore: settingsStore,
      dedupTransport: ApiUploadTransport(api),
      retryPolicy: RetryPolicy(),
      // One pass at a time across isolates: the UI and the Workmanager task
      // share this queue, so a second pass would upload the same assets.
      passLock: DriftRefreshLock(db, namespace: 'sync', lockKey: 'pass'),
    );
    final backgroundScheduler = scheduler ?? BackgroundScheduler();
    return AppServices(
      db: db,
      queue: queue,
      auth: authManager,
      api: api,
      sessions: sessions,
      serverAssets: serverAssets,
      observer: mediaObserver,
      coordinator: coordinator,
      scheduler: backgroundScheduler,
      controller: withController
          ? PhotoXController(
              auth: authManager,
              api: api,
              queue: queue,
              coordinator: coordinator,
              settingsStore: settingsStore,
              scheduler: backgroundScheduler,
              observer: mediaObserver,
              progress: progress,
              serverAssets: serverAssets,
            )
          : null,
    );
  }
}
