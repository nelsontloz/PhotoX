import 'package:dio/dio.dart';
import 'package:flutter/foundation.dart';

import 'api_client.dart';
import 'app_config.dart';
import 'auth_models.dart';
import 'refresh_lock.dart';
import 'token_store.dart';

/// Owns the token pair and serializes refresh-token rotation.
///
/// Refresh tokens rotate with reuse detection: a replayed token revokes the
/// whole family, so refreshes must never run in parallel. The in-process
/// single-flight future plus [RefreshLock] enforce that; after acquiring the
/// lock we always re-read the store in case another isolate already rotated.
class AuthManager extends ChangeNotifier {
  /// Creates the token manager for [store].
  ///
  /// Exactly one [AuthManager] may exist per [store] per process. Two
  /// instances would each rotate independently and double-refresh (and race on
  /// the persisted pair) until a durable cross-isolate lock exists.
  AuthManager({
    required this.store,
    required this.refreshLock,
    Dio? dio,
    String? baseUrl,
    DateTime Function()? clock,
  }) : _clock = clock ?? DateTime.now,
       _dio = dio ?? Dio() {
    final configured = _dio.options.baseUrl;
    _dio.options.baseUrl =
        baseUrl ?? (configured.isNotEmpty ? configured : AppConfig.apiBaseUrl);
    _dio.options.connectTimeout ??= const Duration(seconds: 15);
    _dio.options.receiveTimeout ??= const Duration(seconds: 30);
    _dio.options.sendTimeout ??= const Duration(seconds: 30);
  }

  /// Persistence for the single token document.
  final TokenStore store;

  /// Points every later auth request at the server the user just entered.
  set baseUrl(String url) => _dio.options.baseUrl = url;

  /// Cross-isolate mutex guarding refresh rotation.
  final RefreshLock refreshLock;

  final Dio _dio;
  final DateTime Function() _clock;

  static const Duration _refreshLockTtl = Duration(seconds: 30);
  static const Duration _refreshLockWait = Duration(seconds: 35);

  static int _ownerCounter = 0;
  final String _owner =
      'auth-${DateTime.now().microsecondsSinceEpoch}-${_ownerCounter++}';

  AuthTokens? _tokens;
  bool _restored = false;
  Future<void>? _refreshInFlight;

  /// True while [signOut] is awaiting the server logout.
  ///
  /// A [forceRefresh] that starts in this window would rotate (and republish) a
  /// token pair the logout is about to revoke, so it must fail instead.
  bool _signingOut = false;

  /// Whether a token pair is currently held (the access token may be expired).
  bool get isSignedIn => _tokens != null;

  /// Signed-in user, or null when signed out.
  AuthUser? get user => _tokens?.user;

  /// Loads the persisted pair once per process.
  Future<void> restore() async {
    if (_restored) return;
    _tokens = await _readStoreSafely();
    _restored = true;
    notifyListeners();
  }

  /// Authenticates with email/password and persists the returned pair.
  Future<void> signIn({required String email, required String password}) async {
    try {
      final response = await _dio.post<Map<String, dynamic>>(
        '/api/v1/auth/login',
        data: <String, dynamic>{'email': email, 'password': password},
      );
      final data = response.data;
      if (data == null) {
        throw const AuthException('Login response was empty');
      }
      final tokens = AuthTokens.fromResponseJson(data, now: _clock());
      await store.write(tokens);
      _tokens = tokens;
      _restored = true;
      notifyListeners();
    } on DioException catch (error) {
      throw AuthException(
        _messageFor(error),
        statusCode: error.response?.statusCode,
      );
    } on FormatException catch (error) {
      throw AuthException('Malformed login response: ${error.message}');
    }
  }

  /// Revokes every session for the user on the server (best effort) and wipes
  /// the local pair.
  ///
  /// The core logout endpoint invalidates all of the user's sessions, not just
  /// the presented refresh-token family, so a local clear always follows it.
  Future<void> signOut() async {
    _signingOut = true;
    try {
      await restore();
      // A refresh that started before sign-out could otherwise publish a
      // rotated pair after the clear. Wait for it (success or failure) first.
      final inFlight = _refreshInFlight;
      if (inFlight != null) {
        try {
          await inFlight;
        } on Object {
          // A failed refresh must not block sign-out.
        }
      }
      final refreshToken = _tokens?.refreshToken;
      if (refreshToken != null) {
        try {
          await _dio.post<void>(
            '/api/v1/auth/logout',
            data: <String, dynamic>{'refreshToken': refreshToken},
          );
        } on DioException {
          // ponytail: offline sign-out still clears locally; the server remains
          // able to revoke every session on the next successful logout.
        }
      }
      await _clearSession();
    } finally {
      _signingOut = false;
    }
  }

  /// Returns a usable access token, refreshing when less than
  /// [AppConfig.refreshSkew] remains.
  Future<String> ensureAccessToken() async {
    await restore();
    final tokens = _tokens;
    if (tokens == null) {
      throw const AuthException('Not signed in', statusCode: 401);
    }
    if (_isAccessFresh(tokens)) return tokens.accessToken;

    await forceRefresh();
    final refreshed = _tokens;
    if (refreshed == null) {
      throw const AuthException('Not signed in', statusCode: 401);
    }
    return refreshed.accessToken;
  }

  /// Forces one refresh, joining any in-flight refresh instead of starting a
  /// second rotation.
  Future<void> forceRefresh() {
    if (_signingOut) {
      return Future<void>.error(
        const AuthException(
          'Cannot refresh while signing out',
          statusCode: 401,
        ),
      );
    }
    final inFlight = _refreshInFlight;
    if (inFlight != null) return inFlight;
    final future = _refresh().whenComplete(() {
      _refreshInFlight = null;
    });
    _refreshInFlight = future;
    return future;
  }

  bool _isAccessFresh(AuthTokens tokens) =>
      tokens.accessExpiresAt.isAfter(_clock().add(AppConfig.refreshSkew));

  Future<void> _refresh() async {
    final owner = _owner;
    if (!await _acquireRefreshLock(owner)) {
      // Another isolate held the lock for longer than the request timeout.
      // Use its rotated pair when it published one, otherwise fail loudly.
      await _reloadFromStore();
      final tokens = _tokens;
      if (tokens != null && _isAccessFresh(tokens)) return;
      throw const AuthException(
        'Timed out waiting for another token refresh',
        statusCode: 401,
      );
    }

    try {
      final previous = _tokens;
      final stored = await _readStoreSafely();
      // Another isolate rotated while we were waiting for the lock.
      if (stored != null &&
          stored.accessToken != previous?.accessToken &&
          _isAccessFresh(stored)) {
        _tokens = stored;
        _restored = true;
        notifyListeners();
        return;
      }

      final refreshToken = (stored ?? previous)?.refreshToken;
      if (refreshToken == null) {
        await _clearSession();
        throw const AuthException(
          'No refresh token available',
          statusCode: 401,
        );
      }

      final response = await _dio.post<Map<String, dynamic>>(
        '/api/v1/auth/refresh',
        data: <String, dynamic>{'refreshToken': refreshToken},
      );
      final data = response.data;
      if (data == null) {
        throw const AuthException('Refresh response was empty');
      }
      final rotated = AuthTokens.fromResponseJson(data, now: _clock());
      await store.write(rotated);
      _tokens = rotated;
      _restored = true;
      notifyListeners();
    } on DioException catch (error) {
      final status = error.response?.statusCode;
      if (status == 400 || status == 401) {
        await _clearSession();
      }
      throw AuthException(_messageFor(error), statusCode: status);
    } on FormatException catch (error) {
      throw AuthException('Malformed refresh response: ${error.message}');
    } finally {
      await refreshLock.release(owner);
    }
  }

  Future<bool> _acquireRefreshLock(String owner) async {
    // Lock waits must track real elapsed time, not the injected token clock:
    // tests can move that clock arbitrarily and would otherwise spin forever.
    final waited = Stopwatch()..start();
    while (true) {
      if (await refreshLock.acquire(owner, _refreshLockTtl)) return true;
      if (waited.elapsed >= _refreshLockWait) return false;
      await Future<void>.delayed(const Duration(milliseconds: 50));
    }
  }

  Future<AuthTokens?> _readStoreSafely() async {
    try {
      return await store.read();
    } on FormatException {
      return null;
    } on TypeError {
      return null;
    }
  }

  Future<void> _reloadFromStore() async {
    _tokens = await _readStoreSafely();
    _restored = true;
    notifyListeners();
  }

  Future<void> _clearSession() async {
    _tokens = null;
    _restored = true;
    try {
      await store.clear();
    } finally {
      notifyListeners();
    }
  }

  /// Extracts the server envelope message without ever echoing credentials.
  static String _messageFor(DioException error) => envelopeMessage(
    error.response?.data,
    fallback: error.message ?? error.type.name,
  );
}
