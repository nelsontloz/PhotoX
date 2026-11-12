import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:drift/drift.dart' show driftRuntimeOptions;
import 'package:drift/native.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:photox_mobile/core/api_client.dart';
import 'package:photox_mobile/core/network_status.dart';
import 'package:photox_mobile/core/refresh_lock.dart';
import 'package:photox_mobile/media/hasher.dart';
import 'package:photox_mobile/media/photo_observer.dart';
import 'package:photox_mobile/server/album_client.dart';
import 'package:photox_mobile/settings/settings_store.dart';
import 'package:photox_mobile/sync/sync_coordinator.dart';
import 'package:photox_mobile/upload/database.dart';
import 'package:photox_mobile/upload/models.dart';
import 'package:photox_mobile/upload/retry_policy.dart';
import 'package:photox_mobile/upload/transports.dart';
import 'package:photox_mobile/upload/upload_queue.dart';
import 'package:photox_mobile/upload/uploader.dart';

void main() {
  setUpAll(() {
    driftRuntimeOptions.dontWarnAboutMultipleDatabases = true;
  });

  late Directory temp;
  late AppDatabase db;
  late UploadQueue queue;
  late SettingsStore settings;
  late _FakeObserver observer;
  late _FakeTransport transport;
  late _FakeNetwork network;
  late DateTime now;

  setUp(() async {
    temp = await Directory.systemTemp.createTemp('photox-sync-test-');
    db = AppDatabase(NativeDatabase.memory());
    queue = UploadQueue(db);
    settings = SettingsStore(db);
    observer = _FakeObserver();
    transport = _FakeTransport();
    network = _FakeNetwork();
    now = DateTime.utc(2026, 10, 19, 12);
  });

  tearDown(() async {
    await db.close();
    if (await temp.exists()) await temp.delete(recursive: true);
  });

  SyncCoordinator makeCoordinator({
    Uploader? uploader,
    RefreshLock? passLock,
    AlbumClient? albumClient,
  }) {
    final pipeline =
        uploader ??
        Uploader(
          queue: queue,
          uploadTransport: transport,
          sessionTransport: _NoopSessionTransport(),
          hasher: const Hasher(),
          observer: observer,
          spoolDirectory: '${temp.path}/spool',
          thresholdBytes: 1024,
        );
    return SyncCoordinator(
      queue: queue,
      observer: observer,
      uploader: pipeline,
      settingsStore: settings,
      dedupTransport: transport,
      retryPolicy: RetryPolicy(jitter: 0),
      clock: () => now,
      network: network,
      albumClient: albumClient,
      passLock: passLock,
    );
  }

  Future<List<int>> seed(
    String localId, {
    DateTime? takenAt,
    DateTime? modifiedAt,
    String fileName = 'asset.jpg',
    String? folderId,
  }) async {
    final bytes = utf8.encode('bytes-$localId');
    final source = File('${temp.path}/$localId.source');
    await source.writeAsBytes(bytes);
    observer.files[localId] = source;
    observer.candidates.add(
      AssetCandidate(
        localId: localId,
        platform: 'ios',
        kind: MediaKind.photo,
        fileName: fileName,
        mimeType: 'image/jpeg',
        sizeBytes: bytes.length,
        takenAt: takenAt,
        modifiedAt: modifiedAt,
        folderId: folderId,
      ),
    );
    return bytes;
  }

  test('returns without work when permission is denied', () async {
    observer.permission = PhotoPermission.denied;
    await seed('asset-a');

    final report = await makeCoordinator().run();

    expect(report.permission, PhotoPermission.denied);
    expect(report.scanned, 0);
    expect(report.enqueued, 0);
    expect(observer.scanCalls, 0);
    expect(await db.select(db.queuedAssets).get(), isEmpty);
  });

  test('flags the discovery phase around the scan, then clears it', () async {
    await seed('asset-a');
    final seen = <bool>[];
    final coordinator = makeCoordinator()..onDiscovery = seen.add;

    await coordinator.run();

    expect(seen, <bool>[true, false]);
    expect(await db.select(db.queuedAssets).get(), isNotEmpty);
  });

  test('clears the discovery flag when the scan throws', () async {
    await seed('asset-a');
    observer.scanError = StateError('library unavailable');
    final seen = <bool>[];
    final coordinator = makeCoordinator()..onDiscovery = seen.add;

    final report = await coordinator.run();

    expect(report.error, contains('library unavailable'));
    expect(seen, <bool>[true, false]);
  });

  test('a second pass over the same queue is skipped, never raced', () async {
    await seed('asset-a');
    final first = makeCoordinator(passLock: DriftRefreshLock(db));
    final second = makeCoordinator(passLock: DriftRefreshLock(db));

    // The UI isolate starts a pass; the background isolate asks for one too.
    final running = first.run();
    final other = await second.run();

    expect(other.alreadyRunning, isTrue);
    expect(other.scanned, 0);

    final report = await running;
    expect(report.alreadyRunning, isFalse);
    expect(report.uploaded, 1);
    expect(observer.scanCalls, 1, reason: 'a skipped pass reads nothing');
    expect(transport.uploadCalls, 1);
    expect(
      (await queue.byLocalId('asset-a'))?.state,
      UploadState.uploaded.name,
    );
  });

  test('does nothing at all while paused', () async {
    await settings.save(const AppSettings(paused: true));
    await seed('asset-a');

    final report = await makeCoordinator().run();

    expect(report.paused, isTrue);
    expect(observer.scanCalls, 0);
    expect(transport.uploadCalls, 0);
    expect(await db.select(db.queuedAssets).get(), isEmpty);
  });

  test('holds uploads on a metered link when wifiOnly is on', () async {
    await seed('asset-a');
    network.unmetered = false;

    final report = await makeCoordinator().run();

    // Discovery is local, so the asset is queued; only the upload waits.
    expect(report.waitingForWifi, isTrue);
    expect(report.enqueued, 1);
    expect(report.uploaded, 0);
    expect(transport.uploadCalls, 0);
    expect((await queue.byLocalId('asset-a'))?.state, 'discovered');
  });

  test('uploads on a metered link when wifiOnly is off', () async {
    await settings.save(const AppSettings(wifiOnly: false));
    network.unmetered = false;
    await seed('asset-a');

    final report = await makeCoordinator().run();

    expect(report.waitingForWifi, isFalse);
    expect(report.uploaded, 1);
  });

  test('a pause persisted mid-pass stops before the next asset', () async {
    await seed('asset-a');
    await seed('asset-b');
    // Flip the flag as soon as the first asset is hashed and in flight.
    transport.onUpload = () => settings.save(const AppSettings(paused: true));

    final report = await makeCoordinator().run();

    expect(report.paused, isTrue);
    expect(report.uploaded, lessThan(2));
    expect((await queue.byLocalId('asset-b'))?.state, isNot('uploaded'));
  });

  test('scans, enqueues and uploads new assets', () async {
    final taken = DateTime.utc(2026, 10, 18, 9);
    final modified = DateTime.utc(2026, 10, 18, 10);
    await seed('asset-a', takenAt: taken, modifiedAt: modified);
    await seed('asset-b', takenAt: taken, modifiedAt: modified);

    final report = await makeCoordinator().run();

    expect(report.permission, PhotoPermission.authorized);
    expect(report.scanned, 2);
    expect(report.enqueued, 2);
    expect(report.uploaded, 2);
    expect(report.duplicates, 0);
    expect(report.remaining, 0);
    expect(observer.lastSince, isNull);
    expect(transport.uploadCalls, 2);

    final rows = await db.select(db.queuedAssets).get();
    expect(rows, hasLength(2));
    expect(rows.every((row) => row.state == UploadState.uploaded.name), isTrue);
    expect(
      await queue.getMeta(SyncCoordinator.scanWatermarkKey),
      modified.toIso8601String(),
    );
  });

  test('defaults the scan scope to the camera album', () async {
    await seed('asset-a');
    observer.foldersValue = const <MediaFolder>[
      MediaFolder(id: 'screens', name: 'Screenshots', assetCount: 50),
      MediaFolder(id: 'camera', name: 'Camera', assetCount: 2, isCamera: true),
    ];

    await makeCoordinator().run();

    expect(observer.lastFolderIds, <String>['camera']);
    expect(observer.folderCalls, 1);
  });

  test('falls back to the whole library when no album is flagged', () async {
    await seed('asset-a');
    observer.foldersValue = const <MediaFolder>[
      MediaFolder(id: 'screens', name: 'Screenshots', assetCount: 2),
    ];

    await makeCoordinator().run();

    expect(observer.lastFolderIds, isNull);
  });

  test('scans exactly the chosen albums', () async {
    await settings.save(
      const AppSettings(uploadFolderIds: <String>['album-a', 'album-b']),
    );
    await seed('asset-a');

    await makeCoordinator().run();

    expect(observer.lastFolderIds, <String>['album-a', 'album-b']);
    expect(observer.folderCalls, 0, reason: 'a choice skips the camera lookup');
  });

  test('uploadAllFolders scans the whole library', () async {
    await settings.save(
      const AppSettings(
        uploadAllFolders: true,
        uploadFolderIds: <String>['album-a'],
      ),
    );
    await seed('asset-a');

    await makeCoordinator().run();

    expect(observer.lastFolderIds, isNull);
    expect(observer.folderCalls, 0);
  });

  test('a broken album listing falls back to the whole library', () async {
    await seed('asset-a');
    observer.foldersError = StateError('no photo library');

    final report = await makeCoordinator().run();

    expect(observer.lastFolderIds, isNull);
    expect(report.enqueued, 1);
  });

  test('marks a dedup hit with an existing asset uploaded', () async {
    final bytes = await seed('asset-dedup');
    transport.hits[Hasher.sha256OfBytes(bytes)] = const DedupHit(
      checksumSha256: '',
      exists: true,
      existingAssetId: 'existing-asset',
      existingFileId: 'existing-file',
    );

    final report = await makeCoordinator().run();

    expect(report.uploaded, 1);
    expect(report.duplicates, 0);
    expect(transport.uploadCalls, 0);
    final row = (await queue.byLocalId('asset-dedup'))!;
    expect(row.state, UploadState.uploaded.name);
    expect(row.serverAssetId, 'existing-asset');
    expect(row.serverFileId, 'existing-file');
  });

  test('schedules a retryable failure with Retry-After', () async {
    await seed('asset-retry');
    transport.uploadError = const ApiException(
      statusCode: 500,
      message: 'boom',
      retryAfter: Duration(seconds: 5),
    );

    final report = await makeCoordinator().run();

    final row = (await queue.byLocalId('asset-retry'))!;
    expect(row.state, UploadState.failedRetryable.name);
    expect(row.attempts, 1);
    expect(row.nextAttemptAt!.toUtc(), now.add(const Duration(seconds: 5)));
    expect(report.remaining, 1);
    expect(report.uploaded, 0);
  });

  test('stops on 401 and reports authRequired', () async {
    await seed('asset-auth');
    transport.uploadError = const ApiException(
      statusCode: 401,
      message: 'access token expired',
    );

    final report = await makeCoordinator().run();

    expect(report.authRequired, isTrue);
    expect(
      (await queue.byLocalId('asset-auth'))!.state,
      UploadState.pending.name,
    );
  });

  test('pre-checks one asset just before uploading it', () async {
    await seed('a');
    await seed('b');
    await seed('c');

    final report = await makeCoordinator().run();

    expect(report.uploaded, 3);
    expect(transport.existsRequests, hasLength(3));
    expect(
      transport.existsRequests.every((request) => request.length == 1),
      isTrue,
    );
  });

  test('prepares each asset right before it uploads it', () async {
    await seed('first');
    await seed('second');

    final uploader = _RecordingUploader(
      queue: queue,
      uploadTransport: transport,
      sessionTransport: _NoopSessionTransport(),
      hasher: const Hasher(),
      observer: observer,
      spoolDirectory: '${temp.path}/spool',
      thresholdBytes: 1024,
    );

    await makeCoordinator(uploader: uploader).run();

    expect(uploader.calls, <String>[
      'prepare:first',
      'process:first',
      'prepare:second',
      'process:second',
    ]);
  });

  test('does not create a watermark when nothing was scanned', () async {
    final report = await makeCoordinator().run();

    expect(report.scanned, 0);
    expect(await queue.getMeta(SyncCoordinator.scanWatermarkKey), isNull);
  });

  test('preserves the previous watermark on an empty scan', () async {
    final previous = now.subtract(const Duration(hours: 2));
    await queue.setMeta(
      SyncCoordinator.scanWatermarkKey,
      previous.toUtc().toIso8601String(),
    );

    final report = await makeCoordinator().run();

    expect(report.scanned, 0);
    expect(observer.lastSince, previous);
    expect(
      await queue.getMeta(SyncCoordinator.scanWatermarkKey),
      previous.toIso8601String(),
    );
  });

  test('derives the watermark from eligible candidates only', () async {
    final eligibleTaken = DateTime.utc(2026, 10, 17, 9);
    final eligibleModified = DateTime.utc(2026, 10, 17, 10);
    await seed(
      'eligible',
      takenAt: eligibleTaken,
      modifiedAt: eligibleModified,
    );

    final rawBytes = utf8.encode('not a supported container');
    final rawFile = File('${temp.path}/raw.source');
    await rawFile.writeAsBytes(rawBytes);
    observer.files['raw-asset'] = rawFile;
    observer.candidates.add(
      AssetCandidate(
        localId: 'raw-asset',
        platform: 'ios',
        kind: MediaKind.photo,
        fileName: 'raw.dng',
        mimeType: 'image/x-adobe-dng',
        sizeBytes: rawBytes.length,
        takenAt: DateTime.utc(2026, 10, 19, 11),
        modifiedAt: DateTime.utc(2026, 10, 19, 11),
      ),
    );

    final report = await makeCoordinator().run();

    expect(report.scanned, 2);
    expect(report.enqueued, 1);
    expect(
      await queue.getMeta(SyncCoordinator.scanWatermarkKey),
      eligibleModified.toIso8601String(),
    );
  });

  test('honours the upload budget without losing queued work', () async {
    await seed('budget-a');
    await seed('budget-b');

    final report = await makeCoordinator().run(budget: Duration.zero);

    expect(report.scanned, 2);
    expect(report.enqueued, 2);
    expect(report.uploaded, 0);
    expect(report.remaining, 2);
    expect(transport.existsRequests, isEmpty);
    expect(transport.uploadCalls, 0);
  });

  test('reuses the stored watermark on the next pass', () async {
    final firstTimestamp = now.subtract(const Duration(hours: 1));
    await seed('first', takenAt: firstTimestamp, modifiedAt: firstTimestamp);
    final first = await makeCoordinator().run();
    expect(first.uploaded, 1);
    final watermark = await queue.getMeta(SyncCoordinator.scanWatermarkKey);

    now = now.add(const Duration(minutes: 10));
    await seed('second', takenAt: now, modifiedAt: now);
    final second = await makeCoordinator().run();

    expect(observer.lastSince?.toIso8601String(), watermark);
    expect(second.enqueued, 1);
    expect(second.uploaded, 1);
    expect(second.remaining, 0);
  });

  test('PARTS_PENDING requeues without incrementing attempts', () async {
    await seed('asset-parts');
    final uploader = _ScriptedUploader(
      queue: queue,
      uploadTransport: transport,
      sessionTransport: _NoopSessionTransport(),
      hasher: const Hasher(),
      observer: observer,
      spoolDirectory: '${temp.path}/spool',
      thresholdBytes: 1024,
    );

    final report = await makeCoordinator(uploader: uploader).run();

    expect(uploader.processCalls, 2);
    final observed = uploader.rowAfterPartsPending!;
    expect(observed.state, UploadState.pending.name);
    expect(observed.attempts, 0);
    expect(observed.nextAttemptAt, isNull);
    expect(observed.lastError, isNull);
    expect(
      (await queue.byLocalId('asset-parts'))!.state,
      UploadState.uploaded.name,
    );
    expect(report.uploaded, 1);
    expect(report.remaining, 0);
  });

  group('album linking', () {
    test('links a fresh upload to its folder album', () async {
      final albums = _FakeAlbumClient();
      await settings.save(
        const AppSettings(folderAlbums: <String, String>{'camera': 'album-1'}),
      );
      await seed('asset-a', folderId: 'camera');

      final report = await makeCoordinator(albumClient: albums).run();

      expect(report.uploaded, 1);
      expect(report.linked, 1);
      expect(albums.addedAssets['album-1'], <String>['server-asset.jpg']);
      expect((await queue.byLocalId('asset-a'))!.albumLinkedAt, isNotNull);
    });

    test('links a dedup hit exactly like a fresh upload', () async {
      final albums = _FakeAlbumClient();
      await settings.save(
        const AppSettings(folderAlbums: <String, String>{'camera': 'album-1'}),
      );
      final bytes = await seed('asset-dedup', folderId: 'camera');
      transport.hits[Hasher.sha256OfBytes(bytes)] = const DedupHit(
        checksumSha256: '',
        exists: true,
        existingAssetId: 'existing-asset',
        existingFileId: 'existing-file',
      );

      await makeCoordinator(albumClient: albums).run();

      expect(transport.uploadCalls, 0);
      expect(albums.addedAssets['album-1'], <String>['existing-asset']);
      expect((await queue.byLocalId('asset-dedup'))!.albumLinkedAt, isNotNull);
    });

    test('an unmapped folder never reaches the album client', () async {
      final albums = _FakeAlbumClient();
      await seed('asset-a', folderId: 'screens');

      await makeCoordinator(albumClient: albums).run();

      expect(albums.addedAssets, isEmpty);
      expect((await queue.byLocalId('asset-a'))!.albumLinkedAt, isNull);
    });

    test('sweeps rows uploaded before the mapping existed', () async {
      final albums = _FakeAlbumClient();
      await seed('asset-old', folderId: 'camera');
      await makeCoordinator(albumClient: albums).run();
      expect(albums.addedAssets, isEmpty);

      await settings.save(
        const AppSettings(folderAlbums: <String, String>{'camera': 'album-1'}),
      );
      final report = await makeCoordinator(albumClient: albums).run();

      expect(report.uploaded, 0, reason: 'nothing is left to upload');
      expect(albums.addedAssets['album-1'], <String>['server-asset.jpg']);
      expect((await queue.byLocalId('asset-old'))!.albumLinkedAt, isNotNull);
    });

    test(
      'a deleted album drops the mapping and keeps the pass quiet',
      () async {
        final albums = _FakeAlbumClient()
          ..error = const ApiException(
            statusCode: 404,
            message: 'Album not found',
          )
          ..albumExists = false;
        await settings.save(
          const AppSettings(
            folderAlbums: <String, String>{'camera': 'album-1'},
          ),
        );
        await seed('asset-a', folderId: 'camera');

        final report = await makeCoordinator(albumClient: albums).run();

        expect(report.uploaded, 1, reason: 'the upload itself succeeded');
        expect(report.linked, 0, reason: 'nothing joined a deleted album');
        expect(report.error, isNull);
        expect((await settings.load()).folderAlbums, isEmpty);
        expect(albums.existsCalls, 1);
        expect(
          albums.addCalls,
          hasLength(1),
          reason: 'a gone album is never retried per asset',
        );
        expect((await queue.byLocalId('asset-a'))!.albumLinkedAt, isNotNull);
      },
    );

    test(
      'retries per asset when a batch 404s but the album is alive',
      () async {
        final albums = _FakeAlbumClient()..deadAssets.add('server-gone.jpg');
        await settings.save(
          const AppSettings(
            folderAlbums: <String, String>{'camera': 'album-1'},
          ),
        );
        await seed('asset-dead', fileName: 'gone.jpg', folderId: 'camera');
        await seed('asset-live', fileName: 'live.jpg', folderId: 'camera');

        final report = await makeCoordinator(albumClient: albums).run();

        expect(report.uploaded, 2);
        expect(report.error, isNull);
        expect(albums.existsCalls, 1);
        expect(albums.addCalls, hasLength(3), reason: 'one batch plus two ids');
        expect(albums.addedAssets['album-1'], <String>['server-live.jpg']);
        expect(
          report.linked,
          1,
          reason: 'only the live asset actually joined the album',
        );
        expect((await settings.load()).folderAlbums, <String, String>{
          'camera': 'album-1',
        });
        expect(
          (await queue.byLocalId('asset-dead'))!.albumLinkedAt,
          isNotNull,
          reason: 'a gone asset can never join and must not stay in the sweep',
        );
        expect((await queue.byLocalId('asset-live'))!.albumLinkedAt, isNotNull);
      },
    );

    test('a failed album call leaves the row for the next pass', () async {
      final albums = _FakeAlbumClient()
        ..error = const ApiException(message: 'offline');
      await settings.save(
        const AppSettings(folderAlbums: <String, String>{'camera': 'album-1'}),
      );
      await seed('asset-a', folderId: 'camera');

      final report = await makeCoordinator(albumClient: albums).run();

      expect(report.error, isNull);
      expect(report.linked, 0);
      expect(albums.existsCalls, 0, reason: 'only a 404 asks about the album');
      expect((await queue.byLocalId('asset-a'))!.albumLinkedAt, isNull);
      expect((await settings.load()).folderAlbums, <String, String>{
        'camera': 'album-1',
      });
    });

    test(
      'adoptFolder attributes uploaded rows without uploading them',
      () async {
        await seed('asset-a');
        final first = await makeCoordinator().run();
        expect(first.uploaded, 1);
        final watermark = await queue.getMeta(SyncCoordinator.scanWatermarkKey);
        expect((await queue.byLocalId('asset-a'))!.folderId, isNull);
        final uploads = transport.uploadCalls;

        // The mapping exists now and the platform reports which album it is in.
        observer.candidates.clear();
        await seed('asset-a', folderId: 'camera');

        await makeCoordinator().adoptFolder('camera');

        final row = (await queue.byLocalId('asset-a'))!;
        expect(row.folderId, 'camera');
        expect(row.state, UploadState.uploaded.name);
        expect(transport.uploadCalls, uploads);
        expect(
          await queue.getMeta(SyncCoordinator.scanWatermarkKey),
          watermark,
        );
        expect(observer.lastSince, isNull);
        expect(observer.lastFolderIds, <String>['camera']);
      },
    );
  });
}

class _ScriptedUploader extends Uploader {
  _ScriptedUploader({
    required super.queue,
    required super.uploadTransport,
    required super.sessionTransport,
    required super.hasher,
    required super.observer,
    super.spoolDirectory,
    super.thresholdBytes,
  });

  int processCalls = 0;
  QueuedAsset? rowAfterPartsPending;

  @override
  Future<PreparedUpload> prepare(QueuedAsset item) async {
    return PreparedUpload(
      localId: item.localId,
      sha256: 'a' * 64,
      spoolPath: '/nonexistent/${item.localId}',
      sizeBytes: 1,
      protocol: UploadProtocol.single,
      fileName: item.fileName ?? 'asset.jpg',
      mimeType: item.mimeType,
    );
  }

  @override
  Future<UploadOutcome> process(
    QueuedAsset item, {
    DedupHit? prechecked,
    int? maxParts,
  }) async {
    if (processCalls++ == 0) {
      throw const UploadFailure(
        message: 'parts remain',
        retryable: true,
        code: 'PARTS_PENDING',
      );
    }
    rowAfterPartsPending = (await queue.byLocalId(item.localId))!;
    await queue.markState(
      localId: item.localId,
      state: UploadState.uploaded,
      serverAssetId: 'server-asset',
      serverFileId: 'server-file',
    );
    return const UploadOutcome(
      state: UploadState.uploaded,
      serverAssetId: 'server-asset',
      serverFileId: 'server-file',
    );
  }
}

/// Records the coordinator's per-asset call order; the upload itself is real.
class _RecordingUploader extends Uploader {
  _RecordingUploader({
    required super.queue,
    required super.uploadTransport,
    required super.sessionTransport,
    required super.hasher,
    required super.observer,
    super.spoolDirectory,
    super.thresholdBytes,
  });

  final List<String> calls = <String>[];
  bool _inProcess = false;

  @override
  Future<PreparedUpload> prepare(QueuedAsset item) async {
    // `process` re-prepares to reuse the spool; only the coordinator's own call
    // is the one whose position this test pins.
    if (!_inProcess) calls.add('prepare:${item.localId}');
    return super.prepare(item);
  }

  @override
  Future<UploadOutcome> process(
    QueuedAsset item, {
    DedupHit? prechecked,
    int? maxParts,
  }) async {
    calls.add('process:${item.localId}');
    _inProcess = true;
    try {
      return await super.process(
        item,
        prechecked: prechecked,
        maxParts: maxParts,
      );
    } finally {
      _inProcess = false;
    }
  }
}

class _FakeAlbumClient implements AlbumClient {
  /// album id -> asset ids posted to it, in call order.
  final Map<String, List<String>> addedAssets = <String, List<String>>{};

  /// Every add call, including the per-id retries, in call order.
  final List<List<String>> addCalls = <List<String>>[];

  /// Asset ids the server no longer has: a batch containing one 404s.
  final Set<String> deadAssets = <String>{};

  /// When set, every add throws it, standing in for the server.
  Object? error;

  /// Whether [exists] reports the album as still there.
  bool albumExists = true;

  int existsCalls = 0;

  @override
  ApiClient get api => throw StateError('the fake never talks HTTP');

  @override
  Future<List<ServerAlbum>> list() async => const <ServerAlbum>[];

  @override
  Future<ServerAlbum> create(String name, {required bool hiddenFromTimeline}) {
    throw StateError('the fake creates nothing');
  }

  @override
  Future<bool> exists(String albumId) async {
    existsCalls++;
    return albumExists;
  }

  @override
  Future<void> addAssets(String albumId, List<String> assetIds) async {
    addCalls.add(List<String>.of(assetIds));
    final failure = error;
    if (failure != null) throw failure;
    if (assetIds.any(deadAssets.contains)) {
      throw const ApiException(statusCode: 404, message: 'Asset not found');
    }
    addedAssets.putIfAbsent(albumId, () => <String>[]).addAll(assetIds);
  }
}

class _FakeObserver implements PhotoObserver {
  PhotoPermission permission = PhotoPermission.authorized;
  final List<AssetCandidate> candidates = <AssetCandidate>[];
  final Map<String, File> files = <String, File>{};
  final Map<String, Uint8List> thumbnails = <String, Uint8List>{};
  List<MediaFolder> foldersValue = const <MediaFolder>[];
  Object? foldersError;
  Object? scanError;
  DateTime? lastSince;
  List<String>? lastFolderIds;
  int scanCalls = 0;
  int folderCalls = 0;

  @override
  Future<PhotoPermission> ensurePermission() async => permission;

  @override
  Future<List<MediaFolder>> folders() async {
    folderCalls++;
    final error = foldersError;
    if (error != null) throw error;
    return foldersValue;
  }

  @override
  Future<List<AssetCandidate>> page({
    required int offset,
    required int limit,
    String? folderId,
  }) async => const <AssetCandidate>[];

  @override
  Future<int> libraryCount({String? folderId}) async => 0;

  @override
  Future<List<AssetCandidate>> scanNew({
    DateTime? since,
    List<String>? folderIds,
  }) async {
    scanCalls++;
    lastSince = since;
    lastFolderIds = folderIds;
    final error = scanError;
    if (error != null) throw error;
    if (since == null) return List<AssetCandidate>.of(candidates);
    return candidates
        .where(
          (candidate) =>
              candidate.takenAt == null || candidate.takenAt!.isAfter(since),
        )
        .toList(growable: false);
  }

  @override
  Future<File?> fileFor(String localId) async => files[localId];

  @override
  Future<File?> playableVideo(
    String localId, {
    void Function(double progress)? onProgress,
  }) async => null;

  @override
  Future<Uint8List?> thumbnailFor(String localId, {int size = 128}) async =>
      thumbnails[localId];

  @override
  Future<void> dispose() async {}
}

class _FakeNetwork implements NetworkStatus {
  bool unmetered = true;
  int checks = 0;

  @override
  Future<bool> isUnmetered() async {
    checks++;
    return unmetered;
  }
}

class _FakeTransport implements UploadTransport {
  final Map<String, DedupHit> hits = <String, DedupHit>{};
  final List<List<DedupCheck>> existsRequests = <List<DedupCheck>>[];
  int uploadCalls = 0;
  Object? uploadError;

  /// Runs after each successful upload, to observe mid-pass changes.
  Future<void> Function()? onUpload;

  @override
  Future<List<DedupHit>> exists(List<DedupCheck> items) async {
    existsRequests.add(List<DedupCheck>.of(items));
    return <DedupHit>[
      for (final item in items)
        if (hits.containsKey(item.checksumSha256))
          DedupHit(
            checksumSha256: item.checksumSha256,
            exists: true,
            existingFileId: hits[item.checksumSha256]!.existingFileId,
            existingAssetId: hits[item.checksumSha256]!.existingAssetId,
          ),
    ];
  }

  @override
  Future<AssetSummary> uploadFile(
    File file,
    String originalName, {
    String? mimeType,
    String? title,
    String? description,
    DateTime? takenAt,
  }) async {
    uploadCalls++;
    final error = uploadError;
    if (error != null) throw error;
    final hook = onUpload;
    if (hook != null) await hook();
    return AssetSummary(
      id: 'server-$originalName',
      fileId: 'file-$originalName',
    );
  }
}

class _NoopSessionTransport implements SessionTransport {
  @override
  Future<void> abort(String uploadId) async {}

  @override
  Future<UploadCompleteResult> complete(String uploadId) {
    throw StateError('session path is not used by these tests');
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
    throw StateError('session path is not used by these tests');
  }

  @override
  Future<UploadSessionStatus> getStatus(String uploadId) {
    throw StateError('session path is not used by these tests');
  }

  @override
  Future<void> putPart(
    String uploadId,
    int partIndex, {
    required List<int> bytes,
  }) {
    throw StateError('session path is not used by these tests');
  }
}
