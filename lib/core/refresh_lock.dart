/// Cross-isolate mutex guarding refresh-token rotation.
///
/// Refresh tokens rotate with reuse detection, so two concurrent refreshes
/// would revoke the whole token family. Callers must re-read the token store
/// after acquiring to pick up a pair another isolate already rotated.
abstract class RefreshLock {
  /// Attempts to take the lock for [owner] until [ttl] elapses.
  ///
  /// Returns false when another owner holds a live lock.
  Future<bool> acquire(String owner, Duration ttl);

  /// Releases the lock when [owner] still holds it (no-op otherwise).
  Future<void> release(String owner);
}

/// Process-local [RefreshLock]. A real cross-isolate implementation can live
/// in secure storage / a lock file later; the interface does not change.
class MemoryRefreshLock implements RefreshLock {
  MemoryRefreshLock({DateTime Function()? clock})
    : _clock = clock ?? DateTime.now;

  final DateTime Function() _clock;
  String? _owner;
  DateTime? _expiresAt;

  @override
  Future<bool> acquire(String owner, Duration ttl) async {
    final now = _clock();
    final expiresAt = _expiresAt;
    if (_owner != null && expiresAt != null && now.isBefore(expiresAt)) {
      return false;
    }
    _owner = owner;
    _expiresAt = now.add(ttl);
    return true;
  }

  @override
  Future<void> release(String owner) async {
    if (_owner == owner) {
      _owner = null;
      _expiresAt = null;
    }
  }
}
