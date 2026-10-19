import 'dart:io';

import '../core/api_client.dart';
import 'models.dart';
import 'session_client.dart';

/// Single-request upload and dedup operations used by the pipeline.
///
/// Keeping this as an interface lets tests run the uploader without Dio and
/// leaves room for a future background-upload backend.
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
    String? mimeHint,
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

/// [UploadTransport] backed by the signed core [ApiClient].
class ApiUploadTransport implements UploadTransport {
  const ApiUploadTransport(this.api);

  final ApiClient api;

  @override
  Future<AssetSummary> uploadFile(
    File file,
    String originalName, {
    String? mimeType,
    String? title,
    String? description,
    DateTime? takenAt,
  }) {
    return api.uploadFile(
      file,
      originalName,
      mimeType: mimeType,
      title: title,
      description: description,
      takenAt: takenAt,
    );
  }

  @override
  Future<List<DedupHit>> exists(List<DedupCheck> items) => api.exists(items);
}

/// [SessionTransport] backed by [SessionClient].
class SessionApiTransport implements SessionTransport {
  const SessionApiTransport(this.sessions);

  final SessionClient sessions;

  @override
  Future<CreateSessionResult> createSession({
    required String sha256Hex,
    required int sizeBytes,
    required String filename,
    String? mimeHint,
    DateTime? takenAt,
    String? title,
    String? description,
  }) {
    return sessions.createSession(
      sha256Hex: sha256Hex,
      sizeBytes: sizeBytes,
      filename: filename,
      mimeHint: mimeHint,
      takenAt: takenAt,
      title: title,
      description: description,
    );
  }

  @override
  Future<UploadSessionStatus> getStatus(String uploadId) =>
      sessions.getStatus(uploadId);

  @override
  Future<void> putPart(
    String uploadId,
    int partIndex, {
    required List<int> bytes,
  }) {
    return sessions.putPart(uploadId, partIndex, bytes: bytes);
  }

  @override
  Future<UploadCompleteResult> complete(String uploadId) =>
      sessions.complete(uploadId);

  @override
  Future<void> abort(String uploadId) => sessions.abort(uploadId);
}
