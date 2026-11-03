import '../core/json_read.dart';

/// One asset the server holds, reduced to what the merged library grid needs.
///
/// `GET /api/v1/assets` returns the full `Asset` DTO; the grid only reads the
/// identity, the date it sorts by and the thumbnail it can draw.
class ServerAsset {
  const ServerAsset({
    required this.id,
    required this.kind,
    required this.uploadedAt,
    this.takenAt,
    this.width,
    this.height,
    this.thumbnailFileId,
    this.title,
  });

  factory ServerAsset.fromJson(Map<String, dynamic> json) {
    final kind = requireString(json, 'kind', 'ServerAsset');
    return ServerAsset(
      id: requireString(json, 'id', 'ServerAsset'),
      kind: kind,
      uploadedAt: requireDateTime(json, 'uploadedAt', 'ServerAsset'),
      takenAt: _dateTimeOrNull(json, 'takenAt', 'ServerAsset'),
      width: _intOrNull(json, 'width', 'ServerAsset'),
      height: _intOrNull(json, 'height', 'ServerAsset'),
      thumbnailFileId: _pickThumbnail(json, video: kind == 'video'),
      title: requireStringOrNull(json, 'originalName', 'ServerAsset'),
    );
  }

  /// Server-side asset id.
  final String id;

  /// `photo` or `video`.
  final String kind;

  /// When the server received the bytes; the sort fallback when there is no
  /// capture date, which is also how the server orders its own list.
  final DateTime uploadedAt;

  /// Capture date from EXIF/metadata, when the pipeline has filled it in.
  final DateTime? takenAt;

  final int? width;
  final int? height;

  /// Thumbnail file record the grid can stream; null until thumbnails exist.
  final String? thumbnailFileId;

  /// Original file name, used as the tile's screen-reader label.
  final String? title;

  bool get isVideo => kind == 'video';

  /// The date the merged timeline sorts this asset by.
  ///
  /// Local time on purpose: device candidates carry local dates, and the day
  /// headers group both halves, so a UTC value would put an asset on the wrong
  /// day near midnight.
  DateTime get date => (takenAt ?? uploadedAt).toLocal();

  static String? _pickThumbnail(Map<String, dynamic> json, {required bool video}) {
    final raw = json['thumbnails'];
    if (raw is! List || raw.isEmpty) return null;
    // Same preference as the web viewer: the biggest still that is cheap enough.
    final preferred = video ? 'lg' : 'xl';
    for (final entry in raw) {
      if (entry is Map && entry['size'] == preferred) {
        final fileId = entry['fileId'];
        if (fileId is String) return fileId;
      }
    }
    final first = raw.first;
    if (first is Map) {
      final fileId = first['fileId'];
      if (fileId is String) return fileId;
    }
    return null;
  }

  static DateTime? _dateTimeOrNull(
    Map<String, dynamic> json,
    String field,
    String context,
  ) {
    final value = json[field];
    if (value == null) return null;
    return requireDateTime(json, field, context);
  }

  static int? _intOrNull(Map<String, dynamic> json, String field, String context) {
    final value = json[field];
    if (value == null) return null;
    if (value is num) return value.toInt();
    throw FormatException(
      '$context.$field must be a number or null, got ${value.runtimeType}',
    );
  }
}

/// One page of the server's asset list.
class ServerAssetPage {
  const ServerAssetPage({required this.items, required this.total});

  final List<ServerAsset> items;

  /// Total assets matching the query, so the caller can tell there is more.
  final int total;

  bool get hasMore => items.isNotEmpty && items.length < total;
}
