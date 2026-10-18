import 'package:dio/dio.dart';

import 'app_config.dart';
import 'auth_manager.dart';

/// Dio transport for the PhotoX core API, signed with the stored Bearer token.
class ApiClient {
  ApiClient({required this.auth})
    : dio = Dio(BaseOptions(baseUrl: AppConfig.apiBaseUrl)) {
    dio.interceptors.add(
      InterceptorsWrapper(
        onRequest: (options, handler) async {
          // TODO(spec §3.2): 401-retry and refresh bookkeeping hook in here;
          // the guard must reuse AuthManager.ensureAccessToken()'s single flight.
          final token = await auth.ensureAccessToken();
          options.headers['Authorization'] = 'Bearer $token';
          handler.next(options);
        },
      ),
    );
  }

  /// Token provider used to sign every outgoing request.
  final AuthManager auth;

  /// Shared Dio instance; feature clients layer options on top of it.
  final Dio dio;

  // TODO(spec §3.2): map 413 (quota) and 410 (expired session) into typed
  // errors so callers can stop retrying instead of guessing from strings.
}
