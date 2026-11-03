import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:photox_mobile/app.dart';
import 'package:photox_mobile/library/backup_status.dart';
import 'package:photox_mobile/media/photo_observer.dart';
import 'package:photox_mobile/server/server_asset.dart';
import 'package:photox_mobile/settings/settings_store.dart';
import 'package:photox_mobile/sync/transfer_progress.dart';
import 'package:photox_mobile/ui/library_screen.dart';
import 'package:photox_mobile/ui/widgets/asset_tile.dart';
import 'package:photox_mobile/upload/models.dart';

import 'support/fake_video.dart';

AssetCandidate _asset(
  String id, {
  DateTime? takenAt,
  MediaKind kind = MediaKind.photo,
}) {
  return AssetCandidate(
    localId: id,
    platform: 'ios',
    kind: kind,
    fileName: '$id.jpg',
    mimeType: 'image/jpeg',
    sizeBytes: 1024,
    takenAt: takenAt,
  );
}

ServerAsset _server(String id, {DateTime? takenAt, String? title}) {
  return ServerAsset(
    id: id,
    kind: 'photo',
    uploadedAt: takenAt ?? DateTime(2025, 5, 12, 12),
    takenAt: takenAt,
    title: title ?? '$id.jpg',
  );
}

/// One server page carrying exactly [items].
typedef _ServerPage = Future<ServerAssetPage> Function({
  DateTime? dateTo,
  int offset,
  int limit,
});

_ServerPage _serve(List<ServerAsset> items) {
  return ({DateTime? dateTo, int offset = 0, int limit = 100}) async =>
      offset == 0
      ? ServerAssetPage(items: items, total: items.length)
      : const ServerAssetPage(items: <ServerAsset>[], total: 0);
}

Future<ServerAssetPage> _offline({
  DateTime? dateTo,
  int offset = 0,
  int limit = 100,
}) async {
  throw StateError('server unreachable');
}

/// Library screen on the main tab: both halves wired, device half faked.
Widget _screen({
  List<AssetCandidate> assets = const <AssetCandidate>[],
  Map<String, UploadState> states = const <String, UploadState>{},
  PhotoPermission permission = PhotoPermission.authorized,
  _ServerPage? serverPage,
  Future<Map<String, String>> Function(List<String> localIds)? serverIds,
  List<List<AssetCandidate>>? queued,
}) {
  return MaterialApp(
    debugShowCheckedModeBanner: false,
    theme: photoXTheme(),
    home: LibraryScreen(
      permission: permission,
      settings: const AppSettings(),
      syncing: false,
      queueRevision: 0,
      progress: TransferProgress(),
      loadPage: ({
        required int offset,
        int limit = 200,
        String? folderId,
      }) async => offset == 0 ? assets : const <AssetCandidate>[],
      loadStates: (ids) async => states,
      thumbnail: (id, {int size = 128}) async => null,
      loadPreview: (id) async => null,
      loadDetail: (asset) async =>
          const BackupDetail(status: BackupStatus.unknown),
      video: FakeVideoSupport().support,
      onBackUpNow: (picked) async => queued?.add(picked),
      onOpenSettings: () {},
      onSyncNow: () async {},
      onRequestAccess: () async {},
      serverPage: serverPage,
      serverIds: serverIds ?? (ids) async => const <String, String>{},
      serverThumb: (fileId) async => null,
    ),
  );
}

void main() {
  testWidgets('a server-only asset adds a tile with the Online only mark', (
    tester,
  ) async {
    final handle = tester.ensureSemantics();
    final queued = <List<AssetCandidate>>[];

    await tester.pumpWidget(
      _screen(
        assets: <AssetCandidate>[
          _asset('one', takenAt: DateTime(2025, 5, 12, 12)),
        ],
        states: <String, UploadState>{'one': UploadState.uploaded},
        serverPage: _serve(<ServerAsset>[
          _server('s1', takenAt: DateTime(2025, 5, 11, 12), title: 'cloud.jpg'),
        ]),
        queued: queued,
      ),
    );
    await tester.pumpAndSettle();

    // One row per photo: the device's own plus the server's extra.
    expect(find.byType(AssetTile), findsNWidgets(2));
    expect(find.bySemanticsLabel('cloud.jpg, Online only'), findsOneWidget);

    // Long-pressing a row with nothing on this phone starts no selection.
    final online = find.byKey(const ValueKey<String>('server:s1'));
    expect(tester.widget<AssetTile>(online).onLongPress, isNull);

    final gesture = await tester.startGesture(tester.getCenter(online));
    await tester.pump(const Duration(milliseconds: 600));
    expect(find.text('1 selected'), findsNothing);
    expect(find.byKey(const Key('library-back-up-now')), findsNothing);

    await gesture.up();
    await tester.pumpAndSettle();
    expect(queued, isEmpty);

    handle.dispose();
  });

  testWidgets('a server row the device half claims is not drawn twice', (
    tester,
  ) async {
    final handle = tester.ensureSemantics();

    await tester.pumpWidget(
      _screen(
        assets: <AssetCandidate>[
          _asset('one', takenAt: DateTime(2025, 5, 12, 12)),
        ],
        states: <String, UploadState>{'one': UploadState.uploaded},
        serverPage: _serve(<ServerAsset>[
          _server('s1', takenAt: DateTime(2025, 5, 12, 12)),
        ]),
        serverIds: (ids) async => <String, String>{'one': 's1'},
      ),
    );
    await tester.pumpAndSettle();

    // The claim drops the server row; the device row says both sides have it.
    expect(find.byType(AssetTile), findsOneWidget);
    expect(find.bySemanticsLabel('one.jpg, Backed up'), findsOneWidget);
    expect(find.byIcon(Icons.cloud_outlined), findsNothing);

    handle.dispose();
  });

  testWidgets('Online only filters to the server rows and is counted apart', (
    tester,
  ) async {
    await tester.pumpWidget(
      _screen(
        assets: <AssetCandidate>[
          _asset('one', takenAt: DateTime(2025, 5, 12, 12)),
        ],
        serverPage: _serve(<ServerAsset>[
          _server('s1', takenAt: DateTime(2025, 5, 11, 12)),
          _server('s2', takenAt: DateTime(2025, 5, 10, 12)),
        ]),
      ),
    );
    await tester.pumpAndSettle();

    // The server rows are not part of the "not backed up" pile.
    expect(
      find.text('3 items · 1 not backed up · 2 online only'),
      findsOneWidget,
    );
    expect(find.text('Not backed up 1'), findsOneWidget);

    await tester.tap(find.byKey(const Key('filter-onlineOnly')));
    await tester.pumpAndSettle();

    expect(find.byType(AssetTile), findsNWidgets(2));
    expect(find.byKey(const ValueKey<String>('server:s1')), findsOneWidget);
    expect(find.byKey(const ValueKey<String>('server:s2')), findsOneWidget);
    expect(find.byKey(const ValueKey<String>('one')), findsNothing);
  });

  testWidgets('a failing server half keeps the device grid and says so', (
    tester,
  ) async {
    await tester.pumpWidget(
      _screen(
        assets: <AssetCandidate>[
          _asset('one', takenAt: DateTime(2025, 5, 12, 12)),
        ],
        serverPage: _offline,
      ),
    );
    await tester.pumpAndSettle();

    expect(find.byKey(const Key('library-server-banner')), findsOneWidget);
    expect(find.text('Server unavailable'), findsOneWidget);
    // The rows it cannot show claim no place in the timeline or the chips.
    expect(find.byType(AssetTile), findsOneWidget);
    expect(find.byIcon(Icons.cloud_outlined), findsNothing);
    expect(find.byKey(const Key('filter-onlineOnly')), findsNothing);
  });

  testWidgets('denied access with server rows renders the grid, not the wall', (
    tester,
  ) async {
    await tester.pumpWidget(
      _screen(
        permission: PhotoPermission.denied,
        serverPage: _serve(<ServerAsset>[
          _server('s1', takenAt: DateTime(2025, 5, 11, 12)),
        ]),
      ),
    );
    await tester.pumpAndSettle();

    // The server half is readable, so it keeps a grid under a banner instead
    // of the full-screen permission state.
    expect(find.byType(CustomScrollView), findsOneWidget);
    expect(find.byType(AssetTile), findsOneWidget);
    expect(find.byKey(const Key('library-permission-banner')), findsOneWidget);
    expect(find.textContaining('Server photos are shown'), findsOneWidget);
    // No device rows means no device filters and no device claims.
    expect(find.byKey(const Key('filter-notBackedUp')), findsNothing);
    expect(find.byKey(const Key('filter-onlineOnly')), findsOneWidget);
  });
}
