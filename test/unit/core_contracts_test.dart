import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:crypto/crypto.dart';
import 'package:dio/dio.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:photox_mobile/core/api_client.dart';
import 'package:photox_mobile/core/app_config.dart';
import 'package:photox_mobile/core/auth_manager.dart';
import 'package:photox_mobile/core/auth_models.dart';
import 'package:photox_mobile/core/refresh_lock.dart';
import 'package:photox_mobile/core/token_store.dart';
import 'package:photox_mobile/upload/models.dart';
import 'package:photox_mobile/upload/session_client.dart';

void main() {
  group('AuthTokens', () {
    final user = AuthUser(
      id: 'user-1',
      email: 'user@example.com',
      role: 'user',
      displayName: 'Test User',
      createdAt: DateTime.utc(2026, 1, 1),
      updatedAt: DateTime.utc(2026, 1, 2),
    );

    test('derives accessExpiresAt from accessTokenExpiresIn', () {
      final now = DateTime.utc(2026, 10, 19, 12);
      final tokens = AuthTokens.fromResponseJson(<String, dynamic>{
        'accessToken': 'access-1',
        'accessTokenExpiresIn': 1800,
        'refreshToken': 'refresh-1',
        'user': user.toJson(),
      }, now: now);

      expect(tokens.accessExpiresAt, now.add(const Duration(minutes: 30)));
      expect(tokens.accessExpiresAt.isUtc, isTrue);
      expect(tokens.user.email, 'user@example.com');
      expect(tokens.user.createdAt, DateTime.utc(2026, 1, 1));
    });

    test('round-trips through JSON without losing the expiry instant', () {
      final tokens = AuthTokens(
        accessToken: 'access-1',
        refreshToken: 'refresh-1',
        accessExpiresAt: DateTime.utc(2026, 10, 19, 12, 30),
        user: user,
      );

      final decoded = AuthTokens.fromJson(
        (jsonDecode(jsonEncode(tokens.toJson())) as Map)
            .cast<String, dynamic>(),
      );

      expect(decoded.accessToken, tokens.accessToken);
      expect(decoded.refreshToken, tokens.refreshToken);
      expect(
        decoded.accessExpiresAt.isAtSameMomentAs(tokens.accessExpiresAt),
        isTrue,
      );
      expect(decoded.user.id, user.id);
      expect(decoded.user.updatedAt, user.updatedAt);
    });
  });

  group('AppConfig', () {
    test('uses the server contract values', () {
      expect(AppConfig.singleUploadThresholdBytes, 64 * 1024 * 1024);
      expect(AppConfig.sessionChunkSizeBytes, 8 * 1024 * 1024);
      expect(AppConfig.maxUploadSizeBytes, 4 * 1024 * 1024 * 1024);
      expect(AppConfig.maxActiveSessionsPerUser, 5);
      expect(AppConfig.refreshSkew, const Duration(seconds: 60));
      expect(AppConfig.apiBaseUrl, isNotEmpty);
    });
  });

  group('ApiException', () {
    test('classifies retryable failures', () {
      final offline = ApiException.fromDio(
        DioException.connectionError(
          requestOptions: RequestOptions(path: '/api/v1/files'),
          reason: 'offline',
        ),
      );
      expect(offline.statusCode, isNull);
      expect(offline.isRetryable, isTrue);
      expect(offline.isAuthError, isFalse);

      for (final status in <int>[408, 429, 500, 503]) {
        expect(
          ApiException(statusCode: status, message: 'x').isRetryable,
          isTrue,
          reason: '$status should be retryable',
        );
      }
      for (final status in <int>[400, 404, 409, 413, 422]) {
        expect(
          ApiException(statusCode: status, message: 'x').isRetryable,
          isFalse,
          reason: '$status should be terminal',
        );
      }
      expect(
        const ApiException(statusCode: 401, message: 'x').isAuthError,
        isTrue,
      );
    });

    test('parses the error envelope, parts, and Retry-After', () {
      final request = RequestOptions(path: '/api/v1/uploads/upload-1/complete');
      final error = DioException.badResponse(
        statusCode: 409,
        requestOptions: request,
        response: Response<dynamic>(
          requestOptions: request,
          statusCode: 409,
          headers: Headers.fromMap(<String, List<String>>{
            'retry-after': <String>['3'],
          }),
          data: <String, dynamic>{
            'statusCode': 409,
            'message': 'Upload is missing parts',
            'code': 'PARTS_MISSING',
            'receivedParts': <int>[0, 2],
          },
        ),
      );

      final parsed = ApiException.fromDio(error);
      expect(parsed.statusCode, 409);
      expect(parsed.message, 'Upload is missing parts');
      expect(parsed.code, 'PARTS_MISSING');
      expect(parsed.receivedParts, <int>[0, 2]);
      expect(parsed.retryAfter, const Duration(seconds: 3));
      expect(parsed.isRetryable, isFalse);
    });
  });

  group('SessionClient HTTP contract', () {
    late HttpServer server;
    late ApiClient api;
    late SessionClient sessions;
    final requests = <_CapturedRequest>[];

    setUp(() async {
      requests.clear();
      server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
      server.listen((request) {
        unawaited(_handleRequest(request, requests));
      });
      final baseUrl = 'http://${server.address.host}:${server.port}';
      final store = MemoryTokenStore();
      final auth = AuthManager(
        store: store,
        refreshLock: MemoryRefreshLock(),
        baseUrl: baseUrl,
      );
      await store.write(
        AuthTokens(
          accessToken: 'access-token',
          refreshToken: 'refresh-token',
          accessExpiresAt: DateTime.now().toUtc().add(const Duration(hours: 1)),
          user: AuthUser(
            id: 'user-1',
            email: 'user@example.com',
            role: 'user',
            displayName: 'Test User',
            createdAt: DateTime.utc(2026, 1, 1),
            updatedAt: DateTime.utc(2026, 1, 2),
          ),
        ),
      );
      await auth.restore();
      api = ApiClient(auth: auth, baseUrl: baseUrl);
      sessions = SessionClient(api);
    });

    tearDown(() async {
      api.close();
      await server.close(force: true);
    });

    test(
      'create/status/put/complete/abort use the documented wire shape',
      () async {
        const checksum =
            'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

        final created = await sessions.createSession(
          sha256Hex: checksum,
          sizeBytes: 9,
          filename: 'IMG_0001.HEIC',
          title: 'Trip',
          takenAt: DateTime.utc(2026, 10, 18, 9),
        );
        expect(created.uploadId, 'upload-1');
        expect(created.chunkSizeBytes, AppConfig.sessionChunkSizeBytes);
        expect(created.totalParts, 2);

        final createBody =
            jsonDecode(utf8.decode(requests[0].body)) as Map<String, dynamic>;
        expect(createBody['checksumSha256'], checksum.toLowerCase());
        expect(createBody['sizeBytes'], 9);
        expect(createBody['originalName'], 'IMG_0001.HEIC');
        expect(createBody.containsKey('partSize'), isFalse);
        expect(createBody.keys.toSet(), <String>{
          'sizeBytes',
          'originalName',
          'checksumSha256',
          'title',
          'takenAt',
        });

        final status = await sessions.getStatus('upload-1');
        expect(status.status, 'pending');
        expect(status.receivedParts, <int>[0]);
        expect(status.receivedBytes, AppConfig.sessionChunkSizeBytes);
        expect(status.assetId, isNull);
        expect(status.fileId, isNull);

        final partBytes = <int>[1, 2, 3];
        await sessions.putPart('upload-1', 0, bytes: partBytes);
        final put = requests[2];
        expect(put.method, 'PUT');
        expect(put.path, '/api/v1/uploads/upload-1/parts/0');
        expect(put.body, partBytes);
        expect(
          put.headers['content-type'],
          startsWith('application/octet-stream'),
        );
        expect(put.headers['content-length'], '3');
        expect(
          put.headers['x-part-sha256'],
          sha256.convert(partBytes).toString(),
        );
        expect(put.headers['authorization'], 'Bearer access-token');

        final completed = await sessions.complete('upload-1');
        expect(completed.asset.id, 'asset-1');
        expect(completed.asset.fileId, 'file-1');
        expect(completed.deduplicated, isTrue);

        // A 404/410 abort means the session is already gone.
        await sessions.abort('gone');
        expect(requests.last.path, '/api/v1/uploads/gone');
      },
    );

    test('exists sends one JSON batch and maps hits in order', () async {
      const checksumA =
          'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
      const checksumB =
          'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

      final hits = await api.exists(const <DedupCheck>[
        DedupCheck(checksumSha256: checksumA, sizeBytes: 10),
        DedupCheck(checksumSha256: checksumB),
      ]);

      final body =
          jsonDecode(utf8.decode(requests.single.body)) as Map<String, dynamic>;
      expect(body['items'], <Map<String, dynamic>>[
        <String, dynamic>{'checksumSha256': checksumA, 'sizeBytes': 10},
        <String, dynamic>{'checksumSha256': checksumB},
      ]);
      expect(hits, hasLength(2));
      expect(hits[0].checksumSha256, checksumA);
      expect(hits[0].exists, isTrue);
      expect(hits[0].existingAssetId, 'asset-1');
      expect(hits[0].existingFileId, 'file-1');
      expect(hits[1].exists, isFalse);
    });
  });

  group('strict wire parsing', () {
    test('malformed auth payloads throw FormatException naming the field', () {
      expect(
        () => AuthUser.fromJson(<String, dynamic>{'id': 7}),
        throwsA(
          isA<FormatException>().having(
            (error) => error.message,
            'message',
            contains('AuthUser.id'),
          ),
        ),
      );
      expect(
        () => AuthTokens.fromJson(<String, dynamic>{
          'accessToken': 'access',
          'refreshToken': 'refresh',
          'accessExpiresAt': 'not-a-date',
          'user': _userJson(),
        }),
        throwsA(
          isA<FormatException>().having(
            (error) => error.message,
            'message',
            contains('AuthTokens.accessExpiresAt'),
          ),
        ),
      );
      expect(
        () => AuthTokens.fromResponseJson(<String, dynamic>{
          'accessToken': 'access',
          'refreshToken': 'refresh',
          'accessTokenExpiresIn': 60,
          'user': 'not-a-map',
        }),
        throwsA(
          isA<FormatException>().having(
            (error) => error.message,
            'message',
            contains('AuthTokens.user'),
          ),
        ),
      );
    });

    test(
      'malformed upload payloads throw FormatException naming the field',
      () {
        expect(
          () => AssetSummary.fromJson(<String, dynamic>{'id': 'asset'}),
          throwsA(
            isA<FormatException>().having(
              (error) => error.message,
              'message',
              contains('AssetSummary.fileId'),
            ),
          ),
        );
        expect(
          () => DedupHit.fromJson(<String, dynamic>{
            'checksumSha256': 'a' * 64,
            'exists': 'yes',
          }),
          throwsA(
            isA<FormatException>().having(
              (error) => error.message,
              'message',
              contains('DedupHit.exists'),
            ),
          ),
        );
        expect(
          () => CreateSessionResult.fromJson(<String, dynamic>{
            'uploadId': 'upload-1',
            'chunkSizeBytes': 8,
            'totalParts': 1,
            'expiresAt': 42,
            'status': 'pending',
          }),
          throwsA(
            isA<FormatException>().having(
              (error) => error.message,
              'message',
              contains('CreateSessionResult.expiresAt'),
            ),
          ),
        );
        expect(
          () => UploadSessionStatus.fromJson(<String, dynamic>{
            'status': 'pending',
            'chunkSizeBytes': 8,
            'totalParts': 1,
            'receivedParts': <Object>['zero'],
            'receivedBytes': 0,
            'expiresAt': '2026-10-20T00:00:00.000Z',
          }),
          throwsA(
            isA<FormatException>().having(
              (error) => error.message,
              'message',
              contains('UploadSessionStatus.receivedParts[0]'),
            ),
          ),
        );
        expect(
          () => UploadCompleteResult.fromJson(<String, dynamic>{
            'asset': 'not-a-map',
            'deduplicated': false,
          }),
          throwsA(
            isA<FormatException>().having(
              (error) => error.message,
              'message',
              contains('UploadCompleteResult.asset'),
            ),
          ),
        );
      },
    );
  });

  group('SecureTokenStore', () {
    test('corrupt payload returns null and is deleted', () async {
      final storage = _FakeSecureStorage(<String, String?>{
        SecureTokenStore.storageKey: '{not valid json',
      });
      final store = SecureTokenStore(storage: storage);

      expect(await store.read(), isNull);
      expect(storage.deletedKeys, contains(SecureTokenStore.storageKey));
      expect(storage.values.containsKey(SecureTokenStore.storageKey), isFalse);
    });

    test('wrong-shape payload returns null and is deleted', () async {
      final storage = _FakeSecureStorage(<String, String?>{
        SecureTokenStore.storageKey: '{"accessToken": 42}',
      });
      final store = SecureTokenStore(storage: storage);

      expect(await store.read(), isNull);
      expect(storage.deletedKeys, contains(SecureTokenStore.storageKey));
    });

    test('valid pair round-trips through storage', () async {
      final storage = _FakeSecureStorage(<String, String?>{});
      final store = SecureTokenStore(storage: storage);
      final tokens = _freshTokens(accessToken: 'access-stored');

      await store.write(tokens);
      final restored = await store.read();

      expect(restored?.accessToken, 'access-stored');
      expect(restored?.refreshToken, tokens.refreshToken);
      expect(restored?.user.email, tokens.user.email);
    });
  });

  group('AuthManager refresh serialization', () {
    test('concurrent ensureAccessToken calls refresh exactly once', () async {
      var refreshCalls = 0;
      final server = await _StubServer.start((request, captured) async {
        if (captured.method == 'POST' &&
            captured.path == '/api/v1/auth/refresh') {
          refreshCalls++;
          _jsonResponse(request.response, 200, _tokenPayload());
        } else {
          _jsonResponse(request.response, 404, <String, dynamic>{
            'message': 'not found',
          });
        }
        await request.response.close();
      });
      addTearDown(server.close);

      final store = MemoryTokenStore(_expiredTokens());
      final manager = AuthManager(
        store: store,
        refreshLock: MemoryRefreshLock(),
        baseUrl: server.baseUrl,
      );
      await manager.restore();

      final results = await Future.wait(<Future<String>>[
        manager.ensureAccessToken(),
        manager.ensureAccessToken(),
      ]);

      expect(results, <String>['access-new', 'access-new']);
      expect(refreshCalls, 1);
      final body = jsonDecode(
        utf8.decode(server.requests.single.body),
      ) as Map<String, dynamic>;
      expect(body['refreshToken'], 'refresh-old');
      expect((await store.read())?.accessToken, 'access-new');
    });

    test('concurrent forceRefresh calls refresh exactly once', () async {
      var refreshCalls = 0;
      final server = await _StubServer.start((request, captured) async {
        if (captured.method == 'POST' &&
            captured.path == '/api/v1/auth/refresh') {
          refreshCalls++;
          _jsonResponse(request.response, 200, _tokenPayload());
        } else {
          _jsonResponse(request.response, 404, <String, dynamic>{
            'message': 'not found',
          });
        }
        await request.response.close();
      });
      addTearDown(server.close);

      final store = MemoryTokenStore(_expiredTokens());
      final manager = AuthManager(
        store: store,
        refreshLock: MemoryRefreshLock(),
        baseUrl: server.baseUrl,
      );
      await manager.restore();

      await Future.wait(<Future<void>>[
        manager.forceRefresh(),
        manager.forceRefresh(),
      ]);

      expect(refreshCalls, 1);
      expect((await store.read())?.accessToken, 'access-new');
    });

    test('ensureAccessToken with a fresh pair makes no HTTP calls', () async {
      final server = await _StubServer.start((request, captured) async {
        _jsonResponse(request.response, 500, <String, dynamic>{
          'message': 'unexpected call',
        });
        await request.response.close();
      });
      addTearDown(server.close);

      final store = MemoryTokenStore(_freshTokens(accessToken: 'access-fresh'));
      final manager = AuthManager(
        store: store,
        refreshLock: MemoryRefreshLock(),
        baseUrl: server.baseUrl,
      );
      await manager.restore();

      expect(await manager.ensureAccessToken(), 'access-fresh');
      expect(server.requests, isEmpty);
    });

    test('a peer manager adopts the rotated pair without refreshing', () async {
      final refreshStarted = Completer<void>();
      var refreshCalls = 0;
      final server = await _StubServer.start((request, captured) async {
        if (captured.method == 'POST' &&
            captured.path == '/api/v1/auth/refresh') {
          refreshCalls++;
          if (!refreshStarted.isCompleted) refreshStarted.complete();
          await Future<void>.delayed(const Duration(milliseconds: 200));
          _jsonResponse(
            request.response,
            200,
            _tokenPayload(
              accessToken: 'access-rotated',
              refreshToken: 'refresh-rotated',
            ),
          );
        } else {
          _jsonResponse(request.response, 404, <String, dynamic>{
            'message': 'not found',
          });
        }
        await request.response.close();
      });
      addTearDown(server.close);

      final store = MemoryTokenStore(_expiredTokens());
      final lock = MemoryRefreshLock();
      final first = AuthManager(
        store: store,
        refreshLock: lock,
        baseUrl: server.baseUrl,
      );
      final second = AuthManager(
        store: store,
        refreshLock: lock,
        baseUrl: server.baseUrl,
      );
      await first.restore();
      await second.restore();

      final firstRefresh = first.forceRefresh();
      await refreshStarted.future;
      final secondRefresh = second.forceRefresh();
      await Future.wait(<Future<void>>[firstRefresh, secondRefresh]);

      expect(refreshCalls, 1);
      expect(await second.ensureAccessToken(), 'access-rotated');
      expect((await store.read())?.refreshToken, 'refresh-rotated');
    });

    test('a 401 refresh clears the store and is attempted once', () async {
      var refreshCalls = 0;
      final server = await _StubServer.start((request, captured) async {
        if (captured.method == 'POST' &&
            captured.path == '/api/v1/auth/refresh') {
          refreshCalls++;
          _jsonResponse(request.response, 401, <String, dynamic>{
            'statusCode': 401,
            'message': 'Refresh token revoked',
          });
        } else {
          _jsonResponse(request.response, 404, <String, dynamic>{
            'message': 'not found',
          });
        }
        await request.response.close();
      });
      addTearDown(server.close);

      final store = MemoryTokenStore(_expiredTokens());
      final manager = AuthManager(
        store: store,
        refreshLock: MemoryRefreshLock(),
        baseUrl: server.baseUrl,
      );
      await manager.restore();

      await expectLater(
        manager.forceRefresh(),
        throwsA(
          isA<AuthException>()
              .having((error) => error.statusCode, 'statusCode', 401)
              .having(
                (error) => error.message,
                'message',
                contains('Refresh token revoked'),
              ),
        ),
      );

      expect(refreshCalls, 1);
      expect(manager.isSignedIn, isFalse);
      expect(await store.read(), isNull);
    });

    test(
      'signOut waits for an in-flight refresh and leaves no tokens',
      () async {
        final refreshStarted = Completer<void>();
        var refreshCalls = 0;
        var logoutCalls = 0;
        final server = await _StubServer.start((request, captured) async {
          if (captured.method == 'POST' &&
              captured.path == '/api/v1/auth/refresh') {
            refreshCalls++;
            if (!refreshStarted.isCompleted) refreshStarted.complete();
            await Future<void>.delayed(const Duration(milliseconds: 150));
            _jsonResponse(
              request.response,
              200,
              _tokenPayload(
                accessToken: 'access-late',
                refreshToken: 'refresh-late',
              ),
            );
          } else if (captured.method == 'POST' &&
              captured.path == '/api/v1/auth/logout') {
            logoutCalls++;
            request.response.statusCode = HttpStatus.noContent;
          } else {
            _jsonResponse(request.response, 404, <String, dynamic>{
              'message': 'not found',
            });
          }
          await request.response.close();
        });
        addTearDown(server.close);

        final store = MemoryTokenStore(_expiredTokens());
        final manager = AuthManager(
          store: store,
          refreshLock: MemoryRefreshLock(),
          baseUrl: server.baseUrl,
        );
        await manager.restore();

        final refresh = manager.forceRefresh();
        await refreshStarted.future;
        await manager.signOut();
        await refresh;

        expect(refreshCalls, 1);
        expect(logoutCalls, 1);
        expect(manager.isSignedIn, isFalse);
        expect(await store.read(), isNull);
        await Future<void>.delayed(const Duration(milliseconds: 50));
        expect(await store.read(), isNull);
      },
    );

    test('restore treats a corrupt store as signed out', () async {
      final manager = AuthManager(
        store: _CorruptTokenStore(),
        refreshLock: MemoryRefreshLock(),
        baseUrl: 'http://127.0.0.1:1',
      );

      await manager.restore();

      expect(manager.isSignedIn, isFalse);
    });
  });

  group('ApiClient upload', () {
    test(
      'multipart uses only the file field and whitelisted metadata',
      () async {
        final harness = await _startHarness((request, captured) async {
          _jsonResponse(request.response, 201, <String, dynamic>{
            'id': 'asset-1',
            'fileId': 'file-1',
          });
          await request.response.close();
        });
        addTearDown(harness.close);

        final directory = await Directory.systemTemp.createTemp(
          'photox-upload-',
        );
        addTearDown(() => directory.delete(recursive: true));
        final file = File('${directory.path}/photo.heic');
        await file.writeAsBytes(<int>[0, 1, 2, 3]);

        final summary = await harness.api.uploadFile(
          file,
          'IMG_0001.HEIC',
          mimeType: 'image/heic',
          title: 'Trip',
          description: 'Sunset',
          takenAt: DateTime.utc(2026, 10, 18, 9),
        );

        expect(summary.id, 'asset-1');
        expect(summary.fileId, 'file-1');
        final captured = harness.server.requests.single;
        expect(captured.headers['authorization'], 'Bearer access-fresh');
        final body = latin1.decode(captured.body);
        final fieldNames = RegExp(r'\bname="([^"]+)"')
            .allMatches(body)
            .map((match) => match.group(1))
            .toSet();
        expect(fieldNames, <String>{'file', 'title', 'description', 'takenAt'});
        expect(body, contains('filename="IMG_0001.HEIC"'));
        expect(body, contains('content-type: image/heic'));
      },
    );

    test('409 duplicate maps existingAssetId and existingFileId', () async {
      final harness = await _startHarness((request, captured) async {
        _jsonResponse(request.response, 409, <String, dynamic>{
          'statusCode': 409,
          'message': 'File already exists',
          'existingAssetId': 'asset-existing',
          'existingFileId': 'file-existing',
        });
        await request.response.close();
      });
      addTearDown(harness.close);

      final directory = await Directory.systemTemp.createTemp('photox-upload-');
      addTearDown(() => directory.delete(recursive: true));
      final file = File('${directory.path}/photo.jpg');
      await file.writeAsBytes(<int>[1, 2, 3]);

      await expectLater(
        harness.api.uploadFile(file, 'photo.jpg'),
        throwsA(
          isA<ApiException>()
              .having((error) => error.statusCode, 'statusCode', 409)
              .having(
                (error) => error.existingAssetId,
                'existingAssetId',
                'asset-existing',
              )
              .having(
                (error) => error.existingFileId,
                'existingFileId',
                'file-existing',
              ),
        ),
      );
    });

    test('uploadFile normalizes AuthException from forceRefresh', () async {
      final server = await _StubServer.start((request, captured) async {
        _jsonResponse(request.response, 401, <String, dynamic>{
          'statusCode': 401,
          'message': 'expired',
        });
        await request.response.close();
      });
      addTearDown(server.close);

      final auth = _ThrowingRefreshAuth(
        store: MemoryTokenStore(_freshTokens()),
        refreshLock: MemoryRefreshLock(),
        baseUrl: server.baseUrl,
      );
      await auth.restore();
      final api = ApiClient(auth: auth, baseUrl: server.baseUrl);
      addTearDown(api.close);

      final directory = await Directory.systemTemp.createTemp('photox-upload-');
      addTearDown(() => directory.delete(recursive: true));
      final file = File('${directory.path}/photo.jpg');
      await file.writeAsBytes(<int>[1, 2, 3]);

      await expectLater(
        api.uploadFile(file, 'photo.jpg'),
        throwsA(
          isA<ApiException>()
              .having((error) => error.statusCode, 'statusCode', 401)
              .having((error) => error.message, 'message', 'refresh rejected'),
        ),
      );
      expect(server.requests, hasLength(1));
    });
  });

  group('ApiClient 401 interceptor', () {
    test('retries once with the rotated token', () async {
      var refreshCalls = 0;
      var fileCalls = 0;
      final server = await _StubServer.start((request, captured) async {
        if (captured.method == 'POST' &&
            captured.path == '/api/v1/auth/refresh') {
          refreshCalls++;
          _jsonResponse(request.response, 200, _tokenPayload());
        } else if (captured.path == '/api/v1/files/asset-1') {
          fileCalls++;
          if (captured.headers['authorization'] == 'Bearer access-new') {
            _jsonResponse(request.response, 200, <String, dynamic>{
              'id': 'asset-1',
            });
          } else {
            _jsonResponse(request.response, 401, <String, dynamic>{
              'statusCode': 401,
              'message': 'expired',
            });
          }
        } else {
          _jsonResponse(request.response, 404, <String, dynamic>{
            'message': 'not found',
          });
        }
        await request.response.close();
      });
      addTearDown(server.close);

      final harness = await _startHarnessWithServer(server);
      addTearDown(harness.close);

      final json = await harness.api.get<Map<String, dynamic>>(
        '/api/v1/files/asset-1',
      );

      expect(json['id'], 'asset-1');
      expect(refreshCalls, 1);
      expect(fileCalls, 2);
      final fileRequests = server.requests
          .where((request) => request.path == '/api/v1/files/asset-1')
          .toList();
      expect(fileRequests[0].headers['authorization'], 'Bearer access-fresh');
      expect(fileRequests[1].headers['authorization'], 'Bearer access-new');
    });

    test('persistent 401 does not loop', () async {
      var refreshCalls = 0;
      var fileCalls = 0;
      final server = await _StubServer.start((request, captured) async {
        if (captured.method == 'POST' &&
            captured.path == '/api/v1/auth/refresh') {
          refreshCalls++;
          _jsonResponse(request.response, 200, _tokenPayload());
        } else if (captured.path == '/api/v1/files/asset-1') {
          fileCalls++;
          _jsonResponse(request.response, 401, <String, dynamic>{
            'statusCode': 401,
            'message': 'still expired',
          });
        } else {
          _jsonResponse(request.response, 404, <String, dynamic>{
            'message': 'not found',
          });
        }
        await request.response.close();
      });
      addTearDown(server.close);

      final harness = await _startHarnessWithServer(server);
      addTearDown(harness.close);

      await expectLater(
        harness.api.get<Map<String, dynamic>>('/api/v1/files/asset-1'),
        throwsA(
          isA<ApiException>().having(
            (error) => error.statusCode,
            'statusCode',
            401,
          ),
        ),
      );

      expect(refreshCalls, 1);
      expect(fileCalls, 2);
    });
  });

  group('SessionClient failures', () {
    test('complete surfaces receivedParts on 409 PARTS_MISSING', () async {
      final harness = await _startHarness((request, captured) async {
        _jsonResponse(request.response, 409, <String, dynamic>{
          'statusCode': 409,
          'message': 'Upload is missing parts',
          'code': 'PARTS_MISSING',
          'receivedParts': <int>[1, 3],
        });
        await request.response.close();
      });
      addTearDown(harness.close);

      await expectLater(
        harness.sessions.complete('upload-1'),
        throwsA(
          isA<ApiException>()
              .having((error) => error.statusCode, 'statusCode', 409)
              .having((error) => error.code, 'code', 'PARTS_MISSING')
              .having((error) => error.receivedParts, 'receivedParts', <int>[
                1,
                3,
              ]),
        ),
      );
    });

    test('abort rethrows network errors and swallows 404/410', () async {
      final harness = await _startHarness((request, captured) async {
        if (captured.path == '/api/v1/uploads/net-error') {
          final socket = await request.response.detachSocket(
            writeHeaders: false,
          );
          socket.destroy();
          return;
        }
        final status = captured.path == '/api/v1/uploads/gone' ? 410 : 404;
        _jsonResponse(request.response, status, <String, dynamic>{
          'statusCode': status,
          'message': 'session gone',
        });
        await request.response.close();
      });
      addTearDown(harness.close);

      await expectLater(
        harness.sessions.abort('net-error'),
        throwsA(
          isA<ApiException>().having(
            (error) => error.statusCode,
            'statusCode',
            isNull,
          ),
        ),
      );
      await harness.sessions.abort('missing');
      await harness.sessions.abort('gone');
    });

    test('createSession rejects invalid size and checksum', () async {
      final harness = await _startHarness((request, captured) async {
        _jsonResponse(request.response, 500, <String, dynamic>{
          'message': 'unexpected call',
        });
        await request.response.close();
      });
      addTearDown(harness.close);

      const validChecksum =
          'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

      await expectLater(
        harness.sessions.createSession(
          sha256Hex: validChecksum,
          sizeBytes: 0,
          filename: 'empty.jpg',
        ),
        throwsA(isA<ArgumentError>()),
      );
      await expectLater(
        harness.sessions.createSession(
          sha256Hex: 'not-a-checksum',
          sizeBytes: 10,
          filename: 'photo.jpg',
        ),
        throwsA(isA<ArgumentError>()),
      );
      expect(harness.server.requests, isEmpty);
    });

    test('createSession converts malformed payload to ApiException', () async {
      final harness = await _startHarness((request, captured) async {
        _jsonResponse(request.response, 201, <String, dynamic>{
          'uploadId': 42,
          'chunkSizeBytes': 8,
          'totalParts': 1,
          'expiresAt': '2026-10-20T00:00:00.000Z',
          'status': 'pending',
        });
        await request.response.close();
      });
      addTearDown(harness.close);

      await expectLater(
        harness.sessions.createSession(
          sha256Hex: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          sizeBytes: 10,
          filename: 'photo.jpg',
        ),
        throwsA(
          isA<ApiException>().having(
            (error) => error.message,
            'message',
            contains('uploadId'),
          ),
        ),
      );
    });
  });
}

Future<void> _handleRequest(
  HttpRequest request,
  List<_CapturedRequest> requests,
) async {
  final body = await request.fold<List<int>>(
    <int>[],
    (buffer, chunk) => buffer..addAll(chunk),
  );
  final headers = <String, String>{};
  request.headers.forEach((name, values) {
    headers[name.toLowerCase()] = values.join(',');
  });
  requests.add(
    _CapturedRequest(
      method: request.method,
      path: request.uri.path,
      headers: headers,
      body: body,
    ),
  );

  final response = request.response;
  final route = '${request.method} ${request.uri.path}';
  if (route == 'POST /api/v1/uploads') {
    response.statusCode = HttpStatus.created;
    _writeJson(response, <String, dynamic>{
      'uploadId': 'upload-1',
      'chunkSizeBytes': AppConfig.sessionChunkSizeBytes,
      'totalParts': 2,
      'expiresAt': '2026-10-20T00:00:00.000Z',
      'status': 'pending',
    });
  } else if (route == 'GET /api/v1/uploads/upload-1') {
    response.statusCode = HttpStatus.ok;
    _writeJson(response, <String, dynamic>{
      'status': 'pending',
      'chunkSizeBytes': AppConfig.sessionChunkSizeBytes,
      'totalParts': 2,
      'receivedParts': <int>[0],
      'receivedBytes': AppConfig.sessionChunkSizeBytes,
      'expiresAt': '2026-10-20T00:00:00.000Z',
    });
  } else if (route == 'PUT /api/v1/uploads/upload-1/parts/0') {
    response.statusCode = HttpStatus.noContent;
  } else if (route == 'POST /api/v1/uploads/upload-1/complete') {
    response.statusCode = HttpStatus.ok;
    _writeJson(response, <String, dynamic>{
      'asset': <String, dynamic>{'id': 'asset-1', 'fileId': 'file-1'},
      'deduplicated': true,
    });
  } else if (route == 'DELETE /api/v1/uploads/gone') {
    response.statusCode = HttpStatus.gone;
    _writeJson(response, <String, dynamic>{
      'statusCode': 410,
      'message': 'Upload session expired',
      'code': 'SESSION_EXPIRED',
    });
  } else if (route == 'POST /api/v1/files/exists') {
    response.statusCode = HttpStatus.ok;
    _writeJson(response, <String, dynamic>{
      'items': <Map<String, dynamic>>[
        <String, dynamic>{
          'checksumSha256': 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          'exists': true,
          'existingFileId': 'file-1',
          'existingAssetId': 'asset-1',
        },
        <String, dynamic>{
          'checksumSha256': 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
          'exists': false,
        },
      ],
    });
  } else {
    response.statusCode = HttpStatus.notFound;
    _writeJson(response, <String, dynamic>{
      'statusCode': 404,
      'message': 'Not found: $route',
    });
  }
  await response.close();
}

void _writeJson(HttpResponse response, Map<String, dynamic> body) {
  response.headers.contentType = ContentType.json;
  response.write(jsonEncode(body));
}

class _CapturedRequest {
  const _CapturedRequest({
    required this.method,
    required this.path,
    required this.headers,
    required this.body,
  });

  final String method;
  final String path;
  final Map<String, String> headers;
  final List<int> body;
}

typedef _StubHandler = Future<void> Function(
  HttpRequest request,
  _CapturedRequest captured,
);

class _StubServer {
  _StubServer._(this._server);

  final HttpServer _server;
  final List<_CapturedRequest> requests = <_CapturedRequest>[];

  String get baseUrl => 'http://${_server.address.host}:${_server.port}';

  static Future<_StubServer> start(_StubHandler handler) async {
    final httpServer = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
    final server = _StubServer._(httpServer);
    httpServer.listen((request) {
      unawaited(server._serve(request, handler));
    });
    return server;
  }

  Future<void> _serve(HttpRequest request, _StubHandler handler) async {
    final captured = await _captureRequest(request);
    requests.add(captured);
    await handler(request, captured);
  }

  Future<void> close() => _server.close(force: true);
}

class _ApiHarness {
  _ApiHarness(this.server, this.store, this.auth, this.api)
    : sessions = SessionClient(api);

  final _StubServer server;
  final MemoryTokenStore store;
  final AuthManager auth;
  final ApiClient api;
  final SessionClient sessions;

  Future<void> close() async {
    api.close();
    await server.close();
  }
}

Future<_ApiHarness> _startHarness(_StubHandler handler) async {
  final server = await _StubServer.start(handler);
  return _startHarnessWithServer(server);
}

Future<_ApiHarness> _startHarnessWithServer(_StubServer server) async {
  final store = MemoryTokenStore(_freshTokens());
  final auth = AuthManager(
    store: store,
    refreshLock: MemoryRefreshLock(),
    baseUrl: server.baseUrl,
  );
  await auth.restore();
  return _ApiHarness(
    server,
    store,
    auth,
    ApiClient(auth: auth, baseUrl: server.baseUrl),
  );
}

Future<_CapturedRequest> _captureRequest(HttpRequest request) async {
  final body = await request.fold<List<int>>(
    <int>[],
    (buffer, chunk) => buffer..addAll(chunk),
  );
  final headers = <String, String>{};
  request.headers.forEach((name, values) {
    headers[name.toLowerCase()] = values.join(',');
  });
  return _CapturedRequest(
    method: request.method,
    path: request.uri.path,
    headers: headers,
    body: body,
  );
}

void _jsonResponse(
  HttpResponse response,
  int statusCode,
  Map<String, dynamic> body,
) {
  response.statusCode = statusCode;
  _writeJson(response, body);
}

Map<String, dynamic> _userJson() => <String, dynamic>{
  'id': 'user-1',
  'email': 'user@example.com',
  'role': 'user',
  'displayName': 'Test User',
  'createdAt': '2026-01-01T00:00:00.000Z',
  'updatedAt': '2026-01-02T00:00:00.000Z',
};

Map<String, dynamic> _tokenPayload({
  String accessToken = 'access-new',
  String refreshToken = 'refresh-new',
}) => <String, dynamic>{
  'accessToken': accessToken,
  'accessTokenExpiresIn': 3600,
  'refreshToken': refreshToken,
  'user': _userJson(),
};

AuthTokens _freshTokens({
  String accessToken = 'access-fresh',
  String refreshToken = 'refresh-fresh',
}) => AuthTokens(
  accessToken: accessToken,
  refreshToken: refreshToken,
  accessExpiresAt: DateTime.now().toUtc().add(const Duration(hours: 1)),
  user: AuthUser.fromJson(_userJson()),
);

AuthTokens _expiredTokens({
  String accessToken = 'access-old',
  String refreshToken = 'refresh-old',
}) => AuthTokens(
  accessToken: accessToken,
  refreshToken: refreshToken,
  accessExpiresAt: DateTime.now().toUtc().subtract(const Duration(minutes: 5)),
  user: AuthUser.fromJson(_userJson()),
);

class _FakeSecureStorage extends FlutterSecureStorage {
  _FakeSecureStorage(this.values);

  final Map<String, String?> values;
  final List<String> deletedKeys = <String>[];

  @override
  Future<String?> read({
    required String key,
    AppleOptions? iOptions,
    AndroidOptions? aOptions,
    LinuxOptions? lOptions,
    WebOptions? webOptions,
    AppleOptions? mOptions,
    WindowsOptions? wOptions,
  }) async => values[key];

  @override
  Future<void> write({
    required String key,
    required String? value,
    AppleOptions? iOptions,
    AndroidOptions? aOptions,
    LinuxOptions? lOptions,
    WebOptions? webOptions,
    AppleOptions? mOptions,
    WindowsOptions? wOptions,
  }) async {
    values[key] = value;
  }

  @override
  Future<void> delete({
    required String key,
    AppleOptions? iOptions,
    AndroidOptions? aOptions,
    LinuxOptions? lOptions,
    WebOptions? webOptions,
    AppleOptions? mOptions,
    WindowsOptions? wOptions,
  }) async {
    deletedKeys.add(key);
    values.remove(key);
  }
}

class _CorruptTokenStore implements TokenStore {
  @override
  Future<AuthTokens?> read() async => throw const FormatException('corrupt');

  @override
  Future<void> write(AuthTokens tokens) async {}

  @override
  Future<void> clear() async {}
}

class _ThrowingRefreshAuth extends AuthManager {
  _ThrowingRefreshAuth({
    required super.store,
    required super.refreshLock,
    super.baseUrl,
  });

  @override
  Future<String> ensureAccessToken() async => 'stale-token';

  @override
  Future<void> forceRefresh() async {
    throw const AuthException('refresh rejected');
  }
}
