/// Compile-time settings shared by the whole app.
abstract final class AppConfig {
  /// Base URL of the PhotoX core API; override with `--dart-define=PHOTOX_API_URL=...`.
  static const String apiBaseUrl = String.fromEnvironment(
    'PHOTOX_API_URL',
    defaultValue: 'http://localhost:3000',
  );

  /// Assets at or below this size use the single-request multipart upload path.
  static const int singleUploadThresholdBytes = 64 * 1024 * 1024;

  /// Smallest part size the session API accepts.
  static const int partSizeMinBytes = 5 * 1024 * 1024;

  /// Largest part size the session API accepts.
  static const int partSizeMaxBytes = 64 * 1024 * 1024;

  /// Part size requested when the server does not dictate one.
  static const int partSizeDefaultBytes = 8 * 1024 * 1024;

  /// Maximum concurrent resumable sessions allowed per user.
  static const int maxActiveSessionsPerUser = 5;

  /// Window during which the previous refresh token is still accepted.
  static const Duration refreshGraceWindow = Duration(seconds: 60);

  // TODO(spec §2.2, §3.1): confirm these constants against the core capability
  // endpoint once it exists instead of hardcoding them here.
}
