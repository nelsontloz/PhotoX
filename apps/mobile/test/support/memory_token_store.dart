import 'package:photox_mobile/core/auth_models.dart';
import 'package:photox_mobile/core/token_store.dart';

/// In-memory [TokenStore] for tests.
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
