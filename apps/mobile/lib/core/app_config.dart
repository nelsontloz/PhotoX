/// Compile-time settings shared by the whole app.
abstract final class AppConfig {
  /// Base URL of the PhotoX core API; override with `--dart-define=PHOTOX_API_URL=...`.
  static const String apiBaseUrl = String.fromEnvironment(
    'PHOTOX_API_URL',
    defaultValue: 'http://localhost:3000',
  );

  /// Assets at or below this size use the single-request multipart upload path.
  ///
  /// Kept at one part: anything larger goes through the resumable session API,
  /// so a proxy or tunnel in front of core (which caps request bodies well
  /// below 64 MiB) cannot reject a whole file with a 413.
  static const int singleUploadThresholdBytes = sessionChunkSizeBytes;

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

/// One-line warning for a plain-http server address, or null when [raw] is
/// unusable or https.
///
/// Over http the login password, every Bearer token and every uploaded photo
/// travel in clear text, so a user typing an address deserves to know.
String? insecureServerWarning(String raw) {
  final url = normalizeServerUrl(raw);
  if (url == null || !url.startsWith('http://')) return null;
  return 'Not encrypted: anyone on this network can read your password. Use '
      'https:// outside your home network.';
}

/// Returns [raw] as a usable base URL (trimmed, no trailing slash), or null
/// when it is not an absolute http(s) address.
String? normalizeServerUrl(String raw) {
  final trimmed = raw.trim();
  final uri = Uri.tryParse(trimmed);
  if (uri == null || uri.host.isEmpty) return null;
  if (!uri.isScheme('http') && !uri.isScheme('https')) return null;
  return trimmed.replaceAll(RegExp(r'/+$'), '');
}
