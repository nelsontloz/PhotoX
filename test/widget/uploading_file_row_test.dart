import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:photox_mobile/media/photo_observer.dart';
import 'package:photox_mobile/sync/transfer_progress.dart';
import 'package:photox_mobile/ui/home_screen.dart';
import 'package:photox_mobile/ui/widgets/uploading_file_row.dart';
import 'package:photox_mobile/upload/upload_queue.dart';

/// 1x1 PNGs, so `Image.memory` decodes in the test harness.
Uint8List _png(String base64) => base64Decode(base64);

final Uint8List _red = _png(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/'
  'iZk9HQAAAABJRU5ErkJggg==',
);
final Uint8List _blue = _png(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYPj/HwADAgH/'
  '5ncLrgAAAABJRU5ErkJggg==',
);

Widget _app(Widget child) {
  return MaterialApp(
    debugShowCheckedModeBanner: false,
    themeMode: ThemeMode.dark,
    darkTheme: ThemeData(
      useMaterial3: true,
      colorScheme: ColorScheme.fromSeed(
        seedColor: const Color(0xFF4C6FFF),
        brightness: Brightness.dark,
      ),
    ),
    home: Scaffold(body: Center(child: child)),
  );
}

/// A transfer whose clock the test moves by hand, so notifications are not
/// throttled by the 200 ms interval.
({TransferProgress progress, void Function(Duration) tick}) _transfer() {
  var now = DateTime(2026, 1, 1);
  return (
    progress: TransferProgress(clock: () => now),
    tick: (elapsed) => now = now.add(elapsed),
  );
}

Future<void> _pumpRow(
  WidgetTester tester,
  TransferProgress progress, {
  Future<Uint8List?> Function(String localId)? thumbnail,
}) {
  return tester.pumpWidget(
    _app(UploadingFileRow(progress: progress, thumbnail: thumbnail)),
  );
}

MemoryImage _rendered(WidgetTester tester) {
  final image = tester.widget<Image>(find.byType(Image));
  return image.image as MemoryImage;
}

void main() {
  testWidgets('idle: quiet placeholder, no bar value, no image', (
    tester,
  ) async {
    final progress = TransferProgress();
    addTearDown(progress.dispose);
    await _pumpRow(tester, progress);

    expect(find.text('Nothing uploading'), findsOneWidget);
    expect(find.text('Waiting for the next item.'), findsOneWidget);
    expect(find.byIcon(Icons.image_outlined), findsOneWidget);
    expect(find.byType(Image), findsNothing);

    final bar = tester.widget<LinearProgressIndicator>(
      find.byKey(const Key('uploading-file-progress')),
    );
    expect(bar.value, 0);
  });

  testWidgets('uploading: name, bytes, percentage and bar', (tester) async {
    final transfer = _transfer();
    final progress = transfer.progress;
    addTearDown(progress.dispose);
    progress.begin(
      localId: 'asset-1',
      fileName: 'IMG_4821.HEIC',
      totalBytes: 10000000,
      phase: TransferPhase.uploading,
    );

    await _pumpRow(tester, progress);
    transfer.tick(const Duration(seconds: 1));
    progress.advance(2500000);
    await tester.pumpAndSettle();

    expect(find.text('IMG_4821.HEIC'), findsOneWidget);
    expect(find.text('2.5 MB of 10.0 MB'), findsOneWidget);
    expect(find.text('25%'), findsOneWidget);

    final bar = tester.widget<LinearProgressIndicator>(
      find.byKey(const Key('uploading-file-progress')),
    );
    expect(bar.value, closeTo(0.25, 0.001));

    // A finished transfer keeps the last file at its final state.
    progress.finish();
    await tester.pumpAndSettle();
    expect(find.text('IMG_4821.HEIC'), findsOneWidget);
    expect(find.text('25%'), findsOneWidget);
  });

  testWidgets('preparing says so and keeps the bar determinate', (
    tester,
  ) async {
    final progress = TransferProgress();
    addTearDown(progress.dispose);
    progress.begin(
      localId: 'asset-1',
      fileName: 'IMG_0001.JPG',
      totalBytes: 4000,
      phase: TransferPhase.preparing,
    );

    await _pumpRow(tester, progress);
    await tester.pumpAndSettle();

    expect(find.text('Preparing · 0 B of 4.0 KB'), findsOneWidget);
    final bar = tester.widget<LinearProgressIndicator>(
      find.byKey(const Key('uploading-file-progress')),
    );
    expect(bar.value, 0);
  });

  testWidgets('thumbnail bytes are painted with gapless playback', (
    tester,
  ) async {
    final progress = TransferProgress();
    addTearDown(progress.dispose);
    progress.begin(
      localId: 'asset-1',
      fileName: 'IMG_4821.HEIC',
      totalBytes: 1000,
      phase: TransferPhase.uploading,
    );

    await _pumpRow(tester, progress, thumbnail: (id) async => _red);
    await tester.pump();

    expect(find.byIcon(Icons.image_outlined), findsNothing);
    expect(tester.widget<Image>(find.byType(Image)).gaplessPlayback, isTrue);
    expect(_rendered(tester).bytes, same(_red));
  });

  testWidgets('a missing thumbnail falls back to the icon, not an error', (
    tester,
  ) async {
    final progress = TransferProgress();
    addTearDown(progress.dispose);
    progress.begin(
      localId: 'asset-1',
      fileName: 'IMG_4821.HEIC',
      totalBytes: 1000,
      phase: TransferPhase.uploading,
    );

    await _pumpRow(tester, progress, thumbnail: (id) async => null);
    await tester.pump();

    expect(find.byIcon(Icons.image_outlined), findsOneWidget);
    expect(find.text('IMG_4821.HEIC'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('a stale thumbnail never overwrites the newer file', (
    tester,
  ) async {
    final first = Completer<Uint8List?>();
    final second = Completer<Uint8List?>();
    final progress = TransferProgress();
    addTearDown(progress.dispose);
    progress.begin(
      localId: 'asset-1',
      fileName: 'FIRST.HEIC',
      totalBytes: 1000,
      phase: TransferPhase.uploading,
    );

    await _pumpRow(
      tester,
      progress,
      thumbnail: (id) {
        return id == 'asset-1' ? first.future : second.future;
      },
    );

    progress.begin(
      localId: 'asset-2',
      fileName: 'SECOND.HEIC',
      totalBytes: 1000,
      phase: TransferPhase.uploading,
    );
    await tester.pump();

    second.complete(_blue);
    await tester.pump();
    await tester.pump();
    expect(_rendered(tester).bytes, same(_blue));

    // The first file's bytes arrive late; they belong to a file no longer shown.
    first.complete(_red);
    await tester.pump();
    await tester.pump();

    expect(find.text('SECOND.HEIC'), findsOneWidget);
    expect(_rendered(tester).bytes, same(_blue));
  });

  testWidgets('a revisited file reuses its cached thumbnail', (tester) async {
    var loads = 0;
    final progress = TransferProgress();
    addTearDown(progress.dispose);
    await _pumpRow(
      tester,
      progress,
      thumbnail: (id) async {
        loads++;
        return _red;
      },
    );

    for (final id in <String>['asset-1', 'asset-2', 'asset-1']) {
      progress.begin(
        localId: id,
        fileName: '$id.HEIC',
        totalBytes: 1000,
        phase: TransferPhase.uploading,
      );
      await tester.pump();
    }

    expect(loads, 2);
    expect(_rendered(tester).bytes, same(_red));
  });

  testWidgets('the slot height is identical idle and uploading', (
    tester,
  ) async {
    final progress = TransferProgress();
    addTearDown(progress.dispose);
    await _pumpRow(tester, progress);
    final idle = tester.getSize(find.byType(UploadingFileRow));

    progress.begin(
      localId: 'asset-1',
      fileName: 'IMG_4821.HEIC',
      totalBytes: 10000000,
      phase: TransferPhase.uploading,
    );
    await tester.pumpAndSettle();
    final uploading = tester.getSize(find.byType(UploadingFileRow));

    expect(uploading, idle);
    expect(idle.height, 72);
  });

  testWidgets('HomeScreen hands its thumbnail callback to the row', (
    tester,
  ) async {
    final progress = TransferProgress();
    addTearDown(progress.dispose);
    progress.begin(
      localId: 'asset-1',
      fileName: 'IMG_4821.HEIC',
      totalBytes: 10000000,
      phase: TransferPhase.uploading,
    );

    await tester.pumpWidget(
      _app(
        HomeScreen(
          stats: const QueueStats(
            pending: 1,
            uploaded: 0,
            duplicate: 0,
            failed: 0,
          ),
          progress: progress,
          permission: PhotoPermission.authorized,
          syncing: true,
          paused: false,
          authRequired: false,
          lastReport: null,
          error: null,
          onSyncNow: () async {},
          onPause: () async {},
          onResume: () async {},
          onOpenSettings: () {},
          onSignOut: () async {},
          thumbnail: (id) async => _red,
        ),
      ),
    );
    await tester.pump();

    expect(find.text('IMG_4821.HEIC'), findsOneWidget);
    expect(_rendered(tester).bytes, same(_red));
  });
}
