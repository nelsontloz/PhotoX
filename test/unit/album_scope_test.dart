import 'package:flutter_test/flutter_test.dart';
import 'package:photox_mobile/library/album_scope.dart';
import 'package:photox_mobile/media/photo_observer.dart';
import 'package:photox_mobile/settings/settings_store.dart';

MediaFolder _folder(
  String id, {
  String? name,
  int count = 10,
  bool isCamera = false,
}) {
  return MediaFolder(
    id: id,
    name: name ?? id,
    assetCount: count,
    isCamera: isCamera,
  );
}

void main() {
  final camera = _folder('camera', name: 'Camera', isCamera: true);
  final screenshots = _folder('shots', name: 'Screenshots');
  final downloaded = _folder('downloads', name: 'Downloads');
  final folders = <MediaFolder>[camera, screenshots, downloaded];

  group('AlbumScope.of', () {
    test('no selection reads as the camera album', () {
      final scope = AlbumScope.of(const AppSettings());

      expect(scope.usesDefault, isTrue);
      expect(scope.all, isFalse);
      expect(scope.isPartial, isFalse);
      expect(scope.includes(camera), isTrue);
      expect(scope.includes(screenshots), isFalse);
    });

    test('all folders includes every album', () {
      final scope = AlbumScope.of(const AppSettings(uploadAllFolders: true));

      expect(scope.all, isTrue);
      expect(scope.isPartial, isFalse);
      expect(scope.includes(downloaded), isTrue);
    });

    test('explicit albums are partial', () {
      final scope = AlbumScope.of(
        const AppSettings(uploadFolderIds: <String>['shots']),
      );

      expect(scope.isPartial, isTrue);
      expect(scope.includes(screenshots), isTrue);
      // An explicit set replaces the camera default rather than adding to it.
      expect(scope.includes(camera), isFalse);
    });
  });

  group('withAlbumInScope include', () {
    test('the camera album is the default and changes nothing', () {
      final next = withAlbumInScope(
        const AppSettings(),
        album: camera,
        include: true,
        folders: folders,
      );

      expect(next.uploadFolderIds, isEmpty);
      expect(next.uploadAllFolders, isFalse);
    });

    test('a second album keeps the camera album in the set', () {
      final next = withAlbumInScope(
        const AppSettings(),
        album: screenshots,
        include: true,
        folders: folders,
      );

      expect(next.uploadFolderIds, <String>['camera', 'shots']);
    });

    test('adding to an explicit set appends', () {
      final next = withAlbumInScope(
        const AppSettings(uploadFolderIds: <String>['shots']),
        album: downloaded,
        include: true,
        folders: folders,
      );

      expect(next.uploadFolderIds, <String>['shots', 'downloads']);
    });

    test('adding while everything is included is a no-op', () {
      const current = AppSettings(uploadAllFolders: true);
      final next = withAlbumInScope(
        current,
        album: screenshots,
        include: true,
        folders: folders,
      );

      expect(identical(next, current) || next == current, isTrue);
    });
  });

  group('withAlbumInScope remove', () {
    test('removing from "all albums" spells the rest out', () {
      final next = withAlbumInScope(
        const AppSettings(uploadAllFolders: true),
        album: screenshots,
        include: false,
        folders: folders,
      );

      expect(next.uploadAllFolders, isFalse);
      expect(next.uploadFolderIds, <String>['camera', 'downloads']);
    });

    test('removing the camera album from the default leaves the rest', () {
      final next = withAlbumInScope(
        const AppSettings(),
        album: camera,
        include: false,
        folders: folders,
      );

      expect(next.uploadFolderIds, <String>['shots', 'downloads']);
    });

    test('removing the last explicit album is refused', () {
      const current = AppSettings(uploadFolderIds: <String>['shots']);
      final next = withAlbumInScope(
        current,
        album: screenshots,
        include: false,
        folders: folders,
      );

      // An empty set would mean "camera album", which is not what was asked.
      expect(next.uploadFolderIds, <String>['shots']);
    });

    test('a folder that is not in scope changes nothing', () {
      const current = AppSettings(uploadFolderIds: <String>['shots']);
      final next = withAlbumInScope(
        current,
        album: downloaded,
        include: false,
        folders: folders,
      );

      expect(next.uploadFolderIds, <String>['shots']);
    });
  });

  group('onlyAlbumInScope', () {
    test('the camera album becomes the default selection', () {
      final next = onlyAlbumInScope(
        const AppSettings(uploadFolderIds: <String>['shots']),
        album: camera,
        coversWholeLibrary: false,
      );

      expect(next.uploadFolderIds, isEmpty);
      expect(next.uploadAllFolders, isFalse);
    });

    test('an album that covers the library becomes "all albums"', () {
      final next = onlyAlbumInScope(
        const AppSettings(uploadFolderIds: <String>['shots']),
        album: camera,
        coversWholeLibrary: true,
      );

      expect(next.uploadAllFolders, isTrue);
      expect(next.uploadFolderIds, isEmpty);
    });

    test('a normal album becomes the only album', () {
      final next = onlyAlbumInScope(
        const AppSettings(uploadAllFolders: true),
        album: screenshots,
        coversWholeLibrary: false,
      );

      expect(next.uploadAllFolders, isFalse);
      expect(next.uploadFolderIds, <String>['shots']);
    });
  });

  group('pruneMissingFolders', () {
    test('keeps the ids the device still has', () {
      expect(pruneMissingFolders(<String>['shots', 'gone'], folders), <String>[
        'shots',
      ]);
    });

    test('an unchanged selection is returned as is', () {
      expect(pruneMissingFolders(<String>['shots'], folders), <String>[
        'shots',
      ]);
    });

    test('a selection of deleted albums falls back to the default', () {
      expect(pruneMissingFolders(<String>['gone'], folders), isEmpty);
    });

    test('an empty selection stays empty', () {
      expect(pruneMissingFolders(const <String>[], folders), isEmpty);
    });
  });

  test('albumScopeLabel names the three scopes', () {
    expect(albumScopeLabel(const AppSettings()), 'Camera album');
    expect(
      albumScopeLabel(const AppSettings(uploadFolderIds: <String>['a', 'b'])),
      '2 albums',
    );
    expect(
      albumScopeLabel(const AppSettings(uploadAllFolders: true)),
      'All albums',
    );
  });
}
