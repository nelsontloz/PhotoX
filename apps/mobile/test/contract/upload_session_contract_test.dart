import 'dart:convert';
import 'dart:io';

import 'package:crypto/crypto.dart';
import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:photox_mobile/core/api_client.dart';
import 'package:photox_mobile/core/auth_manager.dart';
import 'package:photox_mobile/core/refresh_lock.dart';
import 'package:photox_mobile/core/token_store.dart';
import 'package:photox_mobile/upload/models.dart';
import 'package:photox_mobile/upload/session_client.dart';

/// A valid 1x1 PNG. Keeping the bytes fixed makes the checksum deterministic.
final List<int> _pngBytes = base64Decode(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk'
  '+A8AAQUBAScY42YAAAAASUVORK5CYII=',
);

const Timeout _networkTimeout = Timeout(Duration(minutes: 2));

void main() {
  final baseUrl = Platform.environment['PHOTOX_E2E_BASE_URL'];
  final skipReason = baseUrl == null || baseUrl.isEmpty
      ? 'PHOTOX_E2E_BASE_URL is not set; start the stack with '
            'tool/e2e/run_contract.sh to run the live core contract suite.'
      : false;

  group('PhotoX core upload session contract', () {
    late Dio rawDio;
    late MemoryTokenStore tokenStore;
    late AuthManager auth;
    late ApiClient api;
    late SessionClient sessions;
    Directory? tempDir;
    late File pngFile;
    late String checksum;
    final activeUploads = <String>[];
    final responseStatuses = <String, int>{};
    var ready = false;

    setUpAll(() async {
      rawDio = Dio(BaseOptions(baseUrl: baseUrl!));
      final dir = await Directory.systemTemp.createTemp('photox-contract-');
      tempDir = dir;
      pngFile = File('${dir.path}/tiny.png');
      await pngFile.writeAsBytes(_pngBytes, flush: true);
      checksum = sha256.convert(_pngBytes).toString();

      final email =
          'contract-${DateTime.now().microsecondsSinceEpoch}@example.com';
      const password = 'contract-password-123';

      final registration = await rawDio.post<Map<String, dynamic>>(
        '/api/v1/auth/register',
        data: <String, dynamic>{
          'email': email,
          'password': password,
          'displayName': 'Contract Test',
        },
      );
      expect(registration.statusCode, 201, reason: 'register must return 201');
      expect(registration.data?['accessToken'], isA<String>());

      tokenStore = MemoryTokenStore();
      auth = AuthManager(
        store: tokenStore,
        refreshLock: MemoryRefreshLock(),
        baseUrl: baseUrl,
      );
      // Exercise the real login path rather than reusing the register tokens.
      await auth.signIn(email: email, password: password);
      expect(auth.isSignedIn, isTrue);

      api = ApiClient(auth: auth, baseUrl: baseUrl);
      api.dio.interceptors.add(
        InterceptorsWrapper(
          onResponse: (response, handler) {
            responseStatuses[response.requestOptions.path] =
                response.statusCode ?? 0;
            handler.next(response);
          },
        ),
      );
      sessions = SessionClient(api);
      ready = true;
    });

    tearDown(() async {
      // setUpAll never reached `sessions = ...`: let its register/login error
      // surface instead of a LateInitializationError from cleanup.
      if (!ready) return;
      // Abandon sessions a failed test left behind so the per-user active
      // session cap cannot leak into the next case.
      for (final uploadId in activeUploads) {
        try {
          await sessions.abort(uploadId);
        } on Object {
          // Best effort: cleanup must never mask the assertion failure.
        }
      }
      activeUploads.clear();
    });

    tearDownAll(() async {
      if (ready) {
        api.close();
        auth.dispose();
      }
      rawDio.close(force: true);
      final dir = tempDir;
      if (dir != null && await dir.exists()) {
        await dir.delete(recursive: true);
      }
    });

    Future<CreateSessionResult> createSession() async {
      final created = await sessions.createSession(
        sha256Hex: checksum,
        sizeBytes: _pngBytes.length,
        filename: 'tiny.png',
      );
      activeUploads.add(created.uploadId);
      return created;
    }

    test('creates a session with the documented 8 MiB part size', () async {
      final created = await createSession();

      expect(created.uploadId, isNotEmpty);
      expect(created.chunkSizeBytes, 8 * 1024 * 1024);
      expect(created.totalParts, 1);
      expect(created.status, 'pending');
      expect(
        responseStatuses['/api/v1/uploads'],
        201,
        reason: 'POST /api/v1/uploads must return 201',
      );
    }, timeout: _networkTimeout);

    test('stores a part and reports it from session status', () async {
      final created = await createSession();

      await sessions.putPart(created.uploadId, 0, bytes: _pngBytes);
      final status = await sessions.getStatus(created.uploadId);

      expect(status.receivedParts, <int>[0]);
      expect(status.receivedBytes, _pngBytes.length);
      expect(status.chunkSizeBytes, created.chunkSizeBytes);
      expect(status.totalParts, 1);
    }, timeout: _networkTimeout);

    test(
      'completes, replays as deduplicated, and blocks a re-upload',
      () async {
        final created = await createSession();
        await sessions.putPart(created.uploadId, 0, bytes: _pngBytes);

        final first = await sessions.complete(created.uploadId);
        expect(first.deduplicated, isFalse);
        expect(first.asset.id, isNotEmpty);
        expect(first.asset.fileId, isNotEmpty);

        final replay = await sessions.complete(created.uploadId);
        expect(replay.deduplicated, isTrue);
        expect(replay.asset.id, first.asset.id);

        final hits = await api.exists(<DedupCheck>[
          DedupCheck(checksumSha256: checksum),
        ]);
        expect(hits, hasLength(1));
        expect(hits.single.exists, isTrue);
        expect(hits.single.existingAssetId, first.asset.id);
        expect(hits.single.existingFileId, first.asset.fileId);

        await expectLater(
          api.uploadFile(pngFile, 'tiny.png', mimeType: 'image/png'),
          throwsA(
            isA<ApiException>()
                .having((error) => error.statusCode, 'statusCode', 409)
                .having(
                  (error) => error.existingAssetId,
                  'existingAssetId',
                  first.asset.id,
                )
                .having(
                  (error) => error.existingFileId,
                  'existingFileId',
                  first.asset.fileId,
                ),
          ),
        );
      },
      timeout: _networkTimeout,
    );

    test(
      'rotates the token pair and keeps authenticated calls working',
      () async {
        final before = await tokenStore.read();
        expect(before, isNotNull);

        await auth.forceRefresh();

        final after = await tokenStore.read();
        expect(after, isNotNull);
        expect(after!.accessToken, isNot(before!.accessToken));
        expect(after.refreshToken, isNot(before.refreshToken));

        final quota = await api.get<Map<String, dynamic>>(
          '/api/v1/files/quota',
        );
        expect(quota['usedBytes'], isA<num>());
      },
      timeout: _networkTimeout,
    );
  }, skip: skipReason);
}
