import 'dart:io';

import 'package:drift/drift.dart' show Value, driftRuntimeOptions;
import 'package:drift/native.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:photox_mobile/media/photo_observer.dart';
import 'package:photox_mobile/upload/database.dart';
import 'package:photox_mobile/upload/models.dart';
import 'package:photox_mobile/upload/upload_queue.dart';

void main() {
  setUpAll(() {
    // The migration test opens a second AppDatabase for its temp file; it uses
    // a distinct executor, so the multi-instance warning is a false positive.
    driftRuntimeOptions.dontWarnAboutMultipleDatabases = true;
  });

  late AppDatabase db;
  late UploadQueue queue;

  setUp(() {
    db = AppDatabase(NativeDatabase.memory());
    queue = UploadQueue(db);
  });

  tearDown(() => db.close());

  Future<void> markInProgress(String localId, {required int sizeBytes}) async {
    await queue.enqueue(_candidate(localId, sizeBytes: sizeBytes));
    await queue.markState(
      localId: localId,
      state: UploadState.failedRetryable,
      sha256: 'a' * 64,
      spoolPath: '/tmp/photox/spool/$localId',
      uploadId: 'upload-1',
      partSize: 4,
      partCount: 3,
      protocol: UploadProtocol.session,
      attempts: 2,
      nextAttemptAt: DateTime.utc(2026, 10, 20, 12),
      lastError: 'previous failure',
      errorCode: 'HTTP_500',
      serverAssetId: 'server-asset',
      serverFileId: 'server-file',
    );
  }

  group('enqueue', () {
    test('is idempotent and preserves existing state', () async {
      final candidate = _candidate('asset-1', sizeBytes: 42);

      await queue.enqueue(candidate);
      await queue.markState(
        localId: candidate.localId,
        state: UploadState.uploaded,
      );
      await queue.enqueue(candidate);

      final rows = await db.select(db.queuedAssets).get();
      expect(rows, hasLength(1));
      final row = rows.single;
      expect(row.localId, 'asset-1');
      expect(row.platform, 'ios');
      expect(row.kind, 'photo');
      expect(row.fileName, 'asset-1.jpg');
      expect(row.mimeType, 'image/jpeg');
      expect(row.sizeBytes, 42);
      expect(row.state, UploadState.uploaded.name);
      expect(row.discoveredAt, isNotNull);
    });

    test('enqueueAll inserts every candidate in one batch', () async {
      await queue.enqueueAll(<AssetCandidate>[
        _candidate('a'),
        _candidate('b'),
        _candidate('c'),
      ]);

      expect(await db.select(db.queuedAssets).get(), hasLength(3));
      expect((await queue.byLocalId('b'))?.state, UploadState.discovered.name);
    });

    test(
      'refreshes scan metadata and preserves progress when unchanged',
      () async {
        await queue.enqueue(_candidate('asset-1', sizeBytes: 10));
        final nextAttempt = DateTime.utc(2026, 10, 20, 12);
        await queue.markState(
          localId: 'asset-1',
          state: UploadState.failedRetryable,
          sha256: 'a' * 64,
          spoolPath: '/tmp/photox/spool/asset-1',
          uploadId: 'upload-1',
          partSize: 4,
          partCount: 3,
          protocol: UploadProtocol.session,
          attempts: 2,
          nextAttemptAt: nextAttempt,
          lastError: 'previous failure',
          errorCode: 'HTTP_500',
          serverAssetId: 'server-asset',
          serverFileId: 'server-file',
        );

        await queue.enqueueAll(<AssetCandidate>[
          _candidate(
            'asset-1',
            sizeBytes: 10,
            takenAt: DateTime.utc(2026, 10, 18, 11),
            modifiedAt: DateTime.utc(2026, 10, 18, 10),
            fileName: 'renamed.png',
            mimeType: 'image/png',
          ),
        ]);

        final row = (await queue.byLocalId('asset-1'))!;
        expect(row.fileName, 'renamed.png');
        expect(row.mimeType, 'image/png');
        expect(row.takenAt!.toUtc(), DateTime.utc(2026, 10, 18, 11));
        expect(row.sizeBytes, 10);
        // Same bytes: the in-flight progress survives.
        expect(row.state, UploadState.failedRetryable.name);
        expect(row.sha256, 'a' * 64);
        expect(row.spoolPath, '/tmp/photox/spool/asset-1');
        expect(row.uploadId, 'upload-1');
        expect(row.partSize, 4);
        expect(row.partCount, 3);
        expect(row.protocol, UploadProtocol.session.name);
        expect(row.attempts, 2);
        expect(row.nextAttemptAt!.toUtc(), nextAttempt);
        expect(row.lastError, 'previous failure');
        expect(row.errorCode, 'HTTP_500');
        expect(row.serverAssetId, 'server-asset');
        expect(row.serverFileId, 'server-file');
      },
    );

    test('resets progress when sizeBytes changes', () async {
      await markInProgress('asset-1', sizeBytes: 10);

      await queue.enqueueAll(<AssetCandidate>[
        _candidate('asset-1', sizeBytes: 11),
      ]);

      final row = (await queue.byLocalId('asset-1'))!;
      expect(row.sizeBytes, 11);
      expect(row.state, UploadState.discovered.name);
      expect(row.sha256, isNull);
      expect(row.spoolPath, isNull);
      expect(row.uploadId, isNull);
      expect(row.partSize, isNull);
      expect(row.partCount, isNull);
      expect(row.protocol, isNull);
      expect(row.attempts, 0);
      expect(row.nextAttemptAt, isNull);
      expect(row.lastError, isNull);
      expect(row.errorCode, isNull);
      expect(row.serverAssetId, isNull);
      expect(row.serverFileId, isNull);
    });

    test('resets progress when modifiedAt changes', () async {
      await markInProgress('asset-1', sizeBytes: 10);

      await queue.enqueueAll(<AssetCandidate>[
        _candidate(
          'asset-1',
          sizeBytes: 10,
          modifiedAt: DateTime.utc(2026, 10, 18, 10, 1),
        ),
      ]);

      final row = (await queue.byLocalId('asset-1'))!;
      expect(row.state, UploadState.discovered.name);
      expect(row.sha256, isNull);
      expect(row.spoolPath, isNull);
      expect(row.uploadId, isNull);
      expect(row.attempts, 0);
      expect(row.nextAttemptAt, isNull);
    });

    test(
      'an unknown (0) size neither resets nor erases a measured size',
      () async {
        await markInProgress('asset-1', sizeBytes: 10);

        // Library pages report no size; re-enqueueing from the grid must not
        // throw away the digest and spool the uploader already paid for.
        await queue.enqueueAll(<AssetCandidate>[
          _candidate('asset-1', sizeBytes: 0),
        ]);

        final row = (await queue.byLocalId('asset-1'))!;
        expect(row.sizeBytes, 10);
        expect(row.state, UploadState.failedRetryable.name);
        expect(row.sha256, isNotNull);
      },
    );

    test('an unknown (0) size is replaced by a measured one', () async {
      await queue.enqueueAll(<AssetCandidate>[
        _candidate('asset-1', sizeBytes: 0),
      ]);
      await markInProgress('asset-1', sizeBytes: 0);

      await queue.enqueueAll(<AssetCandidate>[
        _candidate('asset-1', sizeBytes: 42),
      ]);

      final row = (await queue.byLocalId('asset-1'))!;
      expect(row.sizeBytes, 42);
    });
  });

  group('nextBatch', () {
    test('orders oldest due first and skips terminal/future rows', () async {
      final base = DateTime(2026, 10, 19, 12);
      await queue.enqueueAll(<AssetCandidate>[
        _candidate('a'),
        _candidate('b'),
        _candidate('c'),
        _candidate('d'),
      ]);
      await queue.markState(
        localId: 'a',
        state: UploadState.pending,
        nextAttemptAt: base.subtract(const Duration(minutes: 30)),
      );
      await queue.markState(
        localId: 'b',
        state: UploadState.pending,
        nextAttemptAt: base.subtract(const Duration(minutes: 10)),
      );
      await queue.markState(
        localId: 'c',
        state: UploadState.uploaded,
        nextAttemptAt: base.subtract(const Duration(days: 1)),
      );
      await queue.markState(
        localId: 'd',
        state: UploadState.failedRetryable,
        nextAttemptAt: base.add(const Duration(hours: 1)),
      );

      final batch = await queue.nextBatch(10, now: base);
      expect(batch.map((row) => row.localId), <String>['a', 'b']);

      final limited = await queue.nextBatch(1, now: base);
      expect(limited.single.localId, 'a');
    });

    test('serves the oldest capture date first, undated rows last', () async {
      final base = DateTime(2026, 10, 19, 12);
      await queue.enqueueAll(<AssetCandidate>[
        _candidate('mid', takenAt: DateTime.utc(2022, 5, 1)),
        _candidate('new', takenAt: DateTime.utc(2025, 5, 1)),
        AssetCandidate(
          localId: 'undated',
          platform: 'ios',
          kind: MediaKind.photo,
          fileName: 'undated.jpg',
          mimeType: 'image/jpeg',
          sizeBytes: 100,
          modifiedAt: DateTime.utc(2026, 10, 18),
        ),
        _candidate('old', takenAt: DateTime.utc(2019, 3, 4)),
      ]);

      final batch = await queue.nextBatch(10, now: base);
      expect(batch.map((row) => row.localId), <String>[
        'old',
        'mid',
        'new',
        'undated',
      ]);
    });

    test('treats a null nextAttemptAt as immediately due', () async {
      final base = DateTime(2026, 10, 19, 12);
      await queue.enqueueAll(<AssetCandidate>[
        _candidate('waiting'),
        _candidate('due'),
      ]);
      await queue.markState(
        localId: 'waiting',
        state: UploadState.pending,
        nextAttemptAt: base.add(const Duration(hours: 1)),
      );

      final batch = await queue.nextBatch(5, now: base);
      expect(batch.map((row) => row.localId), <String>['due']);
      expect(await queue.nextBatch(0, now: base), isEmpty);
    });
  });

  group('markState', () {
    test('persists every optional field and stamps lastAttemptAt', () async {
      final next = DateTime(2026, 10, 19, 13);
      await queue.enqueue(_candidate('asset-1'));

      await queue.markState(
        localId: 'asset-1',
        state: UploadState.uploading,
        sha256: 'a' * 64,
        spoolPath: '/tmp/spool/asset-1',
        protocol: UploadProtocol.session,
        uploadId: 'upload-1',
        partSize: 8 * 1024 * 1024,
        partCount: 3,
        serverAssetId: 'server-asset',
        serverFileId: 'server-file',
        attempts: 2,
        nextAttemptAt: next,
        lastError: 'previous failure',
        errorCode: 'NETWORK',
      );

      final row = (await queue.byLocalId('asset-1'))!;
      expect(row.state, UploadState.uploading.name);
      expect(row.sha256, 'a' * 64);
      expect(row.spoolPath, '/tmp/spool/asset-1');
      expect(row.protocol, UploadProtocol.session.name);
      expect(row.uploadId, 'upload-1');
      expect(row.partSize, 8 * 1024 * 1024);
      expect(row.partCount, 3);
      expect(row.serverAssetId, 'server-asset');
      expect(row.serverFileId, 'server-file');
      expect(row.attempts, 2);
      expect(row.nextAttemptAt, next);
      expect(row.lastError, 'previous failure');
      expect(row.errorCode, 'NETWORK');
      expect(row.lastAttemptAt, isNotNull);
    });

    test('omitted optional fields do not clear stored values', () async {
      await queue.enqueue(_candidate('asset-1'));
      await queue.markState(
        localId: 'asset-1',
        state: UploadState.pending,
        sha256: 'b' * 64,
        uploadId: 'upload-1',
      );

      await queue.markState(localId: 'asset-1', state: UploadState.hashing);

      final row = (await queue.byLocalId('asset-1'))!;
      expect(row.state, UploadState.hashing.name);
      expect(row.sha256, 'b' * 64);
      expect(row.uploadId, 'upload-1');
    });
  });

  group('markPartsPending', () {
    test(
      'requeues immediately without touching attempts or progress',
      () async {
        await queue.enqueue(_candidate('asset-1'));
        await queue.markState(
          localId: 'asset-1',
          state: UploadState.failedRetryable,
          sha256: 'b' * 64,
          spoolPath: '/tmp/photox/spool/asset-1',
          uploadId: 'upload-1',
          partSize: 4,
          partCount: 3,
          attempts: 3,
          nextAttemptAt: DateTime.utc(2026, 10, 20, 12),
          lastError: 'parts remain',
          errorCode: 'PARTS_PENDING',
        );

        await queue.markPartsPending('asset-1');

        final row = (await queue.byLocalId('asset-1'))!;
        expect(row.state, UploadState.pending.name);
        expect(row.attempts, 3);
        expect(row.nextAttemptAt, isNull);
        expect(row.lastError, isNull);
        expect(row.errorCode, isNull);
        expect(row.sha256, 'b' * 64);
        expect(row.spoolPath, '/tmp/photox/spool/asset-1');
        expect(row.uploadId, 'upload-1');
        expect(
          (await queue.nextBatch(
            5,
            now: DateTime.utc(2026, 10, 19),
          )).single.localId,
          'asset-1',
        );
      },
    );
  });

  group('part receipts', () {
    test('recordPartAck, partsFor and clearParts round-trip', () async {
      await queue.recordPartAck(uploadId: 'upload-1', partIndex: 1, bytes: 20);
      await queue.recordPartAck(
        uploadId: 'upload-1',
        partIndex: 0,
        bytes: 10,
        sha256: 'c' * 64,
      );

      final parts = await queue.partsFor('upload-1');
      expect(parts.map((part) => part.partIndex), <int>[0, 1]);
      expect(parts.first.bytes, 10);
      expect(parts.first.sha256, 'c' * 64);
      expect(parts.first.acknowledgedAt, isNotNull);
      expect(parts.last.bytes, 20);

      // Re-acknowledging an index is idempotent.
      await queue.recordPartAck(uploadId: 'upload-1', partIndex: 0, bytes: 10);
      expect((await queue.partsFor('upload-1')), hasLength(2));

      await queue.clearParts('upload-1');
      expect(await queue.partsFor('upload-1'), isEmpty);
    });
  });

  group('resetInterrupted', () {
    test('moves only in-flight states back to pending', () async {
      await queue.enqueueAll(<AssetCandidate>[
        _candidate('creating'),
        _candidate('uploading'),
        _candidate('completing'),
        _candidate('pending'),
        _candidate('uploaded'),
      ]);
      await queue.markState(localId: 'creating', state: UploadState.creating);
      await queue.markState(localId: 'uploading', state: UploadState.uploading);
      await queue.markState(
        localId: 'completing',
        state: UploadState.completing,
      );
      await queue.markState(localId: 'pending', state: UploadState.pending);
      await queue.markState(localId: 'uploaded', state: UploadState.uploaded);

      await queue.resetInterrupted();

      for (final localId in <String>['creating', 'uploading', 'completing']) {
        expect(
          (await queue.byLocalId(localId))?.state,
          UploadState.pending.name,
          reason: localId,
        );
      }
      expect(
        (await queue.byLocalId('pending'))?.state,
        UploadState.pending.name,
      );
      expect(
        (await queue.byLocalId('uploaded'))?.state,
        UploadState.uploaded.name,
      );
    });
  });

  group('retryFailed', () {
    test('requeues failed and quota rows and keeps their digest', () async {
      await queue.enqueueAll(<AssetCandidate>[
        _candidate('permanent'),
        _candidate('quota'),
        _candidate('retryable'),
        _candidate('uploaded'),
        _candidate('duplicate'),
      ]);
      await queue.markState(
        localId: 'permanent',
        state: UploadState.failedPermanent,
        sha256: 'a' * 64,
        spoolPath: '/tmp/photox/spool/permanent',
        lastError: 'property mimeHint should not exist',
        errorCode: 'HTTP_400',
      );
      await queue.markState(
        localId: 'quota',
        state: UploadState.skippedQuota,
        lastError: '413',
        errorCode: 'QUOTA_EXCEEDED',
      );
      await queue.markState(
        localId: 'retryable',
        state: UploadState.failedRetryable,
      );
      await queue.markState(localId: 'uploaded', state: UploadState.uploaded);
      await queue.markState(localId: 'duplicate', state: UploadState.duplicate);

      expect(await queue.retryFailed(), 2);

      final permanent = await queue.byLocalId('permanent');
      expect(permanent!.state, UploadState.pending.name);
      expect(permanent.lastError, isNull);
      expect(permanent.errorCode, isNull);
      expect(permanent.attempts, 0);
      expect(
        permanent.sha256,
        'a' * 64,
        reason: 'the bytes are unchanged, so the digest must survive',
      );
      expect(permanent.spoolPath, '/tmp/photox/spool/permanent');

      final quota = await queue.byLocalId('quota');
      expect(quota!.state, UploadState.pending.name);
      expect(quota.errorCode, isNull);

      // Rows that were never terminal are untouched, and the history stays.
      expect(
        (await queue.byLocalId('retryable'))!.state,
        UploadState.failedRetryable.name,
      );
      expect(
        (await queue.byLocalId('uploaded'))!.state,
        UploadState.uploaded.name,
      );
      expect(
        (await queue.byLocalId('duplicate'))!.state,
        UploadState.duplicate.name,
      );
    });

    test(
      'drops stale session geometry so a retry opens a fresh session',
      () async {
        await markInProgress('video', sizeBytes: 100);
        await queue.markState(
          localId: 'video',
          state: UploadState.failedPermanent,
        );

        await queue.retryFailed();

        final row = await queue.byLocalId('video');
        expect(row!.state, UploadState.pending.name);
        expect(row.uploadId, isNull);
        expect(row.partSize, isNull);
        expect(row.partCount, isNull);
        expect(row.protocol, isNull);
        expect(row.nextAttemptAt, isNull);
      },
    );

    test('is a no-op when nothing failed', () async {
      await queue.enqueue(_candidate('pending'));
      expect(await queue.retryFailed(), 0);
      expect(
        (await queue.byLocalId('pending'))!.state,
        UploadState.discovered.name,
      );
    });
  });

  group('requeueNow', () {
    test('revives the named failures and clears their backoff', () async {
      await markInProgress('backing-off', sizeBytes: 100);
      await queue.markState(
        localId: 'backing-off',
        state: UploadState.failedRetryable,
        nextAttemptAt: DateTime.utc(2026, 10, 20, 12),
        attempts: 3,
        lastError: 'network',
      );
      await queue.enqueueAll(<AssetCandidate>[
        _candidate('permanent'),
        _candidate('uploaded'),
        _candidate('other-failure'),
      ]);
      await queue.markState(
        localId: 'permanent',
        state: UploadState.failedPermanent,
        sha256: 'b' * 64,
        spoolPath: '/tmp/photox/spool/permanent',
        lastError: 'Unsupported file type',
        errorCode: 'HTTP_400',
      );
      await queue.markState(localId: 'uploaded', state: UploadState.uploaded);
      await queue.markState(
        localId: 'other-failure',
        state: UploadState.failedPermanent,
      );

      expect(
        await queue.requeueNow(<String>[
          'backing-off',
          'permanent',
          'uploaded',
        ]),
        2,
        reason: 'an uploaded row has nothing left to retry',
      );

      final revived = await queue.byLocalId('backing-off');
      expect(revived!.state, UploadState.pending.name);
      expect(revived.nextAttemptAt, isNull, reason: 'the user asked for now');
      expect(revived.attempts, 0);
      expect(revived.lastError, isNull);

      final permanent = await queue.byLocalId('permanent');
      expect(permanent!.state, UploadState.pending.name);
      expect(permanent.sha256, 'b' * 64);
      expect(permanent.spoolPath, '/tmp/photox/spool/permanent');

      expect(
        (await queue.byLocalId('uploaded'))!.state,
        UploadState.uploaded.name,
      );
      expect(
        (await queue.byLocalId('other-failure'))!.state,
        UploadState.failedPermanent.name,
        reason: 'only the named ids move',
      );
    });

    test('is a no-op for an empty or untouched set', () async {
      await queue.enqueue(_candidate('discovered'));
      expect(await queue.requeueNow(const <String>[]), 0);
      expect(await queue.requeueNow(<String>['discovered']), 0);
      expect(
        (await queue.byLocalId('discovered'))!.state,
        UploadState.discovered.name,
      );
    });
  });

  group('clearNonTerminal', () {
    test('deletes pending work and keeps terminal rows', () async {
      await queue.enqueueAll(<AssetCandidate>[
        _candidate('discovered'),
        _candidate('pending'),
        _candidate('retryable'),
        _candidate('creating'),
        _candidate('uploaded'),
        _candidate('duplicate'),
        _candidate('quota'),
        _candidate('permanent'),
        _candidate('excluded'),
      ]);
      await queue.markState(localId: 'pending', state: UploadState.pending);
      await queue.markState(
        localId: 'retryable',
        state: UploadState.failedRetryable,
        nextAttemptAt: DateTime.utc(2026, 10, 20, 12),
      );
      await queue.markState(localId: 'creating', state: UploadState.creating);
      await queue.markState(localId: 'uploaded', state: UploadState.uploaded);
      await queue.markState(localId: 'duplicate', state: UploadState.duplicate);
      await queue.markState(localId: 'quota', state: UploadState.skippedQuota);
      await queue.markState(
        localId: 'permanent',
        state: UploadState.failedPermanent,
      );
      await queue.markState(localId: 'excluded', state: UploadState.excluded);

      expect(await queue.clearNonTerminal(), 4);

      final rows = await db.select(db.queuedAssets).get();
      expect(rows.map((row) => row.localId).toSet(), <String>{
        'uploaded',
        'duplicate',
        'quota',
        'permanent',
        'excluded',
      });
    });

    test('is a no-op on an empty queue', () async {
      expect(await queue.clearNonTerminal(), 0);
      expect(await db.select(db.queuedAssets).get(), isEmpty);
    });
  });

  group('stats and states', () {
    test('counts pending, uploaded, duplicate and failed rows', () async {
      await queue.enqueueAll(<AssetCandidate>[
        _candidate('pending'),
        _candidate('uploaded'),
        _candidate('duplicate'),
        _candidate('permanent'),
        _candidate('quota'),
        _candidate('excluded'),
      ]);
      await queue.markState(localId: 'uploaded', state: UploadState.uploaded);
      await queue.markState(localId: 'duplicate', state: UploadState.duplicate);
      await queue.markState(
        localId: 'permanent',
        state: UploadState.failedPermanent,
      );
      await queue.markState(localId: 'quota', state: UploadState.skippedQuota);
      await queue.markState(localId: 'excluded', state: UploadState.excluded);

      final stats = await queue.stats();
      expect(stats.pending, 1);
      expect(stats.uploaded, 1);
      expect(stats.duplicate, 1);
      expect(stats.failed, 2);
    });

    test('splits photos and videos and exposes the overall fraction', () async {
      await queue.enqueueAll(<AssetCandidate>[
        _candidate('photo-1'),
        _candidate('photo-2'),
        _candidate('video-1', kind: MediaKind.video),
      ]);
      await queue.markState(localId: 'photo-1', state: UploadState.uploaded);
      await queue.markState(localId: 'video-1', state: UploadState.duplicate);

      final stats = await queue.stats();
      expect(stats.photos, 2);
      expect(stats.videos, 1);
      expect(stats.total, 3);
      expect(stats.completed, 2);
      expect(stats.fraction, closeTo(2 / 3, 1e-9));
    });

    test('reports a zero fraction before anything is queued', () async {
      final stats = await queue.stats();

      expect(stats.total, 0);
      expect(stats.completed, 0);
      expect(stats.fraction, 0);
    });
  });

  group('statesFor', () {
    test('reads listed rows, dedupes ids and omits absent ones', () async {
      await queue.enqueueAll(<AssetCandidate>[
        _candidate('uploaded'),
        _candidate('pending'),
        _candidate('excluded'),
      ]);
      await queue.markState(localId: 'uploaded', state: UploadState.uploaded);
      await queue.markState(localId: 'pending', state: UploadState.pending);
      await queue.markState(localId: 'excluded', state: UploadState.excluded);

      final states = await queue.statesFor(<String>[
        'uploaded',
        'pending',
        'excluded',
        'absent',
        'pending',
      ]);

      expect(states, <String, UploadState>{
        'uploaded': UploadState.uploaded,
        'pending': UploadState.pending,
        'excluded': UploadState.excluded,
      });
      expect(await queue.statesFor(const <String>[]), isEmpty);
    });

    test('chunks more ids than a visible page', () async {
      final ids = List<String>.generate(1200, (index) => 'asset-$index');
      await queue.enqueueAll(<AssetCandidate>[
        for (final id in ids) _candidate(id),
      ]);
      await queue.markState(localId: 'asset-700', state: UploadState.uploaded);

      final states = await queue.statesFor(ids);

      expect(states, hasLength(1200));
      expect(states['asset-700'], UploadState.uploaded);
      expect(states['asset-1199'], UploadState.discovered);
    });

    test('skips a state string this build does not know', () async {
      await queue.enqueueAll(<AssetCandidate>[
        _candidate('future'),
        _candidate('known'),
      ]);
      await (db.update(db.queuedAssets)
            ..where((t) => t.localId.equals('future')))
          .write(const QueuedAssetsCompanion(state: Value('timeTraveled')));

      final states = await queue.statesFor(<String>['future', 'known']);

      expect(states, <String, UploadState>{'known': UploadState.discovered});
    });
  });

  group('serverIdsFor', () {
    test('reads uploaded rows, dedupes ids and omits the rest', () async {
      await queue.enqueueAll(<AssetCandidate>[
        _candidate('uploaded'),
        _candidate('deduped'),
        _candidate('pending'),
        _candidate('absent'),
      ]);
      await queue.markState(
        localId: 'uploaded',
        state: UploadState.uploaded,
        serverAssetId: 'asset-1',
      );
      await queue.markState(
        localId: 'deduped',
        state: UploadState.duplicate,
        serverAssetId: 'asset-2',
      );
      await queue.markState(localId: 'pending', state: UploadState.pending);

      final serverIds = await queue.serverIdsFor(<String>[
        'uploaded',
        'deduped',
        'pending',
        'absent',
        'uploaded',
      ]);

      expect(serverIds, <String, String>{
        'uploaded': 'asset-1',
        'deduped': 'asset-2',
      });
      expect(await queue.serverIdsFor(const <String>[]), isEmpty);
    });

    test('chunks more ids than a visible page', () async {
      final ids = List<String>.generate(1200, (index) => 'asset-$index');
      await queue.enqueueAll(<AssetCandidate>[
        for (final id in ids) _candidate(id),
      ]);
      await queue.markState(
        localId: 'asset-1199',
        state: UploadState.uploaded,
        serverAssetId: 'server-1199',
      );

      final serverIds = await queue.serverIdsFor(ids);

      expect(serverIds, <String, String>{'asset-1199': 'server-1199'});
    });
  });

  group('metadata', () {
    test('set and get only touch the meta namespace', () async {
      expect(await queue.getMeta('lastScan'), isNull);

      await queue.setMeta('lastScan', '2026-10-19T12:00:00.000Z');
      expect(await queue.getMeta('lastScan'), '2026-10-19T12:00:00.000Z');

      await db
          .into(db.keyValues)
          .insert(
            KeyValuesCompanion.insert(
              namespace: 'settings',
              key: 'lastScan',
              value: 'other-namespace',
              updatedAt: DateTime(2026),
            ),
          );
      expect(await queue.getMeta('lastScan'), '2026-10-19T12:00:00.000Z');
    });
  });

  group('schema migration', () {
    test('upgrades a v1 database in place and creates KeyValues', () async {
      final directory = await Directory.systemTemp.createTemp(
        'photox-migration-',
      );
      addTearDown(() => directory.delete(recursive: true));
      final file = File('${directory.path}/photox.sqlite');

      final executor = NativeDatabase(
        file,
        setup: (raw) {
          raw.execute('''
            CREATE TABLE queued_assets (
              local_id TEXT NOT NULL PRIMARY KEY,
              platform TEXT NOT NULL,
              kind TEXT NOT NULL,
              size_bytes INTEGER NOT NULL,
              taken_at INTEGER,
              sha256 TEXT,
              upload_id TEXT,
              part_size INTEGER,
              part_count INTEGER,
              state TEXT NOT NULL,
              attempts INTEGER NOT NULL DEFAULT 0,
              next_attempt_at INTEGER,
              last_error TEXT,
              server_asset_id TEXT
            )
          ''');
          raw.execute('''
            CREATE TABLE upload_parts (
              upload_id TEXT NOT NULL,
              part_index INTEGER NOT NULL,
              bytes INTEGER NOT NULL,
              sha256 TEXT,
              PRIMARY KEY (upload_id, part_index)
            )
          ''');
          raw.execute(
            "INSERT INTO queued_assets "
            "(local_id, platform, kind, size_bytes, state) VALUES "
            "('v1-asset', 'android', 'photo', 123, 'pending')",
          );
          raw.execute('PRAGMA user_version = 1');
        },
      );
      final upgraded = AppDatabase(executor);
      addTearDown(upgraded.close);

      final row = await (upgraded.select(
        upgraded.queuedAssets,
      )..where((t) => t.localId.equals('v1-asset'))).getSingle();
      expect(row.sizeBytes, 123);
      expect(row.state, 'pending');
      expect(row.fileName, isNull);
      expect(row.spoolPath, isNull);
      expect(row.discoveredAt, isNull);

      await upgraded
          .into(upgraded.keyValues)
          .insert(
            KeyValuesCompanion.insert(
              namespace: 'meta',
              key: 'schema',
              value: 'v2',
              updatedAt: DateTime(2026),
            ),
          );
      expect(
        await (upgraded.select(upgraded.keyValues)).getSingle(),
        isA<KeyValue>(),
      );

      await upgraded
          .into(upgraded.uploadParts)
          .insert(
            UploadPartsCompanion.insert(
              uploadId: 'upload-1',
              partIndex: 0,
              bytes: 10,
            ),
          );
      expect(
        (await (upgraded.select(
          upgraded.uploadParts,
        )).getSingle()).acknowledgedAt,
        isNull,
      );
    });
  });
}

AssetCandidate _candidate(
  String localId, {
  int sizeBytes = 100,
  MediaKind kind = MediaKind.photo,
  DateTime? takenAt,
  DateTime? modifiedAt,
  String? fileName,
  String? mimeType,
}) {
  return AssetCandidate(
    localId: localId,
    platform: 'ios',
    kind: kind,
    fileName: fileName ?? '$localId.jpg',
    mimeType: mimeType ?? 'image/jpeg',
    sizeBytes: sizeBytes,
    takenAt: takenAt ?? DateTime.utc(2026, 10, 18, 9),
    modifiedAt: modifiedAt ?? DateTime.utc(2026, 10, 18, 10),
    relativePath: 'DCIM/$localId.jpg',
  );
}
