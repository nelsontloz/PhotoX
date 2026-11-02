import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:photox_mobile/core/auth_manager.dart';
import 'package:photox_mobile/core/auth_models.dart';
import 'package:photox_mobile/core/refresh_lock.dart';
import 'package:photox_mobile/core/token_store.dart';

import 'support/harness.dart';

/// Token contract against the real core, without the UI: rotation on refresh,
/// reuse detection, and sign-out. Registers its own account so the login rate
/// limit (5 per 15 min per ip+email) is never shared with the UI flow.
void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('rotates tokens, revokes on reuse, signs out', (tester) async {
    final api = apiDio();
    final email =
        'mobile-e2e-proto-${DateTime.now().microsecondsSinceEpoch}@photox.test';

    final register = await api.post<Map<String, dynamic>>(
      '/api/v1/auth/register',
      data: <String, dynamic>{
        'email': email,
        'password': e2ePassword,
        'displayName': 'Mobile E2E',
      },
    );
    expect(register.statusCode, anyOf(200, 201));

    final auth = AuthManager(
      store: MemoryTokenStore(),
      refreshLock: MemoryRefreshLock(),
      baseUrl: apiBaseUrl,
    );
    await auth.signIn(email: email, password: e2ePassword);
    expect(auth.isSignedIn, isTrue);

    final first = await auth.ensureAccessToken();
    await auth.forceRefresh();
    final rotated = await auth.ensureAccessToken();
    expect(rotated, isNot(first));

    final me = await api.get<Map<String, dynamic>>(
      '/api/v1/assets',
      options: authHeader(rotated),
    );
    expect(me.statusCode, 200);
    expect(me.data!['total'], 0);

    // A rotated-out refresh token is a replay: core revokes the whole family,
    // so the token that replaced it dies too. That is why refreshes must be
    // single-flight on the client.
    final rawLogin = await api.post<Map<String, dynamic>>(
      '/api/v1/auth/login',
      data: <String, dynamic>{'email': email, 'password': e2ePassword},
    );
    final oldRefresh = rawLogin.data!['refreshToken'] as String;
    final refresh = await api.post<Map<String, dynamic>>(
      '/api/v1/auth/refresh',
      data: <String, dynamic>{'refreshToken': oldRefresh},
    );
    expect(refresh.statusCode, 200);
    final newRefresh = refresh.data!['refreshToken'] as String;

    Future<void> expectRejected(String refreshToken) async {
      await expectLater(
        api.post<dynamic>(
          '/api/v1/auth/refresh',
          data: <String, dynamic>{'refreshToken': refreshToken},
        ),
        throwsA(
          isA<DioException>().having(
            (error) => error.response?.statusCode,
            'status',
            401,
          ),
        ),
      );
    }

    await expectRejected(oldRefresh);
    await expectRejected(newRefresh);

    await auth.signOut();
    expect(auth.isSignedIn, isFalse);
    await expectLater(auth.ensureAccessToken(), throwsA(isA<AuthException>()));
  }, timeout: const Timeout(Duration(minutes: 5)));
}
