import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:photox_mobile/upload/models.dart';

import 'support/harness.dart';
import 'support/pipeline.dart';

/// The two upload doors, against the real core and a real device library.
///
/// The 8 MiB threshold is client policy (`AppConfig.singleUploadThresholdBytes`
/// is one part), so this also pins which door each size takes — the docs in
/// this repo disagree with the code about that number.
void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('a small photo takes one POST and a large one a session', (
    tester,
  ) async {
    final api = apiDio();
    final user = await registerFreshUser(api);
    final services = await bootPipeline();
    addTearDown(services.dispose);

    final small = await seededAsset(services, smallPhotoName);
    final large = await seededAsset(services, largePhotoName);

    await signInPipeline(services, user);
    final report = await services.coordinator.run();
    expect(report.error, isNull, reason: '$report');
    expect(report.authRequired, isFalse, reason: '$report');
    expect(report.failed, 0, reason: '$report');
    expect(report.uploaded, greaterThanOrEqualTo(2), reason: '$report');

    final smallRow = await queueRow(services, small.localId);
    expect(
      smallRow.sizeBytes,
      lessThanOrEqualTo(8 * 1024 * 1024),
      reason: 'fixture must stay under the single-POST threshold',
    );
    expect(smallRow.protocol, UploadProtocol.single.name);
    expect(smallRow.state, UploadState.uploaded.name);
    expect(smallRow.partCount, isNull, reason: 'a single POST has no parts');

    final largeRow = await queueRow(services, large.localId);
    expect(
      largeRow.sizeBytes,
      greaterThan(3 * 8 * 1024 * 1024),
      reason: 'fixture must need more than three 8 MiB parts',
    );
    expect(largeRow.protocol, UploadProtocol.session.name);
    expect(largeRow.state, UploadState.uploaded.name);
    expect(
      largeRow.partCount,
      (largeRow.sizeBytes + 8 * 1024 * 1024 - 1) ~/ (8 * 1024 * 1024),
      reason: 'the server fixes the 8 MiB part grid',
    );
    expect(largeRow.uploadId, isNotNull);

    // Both rows' digests resolve to the asset the row recorded: the bytes that
    // were hashed are the bytes core stored.
    await expectBytesStored(
      services,
      sha256: smallRow.sha256!,
      assetId: smallRow.serverAssetId,
    );
    await expectBytesStored(
      services,
      sha256: largeRow.sha256!,
      assetId: largeRow.serverAssetId,
    );
    expect(await serverAssetTotal(services), greaterThanOrEqualTo(2));
  }, timeout: const Timeout(Duration(minutes: 10)));
}
