import 'dart:convert';

import 'package:drift/drift.dart';

import '../upload/database.dart';

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

/// Process-local [RefreshLock]. Used by unit tests and as a fallback when no
/// database is available.
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

/// Cross-isolate [RefreshLock] backed by the shared drift database.
///
/// The lock lives in a single [KeyValues] row as JSON so every isolate (UI,
/// background task) sees the same owner. Acquire and release are transactions;
/// sqlite serializes them, and the database's `busy_timeout` absorbs a
/// concurrent writer instead of failing immediately.
///
/// Wall-clock [DateTime.now] is deliberate: the token clock can be swapped in
/// tests, but lock expiry must match the clock other isolates use.
class DriftRefreshLock implements RefreshLock {
  const DriftRefreshLock(this.db);

  /// Database shared by every isolate in the app process.
  final AppDatabase db;

  /// Namespace holding auth-related bookkeeping.
  static const String namespace = 'auth';

  /// Key holding the single lock document.
  static const String lockKey = 'refreshLock';

  @override
  Future<bool> acquire(String owner, Duration ttl) {
    return db.transaction(() async {
      final now = DateTime.now();
      final row = await _readRow();
      if (row != null) {
        final current = _LockState.tryParse(row.value);
        if (current != null &&
            current.owner != owner &&
            now.isBefore(current.expiresAt)) {
          return false;
        }
      }
      await db
          .into(db.keyValues)
          .insertOnConflictUpdate(
            KeyValuesCompanion.insert(
              namespace: namespace,
              key: lockKey,
              value: jsonEncode(<String, String>{
                'owner': owner,
                'expiresAt': now.add(ttl).toUtc().toIso8601String(),
              }),
              updatedAt: now,
            ),
          );
      return true;
    });
  }

  @override
  Future<void> release(String owner) {
    return db.transaction(() async {
      final row = await _readRow();
      if (row == null) return;
      final current = _LockState.tryParse(row.value);
      if (current?.owner != owner) return;
      await (db.delete(db.keyValues)..where(
            (t) => t.namespace.equals(namespace) & t.key.equals(lockKey),
          ))
          .go();
    });
  }

  Future<KeyValue?> _readRow() {
    return (db.select(db.keyValues)
          ..where((t) => t.namespace.equals(namespace) & t.key.equals(lockKey)))
        .getSingleOrNull();
  }
}

class _LockState {
  const _LockState({required this.owner, required this.expiresAt});

  final String owner;
  final DateTime expiresAt;

  /// Returns null for a corrupt document, which callers treat as "no lock".
  static _LockState? tryParse(String raw) {
    try {
      final decoded = jsonDecode(raw);
      if (decoded is! Map) return null;
      final owner = decoded['owner'];
      final rawExpiresAt = decoded['expiresAt'];
      if (owner is! String || rawExpiresAt is! String) return null;
      final expiresAt = DateTime.tryParse(rawExpiresAt);
      if (expiresAt == null) return null;
      return _LockState(owner: owner, expiresAt: expiresAt);
    } on FormatException {
      return null;
    } on TypeError {
      return null;
    }
  }
}
