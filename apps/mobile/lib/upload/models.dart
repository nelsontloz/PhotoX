import '../core/json_read.dart';

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
      id: requireString(json, 'id', 'AssetSummary'),
      fileId: requireString(json, 'fileId', 'AssetSummary'),
    );
  }

  /// Server-side asset id.
  final String id;

  /// Server-side file-record id.
  final String fileId;
}

/// One checksum in a dedup pre-check request.
///
/// Core's `POST /api/v1/files/exists` DTO whitelists `checksumSha256` only and
/// runs with `forbidNonWhitelisted`, so any extra field 400s the whole batch.
class DedupCheck {
  const DedupCheck({required this.checksumSha256});

  /// Lowercase SHA-256 hex of the exact bytes that would be uploaded.
  final String checksumSha256;

  Map<String, dynamic> toJson() => <String, dynamic>{
    'checksumSha256': checksumSha256,
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
      checksumSha256: requireString(json, 'checksumSha256', 'DedupHit'),
      exists: requireBool(json, 'exists', 'DedupHit'),
      existingFileId: requireStringOrNull(json, 'existingFileId', 'DedupHit'),
      existingAssetId: requireStringOrNull(json, 'existingAssetId', 'DedupHit'),
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
    required this.status,
  });

  factory CreateSessionResult.fromJson(Map<String, dynamic> json) {
    return CreateSessionResult(
      uploadId: requireString(json, 'uploadId', 'CreateSessionResult'),
      chunkSizeBytes: requireInt(json, 'chunkSizeBytes', 'CreateSessionResult'),
      totalParts: requireInt(json, 'totalParts', 'CreateSessionResult'),
      status: requireString(json, 'status', 'CreateSessionResult'),
    );
  }

  /// Server-side session id used by part and complete calls.
  final String uploadId;

  /// Part size fixed at creation time, in bytes.
  final int chunkSizeBytes;

  /// Number of parts the file is split into.
  final int totalParts;

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
    this.assetId,
    this.fileId,
  });

  factory UploadSessionStatus.fromJson(Map<String, dynamic> json) {
    return UploadSessionStatus(
      status: requireString(json, 'status', 'UploadSessionStatus'),
      chunkSizeBytes: requireInt(json, 'chunkSizeBytes', 'UploadSessionStatus'),
      totalParts: requireInt(json, 'totalParts', 'UploadSessionStatus'),
      receivedParts: requireIntList(
        json,
        'receivedParts',
        'UploadSessionStatus',
      ),
      assetId: requireStringOrNull(json, 'assetId', 'UploadSessionStatus'),
      fileId: requireStringOrNull(json, 'fileId', 'UploadSessionStatus'),
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

  /// Asset created by the session, once completed.
  final String? assetId;

  /// File record created by the session, once completed.
  final String? fileId;
}

/// Result of `POST /api/v1/uploads/:id/complete`.
class UploadCompleteResult {
  const UploadCompleteResult({required this.asset});

  factory UploadCompleteResult.fromJson(Map<String, dynamic> json) {
    return UploadCompleteResult(
      asset: AssetSummary.fromJson(
        requireMap(json, 'asset', 'UploadCompleteResult'),
      ),
    );
  }

  final AssetSummary asset;
}
