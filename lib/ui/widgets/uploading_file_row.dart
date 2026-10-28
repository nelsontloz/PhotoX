import 'dart:typed_data';

import 'package:flutter/material.dart';

import '../../sync/transfer_progress.dart';
import 'count_format.dart';

/// The one asset currently in flight: thumbnail, name, bytes, and its own bar.
///
/// Uploads are sequential, so a single row covers the whole pass. The row is
/// always mounted and always the same height and widget shape, so the panel
/// below it never jumps: no phase branch changes the bar type, and the bar is
/// a determinate [LinearProgressIndicator] animated over one notify interval.
class UploadingFileRow extends StatefulWidget {
  const UploadingFileRow({super.key, required this.progress, this.thumbnail});

  /// Live state of the asset in flight.
  final TransferProgress progress;

  /// Loads thumbnail bytes for a library id; null (or a null result) keeps a
  /// neutral icon. Supplied by the caller so this widget never touches
  /// platform media APIs.
  final Future<Uint8List?> Function(String localId)? thumbnail;

  @override
  State<UploadingFileRow> createState() => _UploadingFileRowState();
}

class _UploadingFileRowState extends State<UploadingFileRow> {
  /// Unscaled slot height; scaled by the text size so large fonts still fit.
  static const double _baseHeight = 72;

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
    final percent = (progress.fraction * 100).round();
    final sent = formatBytes(progress.sentBytes);
    final total = formatBytes(progress.totalBytes);
    final detail = idle
        ? 'Waiting for the next item.'
        : progress.phase == TransferPhase.preparing
        ? 'Preparing · $sent of $total'
        : '$sent of $total';

    return Semantics(
      container: true,
      label: idle
          ? 'Nothing uploading'
          : 'Uploading $name, $percent percent, $sent of $total',
      child: ExcludeSemantics(
        child: SizedBox(
          height: _baseHeight * MediaQuery.textScalerOf(context).scale(1),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.center,
            children: <Widget>[
              _Thumbnail(bytes: _image),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
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
                            style: theme.textTheme.labelMedium?.copyWith(
                              color: scheme.onSurfaceVariant,
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
                    const SizedBox(height: 5),
                    ClipRRect(
                      borderRadius: BorderRadius.circular(10),
                      child: TweenAnimationBuilder<double>(
                        tween: Tween<double>(end: progress.fraction),
                        duration: progress.notifyInterval,
                        curve: Curves.easeOut,
                        builder: (context, value, _) => LinearProgressIndicator(
                          key: const Key('uploading-file-progress'),
                          value: value,
                          minHeight: 4,
                          color: scheme.primary,
                          backgroundColor: scheme.surfaceContainerHighest,
                          semanticsLabel: 'File upload progress',
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
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

class _Thumbnail extends StatelessWidget {
  const _Thumbnail({required this.bytes});

  final Uint8List? bytes;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final image = bytes;

    return ClipRRect(
      borderRadius: BorderRadius.circular(10),
      child: SizedBox.square(
        dimension: 40,
        child: image == null
            ? ColoredBox(
                color: scheme.surfaceContainerHighest,
                child: Center(
                  child: Icon(
                    Icons.image_outlined,
                    size: 20,
                    color: scheme.onSurfaceVariant,
                  ),
                ),
              )
            : Image.memory(
                image,
                gaplessPlayback: true,
                fit: BoxFit.cover,
                width: 40,
                height: 40,
              ),
      ),
    );
  }
}
