import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:photox_mobile/app.dart';
import 'package:photox_mobile/library/backup_status.dart';
import 'package:photox_mobile/library/library_item.dart';
import 'package:photox_mobile/media/photo_observer.dart';
import 'package:photox_mobile/media/video_playback.dart';
import 'package:photox_mobile/server/server_asset.dart';
import 'package:photox_mobile/ui/viewer_screen.dart';

import 'support/fake_video.dart';

/// A real 1x1 PNG: `Image.memory` must decode for the zoom surface to exist.
final Uint8List _preview = base64Decode(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/'
  'q842iQAAAABJRU5ErkJggg==',
);

AssetCandidate _asset(
  String id, {
  MediaKind kind = MediaKind.photo,
  DateTime? takenAt,
}) {
  return AssetCandidate(
    localId: id,
    platform: 'ios',
    kind: kind,
    fileName: '$id.heic',
    mimeType: 'image/heic',
    sizeBytes: 0,
    takenAt: takenAt ?? DateTime(2025, 5, 12, 14, 32),
  );
}

ServerAsset _server(
  String id, {
  String kind = 'photo',
  DateTime? takenAt,
  String? title,
}) {
  return ServerAsset(
    id: id,
    kind: kind,
    uploadedAt: DateTime(2025, 5, 12, 14, 32),
    takenAt: takenAt,
    title: title ?? '$id.jpg',
  );
}

/// Viewer over plain device rows: the device half as the grid builds it.
Widget _viewer(
  List<AssetCandidate> assets, {
  int initialIndex = 0,
  Map<String, BackupDetail> details = const <String, BackupDetail>{},
  List<List<AssetCandidate>>? queued,
  Uint8List? preview,
  VideoSupport? video,
}) {
  return _mergedViewer(
    <LibraryItem>[for (final asset in assets) LibraryItem.deviceOnly(asset)],
    initialIndex: initialIndex,
    details: details,
    queued: queued,
    preview: preview,
    video: video,
  );
}

/// Viewer over merged rows, so a page can be server-only or on both sides.
Widget _mergedViewer(
  List<LibraryItem> items, {
  int initialIndex = 0,
  Map<String, BackupDetail> details = const <String, BackupDetail>{},
  List<List<AssetCandidate>>? queued,
  Uint8List? preview,
  VideoSupport? video,
  Future<BackupDetail> Function(AssetCandidate asset)? loadDetail,
  Future<Uint8List?> Function(LibraryItem item)? loadPreview,
}) {
  return MaterialApp(
    theme: photoXTheme(),
    home: ViewerScreen(
      items: items,
      initialIndex: initialIndex,
      loadPreview: loadPreview ?? (item) async => preview,
      loadDetail:
          loadDetail ??
          (asset) async =>
              details[asset.localId] ??
              const BackupDetail(status: BackupStatus.unknown),
      video: video ?? FakeVideoSupport().support,
      onBackUpNow: (picked) async => queued?.add(picked),
    ),
  );
}

/// Magnification the page is actually showing.
double _scale(WidgetTester tester) {
  final viewer = tester.widget<InteractiveViewer>(
    find.byType(InteractiveViewer).first,
  );
  return viewer.transformationController!.value.getMaxScaleOnAxis();
}

/// Taps the picture where no control sits: the centre glyph starts playback
/// and the bar owns the bottom strip.
Future<void> _tapPicture(WidgetTester tester) async {
  await tester.tapAt(
    tester.getCenter(find.byType(PageView)) + const Offset(0, -140),
  );
  await tester.pumpAndSettle();
}

ScrollPhysics? _pagerPhysics(WidgetTester tester) =>
    tester.widget<PageView>(find.byType(PageView)).physics;

void main() {
  testWidgets('a photo nobody uploaded offers the one action', (tester) async {
    final queued = <List<AssetCandidate>>[];
    await tester.pumpWidget(
      _viewer(<AssetCandidate>[_asset('a')], queued: queued),
    );
    await tester.pumpAndSettle();

    expect(find.text('Not backed up yet'), findsOneWidget);
    expect(
      find.text('This phone has not uploaded these bytes.'),
      findsOneWidget,
    );
    expect(find.text('12 May 2025 · 14:32'), findsOneWidget);

    await tester.tap(find.byKey(const Key('viewer-back-up-now')));
    await tester.pumpAndSettle();

    expect(queued, hasLength(1));
    expect(queued.single.single.localId, 'a');
  });

  testWidgets('a backed-up photo has nothing to queue', (tester) async {
    await tester.pumpWidget(
      _viewer(
        <AssetCandidate>[_asset('a')],
        details: const <String, BackupDetail>{
          'a': BackupDetail(status: BackupStatus.backedUp),
        },
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('Backed up from this phone'), findsOneWidget);
    expect(find.byKey(const Key('viewer-back-up-now')), findsNothing);
  });

  testWidgets('a page only the server holds says so and offers nothing', (
    tester,
  ) async {
    final support = FakeVideoSupport();
    var detailReads = 0;
    final previews = <String>[];

    await tester.pumpWidget(
      _mergedViewer(
        <LibraryItem>[
          // A server video: no bytes on this phone, so no player either.
          LibraryItem.onlineOnly(
            _server(
              's1',
              kind: 'video',
              takenAt: DateTime(2025, 5, 12, 14, 32),
            ),
          ),
        ],
        preview: _preview,
        video: support.support,
        loadPreview: (item) async {
          previews.add(item.key);
          return _preview;
        },
        loadDetail: (asset) async {
          detailReads++;
          return const BackupDetail(status: BackupStatus.unknown);
        },
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('Online only'), findsOneWidget);
    expect(find.text('Not on this phone.'), findsOneWidget);
    expect(find.byKey(const Key('viewer-back-up-now')), findsNothing);
    // There is no queue row to ask and no player for bytes that are not here.
    expect(detailReads, 0);
    expect(support.created, isEmpty);
    expect(support.progress, isEmpty);
    expect(find.byKey(const Key('viewer-video-scrubber')), findsNothing);
    expect(find.byKey(const Key('viewer-video-play-button')), findsNothing);
    // The poster comes from the server; the date is the capture date.
    expect(previews, <String>['server:s1']);
    expect(find.text('12 May 2025 · 14:32'), findsOneWidget);
  });

  testWidgets('a page on both sides reads Backed up and keeps its timeline', (
    tester,
  ) async {
    final support = FakeVideoSupport();
    var detailReads = 0;

    await tester.pumpWidget(
      _mergedViewer(
        <LibraryItem>[
          LibraryItem.backedUp(
            _asset('v', kind: MediaKind.video),
            server: _server('s1', kind: 'video'),
          ),
        ],
        preview: _preview,
        video: support.support,
        loadDetail: (asset) async {
          detailReads++;
          return const BackupDetail(status: BackupStatus.unknown);
        },
      ),
    );
    await tester.pumpAndSettle();

    // The badge comes from provenance, not from a queue read.
    expect(find.text('Backed up'), findsOneWidget);
    expect(detailReads, 0);
    expect(find.byKey(const Key('viewer-back-up-now')), findsNothing);
    // The bytes are on this phone, so the player and its scrubber still exist.
    expect(support.created, hasLength(1));
    expect(find.byKey(const Key('viewer-video-scrubber')), findsOneWidget);
    expect(find.text('12 May 2025 · 14:32'), findsOneWidget);
  });

  testWidgets('a failure shows why, and retries', (tester) async {
    final queued = <List<AssetCandidate>>[];
    await tester.pumpWidget(
      _viewer(
        <AssetCandidate>[_asset('a')],
        queued: queued,
        details: const <String, BackupDetail>{
          'a': BackupDetail(
            status: BackupStatus.failed,
            error: 'Unsupported file type',
          ),
        },
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('Backup failed'), findsOneWidget);
    expect(find.text('Unsupported file type'), findsOneWidget);

    await tester.tap(find.byKey(const Key('viewer-back-up-now')));
    await tester.pumpAndSettle();
    expect(queued.single.single.localId, 'a');
  });

  testWidgets('an excluded asset explains itself and offers nothing', (
    tester,
  ) async {
    await tester.pumpWidget(
      _viewer(
        <AssetCandidate>[_asset('a', kind: MediaKind.video)],
        details: const <String, BackupDetail>{
          'a': BackupDetail(status: BackupStatus.excluded),
        },
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('Not in backup scope'), findsOneWidget);
    expect(
      find.textContaining('cannot back up this kind of file'),
      findsOneWidget,
    );
    expect(find.byKey(const Key('viewer-back-up-now')), findsNothing);
    // Out of backup scope still means playable: the player is there.
    expect(find.byKey(const Key('viewer-video-play-button')), findsOneWidget);
  });

  testWidgets('swiping loads the next photo and its own badge', (tester) async {
    await tester.pumpWidget(
      _viewer(
        <AssetCandidate>[
          _asset('a', takenAt: DateTime(2025, 5, 12, 14, 32)),
          _asset('b', takenAt: DateTime(2025, 5, 11, 9, 5)),
        ],
        preview: _preview,
        details: const <String, BackupDetail>{
          'a': BackupDetail(status: BackupStatus.unknown),
          'b': BackupDetail(status: BackupStatus.queued),
        },
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('Not backed up yet'), findsOneWidget);

    await tester.drag(find.byType(PageView), const Offset(-600, 0));
    await tester.pumpAndSettle();

    expect(find.text('Waiting to back up'), findsOneWidget);
    expect(find.text('Not backed up yet'), findsNothing);
    // The page moved: the swipe was not mistaken for a pan.
    expect(find.text('11 May 2025 · 09:05'), findsOneWidget);
  });

  testWidgets('a pinch zooms the photo instead of turning the page', (
    tester,
  ) async {
    await tester.pumpWidget(
      _viewer(<AssetCandidate>[
        _asset('a', takenAt: DateTime(2025, 5, 12, 14, 32)),
        _asset('b', takenAt: DateTime(2025, 5, 11, 9, 5)),
      ], preview: _preview),
    );
    await tester.pumpAndSettle();
    expect(_scale(tester), 1);

    // Two fingers spreading horizontally: the pager's drag slop is half the
    // scale slop, so this is the gesture that used to turn the page.
    final first = await tester.startGesture(const Offset(150, 300));
    final second = await tester.startGesture(const Offset(250, 300));
    await first.moveBy(const Offset(-60, 0));
    await second.moveBy(const Offset(60, 0));
    await tester.pump();
    // Locked from the second finger down, before any movement settled it.
    expect(_pagerPhysics(tester), isA<NeverScrollableScrollPhysics>());

    await first.up();
    await second.up();
    await tester.pumpAndSettle();

    expect(_scale(tester), greaterThan(1.2));
    expect(find.text('12 May 2025 · 14:32'), findsOneWidget);
    expect(find.text('11 May 2025 · 09:05'), findsNothing);
  });

  testWidgets('a double tap zooms in and back out', (tester) async {
    await tester.pumpWidget(
      _viewer(<AssetCandidate>[_asset('a')], preview: _preview),
    );
    await tester.pumpAndSettle();

    await tester.tapAt(const Offset(200, 300));
    await tester.pump(const Duration(milliseconds: 60));
    await tester.tapAt(const Offset(200, 300));
    await tester.pumpAndSettle();

    expect(_scale(tester), closeTo(2.5, 0.01));
    expect(_pagerPhysics(tester), isA<NeverScrollableScrollPhysics>());

    await tester.tapAt(const Offset(200, 300));
    await tester.pump(const Duration(milliseconds: 60));
    await tester.tapAt(const Offset(200, 300));
    await tester.pumpAndSettle();

    expect(_scale(tester), 1);
    expect(_pagerPhysics(tester), isNull);
  });

  testWidgets('a magnified photo pans instead of paging', (tester) async {
    await tester.pumpWidget(
      _viewer(<AssetCandidate>[
        _asset('a', takenAt: DateTime(2025, 5, 12, 14, 32)),
        _asset('b', takenAt: DateTime(2025, 5, 11, 9, 5)),
      ], preview: _preview),
    );
    await tester.pumpAndSettle();

    await tester.tapAt(const Offset(200, 300));
    await tester.pump(const Duration(milliseconds: 60));
    await tester.tapAt(const Offset(200, 300));
    await tester.pumpAndSettle();

    await tester.drag(find.byType(PageView), const Offset(-600, 0));
    await tester.pumpAndSettle();

    expect(find.text('12 May 2025 · 14:32'), findsOneWidget);
    expect(find.text('11 May 2025 · 09:05'), findsNothing);
  });

  testWidgets('a photo with no platform preview says so', (tester) async {
    await tester.pumpWidget(_viewer(<AssetCandidate>[_asset('a')]));
    await tester.pumpAndSettle();

    expect(find.text('No preview available'), findsOneWidget);
  });

  testWidgets('a video opens on its poster and plays on tap', (tester) async {
    final support = FakeVideoSupport();
    await tester.pumpWidget(
      _viewer(
        <AssetCandidate>[_asset('v', kind: MediaKind.video)],
        preview: _preview,
        video: support.support,
      ),
    );
    await tester.pumpAndSettle();

    expect(support.created, hasLength(1));
    expect(support.latest.calls, contains('load'));
    // The centre glyph and the bar button both say "play".
    expect(find.byIcon(Icons.play_arrow_rounded), findsNWidgets(2));
    expect(find.byKey(const Key('viewer-video-scrubber')), findsOneWidget);

    // Tapping the picture hides the chrome and nothing else.
    await _tapPicture(tester);

    expect(find.byKey(const Key('viewer-video-play-button')), findsNothing);
    expect(find.byKey(const Key('viewer-video-scrubber')), findsNothing);
    expect(find.byIcon(Icons.play_arrow_rounded), findsNothing);
    expect(support.latest.calls, isNot(contains('play')));
    expect(support.latest.calls, isNot(contains('pause')));

    // ...and brings them back.
    await _tapPicture(tester);
    expect(find.byKey(const Key('viewer-video-play-button')), findsOneWidget);
  });

  testWidgets('the centre button starts the clip, the bar stops it', (
    tester,
  ) async {
    final support = FakeVideoSupport();
    await tester.pumpWidget(
      _viewer(<AssetCandidate>[
        _asset('v', kind: MediaKind.video),
      ], video: support.support),
    );
    await tester.pumpAndSettle();

    await tester.tap(find.byKey(const Key('viewer-video-play-glyph')));
    await tester.pumpAndSettle();

    expect(support.latest.calls, contains('play'));
    expect(find.byKey(const Key('viewer-video-play-glyph')), findsNothing);
    expect(
      find.descendant(
        of: find.byKey(const Key('viewer-video-play-button')),
        matching: find.byIcon(Icons.pause_rounded),
      ),
      findsOneWidget,
    );

    await tester.tap(find.byKey(const Key('viewer-video-play-button')));
    await tester.pumpAndSettle();
    expect(support.latest.calls, contains('pause'));
  });

  testWidgets('a playing clip survives the controls being hidden', (
    tester,
  ) async {
    final support = FakeVideoSupport();
    await tester.pumpWidget(
      _viewer(<AssetCandidate>[
        _asset('v', kind: MediaKind.video),
      ], video: support.support),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('viewer-video-play-button')));
    await tester.pumpAndSettle();
    expect(support.latest.state.playing, isTrue);

    await _tapPicture(tester);

    expect(find.byKey(const Key('viewer-video-play-button')), findsNothing);
    expect(support.latest.calls, isNot(contains('pause')));
    expect(
      support.latest.state.playing,
      isTrue,
      reason: 'hiding chrome must not stop the clip',
    );
  });

  testWidgets('a video that cannot be read offers a retry', (tester) async {
    final support = FakeVideoSupport(readFailure: true);
    await tester.pumpWidget(
      _viewer(<AssetCandidate>[
        _asset('v', kind: MediaKind.video),
      ], video: support.support),
    );
    await tester.pumpAndSettle();

    expect(
      find.text('Could not read this video from this device.'),
      findsOneWidget,
    );
    expect(find.byKey(const Key('viewer-video-retry')), findsOneWidget);
    expect(support.created, isEmpty, reason: 'no player without bytes');
  });

  testWidgets('the player is disposed when the page goes away', (tester) async {
    final support = FakeVideoSupport();
    await tester.pumpWidget(
      _viewer(<AssetCandidate>[
        _asset('v', kind: MediaKind.video, takenAt: DateTime(2025, 5, 12)),
        _asset('p', takenAt: DateTime(2025, 5, 11)),
      ], video: support.support),
    );
    await tester.pumpAndSettle();
    expect(support.created, hasLength(1));

    await tester.drag(find.byType(PageView), const Offset(-600, 0));
    await tester.pumpAndSettle();

    expect(support.latest.calls, contains('dispose'));
  });

  testWidgets('coming back to a video resumes where it stopped', (
    tester,
  ) async {
    final support = FakeVideoSupport();
    await tester.pumpWidget(
      _viewer(<AssetCandidate>[
        _asset('v', kind: MediaKind.video, takenAt: DateTime(2025, 5, 12)),
        _asset('p', takenAt: DateTime(2025, 5, 11)),
      ], video: support.support),
    );
    await tester.pumpAndSettle();

    await tester.tap(find.byKey(const Key('viewer-video-play-button')));
    await tester.pumpAndSettle();
    support.latest.emit(
      const VideoPlaybackState(
        ready: true,
        playing: true,
        position: Duration(seconds: 7),
        duration: Duration(seconds: 30),
      ),
    );
    await tester.pump();

    await tester.drag(find.byType(PageView), const Offset(-600, 0));
    await tester.pumpAndSettle();
    await tester.drag(find.byType(PageView), const Offset(600, 0));
    await tester.pumpAndSettle();

    expect(support.created, hasLength(2));
    expect(support.latest.calls, contains('seek:7'));
  });

  testWidgets('dragging the timeline seeks instead of paging', (tester) async {
    final support = FakeVideoSupport();
    await tester.pumpWidget(
      _viewer(<AssetCandidate>[
        _asset('v', kind: MediaKind.video, takenAt: DateTime(2025, 5, 12)),
        _asset('p', takenAt: DateTime(2025, 5, 11)),
      ], video: support.support),
    );
    await tester.pumpAndSettle();

    await tester.drag(
      find.byKey(const Key('viewer-video-scrubber')),
      const Offset(80, 0),
    );
    await tester.pumpAndSettle();

    expect(
      support.latest.calls.where((call) => call.startsWith('seek:')),
      isNotEmpty,
      reason: 'the slider must own the drag, not the pager',
    );
    // Still on the video: the pager did not take the gesture.
    expect(find.byKey(const Key('viewer-video-scrubber')), findsOneWidget);
    expect(support.latest.calls, isNot(contains('dispose')));
  });

  testWidgets('backgrounding the app pauses the clip', (tester) async {
    final support = FakeVideoSupport();
    await tester.pumpWidget(
      _viewer(<AssetCandidate>[
        _asset('v', kind: MediaKind.video),
      ], video: support.support),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('viewer-video-play-button')));
    await tester.pumpAndSettle();
    expect(support.latest.calls, contains('play'));

    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.inactive);
    await tester.pumpAndSettle();

    expect(support.latest.calls, contains('pause'));
  });

  testWidgets('the timeline button plays and pauses', (tester) async {
    final support = FakeVideoSupport();
    await tester.pumpWidget(
      _viewer(<AssetCandidate>[
        _asset('v', kind: MediaKind.video),
      ], video: support.support),
    );
    await tester.pumpAndSettle();

    final button = find.byKey(const Key('viewer-video-play-button'));
    expect(button, findsOneWidget);
    // Revealed before tapping: play is offered, not pause.
    expect(
      find.descendant(
        of: button,
        matching: find.byIcon(Icons.play_arrow_rounded),
      ),
      findsOneWidget,
    );

    await tester.tap(button);
    await tester.pumpAndSettle();

    expect(support.latest.calls, contains('play'));
    expect(
      find.descendant(of: button, matching: find.byIcon(Icons.pause_rounded)),
      findsOneWidget,
    );

    await tester.tap(button);
    await tester.pumpAndSettle();
    expect(support.latest.calls, contains('pause'));
  });
}
