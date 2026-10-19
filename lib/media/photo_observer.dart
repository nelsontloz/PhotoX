import 'dart:async';
import 'dart:io';

/// Media kinds the backup queue tracks.
enum MediaKind { photo, video }

/// Result of asking the platform for photo-library access.
enum PhotoPermission { authorized, limited, denied, restricted, notDetermined }

/// An asset discovered in the platform photo library.
class AssetCandidate {
  const AssetCandidate({
    required this.localId,
    required this.platform,
    required this.kind,
    required this.fileName,
    required this.mimeType,
    required this.sizeBytes,
    this.takenAt,
    this.modifiedAt,
    this.relativePath,
  });

  /// Platform asset id (PhotoKit localIdentifier / MediaStore id).
  final String localId;

  /// Source platform, `ios` or `android`.
  final String platform;

  /// Photo or video.
  final MediaKind kind;

  /// Original file name, used as the server's title fallback.
  final String fileName;

  /// MIME type of the original bytes, when the platform reports one.
  final String mimeType;

  /// Size of the original bytes; decides single vs session upload.
  final int sizeBytes;

  /// Creation time reported by the platform library, when available.
  final DateTime? takenAt;

  /// Last modification time reported by the platform library.
  final DateTime? modifiedAt;

  /// Path relative to the platform library root, when available.
  final String? relativePath;
}

/// Discovers newly added library assets on iOS and Android.
///
/// Implementations live next to the platforms (PhotoKit / MediaStore); the
/// pipeline only sees this interface so it stays testable off-device.
abstract class PhotoObserver {
  /// Returns whether the app may read the library, requesting access once.
  Future<PhotoPermission> ensurePermission();

  /// Returns assets added since [since], or since the last successful scan
  /// when [since] is null, oldest first.
  Future<List<AssetCandidate>> scanNew({DateTime? since});

  /// Resolves the original bytes for [localId], or null when it disappeared.
  Future<File?> fileFor(String localId);

  /// Emits whenever the platform library reports a change.
  Stream<void> get changes;

  /// Releases platform callbacks and closes [changes].
  Future<void> dispose();

  // TODO(spec §3.2): PhotoKit persistent change token on iOS, MediaStore
  // DATE_ADDED watermark + ContentObserver on Android; both must handle
  // limited/partial library access without treating it as "nothing new".
}
