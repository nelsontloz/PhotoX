import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:photox_mobile/library/backup_status.dart';
import 'package:photox_mobile/library/library_item.dart';
import 'package:photox_mobile/media/photo_observer.dart';
import 'package:photox_mobile/server/server_asset.dart';
import 'package:photox_mobile/sync/transfer_progress.dart';
import 'package:photox_mobile/ui/widgets/asset_tile.dart';
import 'package:photox_mobile/ui/widgets/provenance_badge.dart';
import 'package:photox_mobile/ui/widgets/status_badge.dart';

AssetCandidate _asset(String id, {MediaKind kind = MediaKind.photo}) {
  return AssetCandidate(
    localId: id,
    platform: 'android',
    kind: kind,
    fileName: '$id.jpg',
    mimeType: kind == MediaKind.video ? 'video/mp4' : 'image/jpeg',
    sizeBytes: 0,
    takenAt: DateTime(2025, 5, 12),
  );
}

ServerAsset _server(String id, {String kind = 'photo', String? title}) {
  return ServerAsset(
    id: id,
    kind: kind,
    uploadedAt: DateTime(2025, 5, 12),
    title: title ?? '$id.jpg',
  );
}

Widget _host({
  required LibraryItem item,
  required ValueListenable<bool> deferring,
  required Future<Uint8List?> Function(LibraryItem item, {int size}) load,
  BackupStatus? status,
}) {
  return MaterialApp(
    home: Scaffold(
      body: SizedBox.square(
        dimension: 120,
        child: AssetTile(
          item: item,
          preview: load,
          deferring: deferring,
          progress: TransferProgress(),
          status: status,
        ),
      ),
    ),
  );
}

void main() {
  testWidgets('a flinging grid holds the preview request back', (tester) async {
    final deferring = ValueNotifier<bool>(true);
    addTearDown(deferring.dispose);
    final requested = <String>[];

    await tester.pumpWidget(
      _host(
        item: LibraryItem.deviceOnly(_asset('one')),
        deferring: deferring,
        load: (item, {int size = 320}) async {
          requested.add(item.key);
          return null;
        },
      ),
    );
    await tester.pump();

    expect(requested, isEmpty);

    // The fling settles: the tile asks once, not once per frame.
    deferring.value = false;
    await tester.pump();
    await tester.pump();

    expect(requested, <String>['one']);
  });

  testWidgets('a tile that mounts after the fling asks immediately', (
    tester,
  ) async {
    final deferring = ValueNotifier<bool>(false);
    addTearDown(deferring.dispose);
    final requested = <String>[];

    await tester.pumpWidget(
      _host(
        item: LibraryItem.deviceOnly(_asset('one')),
        deferring: deferring,
        load: (item, {int size = 320}) async {
          requested.add(item.key);
          return null;
        },
      ),
    );
    await tester.pump();

    expect(requested, <String>['one']);
  });

  testWidgets('an unanswered queue draws no mark at all', (tester) async {
    final handle = tester.ensureSemantics();
    final deferring = ValueNotifier<bool>(false);
    addTearDown(deferring.dispose);

    await tester.pumpWidget(
      _host(
        item: LibraryItem.deviceOnly(_asset('one')),
        deferring: deferring,
        load: (item, {int size = 320}) async => null,
      ),
    );
    await tester.pump();

    // No queue row yet means no claim, not "not backed up".
    expect(find.byType(StatusBadge), findsNothing);
    expect(find.byType(ProvenanceBadge), findsNothing);
    expect(find.bySemanticsLabel('one.jpg'), findsOneWidget);

    handle.dispose();
  });

  testWidgets('the queue outranks provenance in the one mark', (tester) async {
    final handle = tester.ensureSemantics();
    final deferring = ValueNotifier<bool>(false);
    addTearDown(deferring.dispose);

    Future<void> show(BackupStatus status) async {
      await tester.pumpWidget(
        _host(
          item: LibraryItem.deviceOnly(_asset('one')),
          deferring: deferring,
          load: (item, {int size = 320}) async => null,
          status: status,
        ),
      );
      await tester.pump();
    }

    for (final entry in <BackupStatus, String>{
      BackupStatus.uploading: 'Uploading',
      BackupStatus.failed: 'Backup failed',
      BackupStatus.queued: 'Waiting to back up',
      BackupStatus.excluded: 'Not in backup scope',
    }.entries) {
      await show(entry.key);
      expect(find.byType(StatusBadge), findsOneWidget, reason: entry.value);
      expect(find.byType(ProvenanceBadge), findsNothing, reason: entry.value);
      expect(
        find.bySemanticsLabel('one.jpg, ${entry.value}'),
        findsOneWidget,
        reason: entry.value,
      );
    }

    handle.dispose();
  });

  testWidgets('backed up and unknown fall through to the provenance mark', (
    tester,
  ) async {
    final handle = tester.ensureSemantics();
    final deferring = ValueNotifier<bool>(false);
    addTearDown(deferring.dispose);

    await tester.pumpWidget(
      _host(
        item: LibraryItem.backedUp(_asset('one')),
        deferring: deferring,
        load: (item, {int size = 320}) async => null,
        status: BackupStatus.backedUp,
      ),
    );
    await tester.pump();

    expect(find.byType(StatusBadge), findsNothing);
    expect(find.byType(ProvenanceBadge), findsOneWidget);
    expect(find.bySemanticsLabel('one.jpg, Backed up'), findsOneWidget);

    await tester.pumpWidget(
      _host(
        item: LibraryItem.deviceOnly(_asset('one')),
        deferring: deferring,
        load: (item, {int size = 320}) async => null,
        status: BackupStatus.unknown,
      ),
    );
    await tester.pump();

    expect(find.byType(StatusBadge), findsNothing);
    expect(find.byType(ProvenanceBadge), findsOneWidget);
    expect(find.bySemanticsLabel('one.jpg, Not backed up'), findsOneWidget);

    handle.dispose();
  });

  testWidgets('the label folds the file name and the mark words together', (
    tester,
  ) async {
    final handle = tester.ensureSemantics();
    final deferring = ValueNotifier<bool>(false);
    addTearDown(deferring.dispose);

    await tester.pumpWidget(
      _host(
        item: LibraryItem.deviceOnly(_asset('IMG_1234')),
        deferring: deferring,
        load: (item, {int size = 320}) async => null,
        status: BackupStatus.unknown,
      ),
    );
    await tester.pump();

    // One label, both halves: the badge itself is excluded from semantics.
    expect(
      find.bySemanticsLabel(RegExp(r'^IMG_1234\.jpg.*Not backed up$')),
      findsOneWidget,
    );
    expect(find.bySemanticsLabel('Not backed up'), findsNothing);

    handle.dispose();
  });

  testWidgets('an online-only video shows the cloud and no play mark', (
    tester,
  ) async {
    final handle = tester.ensureSemantics();
    final deferring = ValueNotifier<bool>(false);
    addTearDown(deferring.dispose);

    await tester.pumpWidget(
      _host(
        item: LibraryItem.onlineOnly(_server('cloud', kind: 'video')),
        deferring: deferring,
        load: (item, {int size = 320}) async => null,
      ),
    );
    await tester.pump();

    // The server row has no queue, but it still says where its bytes live.
    expect(find.byIcon(Icons.cloud_outlined), findsOneWidget);
    expect(find.byType(ProvenanceBadge), findsOneWidget);
    // A play glyph would promise bytes this phone cannot open.
    expect(find.byIcon(Icons.play_arrow_rounded), findsNothing);
    expect(find.bySemanticsLabel('cloud.jpg, Online only'), findsOneWidget);

    handle.dispose();
  });

  testWidgets('a video on this phone keeps its play mark', (tester) async {
    final deferring = ValueNotifier<bool>(false);
    addTearDown(deferring.dispose);

    await tester.pumpWidget(
      _host(
        item: LibraryItem.deviceOnly(_asset('clip', kind: MediaKind.video)),
        deferring: deferring,
        load: (item, {int size = 320}) async => null,
      ),
    );
    await tester.pump();

    expect(find.byIcon(Icons.play_arrow_rounded), findsOneWidget);
  });
}
