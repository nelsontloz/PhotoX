import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:photox_mobile/media/hasher.dart';
import 'package:photox_mobile/upload/models.dart';
import 'package:photox_mobile/upload/transports.dart';
import 'package:photox_mobile/upload/uploader.dart';

import 'support/harness.dart';
import 'support/pipeline.dart';

/// Acknowledged parts must survive a restart, and the next pass must continue
/// the same server session instead of opening a new one.
///
/// Part 1 uses a one-part-per-attempt uploader (what a background window does:
/// the coordinator passes the same cap when it runs with a budget) and stops
/// with `PARTS_PENDING`. Part 2 throws that graph away, reopens the same drift
/// file the way a relaunched app does, and finishes the upload.
void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('an interrupted session resumes instead of restarting', (
    tester,
  ) async {
    final api = apiDio();
    final user = await registerFreshUser(api);
    final services = await bootPipeline();

    final large = await seededAsset(services, largePhotoName);
    await signInPipeline(services, user);
    await services.queue.enqueue(large);

    // One part per attempt: the session is created, part 0 lands, then the
    // uploader stops the way an expiring background window does.
    final throttled = Uploader(
      queue: services.queue,
      uploadTransport: ApiUploadTransport(services.api),
      sessionTransport: SessionApiTransport(services.sessions),
      hasher: const Hasher(),
      observer: services.observer,
      maxPartsPerPass: 1,
    );
    final firstRow = await queueRow(services, large.localId);
    await expectLater(
      throttled.process(firstRow),
      throwsA(
        isA<UploadFailure>().having((e) => e.code, 'code', 'PARTS_PENDING'),
      ),
    );

    final partial = await queueRow(services, large.localId);
    expect(partial.state, isNot(UploadState.uploaded.name));
    expect(partial.uploadId, isNotNull, reason: 'the session must be kept');
    final uploadId = partial.uploadId!;
    final receipts = await services.queue.partsFor(uploadId);
    expect(receipts, hasLength(1), reason: 'one acknowledged part');
    final serverView = await services.sessions.getStatus(uploadId);
    expect(serverView.receivedParts, hasLength(1));
    expect(serverView.totalParts, greaterThan(3));
    expect(partial.sha256, isNotNull);

    // Restart: nothing in memory survives, the drift file and the token store
    // do. This is the resume path a killed process takes.
    await services.dispose();
    final resumed = await bootPipeline(reset: false);
    addTearDown(resumed.dispose);
    await resumed.auth.restore();
    expect(resumed.auth.isSignedIn, isTrue, reason: 'tokens persisted');

    final report = await resumed.coordinator.run();
    expect(report.error, isNull, reason: '$report');
    expect(report.authRequired, isFalse, reason: '$report');
    expect(report.uploaded, greaterThanOrEqualTo(1), reason: '$report');

    final done = await queueRow(resumed, large.localId);
    expect(done.state, UploadState.uploaded.name);
    expect(
      done.uploadId,
      uploadId,
      reason: 'the resumed pass opened a new session instead of continuing',
    );
    await expectBytesStored(
      resumed,
      sha256: done.sha256!,
      assetId: done.serverAssetId,
    );
  }, timeout: const Timeout(Duration(minutes: 10)));
}
