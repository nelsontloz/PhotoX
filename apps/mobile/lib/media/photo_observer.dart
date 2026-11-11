import 'dart:async';
import 'dart:io';
import 'dart:typed_data';

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
    this.width,
    this.height,
    this.durationSeconds,
    this.folderId,
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

  /// Pixel width reported by the platform. Display-only, the queue ignores it.
  final int? width;

  /// Pixel height reported by the platform. Display-only, the queue ignores it.
  final int? height;

  /// Video length in seconds. Display-only, the queue ignores it.
  final int? durationSeconds;

  /// Device album this asset was first seen in, when discovery knew one.
  ///
  /// A photo can sit in several albums; the first one a scan reaches wins, so
  /// at most one folder's server album can ever collect it.
  final String? folderId;
}

/// A library album the user can scope backups to.
class MediaFolder {
  const MediaFolder({
    required this.id,
    required this.name,
    required this.assetCount,
    this.isCamera = false,
  });

  /// Platform album id (MediaStore bucket id / PhotoKit localIdentifier).
  final String id;

  /// Display name reported by the platform.
  final String name;

  /// Assets the platform currently counts in this album.
  final int assetCount;

  /// True for the camera roll / Recents album picked by default.
  final bool isCamera;
}

/// Discovers newly added library assets on iOS and Android.
///
/// Implementations live next to the platforms (PhotoKit / MediaStore); the
/// pipeline only sees this interface so it stays testable off-device.
abstract class PhotoObserver {
  /// Returns whether the app may read the library, requesting access once.
  Future<PhotoPermission> ensurePermission();

  /// Lists the albums the platform exposes, camera album flagged.
  Future<List<MediaFolder>> folders();

  /// One page of the device library, newest capture first.
  ///
  /// [folderId] limits the page to that album; null pages the whole library.
  /// An unknown [folderId] returns an empty list rather than throwing, because
  /// a deleted album is not an app error.
  Future<List<AssetCandidate>> page({
    required int offset,
    required int limit,
    String? folderId,
  });

  /// Assets the platform currently counts in [folderId], or the whole library
  /// when it is null. `0` for an unknown album.
  Future<int> libraryCount({String? folderId});

  /// Returns assets added since [since], or since the last successful scan
  /// when [since] is null, oldest first.
  ///
  /// [folderIds] limits the scan to those albums; null or empty means the
  /// whole library.
  Future<List<AssetCandidate>> scanNew({
    DateTime? since,
    List<String>? folderIds,
  });

  /// Resolves the original bytes for [localId], or null when it disappeared.
  Future<File?> fileFor(String localId);

  /// Materialises playable bytes for a video, or null when there are none.
  ///
  /// iOS may have to fetch a video that lives only in iCloud before the player
  /// can open it; [onProgress] reports `0`..`1` while that download runs and is
  /// never called on Android, where the bytes are always local.
  Future<File?> playableVideo(
    String localId, {
    void Function(double progress)? onProgress,
  });

  /// Returns a small encoded thumbnail (JPEG/PNG) for [localId], or null when
  /// the asset is gone or the platform cannot produce one.
  Future<Uint8List?> thumbnailFor(String localId, {int size = 128});

  /// Releases platform callbacks and cached platform handles.
  Future<void> dispose();

  // TODO(spec §3.2): PhotoKit persistent change token on iOS, MediaStore
  // DATE_ADDED watermark + ContentObserver on Android; both must handle
  // limited/partial library access without treating it as "nothing new".
}
