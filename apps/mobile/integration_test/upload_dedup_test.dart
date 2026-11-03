import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:photox_mobile/upload/models.dart';

import 'support/harness.dart';
import 'support/pipeline.dart';

/// Re-uploading bytes the account already stored must cost no new asset.
///
/// The queue is wiped first, which is what a reinstall or a second device looks
/// like: nothing local remembers the upload, so only the server's dedup
/// (`POST /api/v1/files/exists`, then the 409 fallback) can stop a duplicate.
void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('a second device re-uploading the same bytes adds no asset', (
    tester,
  ) async {
    final api = apiDio();
    final user = await registerFreshUser(api);
    final services = await bootPipeline();
    addTearDown(services.dispose);

    final small = await seededAsset(services, smallPhotoName);
    await signInPipeline(services, user);

    final first = await services.coordinator.run();
    expect(first.error, isNull, reason: '$first');
    expect(first.uploaded, greaterThanOrEqualTo(1), reason: '$first');
    final totalAfterFirst = await serverAssetTotal(services);
    final before = await queueRow(services, small.localId);
    final digest = before.sha256!;
    final assetId = before.serverAssetId;

    // Same account, no local memory of the first upload.
    await resetQueueOnly(services.db);
    expect(await services.queue.byLocalId(small.localId), isNull);

    final second = await services.coordinator.run();
    expect(second.error, isNull, reason: '$second');
    expect(second.failed, 0, reason: '$second');
    // A pre-check hit settles as `uploaded` (the bytes are backed up); only a
    // 409 from the upload itself counts as a duplicate.
    expect(
      second.uploaded + second.duplicates,
      greaterThanOrEqualTo(1),
      reason: 'the dedup pre-check must answer for $digest: $second',
    );

    expect(
      await serverAssetTotal(services),
      totalAfterFirst,
      reason: 're-uploading identical bytes created a second asset',
    );
    final row = await queueRow(services, small.localId);
    expect(row.state, UploadState.uploaded.name);
    expect(
      row.serverAssetId,
      assetId,
      reason: 'the second pass resolved to another asset',
    );
  }, timeout: const Timeout(Duration(minutes: 10)));
}
