import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:photox_mobile/main.dart' as app;
import 'package:photox_mobile/ui/widgets/asset_tile.dart';

import 'support/harness.dart';
import 'support/pipeline.dart';

/// The merged Library tab against the real stack, one case per half of the
/// merge: a row only the server has (cloud mark, read-only viewer) and a photo
/// this phone backed up (tick mark, one row and not two).
///
/// Both cases register their own account and [bootPipeline] clears the local
/// state, so nothing an earlier file left behind can reach them.
void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  const String serverOnlyName = 'server-only.jpg';

  // A 1x1 baseline JPEG: core only sniffs the header, and no phone has these
  // bytes, so the asset stays server-side for the whole test.
  // dart format off
  const List<int> tinyJpeg = <int>[
    0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, 0x01,
    0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0xFF, 0xDB, 0x00, 0x43,
    0x00, 0x08, 0x06, 0x06, 0x07, 0x06, 0x05, 0x08, 0x07, 0x07, 0x07, 0x09,
    0x09, 0x08, 0x0A, 0x0C, 0x14, 0x0D, 0x0C, 0x0B, 0x0B, 0x0C, 0x19, 0x12,
    0x13, 0x0F, 0x14, 0x1D, 0x1A, 0x1F, 0x1E, 0x1D, 0x1A, 0x1C, 0x1C, 0x20,
    0x24, 0x2E, 0x27, 0x20, 0x22, 0x2C, 0x23, 0x1C, 0x1C, 0x28, 0x37, 0x29,
    0x2C, 0x30, 0x31, 0x34, 0x34, 0x34, 0x1F, 0x27, 0x39, 0x3D, 0x38, 0x32,
    0x3C, 0x2E, 0x33, 0x34, 0x32, 0xFF, 0xC0, 0x00, 0x0B, 0x08, 0x00, 0x01,
    0x00, 0x01, 0x01, 0x01, 0x11, 0x00, 0xFF, 0xC4, 0x00, 0x1F, 0x00, 0x00,
    0x01, 0x05, 0x01, 0x01, 0x01, 0x01, 0x01, 0x01, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08,
    0x09, 0x0A, 0x0B, 0xFF, 0xC4, 0x00, 0xB5, 0x10, 0x00, 0x02, 0x01, 0x03,
    0x03, 0x02, 0x04, 0x03, 0x05, 0x05, 0x04, 0x04, 0x00, 0x00, 0x01, 0x7D,
    0x01, 0x02, 0x03, 0x00, 0x04, 0x11, 0x05, 0x12, 0x21, 0x31, 0x41, 0x06,
    0x13, 0x51, 0x61, 0x07, 0x22, 0x71, 0x14, 0x32, 0x81, 0x91, 0xA1, 0x08,
    0x23, 0x42, 0xB1, 0xC1, 0x15, 0x52, 0xD1, 0xF0, 0x24, 0x33, 0x62, 0x72,
    0x82, 0x09, 0x0A, 0x16, 0x17, 0x18, 0x19, 0x1A, 0x25, 0x26, 0x27, 0x28,
    0x29, 0x2A, 0x34, 0x35, 0x36, 0x37, 0x38, 0x39, 0x3A, 0x43, 0x44, 0x45,
    0x46, 0x47, 0x48, 0x49, 0x4A, 0x53, 0x54, 0x55, 0x56, 0x57, 0x58, 0x59,
    0x5A, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68, 0x69, 0x6A, 0x73, 0x74, 0x75,
    0x76, 0x77, 0x78, 0x79, 0x7A, 0x83, 0x84, 0x85, 0x86, 0x87, 0x88, 0x89,
    0x8A, 0x92, 0x93, 0x94, 0x95, 0x96, 0x97, 0x98, 0x99, 0x9A, 0xA2, 0xA3,
    0xA4, 0xA5, 0xA6, 0xA7, 0xA8, 0xA9, 0xAA, 0xB2, 0xB3, 0xB4, 0xB5, 0xB6,
    0xB7, 0xB8, 0xB9, 0xBA, 0xC2, 0xC3, 0xC4, 0xC5, 0xC6, 0xC7, 0xC8, 0xC9,
    0xCA, 0xD2, 0xD3, 0xD4, 0xD5, 0xD6, 0xD7, 0xD8, 0xD9, 0xDA, 0xE1, 0xE2,
    0xE3, 0xE4, 0xE5, 0xE6, 0xE7, 0xE8, 0xE9, 0xEA, 0xF1, 0xF2, 0xF3, 0xF4,
    0xF5, 0xF6, 0xF7, 0xF8, 0xF9, 0xFA, 0xFF, 0xDA, 0x00, 0x08, 0x01, 0x01,
    0x00, 0x00, 0x3F, 0x00, 0xFB, 0xD5, 0xFF, 0xD9,
  ];
  // dart format on

  testWidgets('a server-only asset shows online-only and opens read-only', (
    tester,
  ) async {
    final api = apiDio();
    final services = await bootPipeline();
    addTearDown(services.dispose);

    final user = await registerFreshUser(api);
    await signInPipeline(services, user);

    // The phone does not have these bytes: this upload stands in for another
    // device that backed them up, so the account has a server-only row.
    final upload = await api.post<Map<String, dynamic>>(
      '/api/v1/files',
      data: FormData.fromMap(<String, dynamic>{
        'file': MultipartFile.fromBytes(tinyJpeg, filename: serverOnlyName),
      }),
      options: authHeader(await services.auth.ensureAccessToken()),
    );
    expect(upload.statusCode, anyOf(200, 201), reason: '${upload.data}');
    final assetId = upload.data!['id'] as String;

    // Release the graph first: the app builds its own over the same storage and
    // restores the session this one just persisted.
    await services.dispose();
    app.main();
    await pumpUntil(tester, find.byType(NavigationBar));

    final handle = tester.ensureSemantics();

    // No pass can change a server-only row's mark, so its label is the stable
    // thing to wait for before anything else.
    await pumpUntil(
      tester,
      find.bySemanticsLabel(
        RegExp('^${RegExp.escape(serverOnlyName)}, Online only\$'),
      ),
      timeout: const Duration(minutes: 3),
    );
    expect(find.byIcon(Icons.cloud_outlined), findsOneWidget);

    // The device half is still drawn beside it: one of the two on-device marks
    // belongs to a photo this phone holds. Never an absolute tile count, since
    // the emulator's own library varies.
    await pumpUntilAny(tester, <Finder>[
      find.byIcon(Icons.check_rounded),
      find.byIcon(Icons.circle_outlined),
    ], timeout: const Duration(minutes: 6));

    // Narrow the grid to the online-only rows, so the tile under test is on
    // screen whatever else the emulator's library holds.
    final chip = find.byKey(const Key('filter-onlineOnly'));
    await tester.ensureVisible(chip);
    await tester.tap(chip);
    await tester.pump(const Duration(milliseconds: 400));

    // The viewer page carries the same [LibraryItem.key], so this finder is
    // narrowed to the grid tile: a bare key lookup matches both at once.
    final tile = find.byWidgetPredicate(
      (widget) => widget is AssetTile && widget.item.key == 'server:$assetId',
    );
    await pumpUntil(tester, tile);
    await tester.tap(tile);
    await pumpUntil(tester, find.text('Online only'));
    expect(
      find.text(serverOnlyName),
      findsOneWidget,
      reason: 'the viewer title',
    );
    expect(find.text('Not on this phone.'), findsOneWidget);
    expect(
      find.text('Back up now'),
      findsNothing,
      reason: 'nothing on this phone can be queued for a server-only row',
    );
    await tester.pageBack();
    // Wait for the route to finish popping before touching the grid again.
    await pumpUntilGone(tester, find.text('Not on this phone.'));
    await pumpUntil(tester, tile);

    // A long press must not select it: there is nothing here to back up. It may
    // still open the viewer, because a gesture detector with only onTap reports
    // the release as a tap — that is not selection.
    await tester.longPress(tile);
    await tester.pump(const Duration(milliseconds: 500));
    expect(find.textContaining('selected'), findsNothing);
    expect(find.byKey(const Key('library-back-up-now')), findsNothing);
    handle.dispose();
  }, timeout: const Timeout(Duration(minutes: 15)));

  testWidgets('a photo this phone backed up flips to the backed-up mark', (
    tester,
  ) async {
    final services = await bootPipeline();
    addTearDown(services.dispose);

    final user = await registerFreshUser(apiDio());
    await signInPipeline(services, user);

    // One real pass over the seeded device photo, through the real API.
    final small = await seededAsset(services, smallPhotoName);
    final report = await services.coordinator.run();
    expect(report.error, isNull, reason: '$report');
    expect(report.authRequired, isFalse, reason: '$report');
    expect(report.uploaded, greaterThanOrEqualTo(1), reason: '$report');
    final row = await queueRow(services, small.localId);
    expect(
      row.serverAssetId,
      isNotNull,
      reason: 'the pass did not upload ${small.fileName}',
    );

    await services.dispose();
    app.main();
    await pumpUntil(tester, find.byType(NavigationBar));

    final handle = tester.ensureSemantics();

    // The queue says "uploaded" and the server's copy carries the same
    // checksum, so the tile is a `both` row: tick mark, and the file name with
    // the backed-up mark — never a second online-only row beside it.
    await pumpUntil(
      tester,
      find.byIcon(Icons.check_rounded),
      timeout: const Duration(minutes: 3),
    );
    await pumpUntil(
      tester,
      find.bySemanticsLabel(
        RegExp('^${RegExp.escape(smallPhotoName)}, Backed up\$'),
      ),
      timeout: const Duration(minutes: 3),
    );
    expect(
      find.bySemanticsLabel(
        RegExp('^${RegExp.escape(smallPhotoName)}, Online only\$'),
      ),
      findsNothing,
      reason: 'the claimed server row must not draw a second tile',
    );
    handle.dispose();
  }, timeout: const Timeout(Duration(minutes: 15)));
}
