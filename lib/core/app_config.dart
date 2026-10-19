/// Compile-time settings shared by the whole app.
abstract final class AppConfig {
  /// Base URL of the PhotoX core API; override with `--dart-define=PHOTOX_API_URL=...`.
  static const String apiBaseUrl = String.fromEnvironment(
    'PHOTOX_API_URL',
    defaultValue: 'http://localhost:3000',
  );

  /// Assets at or below this size use the single-request multipart upload path.
  static const int singleUploadThresholdBytes = 64 * 1024 * 1024;

  /// Fixed part size of the resumable upload API (server contract: 8 MiB).
  static const int sessionChunkSizeBytes = 8 * 1024 * 1024;

  /// Largest asset the core API accepts, in bytes (4 GiB).
  static const int maxUploadSizeBytes = 4 * 1024 * 1024 * 1024;

  /// Maximum concurrent resumable sessions the server allows per user.
  static const int maxActiveSessionsPerUser = 5;

  /// Refresh the access token when this much time (or less) remains.
  static const Duration refreshSkew = Duration(seconds: 60);

  // TODO(spec §2.2, §3.1): confirm these constants against the core capability
  // endpoint once it exists instead of hardcoding them here.
}
