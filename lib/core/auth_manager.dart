import 'package:flutter_secure_storage/flutter_secure_storage.dart';

/// Owns the token pair plus the stable device id used by the backup API.
class AuthManager {
  /// [storage] defaults to the platform keystore (Keychain on iOS).
  AuthManager({this.storage = const FlutterSecureStorage()});

  /// Secure storage backing the token pair and device id.
  final FlutterSecureStorage storage;

  /// Signs in with email/password and persists the rotated token pair.
  Future<void> signIn({required String email, required String password}) {
    // TODO(spec §2.3): POST the login request, then persist the token pair and
    // the generated stable deviceId in secure storage.
    throw UnimplementedError('AuthManager.signIn');
  }

  /// Clears the local session and revokes the device session when known.
  Future<void> signOut({String? deviceId}) {
    // TODO(spec §2.3): revoke the device session server-side, then wipe the
    // stored pair so the next launch starts logged out.
    throw UnimplementedError('AuthManager.signOut');
  }

  /// Returns a usable access token, refreshing single-flight on expiry.
  Future<String> ensureAccessToken() {
    // TODO(spec §2.3): single-flight refresh on 401 within the 60s rotation
    // grace window; persist the rotated pair; never refresh in parallel.
    throw UnimplementedError('AuthManager.ensureAccessToken');
  }
}
