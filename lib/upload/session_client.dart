import 'dart:async';

import '../core/api_client.dart';
import 'models.dart';

/// Client for the resumable part-based upload session API.
class SessionClient {
  const SessionClient(this.api);

  /// Signed transport used for every session call.
  final ApiClient api;

  /// Opens a session for a file whose bytes hash to [sha256Hex].
  Future<CreateSessionResult> createSession({
    required String sha256Hex,
    required int sizeBytes,
    required String filename,
    DateTime? takenAt,
    String? title,
    String? description,
    int? partSize,
  }) {
    // TODO(spec §2.2): POST /api/v1/uploads; 200 with an identical checksum is
    // a DuplicateFound success, not an error; 413 means over quota.
    throw UnimplementedError('SessionClient.createSession');
  }

  /// Reads the server view of a session so a restart can skip received parts.
  Future<UploadSessionStatus> getStatus(String uploadId) {
    // TODO(spec §2.2): GET /api/v1/uploads/:id; 410 means the session expired
    // and must be recreated.
    throw UnimplementedError('SessionClient.getStatus');
  }

  /// Uploads one part; repeating a successful index is idempotent.
  Future<void> putPart(
    String uploadId,
    int partIndex, {
    required Stream<List<int>> bytes,
    String? sha256Hex,
  }) {
    // TODO(spec §2.2): PUT /api/v1/uploads/:id/parts/:index is idempotent; a
    // 422 checksum mismatch means only this part has to be re-sent.
    throw UnimplementedError('SessionClient.putPart');
  }

  /// Completes the session and records the created asset in the queue.
  Future<void> complete(String uploadId) {
    // TODO(spec §2.2): POST /api/v1/uploads/:id/complete returns the Asset;
    // 409 lists missingParts and pauses the session until they are re-sent.
    throw UnimplementedError('SessionClient.complete');
  }

  /// Abandons a session whose bytes are no longer needed.
  Future<void> abort(String uploadId) {
    // TODO(spec §2.2): DELETE /api/v1/uploads/:id; safe to call after 410.
    throw UnimplementedError('SessionClient.abort');
  }
}
