import 'dart:convert';

import 'package:flutter_secure_storage/flutter_secure_storage.dart';

import 'auth_models.dart';

/// Persistence boundary for the auth token pair.
abstract class TokenStore {
  /// Reads the stored pair, or null when the user is signed out.
  Future<AuthTokens?> read();

  /// Persists one pair atomically (one JSON document).
  Future<void> write(AuthTokens tokens);

  /// Removes any stored pair.
  Future<void> clear();
}

/// [TokenStore] backed by the platform keystore (Keychain on iOS).
class SecureTokenStore implements TokenStore {
  SecureTokenStore({FlutterSecureStorage? storage})
    : _storage =
          storage ??
          const FlutterSecureStorage(
            // first_unlock: readable by opportunistic background work after a
            // device restart, without requiring an unlocked-only keychain item.
            iOptions: IOSOptions(
              accessibility: KeychainAccessibility.first_unlock,
            ),
            aOptions: AndroidOptions(),
          );

  /// Fixed key holding the single JSON document.
  static const String storageKey = 'photox.auth.tokens.v1';

  final FlutterSecureStorage _storage;

  @override
  Future<AuthTokens?> read() async {
    final raw = await _storage.read(key: storageKey);
    if (raw == null || raw.isEmpty) return null;
    final tokens = _decode(raw);
    if (tokens == null) {
      // Best effort: a corrupt document must not wedge every launch. Dropping
      // it signs the app out instead of crashing the restore path.
      try {
        await _storage.delete(key: storageKey);
      } on Object {
        // The call site still recovers as signed out.
      }
    }
    return tokens;
  }

  /// Parses one persisted document, returning null instead of leaking a
  /// [FormatException]/[TypeError] when the payload is corrupt.
  static AuthTokens? _decode(String raw) {
    try {
      final decoded = jsonDecode(raw);
      if (decoded is! Map) return null;
      return AuthTokens.fromJson(Map<String, dynamic>.from(decoded));
    } on FormatException {
      return null;
    } on TypeError {
      return null;
    }
  }

  @override
  Future<void> write(AuthTokens tokens) =>
      _storage.write(key: storageKey, value: jsonEncode(tokens.toJson()));

  @override
  Future<void> clear() => _storage.delete(key: storageKey);
}

/// In-memory [TokenStore] for tests and short-lived isolates.
class MemoryTokenStore implements TokenStore {
  MemoryTokenStore([this._tokens]);

  AuthTokens? _tokens;

  @override
  Future<AuthTokens?> read() async => _tokens;

  @override
  Future<void> write(AuthTokens tokens) async => _tokens = tokens;

  @override
  Future<void> clear() async => _tokens = null;
}
