import 'dart:convert';

import 'package:drift/drift.dart';
import 'package:flutter/foundation.dart' show listEquals, mapEquals;

import '../upload/database.dart';

/// Persisted backup preferences.
class AppSettings {
  const AppSettings({
    this.wifiOnly = true,
    this.chargingOnly = false,
    this.includeVideos = false,
    this.apiBaseUrl = '',
    this.paused = false,
    this.uploadFolderIds = const <String>[],
    this.uploadAllFolders = false,
    this.folderAlbums = const <String, String>{},
  });

  /// Base URL of the PhotoX core API the user entered on first launch.
  ///
  /// Empty means "not configured yet": `AppConfig.apiBaseUrl` is only the
  /// prefilled suggestion, so a build-time default never hides the setup step.
  final String apiBaseUrl;

  /// True while the user has stopped backups; every pass holds until resumed.
  final bool paused;

  /// Upload only while on an unmetered network.
  final bool wifiOnly;

  /// Upload only while the device is charging.
  final bool chargingOnly;

  /// Include videos in the backup set.
  final bool includeVideos;

  /// Album ids the user chose to back up.
  ///
  /// Empty means "not chosen": the pipeline then defaults to the camera album.
  final List<String> uploadFolderIds;

  /// Back up the whole library instead of [uploadFolderIds].
  final bool uploadAllFolders;

  /// Device folder id -> server album id.
  ///
  /// Every asset uploaded from a mapped folder is added to that album. Not part
  /// of the scan scope: it changes where uploads go, not what discovery reads.
  final Map<String, String> folderAlbums;

  AppSettings copyWith({
    bool? wifiOnly,
    bool? chargingOnly,
    bool? includeVideos,
    String? apiBaseUrl,
    bool? paused,
    List<String>? uploadFolderIds,
    bool? uploadAllFolders,
    Map<String, String>? folderAlbums,
  }) {
    return AppSettings(
      wifiOnly: wifiOnly ?? this.wifiOnly,
      chargingOnly: chargingOnly ?? this.chargingOnly,
      includeVideos: includeVideos ?? this.includeVideos,
      apiBaseUrl: apiBaseUrl ?? this.apiBaseUrl,
      paused: paused ?? this.paused,
      uploadFolderIds: uploadFolderIds ?? this.uploadFolderIds,
      uploadAllFolders: uploadAllFolders ?? this.uploadAllFolders,
      folderAlbums: folderAlbums ?? this.folderAlbums,
    );
  }

  /// String form used by [SettingsStore]; only used for storage, not wire.
  Map<String, String> toStorage() => <String, String>{
    'wifiOnly': wifiOnly.toString(),
    'chargingOnly': chargingOnly.toString(),
    'includeVideos': includeVideos.toString(),
    'apiBaseUrl': apiBaseUrl,
    'paused': paused.toString(),
    'uploadFolderIds': jsonEncode(uploadFolderIds),
    'uploadAllFolders': uploadAllFolders.toString(),
    'folderAlbums': jsonEncode(folderAlbums),
  };

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      (other is AppSettings &&
          other.wifiOnly == wifiOnly &&
          other.chargingOnly == chargingOnly &&
          other.includeVideos == includeVideos &&
          other.apiBaseUrl == apiBaseUrl &&
          other.paused == paused &&
          listEquals(other.uploadFolderIds, uploadFolderIds) &&
          other.uploadAllFolders == uploadAllFolders &&
          mapEquals(other.folderAlbums, folderAlbums));

  @override
  int get hashCode => Object.hash(
    wifiOnly,
    chargingOnly,
    includeVideos,
    apiBaseUrl,
    paused,
    Object.hashAll(uploadFolderIds),
    uploadAllFolders,
    // Order-independent: a re-saved map must keep the same hash.
    Object.hashAllUnordered(
      folderAlbums.entries.map((entry) => Object.hash(entry.key, entry.value)),
    ),
  );
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
      apiBaseUrl: _readString(values['apiBaseUrl'], defaults.apiBaseUrl),
      paused: _readBool(values['paused'], defaults.paused),
      uploadFolderIds: _readStringList(values['uploadFolderIds']),
      uploadAllFolders: _readBool(
        values['uploadAllFolders'],
        defaults.uploadAllFolders,
      ),
      folderAlbums: _readStringMap(values['folderAlbums']),
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

  /// Decodes a JSON string array; malformed input falls back to "not chosen"
  /// and non-string entries are dropped.
  static List<String> _readStringList(String? raw) {
    if (raw == null || raw.trim().isEmpty) return const <String>[];
    try {
      final decoded = jsonDecode(raw);
      if (decoded is! List) return const <String>[];
      return <String>[
        for (final entry in decoded)
          if (entry is String) entry,
      ];
    } on FormatException {
      return const <String>[];
    }
  }

  /// Decodes a JSON object of string values; malformed input falls back to
  /// "no mapping" and non-string keys or values are dropped.
  static Map<String, String> _readStringMap(String? raw) {
    if (raw == null || raw.trim().isEmpty) return const <String, String>{};
    try {
      final decoded = jsonDecode(raw);
      if (decoded is! Map) return const <String, String>{};
      return <String, String>{
        for (final entry in decoded.entries)
          if (entry.key is String && entry.value is String)
            entry.key as String: entry.value as String,
      };
    } on FormatException {
      return const <String, String>{};
    }
  }
}
