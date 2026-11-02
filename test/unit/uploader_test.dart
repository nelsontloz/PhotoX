import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:drift/drift.dart' show driftRuntimeOptions;
import 'package:drift/native.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:photox_mobile/core/api_client.dart';
import 'package:photox_mobile/media/hasher.dart';
import 'package:photox_mobile/media/photo_observer.dart';
import 'package:photox_mobile/upload/database.dart';
import 'package:photox_mobile/upload/models.dart';
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
  late _FakeObserver observer;
  late _FakeUploadTransport uploads;
  late _FakeSessionTransport sessions;

  setUp(() async {
    temp = await Directory.systemTemp.createTemp('photox-uploader-test-');
    db = AppDatabase(NativeDatabase.memory());
    queue = UploadQueue(db);
    observer = _FakeObserver();
    uploads = _FakeUploadTransport();
    sessions = _FakeSessionTransport();
  });

  tearDown(() async {
    await db.close();
    if (await temp.exists()) await temp.delete(recursive: true);
  });

  Uploader makeUploader({int threshold = 64, int maxPartsPerPass = 8}) {
    return Uploader(
      queue: queue,
      uploadTransport: uploads,
      sessionTransport: sessions,
      hasher: const Hasher(),
      observer: observer,
      spoolDirectory: '${temp.path}/spool',
      thresholdBytes: threshold,
      maxPartsPerPass: maxPartsPerPass,
    );
  }

  Future<QueuedAsset> enqueue(
    String localId,
    List<int> bytes, {
    String fileName = 'asset.jpg',
  }) async {
    final source = File('${temp.path}/$localId.source');
    await source.writeAsBytes(bytes);
    observer.files[localId] = source;
    await queue.enqueue(_candidate(localId, bytes.length, fileName));
    return (await queue.byLocalId(localId))!;
  }

  Future<UploadFailure> captureFailure(Future<Object?> future) async {
    try {
      await future;
    } on UploadFailure catch (failure) {
      return failure;
    }
    fail('expected an UploadFailure');
  }

  group('prepare', () {
    test('spools the exact bytes, hashes them and persists first', () async {
      final bytes = utf8.encode('PhotoX exact bytes');
      final item = await enqueue('prepare-1', bytes);
      final uploader = makeUploader();

      final prepared = await uploader.prepare(item);

      expect(prepared.sizeBytes, bytes.length);
      expect(prepared.sha256, Hasher.sha256OfBytes(bytes));
      expect(prepared.protocol, UploadProtocol.single);
      expect(await File(prepared.spoolPath).readAsBytes(), bytes);

      final row = (await queue.byLocalId('prepare-1'))!;
      expect(row.state, UploadState.pending.name);
      expect(row.sha256, prepared.sha256);
      expect(row.spoolPath, prepared.spoolPath);
      expect(row.protocol, UploadProtocol.single.name);
    });

    test('reuses a matching spool without touching the source again', () async {
      final bytes = utf8.encode('reusable spool');
      final item = await enqueue('prepare-2', bytes);
      final uploader = makeUploader();

      final first = await uploader.prepare(item);
      final modified = await File(first.spoolPath).lastModified();
      final second = await uploader.prepare(
        (await queue.byLocalId('prepare-2'))!,
      );

      expect(second.spoolPath, first.spoolPath);
      expect(second.sha256, first.sha256);
      expect(await File(first.spoolPath).lastModified(), modified);
    });

    test(
      're-copies the source when the reused spool no longer matches',
      () async {
        final bytes = utf8.encode('reusable spool');
        final item = await enqueue('prepare-3', bytes);
        final uploader = makeUploader();

        final first = await uploader.prepare(item);
        // Same length, different content: what a crash mid-write can leave behind.
        await File(first.spoolPath)
            .writeAsBytes(List<int>.filled(bytes.length, 120));

        final second = await uploader.prepare(
          (await queue.byLocalId('prepare-3'))!,
        );

        expect(second.sha256, Hasher.sha256OfBytes(bytes));
        expect(await File(second.spoolPath).readAsBytes(), bytes);
      },
    );
  });

  group('single upload path', () {
    test('persists uploading before the request and marks uploaded', () async {
      final bytes = utf8.encode('small asset');
      final item = await enqueue('single-1', bytes);
      String? stateDuringRequest;
      List<int>? sentBytes;

      uploads.onUpload = (file, originalName) async {
        stateDuringRequest = (await queue.byLocalId('single-1'))!.state;
        sentBytes = await file.readAsBytes();
        expect(originalName, 'asset.jpg');
        return const AssetSummary(id: 'server-asset', fileId: 'server-file');
      };

      final outcome = await makeUploader().process(item);

      expect(stateDuringRequest, UploadState.uploading.name);
      expect(sentBytes, bytes);
      expect(outcome.state, UploadState.uploaded);
      expect(outcome.serverAssetId, 'server-asset');
      expect(outcome.serverFileId, 'server-file');

      final row = (await queue.byLocalId('single-1'))!;
      expect(row.state, UploadState.uploaded.name);
      expect(row.serverAssetId, 'server-asset');
      expect(row.serverFileId, 'server-file');
      expect(row.sha256, Hasher.sha256OfBytes(bytes));
      expect(await File(row.spoolPath!).exists(), isFalse);
    });

    test('treats 409 as already backed up and deletes the spool', () async {
      final item = await enqueue('single-409', utf8.encode('duplicate'));
      uploads.onUpload = (file, originalName) async {
        throw const ApiException(
          statusCode: 409,
          message: 'file already exists',
          existingAssetId: 'existing-asset',
          existingFileId: 'existing-file',
        );
      };

      final outcome = await makeUploader().process(item);

      expect(outcome.state, UploadState.duplicate);
      expect(outcome.serverAssetId, 'existing-asset');
      expect(outcome.serverFileId, 'existing-file');
      final row = (await queue.byLocalId('single-409'))!;
      expect(row.state, UploadState.duplicate.name);
      expect(row.serverAssetId, 'existing-asset');
      expect(row.serverFileId, 'existing-file');
      expect(await File(row.spoolPath!).exists(), isFalse);
    });

    test('maps 413 to skippedQuota terminal state', () async {
      final item = await enqueue('single-413', utf8.encode('quota'));
      uploads.onUpload = (file, originalName) async {
        throw const ApiException(
          statusCode: 413,
          message: 'storage quota exceeded',
          code: 'QUOTA_EXCEEDED',
        );
      };

      final failure = await captureFailure(makeUploader().process(item));

      expect(failure.retryable, isFalse);
      expect(failure.terminalState, UploadState.skippedQuota);
      expect(
        (await queue.byLocalId('single-413'))!.state,
        UploadState.skippedQuota.name,
      );
    });

    test(
      'maps a 413 without the quota envelope to a visible failure',
      () async {
        // A tunnel or proxy body cap answers 413 with no core envelope; that is
        // not the account being full, so it must not be filed as quota.
        final item = await enqueue('single-proxy-413', utf8.encode('too big'));
        uploads.onUpload = (file, originalName) async {
          throw const ApiException(
            statusCode: 413,
            message: 'Payload Too Large',
          );
        };

        final failure = await captureFailure(makeUploader().process(item));

        expect(failure.retryable, isFalse);
        expect(failure.code, 'HTTP_413');
        expect(failure.terminalState, UploadState.failedPermanent);
        expect(
          (await queue.byLocalId('single-proxy-413'))!.state,
          UploadState.failedPermanent.name,
        );
      },
    );

    test('maps 500 to a retryable UploadFailure with Retry-After', () async {
      final item = await enqueue('single-500', utf8.encode('server error'));
      uploads.onUpload = (file, originalName) async {
        throw const ApiException(
          statusCode: 500,
          message: 'boom',
          retryAfter: Duration(seconds: 7),
        );
      };

      final failure = await captureFailure(makeUploader().process(item));

      expect(failure.retryable, isTrue);
      expect(failure.retryAfter, const Duration(seconds: 7));
      expect(failure.code, 'HTTP_500');
      // No terminal state is persisted; the coordinator schedules the retry.
      expect(
        (await queue.byLocalId('single-500'))!.state,
        UploadState.uploading.name,
      );
    });

    test('maps 422 to failedPermanent', () async {
      final item = await enqueue('single-422', utf8.encode('bad'));
      uploads.onUpload = (file, originalName) async {
        throw const ApiException(statusCode: 422, message: 'invalid asset');
      };

      final failure = await captureFailure(makeUploader().process(item));

      expect(failure.terminalState, UploadState.failedPermanent);
      final row = (await queue.byLocalId('single-422'))!;
      expect(row.state, UploadState.failedPermanent.name);
      // A terminal row never retries those bytes, so the spool is dropped.
      expect(await File(row.spoolPath!).exists(), isFalse);
    });
  });

  group('session upload path', () {
    test('creates a session, uploads every part and completes', () async {
      final bytes = List<int>.generate(10, (index) => index);
      final item = await enqueue('session-1', bytes);
      sessions
        ..chunkSize = 4
        ..totalParts = 3;
      final uploader = makeUploader(threshold: 4);

      final outcome = await uploader.process(item);

      expect(sessions.createCalls, 1);
      expect(sessions.createdFilenames.single, 'asset.jpg');
      expect(sessions.putCalls, <String>[
        'upload-1:0',
        'upload-1:1',
        'upload-1:2',
      ]);
      expect(sessions.completeCalls, 1);
      expect(outcome.state, UploadState.uploaded);
      expect(outcome.serverAssetId, 'asset-upload-1');
      expect(outcome.serverFileId, 'file-upload-1');

      final row = (await queue.byLocalId('session-1'))!;
      expect(row.state, UploadState.uploaded.name);
      expect(row.uploadId, 'upload-1');
      expect(row.partSize, 4);
      expect(row.partCount, 3);
      expect(row.protocol, UploadProtocol.session.name);
      expect(await File(row.spoolPath!).exists(), isFalse);
    });

    test('resumes from server status and skips received parts', () async {
      final bytes = List<int>.generate(10, (index) => index);
      final item = await enqueue('session-resume', bytes);
      sessions
        ..chunkSize = 4
        ..totalParts = 3;
      final uploader = makeUploader(threshold: 4);
      await uploader.prepare(item);
      await queue.markState(
        localId: 'session-resume',
        state: UploadState.uploading,
        uploadId: 'upload-1',
        partSize: 4,
        partCount: 3,
        protocol: UploadProtocol.session,
      );
      sessions.partsByUpload['upload-1'] = <int>{0, 2};

      final outcome = await uploader.process(
        (await queue.byLocalId('session-resume'))!,
      );

      expect(sessions.statusCalls, 1);
      expect(sessions.putCalls, <String>['upload-1:1']);
      expect(sessions.completeCalls, 1);
      expect(outcome.state, UploadState.uploaded);
    });

    test('fills parts after a 409 PARTS_MISSING from complete', () async {
      final bytes = List<int>.generate(10, (index) => index);
      final item = await enqueue('session-gap', bytes);
      sessions
        ..chunkSize = 4
        ..totalParts = 3
        ..dropPartsOnce.add(1);
      final uploader = makeUploader(threshold: 4);

      final outcome = await uploader.process(item);

      expect(outcome.state, UploadState.uploaded);
      expect(sessions.completeCalls, 2);
      expect(sessions.putCalls, <String>[
        'upload-1:0',
        'upload-1:1',
        'upload-1:2',
        'upload-1:1',
      ]);
    });

    test('recreates an expired session once', () async {
      final bytes = List<int>.generate(10, (index) => index);
      final item = await enqueue('session-expired', bytes);
      sessions
        ..chunkSize = 4
        ..totalParts = 3
        ..expired.add('expired-1');
      final uploader = makeUploader(threshold: 4);
      await uploader.prepare(item);
      await queue.markState(
        localId: 'session-expired',
        state: UploadState.uploading,
        uploadId: 'expired-1',
        partSize: 4,
        partCount: 3,
        protocol: UploadProtocol.session,
      );
      await queue.recordPartAck(uploadId: 'expired-1', partIndex: 0, bytes: 4);

      final outcome = await uploader.process(
        (await queue.byLocalId('session-expired'))!,
      );

      expect(sessions.createCalls, 1);
      expect(sessions.putCalls, <String>[
        'upload-1:0',
        'upload-1:1',
        'upload-1:2',
      ]);
      expect(outcome.state, UploadState.uploaded);
      expect((await queue.byLocalId('session-expired'))!.uploadId, 'upload-1');
      expect(await queue.partsFor('expired-1'), isEmpty);
    });

    test('maps 409 SESSION_LIMIT to a retryable failure', () async {
      await enqueue('session-limit', List<int>.filled(10, 0));
      sessions.createError = const ApiException(
        statusCode: 409,
        message: 'too many open sessions',
        code: 'SESSION_LIMIT',
        retryAfter: Duration(seconds: 3),
      );

      final failure = await captureFailure(
        makeUploader(threshold: 4)
            .process((await queue.byLocalId('session-limit'))!),
      );

      expect(failure.retryable, isTrue);
      expect(failure.code, 'SESSION_LIMIT');
      expect(failure.retryAfter, const Duration(seconds: 3));
      expect(failure.terminalState, isNull);
    });

    test(
      'aborts the session and deletes the spool on terminal failure',
      () async {
        final bytes = List<int>.generate(10, (index) => index);
        final uploader = makeUploader(threshold: 4);
        await enqueue('session-terminal', bytes);
        await uploader.prepare((await queue.byLocalId('session-terminal'))!);
        await queue.markState(
          localId: 'session-terminal',
          state: UploadState.uploading,
          uploadId: 'upload-1',
          partSize: 4,
          partCount: 3,
          protocol: UploadProtocol.session,
        );
        sessions.statusError = const ApiException(
          statusCode: 400,
          message: 'session is unusable',
        );

        final failure = await captureFailure(
          uploader.process((await queue.byLocalId('session-terminal'))!),
        );

        expect(failure.retryable, isFalse);
        expect(failure.code, 'HTTP_400');
        final row = (await queue.byLocalId('session-terminal'))!;
        expect(row.state, UploadState.failedPermanent.name);
        expect(row.errorCode, 'HTTP_400');
        expect(sessions.aborted, <String>['upload-1']);
        expect(await File(row.spoolPath!).exists(), isFalse);
      },
    );

    test(
      'an abort failure does not mask the original upload failure',
      () async {
        final bytes = List<int>.generate(10, (index) => index);
        final uploader = makeUploader(threshold: 4);
        await enqueue('session-abort-fails', bytes);
        await uploader.prepare((await queue.byLocalId('session-abort-fails'))!);
        await queue.markState(
          localId: 'session-abort-fails',
          state: UploadState.uploading,
          uploadId: 'upload-1',
          partSize: 4,
          partCount: 3,
          protocol: UploadProtocol.session,
        );
        sessions.statusError = const ApiException(
          statusCode: 422,
          message: 'invalid asset',
        );
        sessions.abortError = StateError('abort endpoint is down');

        final failure = await captureFailure(
          uploader.process((await queue.byLocalId('session-abort-fails'))!),
        );

        expect(failure.code, 'HTTP_422');
        expect(failure.retryable, isFalse);
        expect(
          (await queue.byLocalId('session-abort-fails'))!.state,
          UploadState.failedPermanent.name,
        );
      },
    );

    test('failed session status is terminal and sends no parts', () async {
      final bytes = List<int>.generate(10, (index) => index);
      final uploader = makeUploader(threshold: 4);
      await enqueue('session-failed-status', bytes);
      await uploader.prepare((await queue.byLocalId('session-failed-status'))!);
      await queue.markState(
        localId: 'session-failed-status',
        state: UploadState.uploading,
        uploadId: 'upload-1',
        partSize: 4,
        partCount: 3,
        protocol: UploadProtocol.session,
      );
      sessions.failedStatus.add('upload-1');

      final failure = await captureFailure(
        uploader.process((await queue.byLocalId('session-failed-status'))!),
      );

      expect(failure.retryable, isFalse);
      expect(failure.code, 'UNSUPPORTED_TYPE');
      expect(failure.terminalState, UploadState.failedPermanent);
      expect(sessions.putCalls, isEmpty);
      expect(sessions.completeCalls, 0);
      final row = (await queue.byLocalId('session-failed-status'))!;
      expect(row.state, UploadState.failedPermanent.name);
      expect(row.errorCode, 'UNSUPPORTED_TYPE');
      expect(sessions.aborted, contains('upload-1'));
      expect(await File(row.spoolPath!).exists(), isFalse);
    });

    test('maxParts 0 sends every part in one attempt', () async {
      final bytes = List<int>.generate(10, (index) => index);
      await enqueue('session-uncapped', bytes);
      sessions
        ..chunkSize = 4
        ..totalParts = 3;
      final uploader = makeUploader(threshold: 4, maxPartsPerPass: 1);

      final outcome = await uploader.process(
        (await queue.byLocalId('session-uncapped'))!,
        maxParts: 0,
      );

      expect(outcome.state, UploadState.uploaded);
      expect(sessions.putCalls, <String>[
        'upload-1:0',
        'upload-1:1',
        'upload-1:2',
      ]);
      expect(sessions.completeCalls, 1);
    });

    test('stops after maxPartsPerPass and resumes next pass', () async {
      final bytes = List<int>.generate(10, (index) => index);
      await enqueue('session-cap', bytes);
      sessions
        ..chunkSize = 4
        ..totalParts = 3;
      final uploader = makeUploader(threshold: 4, maxPartsPerPass: 1);

      final first = await captureFailure(
        uploader.process((await queue.byLocalId('session-cap'))!),
      );
      expect(first.retryable, isTrue);
      expect(first.code, 'PARTS_PENDING');
      expect(sessions.completeCalls, 0);
      expect(sessions.putCalls, <String>['upload-1:0']);

      final second = await captureFailure(
        uploader.process((await queue.byLocalId('session-cap'))!),
      );
      expect(second.code, 'PARTS_PENDING');
      expect(sessions.putCalls, <String>['upload-1:0', 'upload-1:1']);

      final outcome = await uploader.process(
        (await queue.byLocalId('session-cap'))!,
      );
      expect(outcome.state, UploadState.uploaded);
      expect(sessions.putCalls, <String>[
        'upload-1:0',
        'upload-1:1',
        'upload-1:2',
      ]);
      expect(sessions.completeCalls, 1);
    });
  });

  group('prechecked dedup', () {
    test(
      'marks a hit with an existing asset uploaded without upload',
      () async {
        final item = await enqueue('precheck-1', utf8.encode('bytes'));
        final prepared = await makeUploader().prepare(item);

        final outcome = await makeUploader().process(
          (await queue.byLocalId('precheck-1'))!,
          prechecked: DedupHit(
            checksumSha256: prepared.sha256,
            exists: true,
            existingAssetId: 'asset-existing',
            existingFileId: 'file-existing',
          ),
        );

        expect(outcome.state, UploadState.uploaded);
        expect(uploads.uploadCalls, 0);
        final row = (await queue.byLocalId('precheck-1'))!;
        expect(row.state, UploadState.uploaded.name);
        expect(row.serverAssetId, 'asset-existing');
        expect(row.serverFileId, 'file-existing');
        expect(await File(row.spoolPath!).exists(), isFalse);
      },
    );

    test(
      'falls through to upload when the file exists without an asset',
      () async {
        final item = await enqueue('precheck-no-asset', utf8.encode('bytes'));
        final prepared = await makeUploader().prepare(item);

        final outcome = await makeUploader().process(
          (await queue.byLocalId('precheck-no-asset'))!,
          prechecked: DedupHit(
            checksumSha256: prepared.sha256,
            exists: true,
            existingFileId: 'file-existing',
          ),
        );

        expect(uploads.uploadCalls, 1);
        expect(outcome.state, UploadState.uploaded);
        final row = (await queue.byLocalId('precheck-no-asset'))!;
        expect(row.state, UploadState.uploaded.name);
        expect(row.serverAssetId, 'server-asset');
        expect(await File(row.spoolPath!).exists(), isFalse);
      },
    );
  });
}

AssetCandidate _candidate(String localId, int sizeBytes, String fileName) {
  return AssetCandidate(
    localId: localId,
    platform: 'ios',
    kind: MediaKind.photo,
    fileName: fileName,
    mimeType: 'image/jpeg',
    sizeBytes: sizeBytes,
    takenAt: DateTime.utc(2026, 10, 18, 9),
    modifiedAt: DateTime.utc(2026, 10, 18, 10),
  );
}

class _FakeObserver implements PhotoObserver {
  final Map<String, File> files = <String, File>{};

  @override
  Future<PhotoPermission> ensurePermission() async =>
      PhotoPermission.authorized;

  @override
  Future<List<AssetCandidate>> scanNew({
    DateTime? since,
    List<String>? folderIds,
  }) async => const <AssetCandidate>[];

  @override
  Future<List<MediaFolder>> folders() async => const <MediaFolder>[];

  @override
  Future<List<AssetCandidate>> page({
    required int offset,
    required int limit,
    String? folderId,
  }) async => const <AssetCandidate>[];

  @override
  Future<int> libraryCount({String? folderId}) async => 0;

  @override
  Future<File?> fileFor(String localId) async => files[localId];

  @override
  Future<Uint8List?> thumbnailFor(String localId, {int size = 128}) async =>
      null;

  @override
  Stream<void> get changes => const Stream<void>.empty();

  @override
  Future<void> dispose() async {}
}

class _FakeUploadTransport implements UploadTransport {
  Future<AssetSummary> Function(File file, String originalName)? onUpload;
  int uploadCalls = 0;

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
    final handler = onUpload;
    if (handler != null) return handler(file, originalName);
    return const AssetSummary(id: 'server-asset', fileId: 'server-file');
  }

  @override
  Future<List<DedupHit>> exists(List<DedupCheck> items) async =>
      const <DedupHit>[];
}

class _FakeSessionTransport implements SessionTransport {
  int chunkSize = 4;
  int totalParts = 3;
  int createCalls = 0;
  int completeCalls = 0;
  int statusCalls = 0;
  final Map<String, Set<int>> partsByUpload = <String, Set<int>>{};
  final Map<String, bool> completedByUpload = <String, bool>{};
  final Set<String> expired = <String>{};
  final Set<String> failedStatus = <String>{};
  final Set<int> dropPartsOnce = <int>{};
  final List<String> putCalls = <String>[];
  final List<String> aborted = <String>[];
  final List<String> createdFilenames = <String>[];
  Object? createError;
  Object? statusError;
  Object? abortError;

  @override
  Future<CreateSessionResult> createSession({
    required String sha256Hex,
    required int sizeBytes,
    required String filename,
    DateTime? takenAt,
    String? title,
    String? description,
  }) async {
    final error = createError;
    if (error != null) throw error;
    createCalls++;
    createdFilenames.add(filename);
    final id = 'upload-$createCalls';
    partsByUpload[id] = <int>{};
    completedByUpload[id] = false;
    return CreateSessionResult(
      uploadId: id,
      chunkSizeBytes: chunkSize,
      totalParts: totalParts,
      expiresAt: DateTime.utc(2030),
      status: 'pending',
    );
  }

  @override
  Future<UploadSessionStatus> getStatus(String uploadId) async {
    statusCalls++;
    final error = statusError;
    if (error != null) throw error;
    if (expired.contains(uploadId)) {
      throw const ApiException(statusCode: 410, message: 'session expired');
    }
    final parts = partsByUpload.putIfAbsent(uploadId, () => <int>{});
    final done = completedByUpload[uploadId] ?? false;
    final sorted = parts.toList()..sort();
    return UploadSessionStatus(
      status: failedStatus.contains(uploadId)
          ? 'failed'
          : done
          ? 'completed'
          : 'pending',
      chunkSizeBytes: chunkSize,
      totalParts: totalParts,
      receivedParts: sorted,
      receivedBytes: 0,
      expiresAt: DateTime.utc(2030),
      assetId: done ? 'asset-$uploadId' : null,
      fileId: done ? 'file-$uploadId' : null,
    );
  }

  @override
  Future<void> putPart(
    String uploadId,
    int partIndex, {
    required List<int> bytes,
  }) async {
    putCalls.add('$uploadId:$partIndex');
    if (dropPartsOnce.remove(partIndex)) return;
    partsByUpload.putIfAbsent(uploadId, () => <int>{}).add(partIndex);
  }

  @override
  Future<UploadCompleteResult> complete(String uploadId) async {
    completeCalls++;
    final parts = partsByUpload[uploadId] ?? <int>{};
    final missing = <int>[
      for (var index = 0; index < totalParts; index++)
        if (!parts.contains(index)) index,
    ];
    if (missing.isNotEmpty) {
      throw ApiException(
        statusCode: 409,
        message: 'missing parts',
        code: 'PARTS_MISSING',
        receivedParts: missing,
      );
    }
    completedByUpload[uploadId] = true;
    return UploadCompleteResult(
      asset: AssetSummary(id: 'asset-$uploadId', fileId: 'file-$uploadId'),
      deduplicated: false,
    );
  }

  @override
  Future<void> abort(String uploadId) async {
    aborted.add(uploadId);
    final error = abortError;
    if (error != null) throw error;
  }
}
