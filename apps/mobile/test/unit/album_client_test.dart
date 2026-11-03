import 'dart:convert';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:photox_mobile/core/api_client.dart';
import 'package:photox_mobile/core/auth_manager.dart';
import 'package:photox_mobile/core/auth_models.dart';
import 'package:photox_mobile/core/refresh_lock.dart';
import 'package:photox_mobile/core/token_store.dart';
import 'package:photox_mobile/server/album_client.dart';

void main() {
  late List<RequestOptions> requests;
  late Future<ResponseBody> Function(RequestOptions options) handler;
  late ApiClient api;
  late AlbumClient albumClient;

  setUp(() async {
    requests = <RequestOptions>[];
    handler = (_) async =>
        _json(404, <String, dynamic>{'message': 'not found'});
    final dio = Dio()
      ..httpClientAdapter = _StubAdapter((options) {
        requests.add(options);
        return handler(options);
      });
    final store = MemoryTokenStore();
    await store.write(_tokens());
    final auth = AuthManager(store: store, refreshLock: MemoryRefreshLock());
    await auth.restore();
    api = ApiClient(auth: auth, dio: dio, baseUrl: 'http://localhost:3000');
    albumClient = AlbumClient(api);
  });

  tearDown(() => api.close());

  test('lists albums with the largest page the server accepts', () async {
    handler = (_) async => _json(200, <String, dynamic>{
      'items': <Map<String, dynamic>>[
        <String, dynamic>{
          'id': 'album-1',
          'name': 'Trip',
          'assetCount': 12,
          'hiddenFromTimeline': false,
        },
        <String, dynamic>{
          'id': 'album-2',
          'name': 'Archive',
          'assetCount': 3,
          'hiddenFromTimeline': true,
        },
      ],
      'total': 2,
    });

    final albums = await albumClient.list();

    expect(requests.single.method, 'GET');
    expect(requests.single.path, '/api/v1/albums');
    expect(requests.single.queryParameters['limit'], AlbumClient.maxLimit);
    expect(albums.map((album) => album.id), <String>['album-1', 'album-2']);
    expect(albums.first.name, 'Trip');
    expect(albums.first.assetCount, 12);
    expect(albums.first.hiddenFromTimeline, isFalse);
    expect(albums.last.hiddenFromTimeline, isTrue);
  });

  test('creates an album with the hidden flag the caller asked for', () async {
    handler = (_) async => _json(201, <String, dynamic>{
      'id': 'album-9',
      'name': 'Private',
      'assetCount': 0,
      'hiddenFromTimeline': true,
    });

    final created = await albumClient.create(
      'Private',
      hiddenFromTimeline: true,
    );

    final request = requests.single;
    expect(request.method, 'POST');
    expect(request.path, '/api/v1/albums');
    expect(request.data, <String, dynamic>{
      'name': 'Private',
      'hiddenFromTimeline': true,
    });
    expect(created.id, 'album-9');
    expect(created.hiddenFromTimeline, isTrue);
  });

  test('chunks addAssets at the server cap of 100 ids', () async {
    handler = (_) async => _json(201, <String, dynamic>{'added': 100});
    final assetIds = List<String>.generate(250, (index) => 'asset-$index');

    await albumClient.addAssets('album-1', assetIds);

    expect(requests, hasLength(3));
    expect(requests.map((request) => request.path).toSet(), <String>{
      '/api/v1/albums/album-1/assets',
    });
    final chunks = <List<String>>[
      for (final request in requests)
        (request.data as Map<String, dynamic>)['assetIds'] as List<String>,
    ];
    expect(chunks.map((chunk) => chunk.length), <int>[100, 100, 50]);
    expect(chunks.expand((chunk) => chunk), assetIds);
  });

  test('addAssets posts nothing for an empty list', () async {
    await albumClient.addAssets('album-1', const <String>[]);

    expect(requests, isEmpty);
  });

  test('a malformed list body becomes an ApiException', () async {
    handler = (_) async =>
        _json(200, <String, dynamic>{'items': 'not-a-list', 'total': 0});

    await expectLater(
      albumClient.list(),
      throwsA(
        isA<ApiException>().having(
          (error) => error.message,
          'message',
          contains('GET /api/v1/albums response'),
        ),
      ),
    );
  });

  test('a malformed album becomes an ApiException naming the field', () async {
    handler = (_) async => _json(200, <String, dynamic>{
      'items': <Map<String, dynamic>>[
        <String, dynamic>{
          'id': 'album-1',
          'name': 'Trip',
          'assetCount': 'many',
          'hiddenFromTimeline': false,
        },
      ],
      'total': 1,
    });

    await expectLater(
      albumClient.list(),
      throwsA(
        isA<ApiException>().having(
          (error) => error.message,
          'message',
          contains('ServerAlbum.assetCount'),
        ),
      ),
    );
  });

  test('a malformed create response becomes an ApiException', () async {
    handler = (_) async => _json(201, <String, dynamic>{'id': 'album-9'});

    await expectLater(
      albumClient.create('Private', hiddenFromTimeline: true),
      throwsA(
        isA<ApiException>().having(
          (error) => error.message,
          'message',
          contains('POST /api/v1/albums response'),
        ),
      ),
    );
  });

  test('exists is true when the album is still there', () async {
    handler = (_) async => _json(200, <String, dynamic>{
      'id': 'album-1',
      'name': 'Trip',
      'assetCount': 1,
      'hiddenFromTimeline': false,
    });

    expect(await albumClient.exists('album-1'), isTrue);
    expect(requests.single.method, 'GET');
    expect(requests.single.path, '/api/v1/albums/album-1');
  });

  test('exists is false on a 404', () async {
    expect(await albumClient.exists('gone'), isFalse);
    expect(requests.single.path, '/api/v1/albums/gone');
  });

  test('exists rethrows a server failure', () async {
    handler = (_) async => _json(500, <String, dynamic>{'message': 'boom'});

    await expectLater(
      albumClient.exists('album-1'),
      throwsA(
        isA<ApiException>().having((error) => error.statusCode, 'status', 500),
      ),
    );
  });

  test('a 404 on addAssets reaches the caller as ApiException', () async {
    handler = (_) async => _json(404, <String, dynamic>{
      'statusCode': 404,
      'message': 'Album not found',
    });

    await expectLater(
      albumClient.addAssets('gone', <String>['asset-1']),
      throwsA(
        isA<ApiException>().having((error) => error.statusCode, 'status', 404),
      ),
    );
  });
}

AuthTokens _tokens() => AuthTokens(
  accessToken: 'access-1',
  refreshToken: 'refresh-1',
  accessExpiresAt: DateTime.now().toUtc().add(const Duration(hours: 1)),
  user: AuthUser(
    id: 'user-1',
    email: 'user@example.com',
    role: 'user',
    displayName: 'Test User',
    createdAt: DateTime.utc(2026, 1, 1),
    updatedAt: DateTime.utc(2026, 1, 2),
  ),
);

ResponseBody _json(int status, Object body) => ResponseBody.fromString(
  jsonEncode(body),
  status,
  headers: const <String, List<String>>{
    Headers.contentTypeHeader: <String>['application/json'],
  },
);

class _StubAdapter implements HttpClientAdapter {
  _StubAdapter(this.onFetch);

  final Future<ResponseBody> Function(RequestOptions options) onFetch;

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) => onFetch(options);

  @override
  void close({bool force = false}) {}
}
