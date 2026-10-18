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

/// Outcome of a session-creation request.
sealed class CreateSessionResult {
  const CreateSessionResult();
}

/// The server opened a resumable session for the requested part layout.
final class SessionCreated extends CreateSessionResult {
  const SessionCreated({
    required this.uploadId,
    required this.partSize,
    required this.partCount,
    required this.expiresAt,
  });

  /// Server-side session id used by the part and complete calls.
  final String uploadId;

  /// Part size the server expects for this session, in bytes.
  final int partSize;

  /// Number of parts the file is split into.
  final int partCount;

  /// Instant after which the session is expired (410).
  final DateTime expiresAt;
}

/// The server already stores an identical checksum.
final class DuplicateFound extends CreateSessionResult {
  const DuplicateFound({required this.fileId, required this.assetId});

  /// Existing file record holding the same bytes.
  final String fileId;

  /// Asset the existing file belongs to.
  final String assetId;
}

/// Snapshot of a session returned by the status endpoint.
class UploadSessionStatus {
  const UploadSessionStatus({
    required this.status,
    required this.partSize,
    required this.partCount,
    required this.receivedParts,
    required this.expiresAt,
  });

  /// Server-reported session state (for example `pending` or `complete`).
  final String status;

  /// Part size fixed at creation time, in bytes.
  final int partSize;

  /// Number of parts the file is split into.
  final int partCount;

  /// Indices the server has already persisted.
  final List<int> receivedParts;

  /// Instant after which the session is expired (410).
  final DateTime expiresAt;
}

// TODO(spec §2.2, §3.4): keep these wire types in sync with the core upload
// endpoints and derive the retry class (retryable vs permanent) from them.
