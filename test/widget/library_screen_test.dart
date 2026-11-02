import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:photox_mobile/app.dart';
import 'package:photox_mobile/library/backup_status.dart';
import 'package:photox_mobile/media/photo_observer.dart';
import 'package:photox_mobile/settings/settings_store.dart';
import 'package:photox_mobile/sync/transfer_progress.dart';
import 'package:photox_mobile/ui/library_screen.dart';
import 'package:photox_mobile/ui/widgets/asset_tile.dart';
import 'package:photox_mobile/ui/widgets/status_badge.dart';
import 'package:photox_mobile/upload/models.dart';

import 'support/fake_video.dart';

AssetCandidate _asset(
  String id, {
  DateTime? takenAt,
  DateTime? modifiedAt,
  MediaKind kind = MediaKind.photo,
  String mimeType = 'image/jpeg',
}) {
  return AssetCandidate(
    localId: id,
    platform: 'ios',
    kind: kind,
    fileName: '$id.jpg',
    mimeType: mimeType,
    sizeBytes: 1024,
    takenAt: takenAt,
    modifiedAt: modifiedAt,
  );
}

Widget _app(Widget home, {double textScale = 1}) {
  return MaterialApp(
    debugShowCheckedModeBanner: false,
    theme: photoXTheme(),
    builder: textScale == 1
        ? null
        : (context, child) {
            final media = MediaQuery.of(context);
            return MediaQuery(
              data: media.copyWith(textScaler: TextScaler.linear(textScale)),
              child: child!,
            );
          },
    home: home,
  );
}

/// Library screen with quiet defaults; each test overrides one behaviour.
Widget _screen({
  Future<List<AssetCandidate>> Function({
    required int offset,
    int limit,
    String? folderId,
  })?
  loadPage,
  Future<Map<String, UploadState>> Function(List<String> localIds)? loadStates,
  List<AssetCandidate> assets = const <AssetCandidate>[],
  Map<String, UploadState> states = const <String, UploadState>{},
  PhotoPermission permission = PhotoPermission.authorized,
  AppSettings settings = const AppSettings(),
  TransferProgress? progress,
  int queueRevision = 0,
  bool syncing = false,
  Future<void> Function(List<AssetCandidate>)? onBackUpNow,
  VoidCallback? onOpenSettings,
  String? folderId,
  double textScale = 1,
}) {
  return _app(
    LibraryScreen(
      permission: permission,
      settings: settings,
      syncing: syncing,
      queueRevision: queueRevision,
      progress: progress ?? TransferProgress(),
      loadPage:
          loadPage ??
          ({required int offset, int limit = 200, String? folderId}) async =>
              offset == 0 ? assets : const <AssetCandidate>[],
      loadStates: loadStates ?? (ids) async => states,
      thumbnail: (id) async => null,
      loadPreview: (id) async => null,
      loadDetail: (asset) async =>
          const BackupDetail(status: BackupStatus.unknown),
      video: FakeVideoSupport().support,
      onBackUpNow: onBackUpNow ?? (assets) async {},
      onOpenSettings: onOpenSettings ?? () {},
      onSyncNow: () async {},
      onRequestAccess: () async {},
      folderId: folderId,
    ),
    textScale: textScale,
  );
}

/// Four days of twenty assets: tall enough that headers must hand over.
const List<String> _dayLabels = <String>[
  '12 May 2025',
  '11 May 2025',
  '10 May 2025',
  '9 May 2025',
];

List<AssetCandidate> _fourDays() {
  return <AssetCandidate>[
    for (final day in <int>[12, 11, 10, 9])
      for (var index = 0; index < 20; index++)
        _asset('m$day-$index', takenAt: DateTime(2025, 5, day, 12)),
  ];
}

/// Day labels sitting in the pinned band at the top of the scroll view.
///
/// Pinned headers are laid out at the scroll view's top edge, pushed-out ones
/// have a negative offset, and days still below the fold are further down: only
/// a live pinned header lands in the first [band] pixels beneath that edge.
List<String> _pinnedDayLabels(WidgetTester tester, {double band = 60}) {
  final top = tester.getTopLeft(find.byType(CustomScrollView)).dy;
  final pinned = <String>[];
  for (final label in _dayLabels) {
    final finder = find.text(label);
    if (finder.evaluate().isEmpty) continue;
    final offset = tester.getTopLeft(finder).dy - top;
    if (offset >= -0.5 && offset < band) pinned.add(label);
  }
  return pinned;
}

void main() {
  testWidgets('every backup state shows a distinct badge', (tester) async {
    final handle = tester.ensureSemantics();
    final progress = TransferProgress();
    progress.begin(
      localId: 'uploading',
      fileName: 'uploading.jpg',
      totalBytes: 100,
      phase: TransferPhase.uploading,
    );
    progress.advance(40);

    await tester.pumpWidget(
      _screen(
        assets: <AssetCandidate>[
          _asset('done'),
          _asset('uploading'),
          _asset('waiting'),
          _asset('broken'),
          // A video with videos switched off and no queue row is out of scope.
          _asset('clip', kind: MediaKind.video, mimeType: 'video/mp4'),
          _asset('fresh'),
        ],
        states: <String, UploadState>{
          'done': UploadState.uploaded,
          'uploading': UploadState.uploading,
          'waiting': UploadState.pending,
          'broken': UploadState.failedPermanent,
        },
        progress: progress,
      ),
    );
    await tester.pumpAndSettle();

    expect(find.bySemanticsLabel('Backed up'), findsOneWidget);
    expect(find.bySemanticsLabel('Uploading 40%'), findsOneWidget);
    expect(find.bySemanticsLabel('Waiting to back up'), findsOneWidget);
    expect(find.bySemanticsLabel('Backup failed'), findsOneWidget);
    expect(find.bySemanticsLabel('Not in backup scope'), findsOneWidget);
    expect(find.bySemanticsLabel('Not backed up'), findsOneWidget);

    handle.dispose();
  });

  testWidgets('day headers group assets and undated comes last', (
    tester,
  ) async {
    await tester.pumpWidget(
      _screen(
        assets: <AssetCandidate>[
          _asset('a', takenAt: DateTime(2025, 5, 12, 9)),
          _asset('b', takenAt: DateTime(2025, 5, 12, 18)),
          _asset('c', modifiedAt: DateTime(2025, 5, 11, 8)),
          _asset('d'),
        ],
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('12 May 2025'), findsOneWidget);
    expect(find.text('11 May 2025'), findsOneWidget);
    expect(find.text('Undated'), findsOneWidget);

    final first = tester.getTopLeft(find.text('12 May 2025')).dy;
    final second = tester.getTopLeft(find.text('11 May 2025')).dy;
    final undated = tester.getTopLeft(find.text('Undated')).dy;
    expect(first, lessThan(second));
    expect(second, lessThan(undated));
  });

  testWidgets('filter chips narrow the loaded set', (tester) async {
    await tester.pumpWidget(
      _screen(
        assets: <AssetCandidate>[
          _asset('done'),
          _asset('fresh'),
          _asset('broken'),
        ],
        states: <String, UploadState>{
          'done': UploadState.uploaded,
          'broken': UploadState.failedPermanent,
        },
      ),
    );
    await tester.pumpAndSettle();

    expect(find.byType(AssetTile), findsNWidgets(3));

    await tester.tap(find.byKey(const Key('filter-notBackedUp')));
    await tester.pumpAndSettle();
    expect(find.byKey(const ValueKey<String>('done')), findsNothing);
    expect(find.byKey(const ValueKey<String>('fresh')), findsOneWidget);
    expect(find.byKey(const ValueKey<String>('broken')), findsOneWidget);

    await tester.tap(find.byKey(const Key('filter-failed')));
    await tester.pumpAndSettle();
    expect(find.byKey(const ValueKey<String>('fresh')), findsNothing);
    expect(find.byKey(const ValueKey<String>('broken')), findsOneWidget);

    await tester.tap(find.byKey(const Key('filter-all')));
    await tester.pumpAndSettle();
    expect(find.byType(AssetTile), findsNWidgets(3));
  });

  testWidgets('long press selects and Back up now sends the selection', (
    tester,
  ) async {
    List<AssetCandidate>? queued;
    await tester.pumpWidget(
      _screen(
        assets: <AssetCandidate>[_asset('one'), _asset('two'), _asset('three')],
        onBackUpNow: (assets) async => queued = assets,
      ),
    );
    await tester.pumpAndSettle();

    await tester.longPress(find.byKey(const ValueKey<String>('one')));
    await tester.pumpAndSettle();
    expect(find.text('1 selected'), findsOneWidget);
    expect(find.text('Cancel'), findsOneWidget);

    await tester.tap(find.byKey(const ValueKey<String>('two')));
    await tester.pumpAndSettle();
    expect(find.text('2 selected'), findsOneWidget);

    await tester.tap(find.byKey(const Key('library-back-up-now')));
    await tester.pumpAndSettle();

    expect(queued!.map((asset) => asset.localId), <String>['one', 'two']);
    expect(find.text('2 selected'), findsNothing);
    expect(find.text('Cancel'), findsNothing);
  });

  testWidgets('a fully excluded selection offers no backup action', (
    tester,
  ) async {
    await tester.pumpWidget(
      _screen(
        assets: <AssetCandidate>[
          _asset('clip', kind: MediaKind.video, mimeType: 'video/mp4'),
        ],
      ),
    );
    await tester.pumpAndSettle();

    await tester.longPress(find.byKey(const ValueKey<String>('clip')));
    await tester.pumpAndSettle();

    expect(find.text('1 selected'), findsOneWidget);
    expect(find.byKey(const Key('library-back-up-now')), findsNothing);
  });

  testWidgets('denied access and an empty library each explain themselves', (
    tester,
  ) async {
    await tester.pumpWidget(_screen(permission: PhotoPermission.denied));
    await tester.pumpAndSettle();
    expect(find.text('Photo access is off'), findsOneWidget);
    expect(find.text('Try again'), findsOneWidget);
    expect(find.byType(AssetTile), findsNothing);

    await tester.pumpWidget(_screen());
    await tester.pumpAndSettle();
    expect(find.text('No photos yet'), findsOneWidget);
  });

  testWidgets('the next page loads when the first one ends', (tester) async {
    final offsets = <int>[];
    await tester.pumpWidget(
      _screen(
        loadPage:
            ({required int offset, int limit = 200, String? folderId}) async {
              offsets.add(offset);
              if (offset == 0) {
                return <AssetCandidate>[
                  for (var index = 0; index < 200; index++)
                    _asset('page1-$index'),
                ];
              }
              if (offset == 200) {
                return <AssetCandidate>[_asset('page2-0'), _asset('page2-1')];
              }
              return const <AssetCandidate>[];
            },
      ),
    );
    await tester.pumpAndSettle();
    expect(offsets, <int>[0]);

    for (var attempt = 0; attempt < 12 && offsets.length < 2; attempt++) {
      await tester.drag(find.byType(CustomScrollView), const Offset(0, -1200));
      await tester.pump();
    }
    await tester.pumpAndSettle();

    expect(offsets, <int>[0, 200]);

    // The appended page sits just past the old bottom of the list.
    await tester.drag(find.byType(CustomScrollView), const Offset(0, -800));
    await tester.pumpAndSettle();
    expect(find.byKey(const ValueKey<String>('page2-0')), findsOneWidget);
  });

  testWidgets('changing the backup scope reloads the grid for that album', (
    tester,
  ) async {
    final calls = <String?>[];
    Future<List<AssetCandidate>> loader({
      required int offset,
      int limit = 200,
      String? folderId,
    }) async {
      calls.add(folderId);
      return offset == 0 ? <AssetCandidate>[_asset('scoped')] : const [];
    }

    await tester.pumpWidget(_screen(loadPage: loader));
    await tester.pumpAndSettle();
    expect(calls, <String?>[null]);

    // Same screen, scope narrowed to one album: the old page is not that set.
    await tester.pumpWidget(_screen(loadPage: loader, folderId: 'album-1'));
    await tester.pumpAndSettle();
    expect(calls, <String?>[null, 'album-1']);
    expect(find.byType(AssetTile), findsOneWidget);
  });

  testWidgets('the header and selection bar survive textScale 1.3', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(400, 800);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    await tester.pumpWidget(
      _screen(
        assets: <AssetCandidate>[_asset('one'), _asset('two')],
        syncing: true,
        textScale: 1.3,
      ),
    );
    // The syncing spinner never settles, so pump a frame at a time.
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 300));
    expect(tester.takeException(), isNull);

    await tester.longPress(find.byKey(const ValueKey<String>('one')));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 300));
    expect(tester.takeException(), isNull);
    expect(find.text('1 selected'), findsOneWidget);
  });

  testWidgets('only the current day header stays pinned', (tester) async {
    tester.view.physicalSize = const Size(400, 800);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    await tester.pumpWidget(_screen(assets: _fourDays()));
    await tester.pumpAndSettle();
    expect(_pinnedDayLabels(tester), <String>['12 May 2025']);

    // Past the first day: its header is pushed out, the second one takes the
    // pinned slot alone.
    await tester.drag(find.byType(CustomScrollView), const Offset(0, -600));
    await tester.pumpAndSettle();

    expect(_pinnedDayLabels(tester), <String>['11 May 2025']);
    final dismissed = find.text('12 May 2025');
    if (dismissed.evaluate().isNotEmpty) {
      final top = tester.getTopLeft(find.byType(CustomScrollView)).dy;
      expect(tester.getTopLeft(dismissed).dy - top, lessThan(0));
    }
  });

  testWidgets('scrolling never pins two headers and keeps days descending', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(400, 800);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    await tester.pumpWidget(_screen(assets: _fourDays()));
    await tester.pumpAndSettle();

    final seen = <String>[];
    for (var step = 0; step < 14; step++) {
      await tester.drag(find.byType(CustomScrollView), const Offset(0, -100));
      await tester.pump();

      final pinned = _pinnedDayLabels(tester);
      expect(
        pinned.length,
        lessThanOrEqualTo(1),
        reason: 'two day headers pinned at once: $pinned',
      );
      if (pinned.isNotEmpty && (seen.isEmpty || seen.last != pinned.single)) {
        seen.add(pinned.single);
      }
    }

    // Every header that did pin came in newest-first order, none twice.
    expect(seen, _dayLabels.take(seen.length).toList());
    expect(seen.length, greaterThanOrEqualTo(3));
  });

  testWidgets('a failed state read leaves the tiles unmarked', (tester) async {
    await tester.pumpWidget(
      _screen(
        assets: <AssetCandidate>[_asset('one'), _asset('two')],
        loadStates: (ids) async => throw StateError('queue read failed'),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.byType(AssetTile), findsNWidgets(2));
    // No row was read, so no tile may claim "not backed up" (or anything else).
    expect(find.byType(StatusBadge), findsNothing);
  });
}
