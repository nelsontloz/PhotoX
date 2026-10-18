/// In-memory backup preferences; nothing is persisted yet.
class SettingsStore {
  /// Upload only while on an unmetered network.
  bool wifiOnly = true;

  /// Upload only while the device is charging.
  bool chargingOnly = false;

  /// Album ids to back up; empty means every album.
  List<String> selectedAlbumIds = <String>[];

  // TODO(spec §3.7): persist these (reuse the drift database or add a storage
  // dependency later) and expose a min-delay plus notification preference.
}
