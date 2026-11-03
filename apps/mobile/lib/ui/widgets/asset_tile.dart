import 'dart:typed_data';

import 'package:flutter/foundation.dart' show ValueListenable;
import 'package:flutter/material.dart';

import '../../library/backup_status.dart';
import '../../media/photo_observer.dart';
import '../../sync/transfer_progress.dart';
import 'status_badge.dart';

/// One square asset in the library grid: the preview, its backup mark, and the
/// selection affordances.
///
/// Plain props only: the screen owns loading, selection and status resolution.
/// The badge is the exception — it follows [progress] on its own so a byte tick
/// repaints one tile instead of the whole grid.
class AssetTile extends StatelessWidget {
  const AssetTile({
    super.key,
    required this.asset,
    required this.thumbnail,
    required this.progress,
    required this.deferring,
    this.status,
    this.selecting = false,
    this.selected = false,
    this.onTap,
    this.onLongPress,
  });

  /// Device asset this tile stands for.
  final AssetCandidate asset;

  /// Encoded preview for [AssetCandidate.localId]; null keeps the placeholder.
  final Future<Uint8List?> Function(String localId, {int size}) thumbnail;

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

    return Semantics(
      container: true,
      button: true,
      label: asset.fileName,
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
              _Thumbnail(asset: asset, load: thumbnail, deferring: deferring),
              // Dimming sits under the marks so they stay readable.
              if (selecting && !selected)
                const ColoredBox(color: Color(0x73000000)),
              if (asset.kind == MediaKind.video) const _VideoMark(),
              Positioned(
                right: 5,
                bottom: 5,
                child: _LiveBadge(
                  asset: asset,
                  status: status,
                  progress: progress,
                ),
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
}

/// The badge, plus the live percentage while this exact asset is in flight.
class _LiveBadge extends StatelessWidget {
  const _LiveBadge({
    required this.asset,
    required this.status,
    required this.progress,
  });

  final AssetCandidate asset;
  final BackupStatus? status;
  final TransferProgress progress;

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: progress,
      builder: (context, _) {
        final active = progress.active && progress.localId == asset.localId;
        final resolved = active ? BackupStatus.uploading : status;
        if (resolved == null) return const SizedBox.shrink();
        // No byte count while the bytes are still being prepared.
        final fraction = active && progress.phase == TransferPhase.uploading
            ? progress.fraction
            : null;
        return StatusBadge(status: resolved, fraction: fraction);
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
    required this.asset,
    required this.load,
    required this.deferring,
  });

  final AssetCandidate asset;
  final Future<Uint8List?> Function(String localId, {int size}) load;

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
    if (oldWidget.asset.localId != widget.asset.localId) {
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
      widget.load(widget.asset.localId, size: _Thumbnail.requestPixels);

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
