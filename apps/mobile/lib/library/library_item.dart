import '../media/photo_observer.dart';
import '../server/server_asset.dart';

/// Where the bytes of one tile live.
enum Provenance {
  /// This phone has the bytes and the server was told they are the same bytes.
  both,

  /// On this phone only: queued, failed, out of scope, or never asked yet.
  deviceOnly,

  /// On the server only: nothing on this phone matches it.
  onlineOnly,
}

/// One row of the merged library: the device's copy, the server's copy, or
/// both, plus the provenance the data layer decided for it.
///
/// The grid never derives provenance from ids or queue rows itself; the screen
/// builds these and the tile only draws them.
class LibraryItem {
  const LibraryItem._({required this.provenance, this.device, this.server});

  /// On this phone, not uploaded yet (or not eligible).
  factory LibraryItem.deviceOnly(AssetCandidate device) =>
      LibraryItem._(provenance: Provenance.deviceOnly, device: device);

  /// On this phone and already on the server.
  factory LibraryItem.backedUp(AssetCandidate device, {ServerAsset? server}) =>
      LibraryItem._(
        provenance: Provenance.both,
        device: device,
        server: server,
      );

  /// Only the server has it.
  factory LibraryItem.onlineOnly(ServerAsset server) =>
      LibraryItem._(provenance: Provenance.onlineOnly, server: server);

  final Provenance provenance;

  /// The device candidate, when this phone holds the bytes.
  final AssetCandidate? device;

  /// The server record, when one is known for this row.
  final ServerAsset? server;

  /// The date the merged timeline sorts and groups by.
  ///
  /// A device row uses the date the device grid has always used; an online-only
  /// row uses the server's own ordering key.
  DateTime? get date =>
      device != null ? (device!.takenAt ?? device!.modifiedAt) : server!.date;

  /// Stable identity across a merge: the platform id, or the server id.
  String get key => device?.localId ?? 'server:${server!.id}';

  /// Screen-reader label for the tile.
  String get title => device?.fileName ?? server?.title ?? 'Photo';

  bool get isVideo => device != null
      ? device!.kind == MediaKind.video
      : server!.isVideo;
}

/// Merges the device and server halves into one newest-first list.
///
/// Undated rows (a device asset with neither capture nor modification time)
/// keep the grid's existing "Undated" bucket, so they sort last. Ties are
/// broken towards the device copy, so the same photo never jumps between two
/// neighbouring positions across rebuilds.
List<LibraryItem> mergeLibraryItems(Iterable<LibraryItem> items) {
  final sorted = <LibraryItem>[...items];
  sorted.sort((a, b) {
    final left = a.date;
    final right = b.date;
    if (left == null && right == null) return a.key.compareTo(b.key);
    if (left == null) return 1;
    if (right == null) return -1;
    final byDate = right.compareTo(left);
    if (byDate != 0) return byDate;
    if (a.device != null && b.device == null) return -1;
    if (a.device == null && b.device != null) return 1;
    return a.key.compareTo(b.key);
  });
  return sorted;
}
