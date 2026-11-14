import 'dart:io';

import 'models.dart';

/// Single-request upload and dedup operations used by the pipeline.
///
/// Implemented by the signed core client, so tests can swap in a fake without
/// Dio and a future background-upload backend has a seam.
abstract class UploadTransport {
  /// Uploads [file] through the multipart single-request endpoint.
  Future<AssetSummary> uploadFile(
    File file,
    String originalName, {
    String? mimeType,
    String? title,
    String? description,
    DateTime? takenAt,
  });

  /// Batch dedup pre-check, at most 100 entries per call.
  Future<List<DedupHit>> exists(List<DedupCheck> items);
}

/// Resumable session operations used by the pipeline.
abstract class SessionTransport {
  /// Opens a session for bytes with [sha256Hex].
  Future<CreateSessionResult> createSession({
    required String sha256Hex,
    required int sizeBytes,
    required String filename,
    DateTime? takenAt,
    String? title,
    String? description,
  });

  /// Reads the server view of an existing session.
  Future<UploadSessionStatus> getStatus(String uploadId);

  /// Uploads one part; repeating an acknowledged index is idempotent.
  Future<void> putPart(
    String uploadId,
    int partIndex, {
    required List<int> bytes,
  });

  /// Completes a session whose parts are all acknowledged.
  Future<UploadCompleteResult> complete(String uploadId);

  /// Abandons a session and its parts.
  Future<void> abort(String uploadId);
}
