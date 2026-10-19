import 'dart:convert';
import 'dart:io';

import 'package:drift/drift.dart' show driftRuntimeOptions;
import 'package:drift/native.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:photox_mobile/core/api_client.dart';
import 'package:photox_mobile/media/hasher.dart';
import 'package:photox_mobile/media/photo_observer.dart';
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
  late DateTime now;

  setUp(() async {
    temp = await Directory.systemTemp.createTemp('photox-sync-test-');
    db = AppDatabase(NativeDatabase.memory());
    queue = UploadQueue(db);
    settings = SettingsStore(db);
    observer = _FakeObserver();
    transport = _FakeTransport();
    now = DateTime.utc(2026, 10, 19, 12);
  });

  tearDown(() async {
    await db.close();
    if (await temp.exists()) await temp.delete(recursive: true);
  });

  SyncCoordinator makeCoordinator({Uploader? uploader}) {
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
    );
  }

  Future<List<int>> seed(
    String localId, {
    DateTime? takenAt,
    DateTime? modifiedAt,
    String fileName = 'asset.jpg',
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

  test('uses one batch dedup call for the whole batch', () async {
    await seed('a');
    await seed('b');
    await seed('c');

    final report = await makeCoordinator().run();

    expect(report.uploaded, 3);
    expect(transport.existsRequests, hasLength(1));
    expect(transport.existsRequests.single, hasLength(3));
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

  test('with backfill disabled starts at now and skips old assets', () async {
    await settings.save(const AppSettings(backfill: false));
    await seed(
      'asset-old',
      takenAt: now.subtract(const Duration(days: 2)),
      modifiedAt: now.subtract(const Duration(days: 1)),
    );

    final report = await makeCoordinator().run();

    expect(observer.lastSince, now);
    expect(report.scanned, 0);
    expect(report.enqueued, 0);
    expect(await db.select(db.queuedAssets).get(), isEmpty);
    expect(
      await queue.getMeta(SyncCoordinator.scanWatermarkKey),
      now.toIso8601String(),
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

class _FakeObserver implements PhotoObserver {
  PhotoPermission permission = PhotoPermission.authorized;
  final List<AssetCandidate> candidates = <AssetCandidate>[];
  final Map<String, File> files = <String, File>{};
  DateTime? lastSince;
  int scanCalls = 0;

  @override
  Future<PhotoPermission> ensurePermission() async => permission;

  @override
  Future<List<AssetCandidate>> scanNew({DateTime? since}) async {
    scanCalls++;
    lastSince = since;
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
  Stream<void> get changes => const Stream<void>.empty();

  @override
  Future<void> dispose() async {}
}

class _FakeTransport implements UploadTransport {
  final Map<String, DedupHit> hits = <String, DedupHit>{};
  final List<List<DedupCheck>> existsRequests = <List<DedupCheck>>[];
  int uploadCalls = 0;
  Object? uploadError;

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
    String? mimeHint,
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
