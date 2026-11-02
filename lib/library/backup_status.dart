import '../media/media_filter.dart';
import '../media/photo_observer.dart';
import '../settings/settings_store.dart';
import '../upload/models.dart';

/// What the on-device library grid shows on one tile.
enum BackupStatus {
  /// The server holds these exact bytes (uploaded, or deduplicated on upload).
  backedUp,

  /// The pipeline is working on this asset right now.
  uploading,

  /// Queued or waiting out a retry backoff.
  queued,

  /// Gave up permanently, or skipped because the quota is full.
  failed,

  /// Not eligible for backup (unsupported container, or a video while videos
  /// are off).
  excluded,

  /// Never queued: nothing is known about it, so it is not backed up.
  unknown,
}

/// Resolves the badge for one device asset.
///
/// [state] is the local queue row's state, or null when the asset has no row
/// (which means nothing was ever attempted for it on this phone).
///
/// With no row the badge only means "this phone never uploaded it": bytes
/// uploaded from another device read [BackupStatus.unknown] until this phone
/// hashes the asset and dedup finds them, so `unknown` is not proof the server
/// lacks the bytes.
BackupStatus resolveBackupStatus({
  required UploadState? state,
  required AssetCandidate asset,
  required AppSettings settings,
  MediaFilter filter = const MediaFilter(),
}) {
  if (state == null) {
    return filter.isSupported(asset, includeVideos: settings.includeVideos)
        ? BackupStatus.unknown
        : BackupStatus.excluded;
  }
  // Exhaustive on purpose: a new UploadState must fail to compile here.
  return switch (state) {
    UploadState.uploaded || UploadState.duplicate => BackupStatus.backedUp,
    UploadState.hashing ||
    UploadState.creating ||
    UploadState.uploading ||
    UploadState.completing => BackupStatus.uploading,
    UploadState.discovered ||
    UploadState.pending ||
    UploadState.failedRetryable => BackupStatus.queued,
    UploadState.failedPermanent ||
    UploadState.skippedQuota => BackupStatus.failed,
    UploadState.excluded => BackupStatus.excluded,
  };
}

/// What the queue knows about one asset beyond its badge.
///
/// The grid only needs [BackupStatus]; the viewer also shows why a permanent
/// failure gave up, which is the one thing a badge cannot say.
class BackupDetail {
  const BackupDetail({required this.status, this.error});

  /// Badge state for the asset.
  final BackupStatus status;

  /// Last failure message recorded on the row, as the server phrased it.
  final String? error;
}
