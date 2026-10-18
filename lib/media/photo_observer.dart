/// Media kinds the backup queue tracks.
enum MediaKind { photo, video }

/// An asset discovered in the platform photo library.
class AssetCandidate {
  const AssetCandidate({
    required this.localId,
    required this.kind,
    required this.sizeBytes,
    this.takenAt,
  });

  /// Platform asset id (PhotoKit localIdentifier / MediaStore id).
  final String localId;

  /// Photo or video.
  final MediaKind kind;

  /// Size of the original bytes; decides single vs session upload.
  final int sizeBytes;

  /// Creation time reported by the platform library, when available.
  final DateTime? takenAt;
}

/// Discovers newly added library assets on iOS and Android.
abstract class PhotoObserver {
  /// Returns assets added since the last successful scan, oldest first.
  Future<List<AssetCandidate>> scanNew();

  // TODO(spec §3.2): PhotoKit persistent change token on iOS, MediaStore
  // DATE_ADDED watermark + ContentObserver on Android; both must handle
  // limited/partial library access without treating it as "nothing new".
}
