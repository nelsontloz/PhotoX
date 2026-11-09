import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:photox_mobile/app.dart';
import 'package:photox_mobile/core/api_client.dart';
import 'package:photox_mobile/server/album_client.dart';
import 'package:photox_mobile/ui/widgets/folder_album_sheet.dart';

ServerAlbum _album(
  String id,
  String name, {
  int count = 0,
  bool hidden = false,
}) {
  return ServerAlbum(
    id: id,
    name: name,
    assetCount: count,
    hiddenFromTimeline: hidden,
  );
}

/// The sheet over a host screen, so closing it is a real route pop.
Future<void> _pumpSheet(
  WidgetTester tester, {
  required Future<List<ServerAlbum>> Function() loadAlbums,
  String? currentAlbumId,
  Future<ServerAlbum> Function(String name, {required bool hiddenFromTimeline})?
  createAlbum,
  Future<void> Function(String folderId, String? albumId)? onChanged,
}) async {
  await tester.pumpWidget(
    MaterialApp(
      debugShowCheckedModeBanner: false,
      theme: photoXTheme(),
      home: Scaffold(
        body: Builder(
          builder: (context) => Center(
            child: TextButton(
              onPressed: () => showFolderAlbumSheet(
                context,
                folderId: 'camera',
                folderName: 'Camera',
                currentAlbumId: currentAlbumId,
                loadAlbums: loadAlbums,
                createAlbum:
                    createAlbum ??
                    (name, {required hiddenFromTimeline}) async =>
                        _album('created', name, hidden: hiddenFromTimeline),
                onChanged: onChanged ?? (folderId, albumId) async {},
              ),
              child: const Text('open'),
            ),
          ),
        ),
      ),
    ),
  );
  await tester.tap(find.text('open'));
  await tester.pumpAndSettle();
}

void main() {
  testWidgets('picking an album stores it once and closes the sheet', (
    tester,
  ) async {
    var calls = 0;
    String? storedFolder;
    String? storedAlbum;

    await _pumpSheet(
      tester,
      loadAlbums: () async => <ServerAlbum>[
        _album('trips', 'Trips', count: 12),
        _album('private', 'Private', count: 3, hidden: true),
      ],
      onChanged: (folderId, albumId) async {
        calls++;
        storedFolder = folderId;
        storedAlbum = albumId;
      },
    );

    expect(find.byKey(const Key('folder-album-sheet')), findsOneWidget);
    // The row says hiding out loud instead of leaving it to the server.
    expect(find.text('Hidden from timeline'), findsOneWidget);
    expect(find.text('12 assets'), findsOneWidget);

    await tester.tap(find.byKey(const Key('folder-album-trips')));
    await tester.pumpAndSettle();

    expect(calls, 1);
    expect(storedFolder, 'camera');
    expect(storedAlbum, 'trips');
    expect(find.byKey(const Key('folder-album-sheet')), findsNothing);
  });

  testWidgets('the current album is checked and can be cleared', (
    tester,
  ) async {
    var calls = 0;
    String? storedAlbum = 'unset';

    await _pumpSheet(
      tester,
      currentAlbumId: 'trips',
      loadAlbums: () async => <ServerAlbum>[_album('trips', 'Trips')],
      onChanged: (folderId, albumId) async {
        calls++;
        storedAlbum = albumId;
      },
    );

    expect(find.byIcon(Icons.check_circle_rounded), findsOneWidget);

    await tester.tap(find.byKey(const Key('folder-album-none')));
    await tester.pumpAndSettle();

    expect(calls, 1);
    expect(storedAlbum, isNull);
    expect(find.byKey(const Key('folder-album-sheet')), findsNothing);
  });

  testWidgets('with no album set, "Not in an album" is disabled', (
    tester,
  ) async {
    var calls = 0;

    await _pumpSheet(
      tester,
      loadAlbums: () async => <ServerAlbum>[_album('trips', 'Trips')],
      onChanged: (folderId, albumId) async => calls++,
    );

    final tile = tester.widget<ListTile>(
      find.byKey(const Key('folder-album-none')),
    );
    expect(tile.enabled, isFalse);
    expect(find.byIcon(Icons.check_circle_rounded), findsOneWidget);

    await tester.tap(find.byKey(const Key('folder-album-none')));
    await tester.pumpAndSettle();
    expect(calls, 0);
    expect(find.byKey(const Key('folder-album-sheet')), findsOneWidget);
  });

  testWidgets('a new album keeps the hidden flag and becomes the mapping', (
    tester,
  ) async {
    var hiddenSent = false;
    String? createdName;
    String? storedAlbum;

    await tester.pumpWidget(
      MaterialApp(
        debugShowCheckedModeBanner: false,
        theme: photoXTheme(),
        home: Scaffold(
          body: Builder(
            builder: (context) => Center(
              child: TextButton(
                onPressed: () => showFolderAlbumSheet(
                  context,
                  folderId: 'camera',
                  folderName: 'Camera',
                  currentAlbumId: null,
                  loadAlbums: () async => const <ServerAlbum>[],
                  createAlbum: (name, {required hiddenFromTimeline}) async {
                    createdName = name;
                    hiddenSent = hiddenFromTimeline;
                    return _album('new-one', name);
                  },
                  onChanged: (folderId, albumId) async {
                    storedAlbum = albumId;
                  },
                ),
                child: const Text('open'),
              ),
            ),
          ),
        ),
      ),
    );
    await tester.tap(find.text('open'));
    await tester.pumpAndSettle();

    await tester.tap(find.byKey(const Key('folder-album-new')));
    await tester.pumpAndSettle();

    // The switch starts on, which is what makes hiding visible by default.
    final hideSwitch = tester.widget<SwitchListTile>(
      find.byKey(const Key('folder-album-hidden')),
    );
    expect(hideSwitch.value, isTrue);

    await tester.enterText(
      find.byKey(const Key('folder-album-name')),
      '  Trips  ',
    );
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('folder-album-create')));
    await tester.pumpAndSettle();

    expect(createdName, 'Trips');
    expect(hiddenSent, isTrue);
    expect(storedAlbum, 'new-one');
    expect(find.byKey(const Key('folder-album-sheet')), findsNothing);
  });

  testWidgets('a created album that failed to map joins the list', (
    tester,
  ) async {
    await _pumpSheet(
      tester,
      loadAlbums: () async => const <ServerAlbum>[],
      createAlbum: (name, {required hiddenFromTimeline}) async =>
          _album('new-one', name),
      onChanged: (folderId, albumId) async {
        throw const ApiException(message: 'Could not save the album.');
      },
    );

    await tester.tap(find.byKey(const Key('folder-album-new')));
    await tester.pumpAndSettle();
    await tester.enterText(find.byKey(const Key('folder-album-name')), 'Trips');
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('folder-album-create')));
    await tester.pumpAndSettle();

    expect(find.text('Could not save the album.'), findsOneWidget);
    // The album exists now, so the form closes instead of inviting a duplicate.
    expect(find.byKey(const Key('folder-album-name')), findsNothing);
    expect(find.byKey(const Key('folder-album-new-one')), findsOneWidget);
  });

  testWidgets('an empty name cannot be created', (tester) async {
    var created = 0;

    await _pumpSheet(
      tester,
      loadAlbums: () async => const <ServerAlbum>[],
      createAlbum: (name, {required hiddenFromTimeline}) async {
        created++;
        return _album('new-one', name);
      },
    );

    await tester.tap(find.byKey(const Key('folder-album-new')));
    await tester.pumpAndSettle();

    expect(
      tester
          .widget<FilledButton>(find.byKey(const Key('folder-album-create')))
          .onPressed,
      isNull,
    );

    await tester.enterText(find.byKey(const Key('folder-album-name')), '   ');
    await tester.pumpAndSettle();
    expect(
      tester
          .widget<FilledButton>(find.byKey(const Key('folder-album-create')))
          .onPressed,
      isNull,
    );
    expect(created, 0);

    await tester.enterText(find.byKey(const Key('folder-album-name')), 'Trips');
    await tester.pumpAndSettle();
    expect(
      tester
          .widget<FilledButton>(find.byKey(const Key('folder-album-create')))
          .onPressed,
      isNotNull,
    );
  });

  testWidgets('a failed read says so and retries', (tester) async {
    var reads = 0;

    await _pumpSheet(
      tester,
      loadAlbums: () async {
        reads++;
        if (reads == 1) {
          throw const ApiException(message: 'Server is unavailable.');
        }
        return <ServerAlbum>[_album('trips', 'Trips')];
      },
    );

    expect(find.text('Server is unavailable.'), findsOneWidget);
    expect(find.text('Try again'), findsOneWidget);

    await tester.tap(find.text('Try again'));
    await tester.pumpAndSettle();

    expect(reads, 2);
    expect(find.text('Server is unavailable.'), findsNothing);
    expect(find.byKey(const Key('folder-album-trips')), findsOneWidget);
  });

  testWidgets('a failed write stays in the sheet with the reason', (
    tester,
  ) async {
    await _pumpSheet(
      tester,
      loadAlbums: () async => <ServerAlbum>[_album('trips', 'Trips')],
      onChanged: (folderId, albumId) async {
        throw const ApiException(message: 'Could not save the album.');
      },
    );

    await tester.tap(find.byKey(const Key('folder-album-trips')));
    await tester.pumpAndSettle();

    expect(find.text('Could not save the album.'), findsOneWidget);
    expect(find.byKey(const Key('folder-album-sheet')), findsOneWidget);
  });

  testWidgets('the sheet holds up on a narrow screen with the form open', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(320, 640);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    await _pumpSheet(
      tester,
      loadAlbums: () async => <ServerAlbum>[
        _album('private', 'Private', count: 1234, hidden: true),
      ],
    );

    await tester.tap(find.byKey(const Key('folder-album-new')));
    await tester.pumpAndSettle();

    expect(tester.takeException(), isNull);
    expect(find.byKey(const Key('folder-album-name')), findsOneWidget);
    expect(find.byKey(const Key('folder-album-create')), findsOneWidget);
  });
}
