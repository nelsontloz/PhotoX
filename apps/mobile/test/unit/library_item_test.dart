import 'package:flutter_test/flutter_test.dart';
import 'package:photox_mobile/library/library_item.dart';
import 'package:photox_mobile/media/photo_observer.dart';
import 'package:photox_mobile/server/server_asset.dart';

AssetCandidate _candidate(
  String id, {
  MediaKind kind = MediaKind.photo,
  DateTime? takenAt,
  DateTime? modifiedAt,
}) {
  return AssetCandidate(
    localId: id,
    platform: 'ios',
    kind: kind,
    fileName: '$id.jpg',
    mimeType: kind == MediaKind.video ? 'video/mp4' : 'image/jpeg',
    sizeBytes: 0,
    takenAt: takenAt,
    modifiedAt: modifiedAt,
  );
}

LibraryItem _device(
  String id, {
  MediaKind kind = MediaKind.photo,
  DateTime? takenAt,
  DateTime? modifiedAt,
}) {
  return LibraryItem.deviceOnly(
    _candidate(id, kind: kind, takenAt: takenAt, modifiedAt: modifiedAt),
  );
}

ServerAsset _serverAsset(
  String id, {
  String kind = 'photo',
  DateTime? takenAt,
  DateTime? uploadedAt,
  String? title,
}) {
  return ServerAsset(
    id: id,
    kind: kind,
    uploadedAt: uploadedAt ?? DateTime(2025, 1, 1),
    takenAt: takenAt,
    title: title,
  );
}

LibraryItem _server(
  String id, {
  String kind = 'photo',
  DateTime? takenAt,
  DateTime? uploadedAt,
  String? title,
}) {
  return LibraryItem.onlineOnly(
    _serverAsset(
      id,
      kind: kind,
      takenAt: takenAt,
      uploadedAt: uploadedAt,
      title: title,
    ),
  );
}

List<String> _keys(Iterable<LibraryItem> items) {
  return <String>[for (final item in items) item.key];
}

void main() {
  group('mergeLibraryItems', () {
    test('newest first across both halves', () {
      final merged = mergeLibraryItems(<LibraryItem>[
        _device('old', takenAt: DateTime(2025, 1, 1)),
        _server('new', takenAt: DateTime(2025, 5, 1)),
        _device('mid', takenAt: DateTime(2025, 3, 1)),
      ]);

      expect(_keys(merged), <String>['server:new', 'mid', 'old']);
    });

    test('a device row wins a timestamp tie against a server row', () {
      final at = DateTime(2025, 5, 1, 12);

      final deviceFirst = mergeLibraryItems(<LibraryItem>[
        _server('shared', takenAt: at),
        _device('photo', takenAt: at),
      ]);
      expect(_keys(deviceFirst), <String>['photo', 'server:shared']);

      // The input order is irrelevant: the device copy is the tie-break.
      final reversed = mergeLibraryItems(<LibraryItem>[
        _device('photo', takenAt: at),
        _server('shared', takenAt: at),
      ]);
      expect(_keys(reversed), <String>['photo', 'server:shared']);
    });

    test('undated rows sort last', () {
      final merged = mergeLibraryItems(<LibraryItem>[
        _device('undated'),
        _device('dated', takenAt: DateTime(2025, 5, 1)),
        _server('server', takenAt: DateTime(2025, 1, 1)),
      ]);

      expect(_keys(merged), <String>['dated', 'server:server', 'undated']);
    });

    test('undated rows are ordered by key too', () {
      final merged = mergeLibraryItems(<LibraryItem>[
        _device('b'),
        _device('a'),
      ]);

      expect(_keys(merged), <String>['a', 'b']);
    });

    test('equal timestamps order by key, whatever the input order', () {
      final at = DateTime(2025, 5, 1, 12);
      final items = <LibraryItem>[
        _server('c', takenAt: at),
        _server('a', takenAt: at),
        _server('b', takenAt: at),
      ];

      final first = _keys(mergeLibraryItems(items));
      final second = _keys(mergeLibraryItems(items.reversed));
      final third = _keys(mergeLibraryItems(items));

      expect(first, <String>['server:a', 'server:b', 'server:c']);
      expect(second, first);
      expect(third, first);
    });
  });

  group('LibraryItem', () {
    test('a device row dates by capture time, then modification time', () {
      final taken = DateTime(2025, 5, 12, 14, 32);
      final modified = DateTime(2025, 6, 1, 9);

      expect(
        _device('a', takenAt: taken, modifiedAt: modified).date,
        taken,
        reason: 'the capture date outranks the file modification date',
      );
      expect(
        _device('a', modifiedAt: modified).date,
        modified,
        reason: 'a missing capture date falls back to the modified date',
      );
      expect(_device('a').date, isNull);
    });

    test('a server row dates by capture time, then upload time', () {
      final taken = DateTime(2025, 5, 12, 14, 32);
      final uploaded = DateTime(2025, 7, 1, 9);

      expect(
        _server('s', takenAt: taken, uploadedAt: uploaded).date,
        taken,
        reason: 'the server sorts by capture date when it has one',
      );
      expect(
        _server('s', uploadedAt: uploaded).date,
        uploaded,
        reason: 'without metadata the upload time is the only date left',
      );
    });

    test('a both row keeps the device date and the device title', () {
      final item = LibraryItem.backedUp(
        _candidate('photo', takenAt: DateTime(2025, 5, 12)),
        server: _serverAsset('s', takenAt: DateTime(2025, 1, 1)),
      );

      expect(item.date, DateTime(2025, 5, 12));
      expect(item.title, 'photo.jpg');
    });

    test('the key is stable and names the side that owns the row', () {
      final device = LibraryItem.deviceOnly(_candidate('local-1'));

      expect(device.key, 'local-1');
      expect(
        LibraryItem.deviceOnly(_candidate('local-1')).key,
        device.key,
        reason: 'the same platform id must merge to the same row',
      );
      expect(LibraryItem.backedUp(_candidate('local-1')).key, device.key);
      expect(_server('asset-9').key, 'server:asset-9');
    });

    test('the title is the file name, the server name, or a fallback', () {
      expect(_device('IMG_1234').title, 'IMG_1234.jpg');
      expect(_server('s', title: 'sunset.heic').title, 'sunset.heic');
      expect(_server('s').title, 'Photo');
    });

    test('isVideo follows the side that holds the bytes', () {
      expect(_device('v', kind: MediaKind.video).isVideo, isTrue);
      expect(_device('p').isVideo, isFalse);
      expect(_server('v', kind: 'video').isVideo, isTrue);
      expect(_server('p', kind: 'photo').isVideo, isFalse);
    });

    test('each factory reports its own provenance', () {
      expect(_device('a').provenance, Provenance.deviceOnly);
      expect(LibraryItem.backedUp(_candidate('a')).provenance, Provenance.both);
      expect(_server('s').provenance, Provenance.onlineOnly);
    });
  });
}
