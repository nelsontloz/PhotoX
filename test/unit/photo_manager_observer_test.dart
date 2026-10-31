import 'dart:io';

import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:photox_mobile/media/photo_manager_observer.dart';
import 'package:photox_mobile/media/photo_observer.dart';

const String _channelName = 'com.fluttercandies/photo_manager';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  late Directory temp;
  late File assetFile;
  late List<MethodCall> calls;
  late Uint8List thumbBytes;

  setUp(() async {
    temp = await Directory.systemTemp.createTemp('photox-observer-test-');
    assetFile = File('${temp.path}/asset.jpg');
    await assetFile.writeAsBytes(<int>[1, 2, 3]);
    calls = <MethodCall>[];
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
            case 'getFullFile':
              return assetFile.path;
            case 'requestPermissionExtend':
              return 3; // PermissionState.authorized
            case 'fetchEntityProperties':
              return _asset(arguments['id'] as String, createDt: 1000);
            case 'getThumb':
              if (arguments['id'] != 'asset-1') {
                throw PlatformException(code: 'not_found');
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

  test(
    'fileFor reuses the scan-time file instead of exporting twice',
    () async {
      final observer = PhotoManagerObserver();
      addTearDown(observer.dispose);

      await observer.scanNew();
      final file = await observer.fileFor('asset-1');

      expect(file?.path, assetFile.path);
      expect(calls.where((call) => call.method == 'getFullFile'), hasLength(1));
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
      expect(option['width'], 512);
      expect(option['height'], 512);

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

Map<String, dynamic> _asset(String id, {required int createDt}) {
  return <String, dynamic>{
    'id': id,
    'type': 1,
    'width': 1,
    'height': 1,
    'duration': 0,
    'title': '$id.jpg',
    'createDt': createDt,
    'modifiedDt': createDt + 1000,
    'relativePath': 'DCIM/$id.jpg',
    'mimeType': 'image/jpeg',
  };
}
