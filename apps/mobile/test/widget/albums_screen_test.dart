import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:photox_mobile/app.dart';
import 'package:photox_mobile/library/album_progress.dart';
import 'package:photox_mobile/library/album_scope.dart';
import 'package:photox_mobile/library/backup_status.dart';
import 'package:photox_mobile/media/photo_observer.dart';
import 'package:photox_mobile/settings/settings_store.dart';
import 'package:photox_mobile/sync/transfer_progress.dart';
import 'package:photox_mobile/ui/albums_screen.dart';
import 'package:photox_mobile/ui/library_screen.dart';
import 'package:photox_mobile/upload/models.dart';

import 'support/fake_video.dart';

MediaFolder _album(
  String id,
  String name, {
  int count = 0,
  bool camera = false,
}) {
  return MediaFolder(id: id, name: name, assetCount: count, isCamera: camera);
}

/// Albums screen with quiet defaults; each test overrides what it checks.
Widget _albumsApp({
  List<MediaFolder> albums = const <MediaFolder>[],
  Future<List<MediaFolder>> Function()? loadFolders,
  AppSettings settings = const AppSettings(),
  int? libraryCount,
  PhotoPermission permission = PhotoPermission.authorized,
  void Function(MediaFolder album)? onOpenAlbum,
  Future<void> Function(AppSettings settings)? onScopeChanged,
  Future<AlbumProgress> Function(String folderId)? loadProgress,
}) {
  return MaterialApp(
    debugShowCheckedModeBanner: false,
    theme: photoXTheme(),
    home: AlbumsScreen(
      settings: settings,
      permission: permission,
      libraryCount: libraryCount,
      loadFolders: loadFolders ?? () async => albums,
      onScopeChanged: onScopeChanged ?? (settings) async {},
      onOpenAlbum: onOpenAlbum ?? (album) {},
      loadProgress: loadProgress,
    ),
  );
}

/// A menu entry by its label, so a screen button with the same words cannot
/// stand in for it.
Finder _menuItem(String label) {
  return find.descendant(
    of: find.byWidgetPredicate((widget) => widget is PopupMenuItem),
    matching: find.text(label),
  );
}

const AssetCandidate _oneAsset = AssetCandidate(
  localId: 'one',
  platform: 'ios',
  kind: MediaKind.photo,
  fileName: 'one.jpg',
  mimeType: 'image/jpeg',
  sizeBytes: 1024,
);

/// One grid for the banner tests, with the whole LibraryScreen API satisfied.
Widget _libraryApp({
  AppSettings settings = const AppSettings(),
  MediaFolder? album,
  String? folderId,
  VoidCallback? onOpenAlbums,
}) {
  return MaterialApp(
    debugShowCheckedModeBanner: false,
    theme: photoXTheme(),
    home: LibraryScreen(
      permission: PhotoPermission.authorized,
      settings: settings,
      syncing: false,
      queueRevision: 0,
      progress: TransferProgress(),
      folderId: folderId,
      album: album,
      onOpenAlbums: onOpenAlbums,
      loadPage: ({
        required int offset,
        int limit = 200,
        String? folderId,
      }) async => offset == 0 ? const <AssetCandidate>[_oneAsset] : const [],
      loadStates: (ids) async => const <String, UploadState>{},
      thumbnail: (id, {int size = 128}) async => null,
      loadPreview: (id) async => null,
      loadDetail: (asset) async =>
          const BackupDetail(status: BackupStatus.unknown),
      video: FakeVideoSupport().support,
      onBackUpNow: (assets) async {},
      onOpenSettings: () {},
      onSyncNow: () async {},
      onRequestAccess: () async {},
    ),
  );
}

void main() {
  testWidgets('albums show their counts and their place in the scope', (
    tester,
  ) async {
    await tester.pumpWidget(
      _albumsApp(
        albums: <MediaFolder>[
          _album('camera', 'Camera', count: 12, camera: true),
          _album('shots', 'Screenshots', count: 7),
        ],
        settings: const AppSettings(uploadFolderIds: <String>['camera']),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('Camera'), findsOneWidget);
    expect(find.text('Screenshots'), findsOneWidget);
    expect(find.text('12 items'), findsOneWidget);
    expect(find.text('7 items'), findsOneWidget);
    expect(find.text('Backing up'), findsOneWidget);
    expect(find.text('Not backed up'), findsOneWidget);
  });

  testWidgets('the camera album counts as in scope by default', (tester) async {
    await tester.pumpWidget(
      _albumsApp(
        albums: <MediaFolder>[
          _album('camera', 'Camera', count: 3, camera: true),
          _album('shots', 'Screenshots', count: 1),
        ],
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('Backing up'), findsOneWidget);
    expect(find.text('Not backed up'), findsOneWidget);
  });

  testWidgets('a device with no albums says so', (tester) async {
    await tester.pumpWidget(_albumsApp());
    await tester.pumpAndSettle();

    expect(find.byKey(const Key('albums-empty')), findsOneWidget);
    expect(find.text('No albums on this device'), findsOneWidget);
  });

  testWidgets('a failed read explains itself and can be retried', (
    tester,
  ) async {
    var fail = true;
    await tester.pumpWidget(
      _albumsApp(
        loadFolders: () async {
          if (fail) throw StateError('platform said no');
          return <MediaFolder>[
            _album('camera', 'Camera', count: 2, camera: true),
          ];
        },
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('Could not read your albums'), findsOneWidget);
    expect(find.byKey(const Key('albums-retry')), findsOneWidget);

    fail = false;
    await tester.tap(find.byKey(const Key('albums-retry')));
    await tester.pumpAndSettle();

    expect(find.text('Could not read your albums'), findsNothing);
    expect(find.text('2 items'), findsOneWidget);
  });

  testWidgets('tapping an album opens exactly that album', (tester) async {
    MediaFolder? opened;
    await tester.pumpWidget(
      _albumsApp(
        albums: <MediaFolder>[_album('shots', 'Screenshots', count: 5)],
        onOpenAlbum: (album) => opened = album,
      ),
    );
    await tester.pumpAndSettle();

    await tester.tap(find.byKey(const Key('album-shots')));
    await tester.pumpAndSettle();

    expect(opened, isNotNull);
    expect(opened!.id, 'shots');
    expect(opened!.name, 'Screenshots');
    expect(opened!.assetCount, 5);
  });

  testWidgets(
    'including an album stores what the scope rule says, no question',
    (tester) async {
      const settings = AppSettings(uploadFolderIds: <String>['camera']);
      final albums = <MediaFolder>[
        _album('camera', 'Camera', count: 4, camera: true),
        _album('archive', 'Archive', count: 9),
      ];
      final applied = <AppSettings>[];

      await tester.pumpWidget(
        _albumsApp(
          albums: albums,
          settings: settings,
          onScopeChanged: (next) async => applied.add(next),
        ),
      );
      await tester.pumpAndSettle();

      await tester.tap(find.byKey(const Key('album-menu-archive')));
      await tester.pumpAndSettle();
      await tester.tap(_menuItem('Include in backup'));
      await tester.pumpAndSettle();

      // Widening drops nothing, so it does not ask.
      expect(find.byKey(const Key('scope-confirm')), findsNothing);
      expect(applied, <AppSettings>[
        withAlbumInScope(
          settings,
          album: albums.last,
          include: true,
          folders: albums,
        ),
      ]);
    },
  );

  testWidgets('narrowing to one album asks first, then stores it', (
    tester,
  ) async {
    const settings = AppSettings(uploadFolderIds: <String>['camera']);
    final albums = <MediaFolder>[
      _album('camera', 'Camera', count: 4, camera: true),
      _album('archive', 'Archive', count: 9),
    ];
    final applied = <AppSettings>[];

    await tester.pumpWidget(
      _albumsApp(
        albums: albums,
        settings: settings,
        onScopeChanged: (next) async => applied.add(next),
      ),
    );
    await tester.pumpAndSettle();

    Future<void> chooseBackUpThisAlbum() async {
      await tester.tap(find.byKey(const Key('album-menu-archive')));
      await tester.pumpAndSettle();
      await tester.tap(_menuItem('Back up this album'));
      await tester.pumpAndSettle();
    }

    await chooseBackUpThisAlbum();
    expect(find.byKey(const Key('scope-confirm')), findsOneWidget);
    expect(find.textContaining('are dropped'), findsOneWidget);
    expect(applied, isEmpty);

    // Cancel leaves the stored scope alone.
    await tester.tap(find.byKey(const Key('scope-cancel')));
    await tester.pumpAndSettle();
    expect(applied, isEmpty);

    await chooseBackUpThisAlbum();
    await tester.tap(find.byKey(const Key('scope-confirm')));
    await tester.pumpAndSettle();

    expect(applied, <AppSettings>[
      onlyAlbumInScope(settings, album: albums.last, coversWholeLibrary: false),
    ]);
    expect(applied.single.uploadFolderIds, <String>['archive']);
  });

  testWidgets('an album holding the whole library means everything', (
    tester,
  ) async {
    final applied = <AppSettings>[];

    await tester.pumpWidget(
      _albumsApp(
        albums: <MediaFolder>[_album('recents', 'Recents', count: 100)],
        settings: const AppSettings(uploadFolderIds: <String>['shots']),
        libraryCount: 100,
        onScopeChanged: (next) async => applied.add(next),
      ),
    );
    await tester.pumpAndSettle();

    await tester.tap(find.byKey(const Key('album-menu-recents')));
    await tester.pumpAndSettle();
    await tester.tap(_menuItem('Back up everything'));
    await tester.pumpAndSettle();

    // Nothing is dropped when everything is added, so it does not ask.
    expect(find.byKey(const Key('scope-confirm')), findsNothing);
    expect(applied, hasLength(1));
    expect(applied.single.uploadAllFolders, isTrue);
    expect(applied.single.uploadFolderIds, isEmpty);
  });

  testWidgets('the library says when what it shows is not backed up', (
    tester,
  ) async {
    // The grid shows the whole library while the scope is a few albums.
    await tester.pumpWidget(
      _libraryApp(
        settings: const AppSettings(
          uploadFolderIds: <String>['camera', 'archive'],
        ),
        onOpenAlbums: () {},
      ),
    );
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('library-scope-banner')), findsOneWidget);
    expect(find.text('Not everything here is backed up'), findsOneWidget);
    expect(find.byKey(const Key('library-open-albums')), findsOneWidget);

    // Everything is in scope: nothing to explain.
    await tester.pumpWidget(
      _libraryApp(
        settings: const AppSettings(uploadAllFolders: true),
        onOpenAlbums: () {},
      ),
    );
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('library-scope-banner')), findsNothing);

    // An album outside the scope says so on its own grid.
    await tester.pumpWidget(
      _libraryApp(
        settings: const AppSettings(uploadFolderIds: <String>['camera']),
        album: _album('archive', 'Archive', count: 9),
        folderId: 'archive',
        onOpenAlbums: () {},
      ),
    );
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('library-scope-banner')), findsOneWidget);
    expect(find.text('This album is not backed up'), findsOneWidget);

    // No Albums tab wired in: the grid says nothing about the scope.
    await tester.pumpWidget(
      _libraryApp(
        settings: const AppSettings(
          uploadFolderIds: <String>['camera', 'archive'],
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('library-scope-banner')), findsNothing);
  });

  testWidgets('only albums in scope get a backed-up tally', (tester) async {
    final asked = <String>[];
    await tester.pumpWidget(
      _albumsApp(
        albums: <MediaFolder>[
          _album('camera', 'Camera', count: 12, camera: true),
          _album('shots', 'Screenshots', count: 7),
        ],
        settings: const AppSettings(uploadFolderIds: <String>['camera']),
        loadProgress: (folderId) async {
          asked.add(folderId);
          return const AlbumProgress(backedUp: 3, total: 12);
        },
      ),
    );
    await tester.pumpAndSettle();

    // Counting an out-of-scope album would walk a set the backup never reads.
    expect(asked, <String>['camera']);
    expect(find.text('3 of 12 backed up'), findsOneWidget);
    expect(find.text('7 items'), findsOneWidget);
    expect(find.text('12 items'), findsNothing);
  });

  testWidgets('a tally that stopped at the cap says how far it read', (
    tester,
  ) async {
    await tester.pumpWidget(
      _albumsApp(
        albums: <MediaFolder>[
          _album('camera', 'Camera', count: 40000, camera: true),
        ],
        loadProgress: (folderId) async =>
            const AlbumProgress(backedUp: 3000, total: 20000, partial: true),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('3,000 of the first 20,000 backed up'), findsOneWidget);
  });

  testWidgets('a tally that fails leaves the count on the card', (
    tester,
  ) async {
    await tester.pumpWidget(
      _albumsApp(
        albums: <MediaFolder>[
          _album('camera', 'Camera', count: 12, camera: true),
        ],
        loadProgress: (folderId) async => throw StateError('tally failed'),
      ),
    );
    await tester.pumpAndSettle();

    expect(tester.takeException(), isNull);
    expect(find.text('12 items'), findsOneWidget);
  });

  testWidgets('a rebuilding card does not re-read its tally', (tester) async {
    var calls = 0;

    Widget screen() {
      return _albumsApp(
        albums: <MediaFolder>[
          _album('camera', 'Camera', count: 12, camera: true),
        ],
        loadProgress: (folderId) async {
          calls++;
          return const AlbumProgress(backedUp: 3, total: 12);
        },
      );
    }

    await tester.pumpWidget(screen());
    await tester.pumpAndSettle();
    expect(calls, 1);

    // Same screen, same state: the memo holds the answer.
    await tester.pumpWidget(screen());
    await tester.pumpAndSettle();
    await tester.pumpWidget(screen());
    await tester.pumpAndSettle();

    expect(calls, 1);
    expect(find.text('3 of 12 backed up'), findsOneWidget);
  });
}
