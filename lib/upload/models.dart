/// Upload protocol picked for an asset.
enum UploadProtocol { single, session }

/// Local queue state of one asset, persisted before each network attempt.
enum UploadState {
  discovered,
  hashing,
  pending,
  creating,
  uploading,
  completing,
  uploaded,
  duplicate,
  failedRetryable,
  failedPermanent,
  excluded,
  skippedQuota,
}

/// Minimal asset identity returned by the upload endpoints.
class AssetSummary {
  const AssetSummary({required this.id, required this.fileId});

  factory AssetSummary.fromJson(Map<String, dynamic> json) {
    return AssetSummary(
      id: _requireString(json, 'id', 'AssetSummary'),
      fileId: _requireString(json, 'fileId', 'AssetSummary'),
    );
  }

  /// Server-side asset id.
  final String id;

  /// Server-side file-record id.
  final String fileId;
}

/// One checksum in a dedup pre-check request.
class DedupCheck {
  const DedupCheck({required this.checksumSha256, this.sizeBytes});

  /// Lowercase SHA-256 hex of the exact bytes that would be uploaded.
  final String checksumSha256;

  /// File size, when known.
  final int? sizeBytes;

  Map<String, dynamic> toJson() => <String, dynamic>{
    'checksumSha256': checksumSha256,
    if (sizeBytes != null) 'sizeBytes': sizeBytes,
  };
}

/// Result of a dedup pre-check for one checksum.
class DedupHit {
  const DedupHit({
    required this.checksumSha256,
    required this.exists,
    this.existingFileId,
    this.existingAssetId,
  });

  factory DedupHit.fromJson(Map<String, dynamic> json) {
    return DedupHit(
      checksumSha256: _requireString(json, 'checksumSha256', 'DedupHit'),
      exists: _requireBool(json, 'exists', 'DedupHit'),
      existingFileId: _requireStringOrNull(json, 'existingFileId', 'DedupHit'),
      existingAssetId: _requireStringOrNull(
        json,
        'existingAssetId',
        'DedupHit',
      ),
    );
  }

  final String checksumSha256;
  final bool exists;
  final String? existingFileId;
  final String? existingAssetId;
}

/// Session opened by `POST /api/v1/uploads`.
class CreateSessionResult {
  const CreateSessionResult({
    required this.uploadId,
    required this.chunkSizeBytes,
    required this.totalParts,
    required this.expiresAt,
    required this.status,
  });

  factory CreateSessionResult.fromJson(Map<String, dynamic> json) {
    return CreateSessionResult(
      uploadId: _requireString(json, 'uploadId', 'CreateSessionResult'),
      chunkSizeBytes: _requireInt(
        json,
        'chunkSizeBytes',
        'CreateSessionResult',
      ),
      totalParts: _requireInt(json, 'totalParts', 'CreateSessionResult'),
      expiresAt: _requireDateTime(json, 'expiresAt', 'CreateSessionResult'),
      status: _requireString(json, 'status', 'CreateSessionResult'),
    );
  }

  /// Server-side session id used by part and complete calls.
  final String uploadId;

  /// Part size fixed at creation time, in bytes.
  final int chunkSizeBytes;

  /// Number of parts the file is split into.
  final int totalParts;

  /// Instant after which the session is expired (410).
  final DateTime expiresAt;

  /// Server session state (`pending` right after creation).
  final String status;
}

/// Snapshot returned by `GET /api/v1/uploads/:id`.
class UploadSessionStatus {
  const UploadSessionStatus({
    required this.status,
    required this.chunkSizeBytes,
    required this.totalParts,
    required this.receivedParts,
    required this.receivedBytes,
    required this.expiresAt,
    this.assetId,
    this.fileId,
  });

  factory UploadSessionStatus.fromJson(Map<String, dynamic> json) {
    return UploadSessionStatus(
      status: _requireString(json, 'status', 'UploadSessionStatus'),
      chunkSizeBytes: _requireInt(
        json,
        'chunkSizeBytes',
        'UploadSessionStatus',
      ),
      totalParts: _requireInt(json, 'totalParts', 'UploadSessionStatus'),
      receivedParts: _requireIntList(
        json,
        'receivedParts',
        'UploadSessionStatus',
      ),
      receivedBytes: _requireInt(json, 'receivedBytes', 'UploadSessionStatus'),
      expiresAt: _requireDateTime(json, 'expiresAt', 'UploadSessionStatus'),
      assetId: _requireStringOrNull(json, 'assetId', 'UploadSessionStatus'),
      fileId: _requireStringOrNull(json, 'fileId', 'UploadSessionStatus'),
    );
  }

  /// Server-reported session state (`pending`, `completed`, ...).
  final String status;

  /// Part size fixed at creation time, in bytes.
  final int chunkSizeBytes;

  /// Number of parts the file is split into.
  final int totalParts;

  /// Indices the server has already persisted, ascending.
  final List<int> receivedParts;

  /// Bytes the server has already persisted.
  final int receivedBytes;

  /// Instant after which the session is expired (410).
  final DateTime expiresAt;

  /// Asset created by the session, once completed.
  final String? assetId;

  /// File record created by the session, once completed.
  final String? fileId;
}

/// Result of `POST /api/v1/uploads/:id/complete`.
class UploadCompleteResult {
  const UploadCompleteResult({required this.asset, required this.deduplicated});

  factory UploadCompleteResult.fromJson(Map<String, dynamic> json) {
    return UploadCompleteResult(
      asset: AssetSummary.fromJson(
        _requireMap(json, 'asset', 'UploadCompleteResult'),
      ),
      deduplicated: _requireBool(json, 'deduplicated', 'UploadCompleteResult'),
    );
  }

  final AssetSummary asset;

  /// True when the bytes already existed and the returned asset is pre-existing.
  final bool deduplicated;
}

String _requireString(Map<String, dynamic> json, String field, String context) {
  final value = json[field];
  if (value is String) return value;
  throw FormatException(
    '$context.$field must be a string, got ${value.runtimeType}',
  );
}

String? _requireStringOrNull(
  Map<String, dynamic> json,
  String field,
  String context,
) {
  final value = json[field];
  if (value == null || value is String) return value as String?;
  throw FormatException(
    '$context.$field must be a string or null, got ${value.runtimeType}',
  );
}

int _requireInt(Map<String, dynamic> json, String field, String context) {
  final value = json[field];
  if (value is num) return value.toInt();
  throw FormatException(
    '$context.$field must be a number, got ${value.runtimeType}',
  );
}

bool _requireBool(Map<String, dynamic> json, String field, String context) {
  final value = json[field];
  if (value is bool) return value;
  throw FormatException(
    '$context.$field must be a boolean, got ${value.runtimeType}',
  );
}

Map<String, dynamic> _requireMap(
  Map<String, dynamic> json,
  String field,
  String context,
) {
  final value = json[field];
  if (value is Map<String, dynamic>) return value;
  if (value is Map) {
    try {
      return Map<String, dynamic>.from(value);
    } on TypeError {
      // Fall through to the FormatException below.
    }
  }
  throw FormatException(
    '$context.$field must be an object, got ${value.runtimeType}',
  );
}

DateTime _requireDateTime(
  Map<String, dynamic> json,
  String field,
  String context,
) {
  final raw = _requireString(json, field, context);
  final parsed = DateTime.tryParse(raw);
  if (parsed == null) {
    throw FormatException(
      '$context.$field must be an ISO-8601 timestamp, got "$raw"',
    );
  }
  return parsed.toUtc();
}

List<int> _requireIntList(
  Map<String, dynamic> json,
  String field,
  String context,
) {
  final value = json[field];
  if (value is! List) {
    throw FormatException(
      '$context.$field must be a list, got ${value.runtimeType}',
    );
  }
  final result = <int>[];
  for (var index = 0; index < value.length; index++) {
    final part = value[index];
    if (part is! num) {
      throw FormatException(
        '$context.$field[$index] must be a number, got ${part.runtimeType}',
      );
    }
    result.add(part.toInt());
  }
  return result;
}
