import 'package:drift/drift.dart';

import '../upload/database.dart';

/// Persisted backup preferences.
class AppSettings {
  const AppSettings({
    this.wifiOnly = true,
    this.chargingOnly = false,
    this.includeVideos = false,
    this.notificationsEnabled = true,
    this.backfill = true,
    this.source = 'cameraRoll',
  });

  /// Upload only while on an unmetered network.
  final bool wifiOnly;

  /// Upload only while the device is charging.
  final bool chargingOnly;

  /// Include videos in the backup set.
  final bool includeVideos;

  /// Show upload progress notifications.
  ///
  /// ponytail: persisted for a future notifier; nothing reads it today. Android
  /// will need the POST_NOTIFICATIONS permission when one is wired up.
  final bool notificationsEnabled;

  /// Also enqueue assets that already existed before the app was installed.
  final bool backfill;

  /// Library scope, `cameraRoll` for the whole library.
  final String source;

  AppSettings copyWith({
    bool? wifiOnly,
    bool? chargingOnly,
    bool? includeVideos,
    bool? notificationsEnabled,
    bool? backfill,
    String? source,
  }) {
    return AppSettings(
      wifiOnly: wifiOnly ?? this.wifiOnly,
      chargingOnly: chargingOnly ?? this.chargingOnly,
      includeVideos: includeVideos ?? this.includeVideos,
      notificationsEnabled: notificationsEnabled ?? this.notificationsEnabled,
      backfill: backfill ?? this.backfill,
      source: source ?? this.source,
    );
  }

  /// String form used by [SettingsStore]; only used for storage, not wire.
  Map<String, String> toStorage() => <String, String>{
    'wifiOnly': wifiOnly.toString(),
    'chargingOnly': chargingOnly.toString(),
    'includeVideos': includeVideos.toString(),
    'notificationsEnabled': notificationsEnabled.toString(),
    'backfill': backfill.toString(),
    'source': source,
  };

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      (other is AppSettings &&
          other.wifiOnly == wifiOnly &&
          other.chargingOnly == chargingOnly &&
          other.includeVideos == includeVideos &&
          other.notificationsEnabled == notificationsEnabled &&
          other.backfill == backfill &&
          other.source == source);

  @override
  int get hashCode => Object.hash(
    wifiOnly,
    chargingOnly,
    includeVideos,
    notificationsEnabled,
    backfill,
    source,
  );

  @override
  String toString() =>
      'AppSettings(wifiOnly: $wifiOnly, chargingOnly: $chargingOnly, '
      'includeVideos: $includeVideos, '
      'notificationsEnabled: $notificationsEnabled, backfill: $backfill, '
      'source: $source)';
}

/// Persists [AppSettings] in the drift [KeyValues] table.
///
/// Missing or corrupt entries fall back to the default for that key, so a bad
/// row never wedges the app on the default-free path.
class SettingsStore {
  const SettingsStore(this.db);

  /// Drift database shared with the upload queue.
  final AppDatabase db;

  /// Namespace used for preference rows.
  static const String namespace = 'settings';

  /// Loads the current preferences, filling in defaults where needed.
  Future<AppSettings> load() async {
    final rows = await (db.select(
      db.keyValues,
    )..where((t) => t.namespace.equals(namespace))).get();
    final values = <String, String>{for (final row in rows) row.key: row.value};
    const defaults = AppSettings();
    return AppSettings(
      wifiOnly: _readBool(values['wifiOnly'], defaults.wifiOnly),
      chargingOnly: _readBool(values['chargingOnly'], defaults.chargingOnly),
      includeVideos: _readBool(values['includeVideos'], defaults.includeVideos),
      notificationsEnabled: _readBool(
        values['notificationsEnabled'],
        defaults.notificationsEnabled,
      ),
      backfill: _readBool(values['backfill'], defaults.backfill),
      source: _readString(values['source'], defaults.source),
    );
  }

  /// Writes every preference in one atomic batch.
  Future<void> save(AppSettings settings) async {
    final updatedAt = DateTime.now();
    await db.batch((batch) {
      for (final entry in settings.toStorage().entries) {
        batch.insert(
          db.keyValues,
          KeyValuesCompanion.insert(
            namespace: namespace,
            key: entry.key,
            value: entry.value,
            updatedAt: updatedAt,
          ),
          mode: InsertMode.insertOrReplace,
        );
      }
    });
  }

  static bool _readBool(String? raw, bool fallback) {
    switch (raw?.trim().toLowerCase()) {
      case 'true':
        return true;
      case 'false':
        return false;
      default:
        return fallback;
    }
  }

  static String _readString(String? raw, String fallback) {
    final trimmed = raw?.trim();
    return trimmed == null || trimmed.isEmpty ? fallback : trimmed;
  }
}
