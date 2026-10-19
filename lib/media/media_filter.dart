import 'photo_observer.dart';

/// Decides which platform library assets the backup pipeline accepts.
///
/// The core API sniffs the first bytes of every upload and rejects anything it
/// does not recognise, so the client must filter before spending a request.
/// Accepted containers (both photo and video) mirror the server sniffer:
/// jpeg, png, gif, webp, heic, heif, avif, mp4, quicktime, webm and avi.
/// RAW, DNG, TIFF and MKV are deliberately unsupported.
class MediaFilter {
  const MediaFilter();

  /// Photo extensions mapped to the MIME the server sniffer reports.
  static const Map<String, String> photoMimeTypes = <String, String>{
    'jpg': 'image/jpeg',
    'jpeg': 'image/jpeg',
    'png': 'image/png',
    'gif': 'image/gif',
    'webp': 'image/webp',
    'heic': 'image/heic',
    'heif': 'image/heif',
    'avif': 'image/avif',
  };

  /// Video extensions mapped to the MIME the server sniffer reports.
  static const Map<String, String> videoMimeTypes = <String, String>{
    'mp4': 'video/mp4',
    'mov': 'video/quicktime',
    'webm': 'video/webm',
    'avi': 'video/x-msvideo',
  };

  /// All photo MIME types the server accepts.
  static final Set<String> supportedPhotoMimes = Set<String>.unmodifiable(
    photoMimeTypes.values,
  );

  /// All video MIME types the server accepts.
  static final Set<String> supportedVideoMimes = Set<String>.unmodifiable(
    videoMimeTypes.values,
  );

  /// Infers a supported MIME type from [fileName], or null when unsupported.
  ///
  /// The extension is the only client-side signal available on iOS, which
  /// reports no MIME type for library assets. Video extensions are included so
  /// [PhotoManagerObserver] can describe candidates; [isSupported] still gates
  /// videos behind the user preference.
  String? inferMimeType(String fileName) {
    final extension = _extensionOf(fileName);
    if (extension == null) return null;
    return photoMimeTypes[extension] ?? videoMimeTypes[extension];
  }

  /// Whether [candidate] may be uploaded with the current settings.
  ///
  /// Photos are always eligible when their container is supported. Videos are
  /// only eligible when [includeVideos] is true. The camera-roll scope is the
  /// whole root library, so albums need no extra filtering here.
  bool isSupported(AssetCandidate candidate, {required bool includeVideos}) {
    final mime = _effectiveMime(candidate);
    switch (candidate.kind) {
      case MediaKind.photo:
        return supportedPhotoMimes.contains(mime);
      case MediaKind.video:
        return includeVideos && supportedVideoMimes.contains(mime);
    }
  }

  String? _effectiveMime(AssetCandidate candidate) {
    final reported = candidate.mimeType.trim().toLowerCase();
    final supported =
        supportedPhotoMimes.contains(reported) ||
        supportedVideoMimes.contains(reported);
    if (supported) return reported;
    return inferMimeType(candidate.fileName);
  }

  static String? _extensionOf(String fileName) {
    final slash = fileName.lastIndexOf('/');
    final dot = fileName.lastIndexOf('.');
    if (dot <= slash || dot == fileName.length - 1) return null;
    return fileName.substring(dot + 1).toLowerCase();
  }
}
