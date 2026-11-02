import 'dart:math';

import '../media/photo_observer.dart';
import '../settings/settings_store.dart';
import '../upload/models.dart';
import 'backup_status.dart';

/// How much of one device album is already backed up.
class AlbumProgress {
  const AlbumProgress({
    required this.backedUp,
    required this.total,
    this.partial = false,
  });

  /// Assets whose bytes the server holds (uploaded or deduplicated).
  final int backedUp;

  /// Assets the tally actually read, which is the album size unless [partial].
  final int total;

  /// True when the tally stopped at the cap instead of reading the album.
  final bool partial;

  @override
  String toString() =>
      'AlbumProgress(backedUp: $backedUp, total: $total, partial: $partial)';
}

/// Counts the backed-up share of an album, one page at a time.
///
/// Takes callbacks instead of a [PhotoObserver] and the queue so it runs in a
/// unit test without a platform or a database. Pages beyond [maxAssets] are
/// not read: a rollup is a hint on an album tile, not a reason to walk a
/// 100k-asset album.
Future<AlbumProgress> tallyAlbumProgress({
  required Future<int> Function() count,
  required Future<List<AssetCandidate>> Function(int offset, int limit) page,
  required Future<Map<String, UploadState>> Function(List<String> localIds)
  states,
  required AppSettings settings,
  int pageSize = 500,
  int maxAssets = 20000,
}) async {
  final expected = await count();
  if (expected <= 0) return const AlbumProgress(backedUp: 0, total: 0);

  final cap = min(expected, maxAssets);
  var backedUp = 0;
  var total = 0;
  while (total < cap) {
    final limit = min(pageSize, cap - total);
    final batch = await page(total, limit);
    if (batch.isEmpty) break;
    // One queue read per page: the whole album never sits in memory.
    final found = await states(
      batch.map((asset) => asset.localId).toList(growable: false),
    );
    for (final asset in batch) {
      if (resolveBackupStatus(
            state: found[asset.localId],
            asset: asset,
            settings: settings,
          ) ==
          BackupStatus.backedUp) {
        backedUp++;
      }
    }
    total += batch.length;
    // A short page means the library shrank or access is limited, not a cap.
    if (batch.length < limit) break;
  }
  return AlbumProgress(
    backedUp: backedUp,
    total: total,
    partial: total >= cap && expected > cap,
  );
}
