import 'package:flutter_test/flutter_test.dart';
import 'package:photox_mobile/library/album_progress.dart';
import 'package:photox_mobile/media/photo_observer.dart';
import 'package:photox_mobile/settings/settings_store.dart';
import 'package:photox_mobile/upload/models.dart';

AssetCandidate _asset(String localId) => AssetCandidate(
  localId: localId,
  platform: 'ios',
  kind: MediaKind.photo,
  fileName: '$localId.jpg',
  mimeType: 'image/jpeg',
  sizeBytes: 3,
);

/// Album of [count] assets whose states come from [stateOf]; records the pages
/// and state reads the tally asked for.
class _Album {
  _Album(this.count, this.stateOf);

  final int count;
  final UploadState? Function(String localId) stateOf;

  final List<(int, int)> pageCalls = <(int, int)>[];
  int stateCalls = 0;

  Future<int> countAll() async => count;

  Future<List<AssetCandidate>> page(int offset, int limit) async {
    pageCalls.add((offset, limit));
    final end = (offset + limit).clamp(0, count);
    return <AssetCandidate>[for (var i = offset; i < end; i++) _asset('a$i')];
  }

  Future<Map<String, UploadState>> states(List<String> localIds) async {
    stateCalls++;
    return <String, UploadState>{for (final id in localIds) id: ?stateOf(id)};
  }
}

Future<AlbumProgress> _tally(
  _Album album, {
  AppSettings settings = const AppSettings(),
  int pageSize = 500,
  int maxAssets = 20000,
}) {
  return tallyAlbumProgress(
    count: album.countAll,
    page: album.page,
    states: album.states,
    settings: settings,
    pageSize: pageSize,
    maxAssets: maxAssets,
  );
}

void main() {
  test('an empty album reads nothing and is not partial', () async {
    final album = _Album(0, (_) => null);

    final progress = await _tally(album);

    expect(progress.backedUp, 0);
    expect(progress.total, 0);
    expect(progress.partial, isFalse);
    expect(album.pageCalls, isEmpty);
    expect(album.stateCalls, 0);
  });

  test('uploaded and deduplicated assets both count as backed up', () async {
    final album = _Album(
      3,
      (id) => switch (id) {
        'a0' => UploadState.uploaded,
        'a1' => UploadState.duplicate,
        _ => UploadState.uploading,
      },
    );

    final progress = await _tally(album);

    expect(progress.backedUp, 2);
    expect(progress.total, 3);
    expect(progress.partial, isFalse);
    expect(album.pageCalls, <(int, int)>[(0, 3)]);
    expect(album.stateCalls, 1);
  });

  test(
    'only backedUp counts: failed, queued, excluded and no row do not',
    () async {
      final album = _Album(
        6,
        (id) => switch (id) {
          'a0' => UploadState.uploaded,
          'a1' => null, // never queued on this phone
          'a2' => UploadState.failedPermanent,
          'a3' => UploadState.pending,
          'a4' => UploadState.skippedQuota,
          _ => UploadState.excluded,
        },
      );

      final progress = await _tally(album);

      expect(progress.backedUp, 1);
      expect(progress.total, 6);
      expect(progress.partial, isFalse);
    },
  );

  test('a video outside the scope is excluded, not backed up', () async {
    final video = AssetCandidate(
      localId: 'a0',
      platform: 'ios',
      kind: MediaKind.video,
      fileName: 'a0.mov',
      mimeType: 'video/quicktime',
      sizeBytes: 9,
    );

    final progress = await tallyAlbumProgress(
      count: () async => 1,
      page: (offset, limit) async => offset == 0 ? <AssetCandidate>[video] : [],
      // No queue row: the filter alone decides, and videos are off.
      states: (ids) async => const <String, UploadState>{},
      settings: const AppSettings(includeVideos: false),
    );

    expect(progress.backedUp, 0);
    expect(progress.total, 1);
  });

  test('the cap stops the walk and marks the tally partial', () async {
    final album = _Album(10, (_) => UploadState.uploaded);

    final progress = await _tally(album, pageSize: 2, maxAssets: 4);

    expect(progress.backedUp, 4);
    expect(progress.total, 4);
    expect(progress.partial, isTrue);
    expect(album.pageCalls, <(int, int)>[(0, 2), (2, 2)]);
  });

  test('a short page ends the tally before the count is reached', () async {
    final album = _Album(10, (_) => UploadState.uploaded);

    final progress = await tallyAlbumProgress(
      count: album.countAll,
      page: (offset, limit) async =>
          offset == 0 ? <AssetCandidate>[_asset('a0'), _asset('a1')] : [],
      states: album.states,
      settings: const AppSettings(),
      pageSize: 5,
    );

    expect(progress.backedUp, 2);
    expect(progress.total, 2);
    expect(progress.partial, isFalse);
    expect(album.stateCalls, 1);
  });

  test('each page reads states once', () async {
    final album = _Album(7, (_) => UploadState.uploaded);

    await _tally(album, pageSize: 3);

    expect(album.pageCalls, <(int, int)>[(0, 3), (3, 3), (6, 1)]);
    expect(album.stateCalls, 3);
  });
}
