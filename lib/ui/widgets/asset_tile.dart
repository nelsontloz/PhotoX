import 'dart:typed_data';

import 'package:flutter/material.dart';

import '../../library/backup_status.dart';
import '../../media/photo_observer.dart';
import 'status_badge.dart';

/// One square asset in the library grid: the preview, its backup mark, and the
/// selection affordances.
///
/// Plain props only: the screen owns loading, selection and status resolution.
class AssetTile extends StatelessWidget {
  const AssetTile({
    super.key,
    required this.asset,
    required this.thumbnail,
    this.status,
    this.fraction,
    this.selecting = false,
    this.selected = false,
    this.onTap,
    this.onLongPress,
  });

  /// Device asset this tile stands for.
  final AssetCandidate asset;

  /// Encoded preview for [AssetCandidate.localId]; null keeps the placeholder.
  final Future<Uint8List?> Function(String localId) thumbnail;

  /// Badge state, or null while the queue has not answered for this asset yet.
  final BackupStatus? status;

  /// Live uploaded fraction, only for the asset a transfer is working on.
  final double? fraction;

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
              _Thumbnail(asset: asset, load: thumbnail),
              // Dimming sits under the marks so they stay readable.
              if (selecting && !selected)
                const ColoredBox(color: Color(0x73000000)),
              if (asset.kind == MediaKind.video) const _VideoMark(),
              if (status != null)
                Positioned(
                  right: 5,
                  bottom: 5,
                  child: StatusBadge(status: status!, fraction: fraction),
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

/// Preview bytes decoded at roughly the tile's own size.
///
/// The future is kept per tile so a rebuild (selection, scroll, status change)
/// never re-asks the platform; Flutter's image cache is size-bounded, and
/// [cacheWidth] keeps 50k decoded previews from being full-resolution bitmaps.
class _Thumbnail extends StatefulWidget {
  const _Thumbnail({required this.asset, required this.load});

  final AssetCandidate asset;
  final Future<Uint8List?> Function(String localId) load;

  @override
  State<_Thumbnail> createState() => _ThumbnailState();
}

class _ThumbnailState extends State<_Thumbnail> {
  Future<Uint8List?>? _bytes;

  @override
  void initState() {
    super.initState();
    _bytes = widget.load(widget.asset.localId);
  }

  @override
  void didUpdateWidget(_Thumbnail oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.asset.localId != widget.asset.localId) {
      _bytes = widget.load(widget.asset.localId);
    }
  }

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
            return Image.memory(
              bytes,
              fit: BoxFit.cover,
              cacheWidth: width,
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
