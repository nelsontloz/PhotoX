import 'dart:typed_data';

import 'package:flutter/material.dart';

import '../../sync/transfer_progress.dart';
import 'count_format.dart';
import 'panel.dart';

/// The one asset currently in flight: thumbnail, name, bytes, and its own bar.
///
/// Uploads are sequential, so a single card covers the whole pass. The card is
/// always mounted and always the same height, so nothing below it jumps: no
/// phase branch changes the bar type, and the bar is a determinate
/// [LinearProgressIndicator] animated over one notify interval.
class UploadingFileRow extends StatefulWidget {
  const UploadingFileRow({
    super.key,
    required this.progress,
    required this.waiting,
    this.paused = false,
    this.thumbnail,
  });

  /// Live state of the asset in flight.
  final TransferProgress progress;

  /// Assets still queued behind this one, for the footer line.
  final int waiting;

  /// True when the user stopped backups; the live dot stops pulsing and the
  /// row reads as paused.
  final bool paused;

  /// Loads thumbnail bytes for a library id; null (or a null result) keeps a
  /// neutral icon. Supplied by the caller so this widget never touches
  /// platform media APIs.
  final Future<Uint8List?> Function(String localId)? thumbnail;

  @override
  State<UploadingFileRow> createState() => _UploadingFileRowState();
}

class _UploadingFileRowState extends State<UploadingFileRow> {
  /// Unscaled tile height; scaled by the text size so large fonts still fit.
  static const double _baseHeight = 64;

  /// Small bounded cache: enough that stepping back and forth never reloads,
  /// small enough that a long pass does not pin the library in memory.
  static const int _cacheLimit = 24;

  final Map<String, Uint8List> _thumbnails = <String, Uint8List>{};

  /// Id the row is describing; a slow load for any other id is dropped.
  String? _shownId;
  Uint8List? _image;

  @override
  void initState() {
    super.initState();
    widget.progress.addListener(_onTransfer);
    _shownId = widget.progress.localId;
    _load(_shownId);
  }

  @override
  void didUpdateWidget(UploadingFileRow oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.progress != widget.progress) {
      oldWidget.progress.removeListener(_onTransfer);
      widget.progress.addListener(_onTransfer);
      // Already rebuilding; mutating here avoids a setState during build.
      _syncToCurrent();
    }
    if (oldWidget.thumbnail != widget.thumbnail) _load(_shownId);
  }

  @override
  void dispose() {
    widget.progress.removeListener(_onTransfer);
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    final progress = widget.progress;
    final name = progress.fileName;
    final idle = name == null;
    // The ping only means "bytes are moving": a finished or paused transfer
    // keeps the last file on screen with a still dot.
    final live = progress.active && !widget.paused;
    final percent = (progress.fraction * 100).round();
    // Zero until a full sample window exists, so an idle card never shows
    // "0 B/s" as if the link had stalled.
    final speed =
        live &&
            progress.phase == TransferPhase.uploading &&
            progress.speedBytesPerSecond > 0
        ? progress.speedBytesPerSecond
        : null;
    final detail = idle
        ? 'Waiting for the next item.'
        : '${formatBytes(progress.sentBytes)} / '
              '${formatBytes(progress.totalBytes)} · ${_phaseLabel()}';

    return Panel(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Row(
            children: <Widget>[
              _LiveDot(live: live),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  (progress.active ? 'Active upload stream' : 'Upload stream')
                      .toUpperCase(),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: theme.textTheme.labelSmall?.copyWith(
                    color: scheme.onSurfaceVariant,
                    fontWeight: FontWeight.w700,
                    letterSpacing: 1.3,
                  ),
                ),
              ),
              if (speed != null) ...<Widget>[
                const SizedBox(width: 8),
                Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 8,
                    vertical: 3,
                  ),
                  decoration: BoxDecoration(
                    color: scheme.surfaceContainerHighest,
                    borderRadius: BorderRadius.circular(100),
                  ),
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: <Widget>[
                      Icon(Icons.bolt_rounded, size: 13, color: scheme.primary),
                      const SizedBox(width: 2),
                      Text(
                        formatSpeed(speed),
                        style: theme.textTheme.labelSmall?.copyWith(
                          color: scheme.primary,
                          fontWeight: FontWeight.w600,
                          fontFeatures: const <FontFeature>[
                            FontFeature.tabularFigures(),
                          ],
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            ],
          ),
          const SizedBox(height: 12),
          Semantics(
            container: true,
            label: idle
                ? 'Nothing uploading'
                : 'Uploading $name, $percent percent, '
                      '${formatBytes(progress.sentBytes)} of '
                      '${formatBytes(progress.totalBytes)}',
            child: ExcludeSemantics(
              child: Container(
                padding: const EdgeInsets.all(10),
                decoration: BoxDecoration(
                  color: scheme.surfaceContainerLow,
                  borderRadius: BorderRadius.circular(10),
                ),
                child: SizedBox(
                  height:
                      _baseHeight * MediaQuery.textScalerOf(context).scale(1),
                  child: Row(
                    children: <Widget>[
                      _Thumbnail(bytes: _image, fileName: name),
                      const SizedBox(width: 12),
                      Expanded(
                        child: Column(
                          mainAxisAlignment: MainAxisAlignment.center,
                          crossAxisAlignment: CrossAxisAlignment.stretch,
                          children: <Widget>[
                            Row(
                              children: <Widget>[
                                Expanded(
                                  child: Text(
                                    name ?? 'Nothing uploading',
                                    maxLines: 1,
                                    overflow: TextOverflow.ellipsis,
                                    style: theme.textTheme.labelLarge?.copyWith(
                                      color: idle
                                          ? scheme.onSurfaceVariant
                                          : scheme.onSurface,
                                      fontWeight: FontWeight.w600,
                                      height: 1.2,
                                    ),
                                  ),
                                ),
                                if (!idle) ...<Widget>[
                                  const SizedBox(width: 8),
                                  Text(
                                    '$percent%',
                                    style: theme.textTheme.labelLarge?.copyWith(
                                      color: scheme.primary,
                                      fontWeight: FontWeight.w700,
                                      height: 1.2,
                                      fontFeatures: const <FontFeature>[
                                        FontFeature.tabularFigures(),
                                      ],
                                    ),
                                  ),
                                ],
                              ],
                            ),
                            const SizedBox(height: 3),
                            Text(
                              detail,
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: theme.textTheme.bodySmall?.copyWith(
                                color: scheme.onSurfaceVariant,
                                height: 1.2,
                              ),
                            ),
                          ],
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ),
          ),
          const SizedBox(height: 10),
          ClipRRect(
            borderRadius: BorderRadius.circular(10),
            child: TweenAnimationBuilder<double>(
              tween: Tween<double>(end: progress.fraction),
              duration: progress.notifyInterval,
              curve: Curves.easeOut,
              builder: (context, value, _) => LinearProgressIndicator(
                key: const Key('uploading-file-progress'),
                value: value,
                minHeight: 8,
                color: scheme.primaryContainer,
                backgroundColor: scheme.surfaceContainerHighest,
                semanticsLabel: 'File upload progress',
              ),
            ),
          ),
          const SizedBox(height: 10),
          Row(
            children: <Widget>[
              Icon(
                Icons.queue_rounded,
                size: 14,
                color: scheme.onSurfaceVariant,
              ),
              const SizedBox(width: 6),
              Expanded(
                child: Text(
                  widget.waiting > 0
                      ? '${countLabel(widget.waiting, 'file')} still waiting'
                      : 'Nothing queued',
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: theme.textTheme.bodySmall?.copyWith(
                    color: scheme.onSurfaceVariant,
                  ),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }

  String _phaseLabel() {
    if (widget.paused) return 'Paused';
    return switch (widget.progress.phase) {
      TransferPhase.preparing => 'Preparing',
      TransferPhase.uploading => 'Uploading',
      TransferPhase.idle => 'Done',
    };
  }

  /// Keeps the painted image while the next file's bytes are still loading, so
  /// the slot never blanks between two files of one pass.
  void _onTransfer() {
    setState(_syncToCurrent);
  }

  /// Moves the row onto the file in flight; returns false on a byte tick.
  void _syncToCurrent() {
    final id = widget.progress.localId;
    if (id == _shownId) return;
    _shownId = id;
    if (id == null) {
      _image = null;
    } else if (_thumbnails[id] != null) {
      _image = _thumbnails[id];
    }
    _load(id);
  }

  Future<void> _load(String? id) async {
    final load = widget.thumbnail;
    if (id == null || load == null || _thumbnails.containsKey(id)) return;
    Uint8List? bytes;
    try {
      bytes = await load(id);
    } on Object {
      bytes = null; // A missing thumbnail is not worth an error anywhere.
    }
    // A later file may have started while this one loaded.
    if (!mounted || id != widget.progress.localId) return;
    final data = bytes;
    if (data == null) {
      setState(() => _image = null);
      return;
    }
    setState(() {
      _thumbnails[id] = data;
      if (_thumbnails.length > _cacheLimit) {
        _thumbnails.remove(_thumbnails.keys.first);
      }
      _image = data;
    });
  }
}

/// Live indicator: a solid dot with a ring that pings out while a transfer is
/// actually running. The controller only repeats in that state, so no animation
/// runs on an idle dashboard.
class _LiveDot extends StatefulWidget {
  const _LiveDot({required this.live});

  final bool live;

  @override
  State<_LiveDot> createState() => _LiveDotState();
}

class _LiveDotState extends State<_LiveDot>
    with SingleTickerProviderStateMixin {
  late final AnimationController _controller = AnimationController(
    vsync: this,
    duration: const Duration(seconds: 2),
  );

  @override
  void initState() {
    super.initState();
    if (widget.live) _controller.repeat();
  }

  @override
  void didUpdateWidget(_LiveDot oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.live == oldWidget.live) return;
    if (widget.live) {
      _controller.repeat();
    } else {
      _controller.stop();
      _controller.value = 0;
    }
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final color = widget.live ? scheme.primary : scheme.outline;

    return SizedBox.square(
      dimension: 14,
      child: AnimatedBuilder(
        animation: _controller,
        builder: (context, _) {
          final t = _controller.value;
          return Stack(
            alignment: Alignment.center,
            children: <Widget>[
              if (widget.live)
                Transform.scale(
                  scale: 0.4 + 0.6 * t,
                  child: DecoratedBox(
                    decoration: BoxDecoration(
                      shape: BoxShape.circle,
                      color: color.withValues(alpha: 0.45 * (1 - t)),
                    ),
                    child: const SizedBox.square(dimension: 14),
                  ),
                ),
              DecoratedBox(
                decoration: BoxDecoration(shape: BoxShape.circle, color: color),
                child: const SizedBox.square(dimension: 6),
              ),
            ],
          );
        },
      ),
    );
  }
}

class _Thumbnail extends StatelessWidget {
  const _Thumbnail({required this.bytes, required this.fileName});

  final Uint8List? bytes;

  /// Only used for the type badge; the name itself is shown next to it.
  final String? fileName;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final image = bytes;
    final type = _extension(fileName);

    return ClipRRect(
      borderRadius: BorderRadius.circular(10),
      child: SizedBox.square(
        dimension: 48,
        child: Stack(
          fit: StackFit.expand,
          children: <Widget>[
            if (image == null)
              ColoredBox(
                color: scheme.surfaceContainerHighest,
                child: Center(
                  child: Icon(
                    Icons.image_outlined,
                    size: 20,
                    color: scheme.onSurfaceVariant,
                  ),
                ),
              )
            else
              Image.memory(image, gaplessPlayback: true, fit: BoxFit.cover),
            if (image != null)
              IgnorePointer(
                child: DecoratedBox(
                  // Scrim so the badge stays readable over any photo.
                  decoration: BoxDecoration(
                    gradient: LinearGradient(
                      begin: Alignment.bottomCenter,
                      end: Alignment.topCenter,
                      colors: <Color>[
                        Colors.black.withValues(alpha: 0.65),
                        Colors.transparent,
                      ],
                      stops: const <double>[0, 0.6],
                    ),
                  ),
                ),
              ),
            if (type != null)
              Align(
                alignment: Alignment.bottomLeft,
                child: Padding(
                  padding: const EdgeInsets.fromLTRB(4, 0, 4, 3),
                  child: Text(
                    type,
                    style: TextStyle(
                      fontSize: 8,
                      height: 1.1,
                      fontWeight: FontWeight.w700,
                      letterSpacing: 0.4,
                      color: Colors.white.withValues(alpha: 0.92),
                    ),
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }

  /// `JPG` for `IMG_4821.JPG`; null when the name carries no useful suffix.
  static String? _extension(String? name) {
    if (name == null) return null;
    final dot = name.lastIndexOf('.');
    if (dot <= 0 || dot == name.length - 1) return null;
    final suffix = name.substring(dot + 1);
    return suffix.length <= 4 ? suffix.toUpperCase() : null;
  }
}
