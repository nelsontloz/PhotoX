import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:photox_mobile/app_services.dart';
import 'package:photox_mobile/upload/models.dart';

import 'support/harness.dart';
import 'support/pipeline.dart';

/// Device folder -> server album, against the real core and a real library.
///
/// Core keeps a hidden album's assets off the timeline while every album-scoped
/// read still answers, so these tests prove the mobile half end to end: the
/// mapping, the attribution of a queued row to its folder, the link that makes
/// an upload join the album, and the repair paths (dedup, sweep, deleted album).
void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  Future<AppServices> boot(({String email, String password}) user) async {
    final services = await bootPipeline();
    addTearDown(services.dispose);
    await signInPipeline(services, user);
    return services;
  }

  testWidgets('only the mapped folder\'s uploads join the album', (
    tester,
  ) async {
    final user = await registerFreshUser(apiDio());
    final services = await boot(user);

    final folder = await seededFolder(services, albumFolderName);
    final camera = await cameraFolder(services);
    final album = await createAlbum(services, 'Trips');
    await savePipelineSettings(
      services,
      scope: <String>[folder.id, camera.id],
      folderAlbums: <String, String>{folder.id: album.id},
    );

    final report = await services.coordinator.run();
    expect(report.error, isNull, reason: '$report');
    expect(report.failed, 0, reason: '$report');

    final albumAsset = await queueRow(
      services,
      (await seededAsset(services, albumPhotoName)).localId,
    );
    final cameraAsset = await queueRow(
      services,
      (await seededAsset(services, smallPhotoName)).localId,
    );
    expect(albumAsset.albumLinkedAt, isNotNull);
    expect(
      cameraAsset.albumLinkedAt,
      isNull,
      reason: 'the camera folder maps to no album',
    );

    expect(await albumAssetIds(services, album.id), <String>{
      albumAsset.serverAssetId!,
    });
    expect(
      await timelineAssetIds(services),
      containsAll(<String>[
        albumAsset.serverAssetId!,
        cameraAsset.serverAssetId!,
      ]),
      reason: 'a visible album must not change the timeline',
    );
  }, timeout: const Timeout(Duration(minutes: 10)));

  testWidgets('a hidden album keeps its uploads off the timeline', (
    tester,
  ) async {
    final user = await registerFreshUser(apiDio());
    final services = await boot(user);

    final folder = await seededFolder(services, albumFolderName);
    final album = await createAlbum(services, 'Private', hidden: true);
    await savePipelineSettings(
      services,
      scope: <String>[folder.id],
      folderAlbums: <String, String>{folder.id: album.id},
    );

    final report = await services.coordinator.run();
    expect(report.error, isNull, reason: '$report');
    expect(report.failed, 0, reason: '$report');

    final row = await queueRow(
      services,
      (await seededAsset(services, albumPhotoName)).localId,
    );
    expect(row.state, UploadState.uploaded.name);
    expect(row.serverAssetId, isNotNull);
    expect(row.albumLinkedAt, isNotNull);

    // The account holds exactly this one asset, so an empty timeline is the
    // whole assertion: nothing else can be hiding it.
    expect(await timelineAssetIds(services), isEmpty);
    expect(await albumAssetIds(services, album.id), <String>{
      row.serverAssetId!,
    });
    expect(await albumScopedTimelineIds(services, album.id), <String>{
      row.serverAssetId!,
    });
  }, timeout: const Timeout(Duration(minutes: 10)));

  testWidgets('a folder backed up before the mapping joins the album', (
    tester,
  ) async {
    final user = await registerFreshUser(apiDio());
    final services = await boot(user);

    final folder = await seededFolder(services, albumFolderName);
    await savePipelineSettings(
      services,
      scope: <String>[folder.id],
      folderAlbums: <String, String>{},
    );

    final first = await services.coordinator.run();
    expect(first.error, isNull, reason: '$first');
    final row = await queueRow(
      services,
      (await seededAsset(services, albumPhotoName)).localId,
    );
    final assetId = row.serverAssetId!;
    expect(row.albumLinkedAt, isNull, reason: 'no mapping existed yet');
    expect(await timelineAssetIds(services), <String>{assetId});

    final album = await createAlbum(services, 'Later', hidden: true);
    await savePipelineSettings(
      services,
      scope: <String>[folder.id],
      folderAlbums: <String, String>{folder.id: album.id},
    );
    // The mapping alone only sees new uploads; this scan is what gives the
    // already-uploaded row its folder back.
    await services.coordinator.adoptFolder(folder.id);
    final second = await services.coordinator.run();
    expect(second.error, isNull, reason: '$second');

    // One id, and the same one: a re-upload would have produced a second asset
    // (or, at best, the same dedup hit), and the timeline total is useless here
    // because a hidden album empties it by definition.
    expect(await albumAssetIds(services, album.id), <String>{assetId});
    expect(await timelineAssetIds(services), isEmpty);
    expect((await queueRow(services, row.localId)).serverAssetId, assetId);
  }, timeout: const Timeout(Duration(minutes: 10)));

  testWidgets('a dedup hit still lands in the album', (tester) async {
    final user = await registerFreshUser(apiDio());
    final services = await boot(user);

    final folder = await seededFolder(services, albumFolderName);
    final album = await createAlbum(services, 'Private', hidden: true);
    await savePipelineSettings(
      services,
      scope: <String>[folder.id],
      folderAlbums: <String, String>{folder.id: album.id},
    );
    expect((await services.coordinator.run()).error, isNull);
    final assetId = (await queueRow(
      services,
      (await seededAsset(services, albumPhotoName)).localId,
    )).serverAssetId!;

    // A reinstall: no local memory of the upload, so only the server's dedup
    // can answer for these bytes.
    await resetQueueOnly(services.db);
    final second = await services.coordinator.run();
    expect(second.error, isNull, reason: '$second');
    expect(
      second.uploaded + second.duplicates,
      greaterThanOrEqualTo(1),
      reason: 'the dedup pre-check must answer: $second',
    );

    expect(await albumAssetIds(services, album.id), <String>{assetId});
    final row = await queueRow(
      services,
      (await seededAsset(services, albumPhotoName)).localId,
    );
    expect(row.state, UploadState.uploaded.name);
    expect(row.albumLinkedAt, isNotNull);
  }, timeout: const Timeout(Duration(minutes: 10)));

  testWidgets('a pass repairs a link it never made', (tester) async {
    final user = await registerFreshUser(apiDio());
    final services = await boot(user);

    final folder = await seededFolder(services, albumFolderName);
    final album = await createAlbum(services, 'Private', hidden: true);
    await savePipelineSettings(
      services,
      scope: <String>[folder.id],
      folderAlbums: <String, String>{folder.id: album.id},
    );
    expect((await services.coordinator.run()).error, isNull);
    final assetId = (await queueRow(
      services,
      (await seededAsset(services, albumPhotoName)).localId,
    )).serverAssetId!;

    // What a killed process or an offline pass leaves behind.
    await services.queue.forgetFolderAlbum(folder.id);
    expect(
      (await queueRow(
        services,
        (await seededAsset(services, albumPhotoName)).localId,
      )).albumLinkedAt,
      isNull,
    );

    final repair = await services.coordinator.run();
    expect(repair.error, isNull, reason: '$repair');
    expect(await albumAssetIds(services, album.id), <String>{assetId});
    expect(
      (await queueRow(
        services,
        (await seededAsset(services, albumPhotoName)).localId,
      )).albumLinkedAt,
      isNotNull,
    );
  }, timeout: const Timeout(Duration(minutes: 10)));

  testWidgets('a deleted album drops the mapping instead of looping', (
    tester,
  ) async {
    final user = await registerFreshUser(apiDio());
    final services = await boot(user);

    final folder = await seededFolder(services, albumFolderName);
    final album = await createAlbum(services, 'Gone', hidden: true);
    await savePipelineSettings(
      services,
      scope: <String>[folder.id],
      folderAlbums: <String, String>{folder.id: album.id},
    );
    expect((await services.coordinator.run()).error, isNull);
    final assetId = (await queueRow(
      services,
      (await seededAsset(services, albumPhotoName)).localId,
    )).serverAssetId!;
    expect(await timelineAssetIds(services), isEmpty);

    await deleteAlbum(services, album.id);
    await resetQueueOnly(services.db);

    final after = await services.coordinator.run();
    expect(after.error, isNull, reason: '$after');
    expect(after.failed, 0, reason: '$after');
    expect(
      (await readPipelineSettings(services)).folderAlbums,
      isEmpty,
      reason: 'the 404 must drop the mapping, not retry it forever',
    );
    expect(await serverAssetTotal(services), 1);
    expect(await timelineAssetIds(services), <String>{
      assetId,
    }, reason: 'deleting the album puts its assets back on the timeline');

    // A third pass must not fail on the dead mapping either.
    final third = await services.coordinator.run();
    expect(third.error, isNull, reason: '$third');
  }, timeout: const Timeout(Duration(minutes: 10)));
}
