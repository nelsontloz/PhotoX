import 'dart:io';

import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:photox_mobile/media/photo_manager_observer.dart';

const String _channelName = 'com.fluttercandies/photo_manager';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  late Directory temp;
  late File assetFile;
  late List<MethodCall> calls;

  setUp(() async {
    temp = await Directory.systemTemp.createTemp('photox-observer-test-');
    assetFile = File('${temp.path}/asset.jpg');
    await assetFile.writeAsBytes(<int>[1, 2, 3]);
    calls = <MethodCall>[];

    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(const MethodChannel(_channelName), (
          call,
        ) async {
          calls.add(call);
          switch (call.method) {
            case 'getAssetPathList':
              return <String, dynamic>{
                'data': <Map<String, dynamic>>[
                  <String, dynamic>{
                    'id': 'all',
                    'name': 'All',
                    'assetCount': 1,
                    'isAll': true,
                    'albumType': 1,
                    'darwinAssetCollectionType': 2,
                    'darwinAssetCollectionSubtype': 1,
                  },
                ],
              };
            case 'getAssetListPaged':
              final arguments = call.arguments as Map<dynamic, dynamic>;
              if (arguments['page'] != 0) {
                return <String, dynamic>{'data': <Object>[]};
              }
              return <String, dynamic>{
                'data': <Map<String, dynamic>>[
                  <String, dynamic>{
                    'id': 'asset-1',
                    'type': 1,
                    'width': 1,
                    'height': 1,
                    'duration': 0,
                    'title': 'asset.jpg',
                    'createDt': 1000,
                    'modifiedDt': 2000,
                    'relativePath': 'DCIM/asset.jpg',
                    'mimeType': 'image/jpeg',
                  },
                ],
              };
            case 'getFullFile':
              return assetFile.path;
          }
          return null;
        });
  });

  tearDown(() async {
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(const MethodChannel(_channelName), null);
    if (await temp.exists()) await temp.delete(recursive: true);
  });

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
}
