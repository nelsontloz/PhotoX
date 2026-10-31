import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:drift/drift.dart' show driftRuntimeOptions;
import 'package:drift/native.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:photox_mobile/app_controller.dart';
import 'package:photox_mobile/background/scheduler.dart';
import 'package:photox_mobile/core/api_client.dart';
import 'package:photox_mobile/core/auth_manager.dart';
import 'package:photox_mobile/core/auth_models.dart';
import 'package:photox_mobile/core/refresh_lock.dart';
import 'package:photox_mobile/core/token_store.dart';
import 'package:photox_mobile/media/hasher.dart';
import 'package:photox_mobile/media/photo_observer.dart';
import 'package:photox_mobile/settings/settings_store.dart';
import 'package:photox_mobile/sync/sync_coordinator.dart';
import 'package:photox_mobile/sync/transfer_progress.dart';
import 'package:photox_mobile/upload/database.dart';
import 'package:photox_mobile/upload/models.dart';
import 'package:photox_mobile/upload/retry_policy.dart';
import 'package:photox_mobile/upload/transports.dart';
import 'package:photox_mobile/upload/upload_queue.dart';
import 'package:photox_mobile/upload/uploader.dart';
import 'package:workmanager/workmanager.dart';

/// Deterministic auth transport: the controller tests never open a socket.
class _StubAdapter implements HttpClientAdapter {
  _StubAdapter(this.onFetch);

  final Future<ResponseBody> Function(RequestOptions options) onFetch;

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) {
    return onFetch(options);
  }

  @override
  void close({bool force = false}) {}
}

/// Observer that always denies access, so a pass never reaches the network.
class _DeniedObserver implements PhotoObserver {
  int permissionCalls = 0;

  /// Album listing returned by [folders].
  List<MediaFolder> foldersValue = const <MediaFolder>[];

  /// When set, [ensurePermission] blocks until it completes so a test can
  /// interleave account actions with an in-flight pass.
  Completer<void>? gate;

  @override
  Future<PhotoPermission> ensurePermission() async {
    permissionCalls++;
    final pending = gate;
    if (pending != null) await pending.future;
    return PhotoPermission.denied;
  }

  @override
  Future<List<MediaFolder>> folders() async => foldersValue;

  @override
  Future<List<AssetCandidate>> scanNew({
    DateTime? since,
    List<String>? folderIds,
  }) async {
    throw StateError('a denied pass must not scan');
  }

  @override
  Future<File?> fileFor(String localId) async => null;

  @override
  Future<Uint8List?> thumbnailFor(String localId, {int size = 128}) async =>
      null;

  @override
  Stream<void> get changes => const Stream<void>.empty();

  @override
  Future<void> dispose() async {}
}

class _FailingUploadTransport implements UploadTransport {
  @override
  Future<List<DedupHit>> exists(List<DedupCheck> items) {
    throw StateError('a denied pass must not precheck');
  }

  @override
  Future<AssetSummary> uploadFile(
    File file,
    String originalName, {
    String? mimeType,
    String? title,
    String? description,
    DateTime? takenAt,
  }) {
    throw StateError('a denied pass must not upload');
  }
}

class _FailingSessionTransport implements SessionTransport {
  @override
  Future<void> abort(String uploadId) {
    throw StateError('a denied pass must not abort');
  }

  @override
  Future<UploadCompleteResult> complete(String uploadId) {
    throw StateError('a denied pass must not complete');
  }

  @override
  Future<CreateSessionResult> createSession({
    required String sha256Hex,
    required int sizeBytes,
    required String filename,
    DateTime? takenAt,
    String? title,
    String? description,
  }) {
    throw StateError('a denied pass must not create sessions');
  }

  @override
  Future<UploadSessionStatus> getStatus(String uploadId) {
    throw StateError('a denied pass must not poll sessions');
  }

  @override
  Future<void> putPart(
    String uploadId,
    int partIndex, {
    required List<int> bytes,
  }) {
    throw StateError('a denied pass must not put parts');
  }
}

class _FakeRegistrar implements WorkRegistrar {
  int initializeCalls = 0;
  bool failPeriodic = false;
  final List<Constraints> periodicConstraints = <Constraints>[];
  final List<String> cancelled = <String>[];

  @override
  Future<void> initialize(void Function() callbackDispatcher) async {
    initializeCalls++;
  }

  @override
  Future<void> registerPeriodicTask(
    String uniqueName,
    String taskName, {
    required Duration frequency,
    required Constraints constraints,
    required ExistingPeriodicWorkPolicy existingWorkPolicy,
  }) async {
    if (failPeriodic) throw StateError('scheduler unavailable');
    periodicConstraints.add(constraints);
  }

  @override
  Future<void> registerOneOffTask(
    String uniqueName,
    String taskName, {
    required Constraints constraints,
    required ExistingWorkPolicy existingWorkPolicy,
  }) async {}

  @override
  Future<void> registerProcessingTask(
    String uniqueName,
    String taskName, {
    required Constraints constraints,
  }) async {}

  @override
  Future<void> cancelByUniqueName(String uniqueName) async {
    cancelled.add(uniqueName);
  }
}

/// Settings store whose writes always fail, to prove a failed save never
/// purges queued work.
class _FailingSettingsStore extends SettingsStore {
  _FailingSettingsStore(super.db);

  @override
  Future<void> save(AppSettings settings) {
    throw StateError('settings write failed');
  }
}

AuthTokens _tokens() => AuthTokens(
  accessToken: 'access-1',
  refreshToken: 'refresh-1',
  accessExpiresAt: DateTime.now().add(const Duration(hours: 1)),
  user: AuthUser(
    id: 'user-1',
    email: 'user@example.com',
    role: 'user',
    displayName: 'Test User',
    createdAt: DateTime.utc(2026, 1, 1),
    updatedAt: DateTime.utc(2026, 1, 2),
  ),
);

AssetCandidate _assetCandidate(String localId) => AssetCandidate(
  localId: localId,
  platform: 'ios',
  kind: MediaKind.photo,
  fileName: '$localId.jpg',
  mimeType: 'image/jpeg',
  sizeBytes: 3,
);

Map<String, dynamic> _tokenPayload() => <String, dynamic>{
  'accessToken': 'access-1',
  'accessTokenExpiresIn': 3600,
  'refreshToken': 'refresh-1',
  'user': <String, dynamic>{
    'id': 'user-1',
    'email': 'user@example.com',
    'role': 'user',
    'displayName': 'Test User',
    'createdAt': '2026-01-01T00:00:00.000Z',
    'updatedAt': '2026-01-02T00:00:00.000Z',
  },
};

ResponseBody _json(int status, Object body) => ResponseBody.fromString(
  jsonEncode(body),
  status,
  headers: const <String, List<String>>{
    Headers.contentTypeHeader: <String>['application/json'],
  },
);

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUpAll(() {
    driftRuntimeOptions.dontWarnAboutMultipleDatabases = true;
  });

  late AppDatabase db;
  late MemoryTokenStore tokenStore;
  late Dio authDio;
  late AuthManager auth;
  late _DeniedObserver observer;
  late _FakeRegistrar registrar;
  late BackgroundScheduler scheduler;
  late SettingsStore settingsStore;
  late UploadQueue queue;
  late TransferProgress progress;
  late SyncCoordinator coordinator;
  late PhotoXController controller;

  var rejectLogin = false;

  setUp(() {
    rejectLogin = false;
    db = AppDatabase(NativeDatabase.memory());
    tokenStore = MemoryTokenStore();
    authDio = Dio()
      ..httpClientAdapter = _StubAdapter((options) async {
        switch (options.path) {
          case '/api/v1/auth/login':
            if (rejectLogin) {
              return _json(401, <String, dynamic>{
                'statusCode': 401,
                'message': 'Invalid credentials',
              });
            }
            return _json(200, _tokenPayload());
          case '/api/v1/auth/logout':
            return ResponseBody.fromString('', 204);
          default:
            return _json(404, <String, dynamic>{'message': 'not found'});
        }
      });
    auth = AuthManager(
      store: tokenStore,
      refreshLock: MemoryRefreshLock(),
      dio: authDio,
    );
    observer = _DeniedObserver();
    registrar = _FakeRegistrar();
    scheduler = BackgroundScheduler(registrar: registrar, isIOS: false);
    settingsStore = SettingsStore(db);
    queue = UploadQueue(db);
    progress = TransferProgress();
    final uploader = Uploader(
      queue: queue,
      uploadTransport: _FailingUploadTransport(),
      sessionTransport: _FailingSessionTransport(),
      hasher: const Hasher(),
      observer: observer,
    );
    coordinator = SyncCoordinator(
      queue: queue,
      observer: observer,
      uploader: uploader,
      settingsStore: settingsStore,
      dedupTransport: _FailingUploadTransport(),
      retryPolicy: RetryPolicy(jitter: 0),
    );
    controller = PhotoXController(
      auth: auth,
      api: ApiClient(auth: auth),
      queue: queue,
      coordinator: coordinator,
      settingsStore: settingsStore,
      scheduler: scheduler,
      observer: observer,
      progress: progress,
    );
  });

  tearDown(() async {
    controller.dispose();
    progress.dispose();
    await db.close();
  });

  test(
    'initialize stays signed out and runs no pass without a session',
    () async {
      await controller.initialize();

      expect(controller.isSignedIn, isFalse);
      expect(observer.permissionCalls, 0);
      expect(
        controller.stats,
        const QueueStats(pending: 0, uploaded: 0, duplicate: 0, failed: 0),
      );
      expect(controller.settings, const AppSettings());
      expect(controller.syncing, isFalse);
    },
  );

  test('folders delegates to the platform observer', () async {
    observer.foldersValue = const <MediaFolder>[
      MediaFolder(id: 'camera', name: 'Camera', assetCount: 3, isCamera: true),
      MediaFolder(id: 'screens', name: 'Screenshots', assetCount: 9),
    ];

    expect(await controller.folders(), observer.foldersValue);
  });

  test(
    'forwards progress ticks and refreshes counters on completion',
    () async {
      await queue.enqueue(
        const AssetCandidate(
          localId: 'asset-a',
          platform: 'ios',
          kind: MediaKind.photo,
          fileName: 'asset-a.jpg',
          mimeType: 'image/jpeg',
          sizeBytes: 3,
        ),
      );
      await controller.initialize();
      expect(controller.stats.pending, 1);
      expect(controller.stats.uploaded, 0);

      var notifications = 0;
      controller.addListener(() => notifications++);
      final before = notifications;

      progress.begin(
        localId: 'asset-a',
        fileName: 'asset-a.jpg',
        totalBytes: 3,
        phase: TransferPhase.uploading,
      );

      expect(controller.progress, same(progress));
      expect(controller.progress.active, isTrue);
      expect(notifications, greaterThan(before));

      await queue.markState(localId: 'asset-a', state: UploadState.uploaded);
      progress.finish();
      await pumpEventQueue();

      expect(controller.progress.active, isFalse);
      expect(controller.stats.uploaded, 1);
      expect(controller.stats.pending, 0);
    },
  );

  test('initialize with a stored session runs an immediate pass', () async {
    await tokenStore.write(_tokens());
    await queue.enqueue(
      const AssetCandidate(
        localId: 'asset-a',
        platform: 'ios',
        kind: MediaKind.photo,
        fileName: 'asset-a.jpg',
        mimeType: 'image/jpeg',
        sizeBytes: 3,
      ),
    );

    await controller.initialize();
    await controller.syncNow();

    expect(controller.isSignedIn, isTrue);
    expect(observer.permissionCalls, greaterThanOrEqualTo(1));
    expect(controller.permission, PhotoPermission.denied);
    expect(controller.lastReport, isNotNull);
    expect(controller.stats.pending, 1);
    expect(controller.syncing, isFalse);
    expect(controller.error, isNull);
  });

  test('syncNow joins a running pass instead of stacking', () async {
    await tokenStore.write(_tokens());
    await controller.initialize();
    await controller.syncNow();
    final drained = observer.permissionCalls;

    final first = controller.syncNow();
    final second = controller.syncNow();
    await Future.wait<void>(<Future<void>>[first, second]);

    expect(observer.permissionCalls, drained + 1);
  });

  test('signIn surfaces the server error and stays signed out', () async {
    rejectLogin = true;

    await controller.signIn('ada@example.com', 'wrong password', '');

    expect(controller.isSignedIn, isFalse);
    expect(controller.error, 'Invalid credentials');
    expect(controller.busy, isFalse);
    expect(observer.permissionCalls, 0);
  });

  test('signIn retargets both transports to a new server address', () async {
    await controller.signIn(
      'ada@example.com',
      'correct horse',
      ' https://photos.example.com/ ',
    );

    expect(controller.settings.apiBaseUrl, 'https://photos.example.com');
    expect(
      (await settingsStore.load()).apiBaseUrl,
      'https://photos.example.com',
      reason: 'the background isolate reads this on its next boot',
    );
    expect(authDio.options.baseUrl, 'https://photos.example.com');
    expect(controller.api.dio.options.baseUrl, 'https://photos.example.com');
  });

  test('signIn leaves the stored server alone for an unchanged or empty '
      'address', () async {
    await settingsStore.save(
      const AppSettings(apiBaseUrl: 'http://10.0.2.2:3000'),
    );
    await controller.initialize();
    final before = authDio.options.baseUrl;

    await controller.signIn('ada@example.com', 'correct horse', '');
    await controller.signIn('ada@example.com', 'correct horse', '10.0.2.2');

    expect(controller.settings.apiBaseUrl, 'http://10.0.2.2:3000');
    expect(
      authDio.options.baseUrl,
      before,
      reason: 'an empty or unparseable address must not retarget anything',
    );
  });

  test('signIn stores the session and starts a pass', () async {
    await controller.signIn('ada@example.com', 'correct horse', '');
    await controller.syncNow();

    expect(controller.isSignedIn, isTrue);
    expect(controller.error, isNull);
    expect(controller.busy, isFalse);
    expect(observer.permissionCalls, greaterThanOrEqualTo(1));
  });

  test('signIn after signOut re-registers the periodic task', () async {
    await tokenStore.write(_tokens());
    await controller.initialize();
    await controller.signOut();
    expect(registrar.cancelled, contains(BackgroundScheduler.periodicTask));
    final registrations = registrar.periodicConstraints.length;

    await controller.signIn('ada@example.com', 'correct horse', '');

    expect(controller.isSignedIn, isTrue);
    expect(controller.error, isNull);
    expect(registrar.periodicConstraints.length, registrations + 1);
  });

  test('signIn keeps the session when re-registration fails', () async {
    registrar.failPeriodic = true;

    await controller.signIn('ada@example.com', 'correct horse', '');

    expect(controller.isSignedIn, isTrue);
    expect(await tokenStore.read(), isNotNull);
    expect(controller.error, contains('background sync'));
    expect(controller.busy, isFalse);
  });

  test(
    'signOut clears the session, cancels schedules and resets counters',
    () async {
      await tokenStore.write(_tokens());
      await queue.enqueue(
        const AssetCandidate(
          localId: 'asset-a',
          platform: 'ios',
          kind: MediaKind.photo,
          fileName: 'asset-a.jpg',
          mimeType: 'image/jpeg',
          sizeBytes: 3,
        ),
      );
      await controller.initialize();
      await controller.syncNow();
      expect(controller.stats.pending, 1);

      await controller.signOut();

      expect(controller.isSignedIn, isFalse);
      expect(await tokenStore.read(), isNull);
      expect(registrar.cancelled, <String>[
        BackgroundScheduler.periodicTask,
        BackgroundScheduler.processingTask,
        BackgroundScheduler.oneOffTask,
      ]);
      expect(
        controller.stats,
        const QueueStats(pending: 0, uploaded: 0, duplicate: 0, failed: 0),
      );
      expect(controller.lastReport, isNull);
      expect(controller.authRequired, isFalse);
    },
  );

  test('updateSettings persists and re-registers the constraints', () async {
    await controller.updateSettings(
      const AppSettings(wifiOnly: false, chargingOnly: true),
    );

    expect(controller.settings.wifiOnly, isFalse);
    expect(controller.settings.chargingOnly, isTrue);
    final persisted = await settingsStore.load();
    expect(persisted.wifiOnly, isFalse);
    expect(persisted.chargingOnly, isTrue);

    expect(registrar.periodicConstraints, isNotEmpty);
    final constraints = registrar.periodicConstraints.last;
    expect(constraints.networkType, NetworkType.connected);
    expect(constraints.requiresCharging, isTrue);
  });

  test(
    'updateSettings keeps controller settings when re-register fails',
    () async {
      registrar.failPeriodic = true;

      await expectLater(
        controller.updateSettings(
          const AppSettings(wifiOnly: false, chargingOnly: true),
        ),
        throwsA(isA<StateError>()),
      );

      expect(controller.settings, const AppSettings());
      expect(controller.busy, isFalse);
    },
  );

  test(
    'changing the folder scope purges queued work and the watermark',
    () async {
      await tokenStore.write(_tokens());
      await queue.enqueueAll(<AssetCandidate>[
        _assetCandidate('uploaded'),
        _assetCandidate('pending'),
      ]);
      await queue.markState(localId: 'uploaded', state: UploadState.uploaded);
      await queue.markState(localId: 'pending', state: UploadState.pending);
      const watermark = '2026-10-19T12:00:00.000Z';
      await queue.setMeta(SyncCoordinator.scanWatermarkKey, watermark);
      await controller.initialize();
      await controller.syncNow();
      final passes = observer.permissionCalls;

      await controller.updateSettings(
        const AppSettings(uploadFolderIds: <String>['camera']),
      );
      await pumpEventQueue();

      expect(await queue.byLocalId('pending'), isNull);
      expect(
        (await queue.byLocalId('uploaded'))?.state,
        UploadState.uploaded.name,
      );
      expect(await queue.getMeta(SyncCoordinator.scanWatermarkKey), '');
      expect(controller.stats.pending, 0);
      expect(controller.stats.uploaded, 1);
      expect(observer.permissionCalls, passes + 1, reason: 'a pass kicks off');
    },
  );

  test('turning uploadAllFolders on purges queued work', () async {
    await queue.enqueue(_assetCandidate('pending'));
    await queue.markState(localId: 'pending', state: UploadState.pending);

    await controller.updateSettings(const AppSettings(uploadAllFolders: true));

    expect(await queue.byLocalId('pending'), isNull);
  });

  test(
    'turning includeVideos on purges queued work and the watermark',
    () async {
      await queue.enqueue(_assetCandidate('pending'));
      await queue.markState(localId: 'pending', state: UploadState.pending);
      const watermark = '2026-10-19T12:00:00.000Z';
      await queue.setMeta(SyncCoordinator.scanWatermarkKey, watermark);

      await controller.updateSettings(const AppSettings(includeVideos: true));

      expect(await queue.byLocalId('pending'), isNull);
      expect(await queue.getMeta(SyncCoordinator.scanWatermarkKey), '');
    },
  );

  test('an unrelated settings change keeps the queue and watermark', () async {
    await queue.enqueue(_assetCandidate('pending'));
    await queue.markState(localId: 'pending', state: UploadState.pending);
    const watermark = '2026-10-19T12:00:00.000Z';
    await queue.setMeta(SyncCoordinator.scanWatermarkKey, watermark);

    await controller.updateSettings(const AppSettings(wifiOnly: false));

    expect((await queue.byLocalId('pending'))?.state, UploadState.pending.name);
    expect(await queue.getMeta(SyncCoordinator.scanWatermarkKey), watermark);
  });

  test('a failed settings save does not purge queued work', () async {
    final scoped = PhotoXController(
      auth: auth,
      api: ApiClient(auth: auth),
      queue: queue,
      coordinator: coordinator,
      settingsStore: _FailingSettingsStore(db),
      scheduler: scheduler,
      observer: observer,
      progress: progress,
    );
    addTearDown(scoped.dispose);
    await queue.enqueue(_assetCandidate('pending'));
    await queue.markState(localId: 'pending', state: UploadState.pending);
    const watermark = '2026-10-19T12:00:00.000Z';
    await queue.setMeta(SyncCoordinator.scanWatermarkKey, watermark);

    await expectLater(
      scoped.updateSettings(
        const AppSettings(uploadFolderIds: <String>['camera']),
      ),
      throwsA(isA<StateError>()),
    );

    expect((await queue.byLocalId('pending'))?.state, UploadState.pending.name);
    expect(await queue.getMeta(SyncCoordinator.scanWatermarkKey), watermark);
  });

  test('signOut during an in-flight pass discards its stale results', () async {
    await tokenStore.write(_tokens());
    await queue.enqueue(
      const AssetCandidate(
        localId: 'asset-a',
        platform: 'ios',
        kind: MediaKind.photo,
        fileName: 'asset-a.jpg',
        mimeType: 'image/jpeg',
        sizeBytes: 3,
      ),
    );
    final gate = Completer<void>();
    observer.gate = gate;

    await controller.initialize();
    expect(controller.syncing, isTrue, reason: 'the pass is blocked');
    expect(controller.stats.pending, 1);

    await controller.signOut();
    expect(controller.lastReport, isNull);
    expect(
      controller.stats,
      const QueueStats(pending: 0, uploaded: 0, duplicate: 0, failed: 0),
    );

    gate.complete();
    await controller.syncNow();

    expect(controller.lastReport, isNull, reason: 'stale report discarded');
    expect(
      controller.stats,
      const QueueStats(pending: 0, uploaded: 0, duplicate: 0, failed: 0),
      reason: 'stale stats discarded',
    );
    expect(controller.authRequired, isFalse);
    expect(controller.syncing, isFalse);
  });

  test('resume triggers a foreground pass', () async {
    await tokenStore.write(_tokens());
    await controller.initialize();
    await controller.syncNow();
    final drained = observer.permissionCalls;

    controller.didChangeAppLifecycleState(AppLifecycleState.resumed);
    await controller.syncNow();

    expect(observer.permissionCalls, drained + 1);
  });
}
