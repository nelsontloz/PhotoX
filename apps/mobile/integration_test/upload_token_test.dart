import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:photox_mobile/core/api_client.dart';
import 'package:photox_mobile/core/auth_manager.dart';
import 'package:photox_mobile/core/auth_models.dart';
import 'package:photox_mobile/core/refresh_lock.dart';
import 'package:photox_mobile/upload/models.dart';
import 'package:photox_mobile/upload/transports.dart';

import 'support/harness.dart';
import 'support/pipeline.dart';

/// How the pipeline behaves when the token pair is not usable.
///
/// Both cases are things core does and the fakes cannot reproduce: a token
/// that expired while the app was closed, and a session revoked from another
/// device. The 401-then-retry branch inside `ApiClient.uploadFile` cannot be
/// reached from here (nothing invalidates the access token while its refresh
/// token still works), so it stays covered by `test/unit/core_contracts_test`.
void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('an access token that expired between passes still uploads', (
    tester,
  ) async {
    final api = apiDio();
    final user = await registerFreshUser(api);
    final services = await bootPipeline();
    addTearDown(services.dispose);

    await signInPipeline(services, user);
    final store = services.auth.store;
    final before = (await store.read())!;

    // Same refresh token, expiry in the past: what the app finds when it opens
    // hours later. A second manager reads the store the way a restarted
    // process does (`restore`), which is the only way to observe the in-memory
    // pair being stale.
    await store.write(
      AuthTokens(
        accessToken: before.accessToken,
        refreshToken: before.refreshToken,
        accessExpiresAt: DateTime.now().subtract(const Duration(minutes: 5)),
        user: before.user,
      ),
    );
    final restarted = AuthManager(
      store: store,
      refreshLock: DriftRefreshLock(services.db),
      baseUrl: apiBaseUrl,
    );
    addTearDown(restarted.dispose);
    await restarted.restore();
    final restartedApi = ApiClient(auth: restarted, baseUrl: apiBaseUrl);
    addTearDown(restartedApi.close);

    final small = await seededAsset(services, smallPhotoName);
    final file = await services.observer.fileFor(small.localId);
    expect(file, isNotNull, reason: 'no bytes for ${small.localId}');
    final summary = await ApiUploadTransport(restartedApi).uploadFile(
      file!,
      smallPhotoName,
      mimeType: small.mimeType.isEmpty ? 'image/jpeg' : small.mimeType,
    );
    expect(summary.id, isNotEmpty);

    final after = (await store.read())!;
    expect(
      after.refreshToken,
      isNot(before.refreshToken),
      reason: 'the expired access token was not refreshed before the upload',
    );
    // Assert with the rotated pair: touching `services.auth` now would replay
    // the pre-rotation refresh token and revoke the family.
    final assets = await api.get<Map<String, dynamic>>(
      '/api/v1/assets',
      options: authHeader(after.accessToken),
    );
    expect((assets.data!['total'] as num).toInt(), greaterThanOrEqualTo(1));
  }, timeout: const Timeout(Duration(minutes: 10)));

  testWidgets('a revoked session stops the pass instead of retrying', (
    tester,
  ) async {
    final api = apiDio();
    final user = await registerFreshUser(api);
    final services = await bootPipeline();
    addTearDown(services.dispose);

    await signInPipeline(services, user);
    final tokens = (await services.auth.store.read())!;

    // Another device (or an admin edit) kills this session. The access token
    // still looks valid to the client, which is exactly the trap.
    final logout = await api.post<dynamic>(
      '/api/v1/auth/logout',
      data: <String, dynamic>{'refreshToken': tokens.refreshToken},
    );
    expect(logout.statusCode, anyOf(200, 204));
    expect(services.auth.isSignedIn, isTrue, reason: 'client-side state');

    final report = await services.coordinator.run();
    expect(report.authRequired, isTrue, reason: '$report');
    expect(report.uploaded, 0, reason: '$report');
    expect(
      services.auth.isSignedIn,
      isFalse,
      reason: 'a 401 the refresh cannot fix must drop the session',
    );

    final small = await seededAsset(services, smallPhotoName);
    final row = await queueRow(services, small.localId);
    expect(row.state, isNot(UploadState.uploaded.name));
    expect(
      row.attempts,
      lessThanOrEqualTo(1),
      reason: 'a dead session must not schedule retries',
    );
  }, timeout: const Timeout(Duration(minutes: 10)));
}
