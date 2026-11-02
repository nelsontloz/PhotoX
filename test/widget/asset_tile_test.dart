import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:photox_mobile/library/backup_status.dart';
import 'package:photox_mobile/media/photo_observer.dart';
import 'package:photox_mobile/sync/transfer_progress.dart';
import 'package:photox_mobile/ui/widgets/asset_tile.dart';

AssetCandidate _asset(String id) => AssetCandidate(
  localId: id,
  platform: 'android',
  kind: MediaKind.photo,
  fileName: '$id.jpg',
  mimeType: 'image/jpeg',
  sizeBytes: 0,
  takenAt: DateTime(2025, 5, 12),
);

Widget _host({
  required ValueListenable<bool> deferring,
  required Future<Uint8List?> Function(String localId, {int size}) load,
}) {
  return MaterialApp(
    home: Scaffold(
      body: SizedBox.square(
        dimension: 120,
        child: AssetTile(
          asset: _asset('one'),
          thumbnail: load,
          deferring: deferring,
          progress: TransferProgress(),
          status: BackupStatus.backedUp,
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
        deferring: deferring,
        load: (id, {int size = 128}) async {
          requested.add(id);
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
        deferring: deferring,
        load: (id, {int size = 128}) async {
          requested.add(id);
          return null;
        },
      ),
    );
    await tester.pump();

    expect(requested, <String>['one']);
  });
}
