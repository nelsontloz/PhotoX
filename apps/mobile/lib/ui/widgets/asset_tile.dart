import 'dart:typed_data';

import 'package:flutter/foundation.dart' show ValueListenable;
import 'package:flutter/material.dart';

import '../../library/backup_status.dart';
import '../../library/library_item.dart';
import '../../sync/transfer_progress.dart';
import 'provenance_badge.dart';
import 'status_badge.dart';

/// One square asset in the library grid: the preview, its one corner mark, and
/// the selection affordances.
///
/// Plain props only: the screen owns loading, selection and status resolution.
/// The mark is the exception — the transfer badge follows [progress] on its own
/// so a byte tick repaints one tile instead of the whole grid.
class AssetTile extends StatelessWidget {
  const AssetTile({
    super.key,
    required this.item,
    required this.preview,
    required this.progress,
    required this.deferring,
    this.status,
    this.selecting = false,
    this.selected = false,
    this.onTap,
    this.onLongPress,
  });

  /// The merged-library row this tile stands for: the device's copy, the
  /// server's, or both.
  final LibraryItem item;

  /// Encoded preview for [item] at roughly the tile's own size; null keeps the
  /// placeholder. The screen decides where the bytes come from — the device for
  /// a row it holds, the server for one it does not.
  final Future<Uint8List?> Function(LibraryItem item, {int size}) preview;

  /// Live transfer state, so this tile shows its own percentage as it moves.
  final TransferProgress progress;

  /// True while the grid is flinging; the preview waits rather than queueing.
  final ValueListenable<bool> deferring;

  /// Badge state, or null while the queue has not answered for this asset yet.
  final BackupStatus? status;

  /// True while the grid is in selection mode.
  final bool selecting;

  /// True when this tile is part of the current selection.
  final bool selected;

  final VoidCallback? onTap;
  final VoidCallback? onLongPress;

  static const BorderRadius _radius = BorderRadius.all(Radius.circular(12));

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final mark = _mark();

    return Semantics(
      container: true,
      button: true,
      label: mark.label == null ? item.title : '${item.title}, ${mark.label}',
      hint: selecting ? null : 'Long press to select',
      selected: selecting ? selected : null,
      onTap: onTap,
      onLongPress: onLongPress,
      child: GestureDetector(
        excludeFromSemantics: true,
        behavior: HitTestBehavior.opaque,
        onTap: onTap,
        onLongPress: onLongPress,
        child: ClipRRect(
          borderRadius: _radius,
          child: Stack(
            fit: StackFit.expand,
            children: <Widget>[
              ColoredBox(color: scheme.surfaceContainerHigh),
              _Thumbnail(item: item, load: preview, deferring: deferring),
              // Dimming sits under the marks so they stay readable.
              if (selecting && !selected)
                const ColoredBox(color: Color(0x73000000)),
              // A play glyph promises bytes on this phone; a server-only row
              // has none here to open.
              if (item.device != null && item.isVideo) const _VideoMark(),
              Positioned(
                right: 5,
                bottom: 5,
                // The tile's label already carries the mark's words.
                child: ExcludeSemantics(child: mark.child),
              ),
              if (selecting)
                Positioned(
                  top: 5,
                  right: 5,
                  child: _SelectionMark(selected: selected),
                ),
              if (selected)
                Positioned.fill(
                  child: IgnorePointer(
                    child: DecoratedBox(
                      decoration: BoxDecoration(
                        borderRadius: _radius,
                        border: Border.all(color: scheme.primary, width: 2.5),
                      ),
                    ),
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }

  /// True while this exact asset's bytes are moving right now.
  bool get _live {
    final localId = item.device?.localId;
    return localId != null && progress.active && progress.localId == localId;
  }

  /// Completed fraction of a live upload; nothing while it is still preparing.
  ///
  /// A build-time snapshot: the ring keeps ticking on its own, the label does
  /// not need to.
  double? get _liveFraction =>
      _live && progress.phase == TransferPhase.uploading
      ? progress.fraction
      : null;

  /// The one mark in the bottom-right slot, plus the words it stands for.
  ///
  /// Priority (spec §2): the live transfer or the queue's own state first, then
  /// provenance — and nothing at all while the queue has not answered.
  ({String? label, Widget child}) _mark() {
    // An online-only row has no queue row at all, so the "no claim before the
    // queue answers" rule below must not swallow the one mark that says where
    // its bytes are.
    if (item.provenance == Provenance.onlineOnly) {
      return (
        label: ProvenanceBadge.labelFor(item.provenance),
        child: ProvenanceBadge(provenance: item.provenance),
      );
    }
    final status = _live ? BackupStatus.uploading : this.status;
    if (status == null) {
      return (label: null, child: const SizedBox.shrink());
    }
    return switch (status) {
      BackupStatus.uploading ||
      BackupStatus.failed ||
      BackupStatus.queued ||
      BackupStatus.excluded => (
        label: StatusBadge.labelFor(status, fraction: _liveFraction),
        child: _LiveBadge(
          localId: item.device?.localId,
          status: status,
          progress: progress,
        ),
      ),
      BackupStatus.backedUp || BackupStatus.unknown => (
        label: ProvenanceBadge.labelFor(item.provenance),
        child: ProvenanceBadge(provenance: item.provenance),
      ),
    };
  }
}

/// The transfer or queue badge, live while its own asset is in flight.
class _LiveBadge extends StatelessWidget {
  const _LiveBadge({
    required this.localId,
    required this.status,
    required this.progress,
  });

  /// Platform id of the device asset, or null on a server-only row.
  final String? localId;

  /// The queue's answer, or [BackupStatus.uploading] for the live transfer.
  final BackupStatus status;

  final TransferProgress progress;

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: progress,
      builder: (context, _) {
        final id = localId;
        final active = id != null && progress.active && progress.localId == id;
        // No byte count while the bytes are still being prepared.
        final fraction = active && progress.phase == TransferPhase.uploading
            ? progress.fraction
            : null;
        return StatusBadge(
          status: active ? BackupStatus.uploading : status,
          fraction: fraction,
        );
      },
    );
  }
}

/// Preview bytes decoded at roughly the tile's own size.
///
/// The future is kept per tile so a rebuild (selection, scroll, status change)
/// never re-asks the platform; the provider below keeps the decode cached.
class _Thumbnail extends StatefulWidget {
  const _Thumbnail({
    required this.item,
    required this.load,
    required this.deferring,
  });

  final LibraryItem item;
  final Future<Uint8List?> Function(LibraryItem item, {int size}) load;

  /// True while the grid is flinging: no request until it settles.
  final ValueListenable<bool> deferring;

  /// Big enough for the widest tile on a 3x screen; encoding once and caching
  /// beats asking 128 px and upscaling it.
  static const int requestPixels = 320;

  @override
  State<_Thumbnail> createState() => _ThumbnailState();
}

class _ThumbnailState extends State<_Thumbnail> {
  Future<Uint8List?>? _bytes;

  @override
  void initState() {
    super.initState();
    widget.deferring.addListener(_onDeferringChanged);
    if (!widget.deferring.value) _bytes = _load();
  }

  @override
  void didUpdateWidget(_Thumbnail oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.deferring != widget.deferring) {
      oldWidget.deferring.removeListener(_onDeferringChanged);
      widget.deferring.addListener(_onDeferringChanged);
      if (!widget.deferring.value && _bytes == null) _bytes = _load();
    }
    if (oldWidget.item.key != widget.item.key) {
      // A recycled tile starts over, and still waits out a fling.
      _bytes = widget.deferring.value ? null : _load();
    }
  }

  @override
  void dispose() {
    widget.deferring.removeListener(_onDeferringChanged);
    super.dispose();
  }

  /// The fling settled: ask for the preview that was held back.
  void _onDeferringChanged() {
    if (widget.deferring.value || _bytes != null) return;
    setState(() {
      _bytes = _load();
    });
  }

  Future<Uint8List?> _load() =>
      widget.load(widget.item, size: _Thumbnail.requestPixels);

  @override
  Widget build(BuildContext context) {
    return FutureBuilder<Uint8List?>(
      future: _bytes,
      builder: (context, snapshot) {
        final bytes = snapshot.data;
        if (bytes == null || bytes.isEmpty) return const _Blank();
        return LayoutBuilder(
          builder: (context, constraints) {
            final ratio = MediaQuery.devicePixelRatioOf(context);
            final width = (constraints.maxWidth * ratio).round().clamp(48, 512);
            return Image(
              image: ResizeImage.resizeIfNeeded(
                width,
                null,
                MemoryImage(bytes),
              ),
              fit: BoxFit.cover,
              gaplessPlayback: true,
              filterQuality: FilterQuality.low,
              errorBuilder: (context, error, stack) => const _Blank(),
            );
          },
        );
      },
    );
  }
}

/// Neutral stand-in while a preview loads, and when the platform has none.
class _Blank extends StatelessWidget {
  const _Blank();

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Center(
      child: Icon(
        Icons.image_outlined,
        size: 20,
        color: scheme.onSurfaceVariant.withValues(alpha: 0.35),
      ),
    );
  }
}

/// Tiny play glyph so videos read as videos even before they are backed up.
class _VideoMark extends StatelessWidget {
  const _VideoMark();

  @override
  Widget build(BuildContext context) {
    return Positioned(
      left: 5,
      top: 5,
      child: DecoratedBox(
        decoration: const BoxDecoration(
          color: Color(0x8C000000),
          shape: BoxShape.circle,
        ),
        child: const Padding(
          padding: EdgeInsets.all(2),
          child: Icon(Icons.play_arrow_rounded, size: 13, color: Colors.white),
        ),
      ),
    );
  }
}

/// Circle that fills in when the tile is part of the selection.
class _SelectionMark extends StatelessWidget {
  const _SelectionMark({required this.selected});

  final bool selected;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;

    return DecoratedBox(
      decoration: BoxDecoration(
        shape: BoxShape.circle,
        color: selected ? scheme.primary : const Color(0x4D000000),
        border: Border.all(
          color: selected ? scheme.primary : Colors.white70,
          width: 1.5,
        ),
      ),
      child: SizedBox.square(
        dimension: 20,
        child: selected
            ? Icon(Icons.check_rounded, size: 14, color: scheme.onPrimary)
            : null,
      ),
    );
  }
}
