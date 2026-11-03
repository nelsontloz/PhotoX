import 'dart:async';
import 'dart:io';

import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:photo_manager/photo_manager.dart';
import 'package:photox_mobile/media/photo_manager_observer.dart';
import 'package:photox_mobile/media/photo_observer.dart';

const String _channelName = 'com.fluttercandies/photo_manager';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  late Directory temp;
  late File assetFile;
  late List<MethodCall> calls;
  late Uint8List thumbBytes;
  // Non-null while a test wants every getThumb to wait for its own completer.
  List<({String id, Completer<void> gate})>? thumbHoldings;

  setUp(() async {
    temp = await Directory.systemTemp.createTemp('photox-observer-test-');
    assetFile = File('${temp.path}/asset.jpg');
    await assetFile.writeAsBytes(<int>[1, 2, 3]);
    calls = <MethodCall>[];
    thumbHoldings = null;
    thumbBytes = Uint8List.fromList(<int>[9, 8, 7]);

    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(const MethodChannel(_channelName), (
          call,
        ) async {
          calls.add(call);
          final arguments = call.arguments is Map
              ? (call.arguments as Map).cast<dynamic, dynamic>()
              : const <dynamic, dynamic>{};
          switch (call.method) {
            case 'getAssetPathList':
              if (arguments['onlyAll'] == false) {
                return <String, dynamic>{
                  'data': <Map<String, dynamic>>[
                    _path('all', 'Recents', 2, isAll: true),
                    _path('screens', 'Screenshots', 9),
                  ],
                };
              }
              return <String, dynamic>{
                'data': <Map<String, dynamic>>[
                  _path('all', 'All', 1, isAll: true),
                ],
              };
            case 'fetchPathProperties':
              final path = _paths[arguments['id']];
              if (path == null) return null;
              return <String, dynamic>{
                'data': <Map<String, dynamic>>[path],
              };
            case 'getAssetCountFromPath':
              return <String, int>{'all': 2, 'screens': 9}[arguments['id']] ??
                  0;
            case 'getAssetListPaged':
              if (arguments['page'] != 0) {
                return <String, dynamic>{'data': <Object>[]};
              }
              final ids = switch (arguments['id']) {
                'camera' => <String>['asset-1'],
                'screens' => <String>['asset-2', 'asset-1'],
                _ => <String>['asset-1'],
              };
              return <String, dynamic>{
                'data': <Map<String, dynamic>>[
                  for (var index = 0; index < ids.length; index++)
                    _asset(ids[index], createDt: 1000 + index),
                ],
              };
            case 'getAssetListRange':
              // Newest first, as the observer's ordering option asks the
              // platform for; the mock library is asset-1..asset-3.
              final start = arguments['start'] as int;
              final end = arguments['end'] as int;
              final ids = <String>['asset-1', 'asset-2', 'asset-3'];
              final stop = end > ids.length ? ids.length : end;
              return <String, dynamic>{
                'data': <Map<String, dynamic>>[
                  for (var index = start; index < stop; index++)
                    _asset(
                      ids[index],
                      createDt: 3000 - index,
                      width: 4000 + index,
                      height: 3000 + index,
                      duration: 10 + index,
                    ),
                ],
              };
            case 'getFullFile':
              return assetFile.path;
            case 'requestPermissionExtend':
              return 3; // PermissionState.authorized
            case 'notifyChange':
              return true;
            case 'fetchEntityProperties':
              return _asset(arguments['id'] as String, createDt: 1000);
            case 'getThumb':
              if (arguments['id'] != 'asset-1') {
                throw PlatformException(code: 'not_found');
              }
              if (thumbHoldings != null) {
                final gate = Completer<void>();
                thumbHoldings!.add((id: arguments['id'] as String, gate: gate));
                await gate.future;
              }
              return thumbBytes;
          }
          return null;
        });
  });

  tearDown(() async {
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(const MethodChannel(_channelName), null);
    if (await temp.exists()) await temp.delete(recursive: true);
  });

  test(
    'asks Android for ACCESS_MEDIA_LOCATION so EXIF GPS is not redacted',
    () async {
      final observer = PhotoManagerObserver();
      addTearDown(observer.dispose);

      expect(await observer.ensurePermission(), PhotoPermission.authorized);

      final call = calls.firstWhere(
        (call) => call.method == 'requestPermissionExtend',
      );
      final androidPermission =
          (call.arguments as Map)['androidPermission'] as Map;
      expect(androidPermission['mediaLocation'], isTrue);
    },
  );

  test('filters by update time and leaves creation time unfiltered', () async {
    final observer = PhotoManagerObserver();
    addTearDown(observer.dispose);
    final since = DateTime.utc(2026, 10, 18, 12);

    final candidates = await observer.scanNew(since: since);

    expect(candidates, hasLength(1));
    final option =
        calls
                .firstWhere((call) => call.method == 'getAssetPathList')
                .arguments['option']
            as Map<dynamic, dynamic>;
    final child = option['child'] as Map<dynamic, dynamic>;
    final update = child['updateDate'] as Map<dynamic, dynamic>;
    final create = child['createDate'] as Map<dynamic, dynamic>;
    expect(update['min'], since.millisecondsSinceEpoch);
    expect(update['max'], isNotNull);
    expect(create['min'], 0);
    expect(create['ignore'], isFalse);
  });

  test('discovery never exports bytes; fileFor fetches one asset', () async {
    final observer = PhotoManagerObserver();
    addTearDown(observer.dispose);

    final candidates = await observer.scanNew();

    expect(candidates, isNotEmpty);
    expect(candidates.first.sizeBytes, 0);
    expect(
      calls.where((call) => call.method == 'getFullFile'),
      isEmpty,
      reason: 'a scan must not materialise the whole library',
    );

    final file = await observer.fileFor('asset-1');
    expect(file?.path, assetFile.path);
    expect(calls.where((call) => call.method == 'getFullFile'), hasLength(1));
  });

  test(
    'playableVideo hands back the platform file, asking for the original',
    () async {
      final observer = PhotoManagerObserver();
      addTearDown(observer.dispose);

      final file = await observer.playableVideo('asset-1');

      expect(file?.path, assetFile.path);
      final call = calls.lastWhere((call) => call.method == 'getFullFile');
      expect((call.arguments as Map<dynamic, dynamic>)['isOrigin'], isTrue);
    },
  );

  test(
    'thumbnailFor clamps the request and never propagates failures',
    () async {
      final observer = PhotoManagerObserver();
      addTearDown(observer.dispose);

      final bytes = await observer.thumbnailFor('asset-1', size: 4096);
      expect(bytes, thumbBytes);
      var option =
          calls
                  .lastWhere((call) => call.method == 'getThumb')
                  .arguments['option']
              as Map<dynamic, dynamic>;
      expect(option['width'], 2048);
      expect(option['height'], 2048);

      await observer.thumbnailFor('asset-1', size: 1);
      option =
          calls
                  .lastWhere((call) => call.method == 'getThumb')
                  .arguments['option']
              as Map<dynamic, dynamic>;
      expect(option['width'], 64);

      // The platform threw; the dashboard must see null, not an exception.
      expect(await observer.thumbnailFor('gone'), isNull);
    },
  );

  test('thumbnailFor serves a repeated request from its cache', () async {
    final observer = PhotoManagerObserver();
    addTearDown(observer.dispose);

    final first = await observer.thumbnailFor('asset-1', size: 200);
    final second = await observer.thumbnailFor('asset-1', size: 200);

    expect(second, same(first));
    // One platform encode: a tile that mounts again reuses the bytes.
    expect(calls.where((call) => call.method == 'getThumb'), hasLength(1));

    // A different size is a different preview, so it asks again.
    await observer.thumbnailFor('asset-1', size: 128);
    expect(calls.where((call) => call.method == 'getThumb'), hasLength(2));
  });

  test('thumbnail slots go to the newest request first', () async {
    final observer = PhotoManagerObserver();
    addTearDown(observer.dispose);

    final holdings = <({String id, Completer<void> gate})>[];
    thumbHoldings = holdings;

    // Six fit in the gate; the rest wait in line. The harness only answers for
    // `asset-1`, so every request asks for the same asset at a different size
    // to keep them distinct cache keys.
    for (var index = 0; index < 8; index++) {
      unawaited(observer.thumbnailFor('asset-1', size: 100 + index));
      await Future<void>.delayed(Duration.zero);
    }
    expect(holdings, hasLength(6));

    // Freeing a slot must wake the newest waiter, not the oldest: the newest is
    // the tile that just mounted on screen.
    holdings[0].gate.complete();
    await Future<void>.delayed(Duration.zero);
    await Future<void>.delayed(Duration.zero);
    expect(holdings, hasLength(7));
    holdings[1].gate.complete();
    await Future<void>.delayed(Duration.zero);
    await Future<void>.delayed(Duration.zero);
    expect(holdings, hasLength(8));

    // Drain, so no request is left waiting on a slot.
    for (final holding in holdings.skip(2)) {
      if (!holding.gate.isCompleted) holding.gate.complete();
    }
    await Future<void>.delayed(Duration.zero);
    thumbHoldings = null;
  });

  test('enumerates albums once, camera first, and caches them', () async {
    final observer = PhotoManagerObserver();
    addTearDown(observer.dispose);

    final folders = await observer.folders();

    expect(folders, hasLength(2));
    // On iOS the "all assets" collection is the camera roll; the host runs
    // neither PhotoKit nor MediaStore, so isAll decides here.
    expect(folders.first.id, 'all');
    expect(folders.first.isCamera, isTrue);
    expect(folders.first.assetCount, 2);
    expect(folders.last.id, 'screens');
    expect(folders.last.name, 'Screenshots');
    expect(folders.last.isCamera, isFalse);
    expect(folders.last.assetCount, 9);

    final again = await observer.folders();
    expect(again, same(folders), reason: 'memoised for the process');
    expect(
      calls.where(
        (call) =>
            call.method == 'getAssetPathList' &&
            call.arguments['onlyAll'] == false,
      ),
      hasLength(1),
    );
    expect(
      calls.where((call) => call.method == 'getAssetCountFromPath'),
      hasLength(2),
    );
  });

  test('scans selected albums and dedupes assets across them', () async {
    final observer = PhotoManagerObserver();
    addTearDown(observer.dispose);

    final candidates = await observer.scanNew(
      folderIds: <String>['camera', 'screens'],
    );

    expect(candidates, hasLength(2));
    expect(candidates.map((candidate) => candidate.localId), <String>[
      'asset-1',
      'asset-2',
    ]);
    expect(
      calls.where((call) => call.method == 'fetchPathProperties'),
      hasLength(2),
    );
  });

  test('skips an album that disappeared instead of aborting', () async {
    final observer = PhotoManagerObserver();
    addTearDown(observer.dispose);

    final candidates = await observer.scanNew(
      folderIds: <String>['gone', 'camera'],
    );

    expect(candidates.map((candidate) => candidate.localId), <String>[
      'asset-1',
    ]);
  });

  test('an empty folder selection scans the whole library', () async {
    final observer = PhotoManagerObserver();
    addTearDown(observer.dispose);

    await observer.scanNew(folderIds: const <String>[]);

    final listCall = calls.firstWhere(
      (call) => call.method == 'getAssetPathList',
    );
    expect(listCall.arguments['onlyAll'], isTrue);
  });

  test('pages an album newest first with the requested range', () async {
    final observer = PhotoManagerObserver();
    addTearDown(observer.dispose);

    final candidates = await observer.page(
      offset: 1,
      limit: 2,
      folderId: 'screens',
    );

    expect(candidates.map((candidate) => candidate.localId), <String>[
      'asset-2',
      'asset-3',
    ]);

    final rangeCall = calls.lastWhere(
      (call) => call.method == 'getAssetListRange',
    );
    expect(rangeCall.arguments['start'], 1);
    expect(rangeCall.arguments['end'], 3);
    expect(rangeCall.arguments['id'], 'screens');

    final option = rangeCall.arguments['option'] as Map<dynamic, dynamic>;
    final child = option['child'] as Map<dynamic, dynamic>;
    final order = (child['orders'] as List<dynamic>).single as Map;
    expect(order['type'], 0, reason: 'OrderOptionType.createDate');
    expect(order['asc'], isFalse);
  });

  test('maps display fields a grid needs and nothing it must export', () async {
    final observer = PhotoManagerObserver();
    addTearDown(observer.dispose);

    final candidates = await observer.page(offset: 0, limit: 2);

    expect(candidates, hasLength(2));
    final first = candidates.first;
    expect(first.localId, 'asset-1');
    expect(first.fileName, 'asset-1.jpg');
    expect(first.mimeType, 'image/jpeg');
    expect(first.width, 4000);
    expect(first.height, 3000);
    expect(first.durationSeconds, 10);
    expect(first.takenAt, isNotNull);
    // Pages never export bytes, so the grid sees no size and no export call.
    expect(first.sizeBytes, 0);
    expect(calls.where((call) => call.method == 'getFullFile'), isEmpty);
  });

  test('an empty page beyond the end is not an error', () async {
    final observer = PhotoManagerObserver();
    addTearDown(observer.dispose);

    expect(await observer.page(offset: 100, limit: 10), isEmpty);
  });

  test('counts the root library and a single album', () async {
    final observer = PhotoManagerObserver();
    addTearDown(observer.dispose);

    expect(await observer.libraryCount(), 2);
    expect(await observer.libraryCount(folderId: 'screens'), 9);
  });

  test(
    'an unknown album pages empty and counts zero instead of throwing',
    () async {
      final observer = PhotoManagerObserver();
      addTearDown(observer.dispose);

      expect(
        await observer.page(offset: 0, limit: 5, folderId: 'gone'),
        isEmpty,
      );
      expect(await observer.libraryCount(folderId: 'gone'), 0);
    },
  );

  test('a library change drops the cached paths', () async {
    await PhotoManager.startChangeNotify();
    final observer = PhotoManagerObserver();
    addTearDown(observer.dispose);

    Future<int> rootResolves() async {
      final before = calls
          .where(
            (call) =>
                call.method == 'getAssetPathList' &&
                call.arguments['onlyAll'] == true,
          )
          .length;
      await observer.page(offset: 0, limit: 2);
      final after = calls
          .where(
            (call) =>
                call.method == 'getAssetPathList' &&
                call.arguments['onlyAll'] == true,
          )
          .length;
      return after - before;
    }

    expect(await rootResolves(), 1);
    expect(await rootResolves(), 0, reason: 'cached between pages');

    await _emitChange();

    expect(await rootResolves(), 1, reason: 'invalidated by the change event');

    // The album listing shares the invalidation.
    await observer.folders();
    await _emitChange();
    final folderResolves = calls
        .where(
          (call) =>
              call.method == 'getAssetPathList' &&
              call.arguments['onlyAll'] == false,
        )
        .length;
    await observer.folders();
    expect(
      calls
          .where(
            (call) =>
                call.method == 'getAssetPathList' &&
                call.arguments['onlyAll'] == false,
          )
          .length,
      folderResolves + 1,
    );
  });
}

/// Pushes the `change` notification the platforms send on library edits.
Future<void> _emitChange() {
  return TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
      .handlePlatformMessage(
        'com.fluttercandies/photo_manager/notify',
        const StandardMethodCodec().encodeMethodCall(
          const MethodCall('change'),
        ),
        (_) {},
      );
}

Map<String, dynamic> _path(
  String id,
  String name,
  int assetCount, {
  bool isAll = false,
}) {
  return <String, dynamic>{
    'id': id,
    'name': name,
    'assetCount': assetCount,
    'isAll': isAll,
    'albumType': 1,
    'darwinAssetCollectionType': 2,
    'darwinAssetCollectionSubtype': 1,
  };
}

final Map<String, Map<String, dynamic>> _paths = <String, Map<String, dynamic>>{
  'all': _path('all', 'Recents', 2, isAll: true),
  'camera': _path('camera', 'Camera', 1),
  'screens': _path('screens', 'Screenshots', 9),
};

Map<String, dynamic> _asset(
  String id, {
  required int createDt,
  int width = 1,
  int height = 1,
  int duration = 0,
}) {
  return <String, dynamic>{
    'id': id,
    'type': 1,
    'width': width,
    'height': height,
    'duration': duration,
    'title': '$id.jpg',
    'createDt': createDt,
    'modifiedDt': createDt + 1000,
    'relativePath': 'DCIM/$id.jpg',
    'mimeType': 'image/jpeg',
  };
}
