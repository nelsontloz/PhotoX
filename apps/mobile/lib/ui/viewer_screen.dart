import 'dart:async';
import 'dart:io';
import 'dart:typed_data';

import 'package:flutter/material.dart';

import '../library/backup_status.dart';
import '../media/photo_observer.dart';
import '../media/video_playback.dart';
import 'widgets/month_names.dart';
import 'widgets/status_badge.dart';

/// Full-screen view of one on-device asset, swiped through [assets] in order.
///
/// The device is the source: the bytes are a platform thumbnail at display
/// resolution, never an export of the original, so opening a photo costs no
/// disk I/O beyond what the library already caches. The bar underneath says
/// what the backup knows about those bytes and offers the one action that can
/// change it.
class ViewerScreen extends StatefulWidget {
  const ViewerScreen({
    super.key,
    required this.assets,
    required this.initialIndex,
    required this.loadPreview,
    required this.loadDetail,
    required this.video,
    required this.onBackUpNow,
  });

  /// The grid's order as it was when the tile was tapped: paging stops at the
  /// ends of this snapshot instead of reading the library again.
  final List<AssetCandidate> assets;

  /// Asset to show first.
  final int initialIndex;

  /// Display-resolution preview for a library id, or null when there is none.
  final Future<Uint8List?> Function(String localId) loadPreview;

  /// Badge and last failure for one asset, read when a page settles.
  final Future<BackupDetail> Function(AssetCandidate asset) loadDetail;

  /// Bytes and player for video pages.
  final VideoSupport video;

  /// Queues the given assets and starts a pass.
  final Future<void> Function(List<AssetCandidate> assets) onBackUpNow;

  @override
  State<ViewerScreen> createState() => _ViewerScreenState();
}

class _ViewerScreenState extends State<ViewerScreen> {
  late final PageController _pages = PageController(
    initialPage: widget.initialIndex,
  );
  late int _index = widget.initialIndex;

  /// Backup state of the asset on screen, or null while it is being read.
  BackupDetail? _detail;

  /// True while the photo on screen is magnified: page swipes would pan the
  /// image instead, so the pager steps aside until it is back to fit.
  bool _zoomed = false;

  /// Fingers currently on the screen. The pager must not own a drag that is
  /// about to become a pinch, so it is locked as soon as the second finger
  /// lands and stays locked until every finger is up.
  int _touchPoints = 0;

  /// Latched by the first two-finger gesture; see [_touchPoints].
  bool _pinching = false;

  /// Playhead of every video already watched, keyed by library id. Session
  /// only: a clip the user left mid-way resumes where they left it.
  final Map<String, Duration> _resumePoints = <String, Duration>{};

  bool _busy = false;

  AssetCandidate get _asset => widget.assets[_index];

  @override
  void initState() {
    super.initState();
    unawaited(_loadDetail());
  }

  @override
  void dispose() {
    _pages.dispose();
    super.dispose();
  }

  /// A pointer that lands before the drag slop is reached decides the gesture:
  /// the pager would win a two-finger pinch otherwise, because its horizontal
  /// drag slop is half the scale slop.
  void _onPointerDown(PointerDownEvent _) {
    _touchPoints++;
    if (_touchPoints >= 2 && !_pinching) setState(() => _pinching = true);
  }

  void _onPointerUp(PointerEvent _) {
    if (_touchPoints > 0) _touchPoints--;
    // Unlock only when the hand is off the glass: a pinch ends by lifting one
    // finger, and a swipe must not start from the finger left behind.
    if (_touchPoints == 0 && _pinching) setState(() => _pinching = false);
  }

  void _onZoomChanged(bool zoomed) {
    if (zoomed == _zoomed) return;
    setState(() => _zoomed = zoomed);
  }

  Future<void> _loadDetail() async {
    final asset = _asset;
    final BackupDetail detail;
    try {
      detail = await widget.loadDetail(asset);
    } on Object {
      // A failed read keeps the bar as it was: it must not claim anything.
      return;
    }
    // The user may have swiped on while the query ran; a stale answer would
    // label the wrong photo.
    if (!mounted || _asset.localId != asset.localId) return;
    setState(() => _detail = detail);
  }

  void _onPageChanged(int index) {
    setState(() {
      _index = index;
      _detail = null;
      _zoomed = false;
    });
    unawaited(_loadDetail());
  }

  Future<void> _backUpNow() async {
    if (_busy) return;
    setState(() => _busy = true);
    try {
      await widget.onBackUpNow(<AssetCandidate>[_asset]);
    } on Object {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('Could not queue this photo. Try again.'),
          ),
        );
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
    await _loadDetail();
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final asset = _asset;

    return Scaffold(
      backgroundColor: Colors.black,
      appBar: AppBar(
        backgroundColor: Colors.black,
        foregroundColor: Colors.white,
        titleSpacing: 0,
        title: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisSize: MainAxisSize.min,
          children: <Widget>[
            Text(
              _stamp(asset),
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: theme.textTheme.titleMedium?.copyWith(
                color: Colors.white,
                fontWeight: FontWeight.w600,
              ),
            ),
            Text(
              asset.fileName,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: theme.textTheme.labelSmall?.copyWith(
                color: Colors.white70,
              ),
            ),
          ],
        ),
      ),
      body: Listener(
        onPointerDown: _onPointerDown,
        onPointerUp: _onPointerUp,
        onPointerCancel: _onPointerUp,
        child: PageView.builder(
          controller: _pages,
          // A locked pager still snaps and lays out; it just stops competing
          // for the gesture, which is what lets pinch and pan win.
          physics: _zoomed || _pinching
              ? const NeverScrollableScrollPhysics()
              : null,
          onPageChanged: _onPageChanged,
          itemCount: widget.assets.length,
          itemBuilder: (context, index) {
            final asset = widget.assets[index];
            if (asset.kind == MediaKind.video) {
              return _VideoPage(
                // Keyed by id: a page that survives a rebuild keeps its player
                // only for the asset it was opened on.
                key: ValueKey<String>(asset.localId),
                asset: asset,
                video: widget.video,
                poster: widget.loadPreview,
                resumeAt: _resumePoints[asset.localId] ?? Duration.zero,
                onPosition: (position) =>
                    _resumePoints[asset.localId] = position,
              );
            }
            return _PhotoPage(
              asset: asset,
              load: widget.loadPreview,
              onZoomChanged: _onZoomChanged,
            );
          },
        ),
      ),
      bottomNavigationBar: _StatusBar(
        detail: _detail,
        busy: _busy,
        onBackUpNow: _canBackUp ? _backUpNow : null,
      ),
    );
  }

  /// Only a photo the backup never took, or one that gave up, needs the action.
  bool get _canBackUp {
    final detail = _detail;
    return detail != null &&
        (detail.status == BackupStatus.unknown ||
            detail.status == BackupStatus.failed);
  }

  /// `12 May 2025 · 14:32`; the time is what tells same-day photos apart.
  String _stamp(AssetCandidate asset) {
    final at = asset.takenAt ?? asset.modifiedAt;
    if (at == null) return 'Undated';
    final hour = at.hour.toString().padLeft(2, '0');
    final minute = at.minute.toString().padLeft(2, '0');
    return '${at.day} ${monthAbbreviations[at.month - 1]} ${at.year} · $hour:$minute';
  }
}

/// One photo: the preview, pinch-zoomed and pannable, double-tap to toggle.
class _PhotoPage extends StatefulWidget {
  const _PhotoPage({
    required this.asset,
    required this.load,
    required this.onZoomChanged,
  });

  final AssetCandidate asset;
  final Future<Uint8List?> Function(String localId) load;

  /// Told when this page leaves or returns to fit, so the viewer can stop
  /// paging while the image is magnified.
  final void Function(bool zoomed) onZoomChanged;

  @override
  State<_PhotoPage> createState() => _PhotoPageState();
}

class _PhotoPageState extends State<_PhotoPage> {
  /// Magnification of a double tap: enough to read detail, small enough to keep
  /// the photo's framing.
  static const double _doubleTapScale = 2.5;

  /// The list is a snapshot, so one page keeps one asset for its lifetime.
  late final Future<Uint8List?> _bytes = widget.load(widget.asset.localId);

  final TransformationController _zoom = TransformationController();

  /// Where the last double tap landed, in this page's own coordinates.
  Offset? _doubleTapAt;

  /// True once the image is bigger than fit. Panning is only offered then:
  /// at fit it would swallow the horizontal swipe that changes photo.
  bool _zoomed = false;

  @override
  void dispose() {
    _zoom.dispose();
    super.dispose();
  }

  void _setZoomed(bool zoomed) {
    if (zoomed == _zoomed) return;
    setState(() => _zoomed = zoomed);
    widget.onZoomChanged(zoomed);
  }

  void _onInteractionEnd(ScaleEndDetails _) {
    // A pinch reports its own end; the matrix is the only truth.
    _setZoomed(_zoom.value.getMaxScaleOnAxis() > 1.01);
  }

  void _onDoubleTap() {
    final at = _doubleTapAt;
    if (_zoomed || at == null) {
      _zoom.value = Matrix4.identity();
      _setZoomed(false);
      return;
    }
    // Keep the tapped point under the finger: scale about it, not the corner.
    _zoom.value = Matrix4.identity()
      ..translateByDouble(
        at.dx * (1 - _doubleTapScale),
        at.dy * (1 - _doubleTapScale),
        0,
        1,
      )
      ..scaleByDouble(_doubleTapScale, _doubleTapScale, 1, 1);
    _setZoomed(true);
  }

  @override
  Widget build(BuildContext context) {
    return FutureBuilder<Uint8List?>(
      future: _bytes,
      builder: (context, snapshot) {
        final bytes = snapshot.data;
        final loading = snapshot.connectionState != ConnectionState.done;

        return Stack(
          fit: StackFit.expand,
          children: <Widget>[
            if (bytes == null || bytes.isEmpty)
              loading
                  ? const Center(
                      child: CircularProgressIndicator(
                        semanticsLabel: 'Loading photo',
                      ),
                    )
                  : const _Missing()
            else
              GestureDetector(
                onDoubleTapDown: (details) =>
                    _doubleTapAt = details.localPosition,
                onDoubleTap: _onDoubleTap,
                child: InteractiveViewer(
                  transformationController: _zoom,
                  minScale: 1,
                  maxScale: 4,
                  panEnabled: _zoomed,
                  onInteractionEnd: _onInteractionEnd,
                  child: Center(
                    child: Image.memory(
                      bytes,
                      fit: BoxFit.contain,
                      gaplessPlayback: true,
                      errorBuilder: (context, error, stack) => const _Missing(),
                    ),
                  ),
                ),
              ),
          ],
        );
      },
    );
  }
}

/// Stand-in when the platform has no preview for these bytes.
class _Missing extends StatelessWidget {
  const _Missing();

  @override
  Widget build(BuildContext context) {
    return const Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          Icon(Icons.image_not_supported_outlined, color: Colors.white54),
          SizedBox(height: 10),
          Text(
            'No preview available',
            style: TextStyle(color: Colors.white54, fontSize: 13),
          ),
        ],
      ),
    );
  }
}

/// One video: the poster until the first frame, then the platform's own player
/// with a tap-to-play surface, a timeline that can be scrubbed, and its own
/// failure state.
class _VideoPage extends StatefulWidget {
  const _VideoPage({
    super.key,
    required this.asset,
    required this.video,
    required this.poster,
    required this.resumeAt,
    required this.onPosition,
  });

  final AssetCandidate asset;

  /// Bytes and player factory supplied by the shell.
  final VideoSupport video;

  /// Encoded poster for the asset, shown before the first frame.
  final Future<Uint8List?> Function(String localId) poster;

  /// Playhead to restore when this page opens again.
  final Duration resumeAt;

  /// Reports the playhead as the page goes away.
  final void Function(Duration position) onPosition;

  @override
  State<_VideoPage> createState() => _VideoPageState();
}

class _VideoPageState extends State<_VideoPage> with WidgetsBindingObserver {
  late final Future<Uint8List?> _poster = widget.poster(widget.asset.localId);

  VideoPlayback? _playback;
  VideoPlaybackState _state = const VideoPlaybackState();

  /// iCloud download progress `0`..`1`, null once the file is on disk.
  double? _download;
  String? _error;
  bool _loading = true;
  bool _dragging = false;
  Duration _dragAt = Duration.zero;
  bool _disposed = false;

  /// Controls visibility. Tapping the picture toggles the chrome and nothing
  /// else: pausing is a decision the user makes on the controls themselves.
  bool _controls = true;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    unawaited(_start());
  }

  @override
  void dispose() {
    _disposed = true;
    WidgetsBinding.instance.removeObserver(this);
    final playback = _playback;
    _playback = null;
    if (playback != null) {
      widget.onPosition(playback.state.position);
      playback.removeListener(_onPlayback);
      playback.dispose();
    }
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    // No background audio: leaving the app stops the clip.
    if (state != AppLifecycleState.resumed) {
      unawaited(_playback?.pause() ?? Future<void>.value());
    }
  }

  Future<void> _start() async {
    File? file;
    try {
      file = await widget.video.loadFile(
        widget.asset.localId,
        onProgress: (progress) {
          if (!_disposed) setState(() => _download = progress);
        },
      );
    } on Object {
      file = null;
    }
    if (_disposed) return;
    if (file == null) {
      setState(() {
        _loading = false;
        _download = null;
        _error = 'Could not read this video from this device.';
      });
      return;
    }

    final playback = widget.video.createPlayback();
    _playback = playback..addListener(_onPlayback);
    await playback.load(file);
    if (_disposed) {
      playback.dispose();
      return;
    }
    if (widget.resumeAt > Duration.zero) await playback.seek(widget.resumeAt);
    if (_disposed) return;
    setState(() {
      _loading = false;
      _download = null;
      _state = playback.state;
    });
  }

  void _onPlayback() {
    final playback = _playback;
    if (_disposed || playback == null) return;
    final stopped = _state.playing && !playback.state.playing;
    setState(() {
      _state = playback.state;
      // A clip that ran to its end must not leave a dead-looking frame with
      // no way back in.
      if (stopped) _controls = true;
    });
  }

  Future<void> _toggle() async {
    final playback = _playback;
    if (playback == null) return;
    if (_state.playing) {
      await playback.pause();
    } else {
      await playback.play();
    }
  }

  @override
  Widget build(BuildContext context) {
    final surface = _playback?.surface;
    final duration = _state.duration;
    final error = _state.error ?? _error;

    return Stack(
      fit: StackFit.expand,
      children: <Widget>[
        _Poster(bytes: _poster),
        ?surface,
        if (error != null)
          _VideoError(message: error, onRetry: () => unawaited(_restart()))
        else if (_loading)
          _VideoLoading(download: _download)
        else ...<Widget>[
          // Above the surface, below the controls: the tap target must not
          // swallow a slider drag, and it never stops the clip.
          Positioned.fill(
            child: Semantics(
              button: true,
              label: _controls ? 'Hide controls' : 'Show controls',
              child: GestureDetector(
                key: const Key('viewer-video-toggle'),
                behavior: HitTestBehavior.opaque,
                onTap: () => setState(() => _controls = !_controls),
              ),
            ),
          ),
          // The centre button starts the clip; stopping is a decision the user
          // makes on the bar, never by tapping the picture.
          if (_controls && !_state.playing)
            Center(
              child: Semantics(
                button: true,
                label: 'Play',
                child: GestureDetector(
                  key: const Key('viewer-video-play-glyph'),
                  onTap: () => unawaited(_toggle()),
                  child: const _PlayGlyph(),
                ),
              ),
            ),
          if (_controls)
            Positioned(
              left: 12,
              right: 12,
              bottom: 8,
              child: _VideoTimeline(
                playing: _state.playing,
                position: _dragging ? _dragAt : _state.position,
                duration: duration,
                onToggle: () => unawaited(_toggle()),
                onStart: () => setState(() {
                  _dragging = true;
                  _dragAt = _state.position;
                }),
                onChanged: (value) => setState(() => _dragAt = value),
                onEnd: (value) {
                  setState(() {
                    _dragging = false;
                    _dragAt = value;
                  });
                  unawaited(_playback?.seek(value) ?? Future<void>.value());
                },
              ),
            ),
        ],
      ],
    );
  }

  /// Re-runs the whole pipeline: file, player, seek.
  Future<void> _restart() async {
    _playback?.removeListener(_onPlayback);
    _playback?.dispose();
    _playback = null;
    setState(() {
      _state = const VideoPlaybackState();
      _error = null;
      _loading = true;
    });
    await _start();
  }
}

/// Poster frame: stays under the surface so there is no black flash.
class _Poster extends StatelessWidget {
  const _Poster({required this.bytes});

  final Future<Uint8List?> bytes;

  @override
  Widget build(BuildContext context) {
    return FutureBuilder<Uint8List?>(
      future: bytes,
      builder: (context, snapshot) {
        final data = snapshot.data;
        if (data == null || data.isEmpty) {
          // A missing poster is not an error: the surface or the spinner
          // already explains what is happening.
          return const SizedBox.shrink();
        }
        return Image.memory(
          data,
          fit: BoxFit.contain,
          gaplessPlayback: true,
          errorBuilder: (context, error, stack) => const SizedBox.shrink(),
        );
      },
    );
  }
}

/// Waiting state: an iCloud fetch says how far it got, a local read does not.
class _VideoLoading extends StatelessWidget {
  const _VideoLoading({this.download});

  final double? download;

  @override
  Widget build(BuildContext context) {
    final value = download;
    return Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          SizedBox.square(
            dimension: 26,
            child: CircularProgressIndicator(
              value: value,
              strokeWidth: 2.2,
              semanticsLabel: 'Loading video',
            ),
          ),
          const SizedBox(height: 12),
          Text(
            value == null
                ? 'Opening video…'
                : 'Downloading from iCloud · ${(value * 100).round()}%',
            style: const TextStyle(color: Colors.white70, fontSize: 13),
          ),
        ],
      ),
    );
  }
}

/// Playback failed: say so once and offer the one useful action.
class _VideoError extends StatelessWidget {
  const _VideoError({required this.message, required this.onRetry});

  final String message;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: <Widget>[
            const Icon(
              Icons.videocam_off_outlined,
              color: Colors.white54,
              size: 28,
            ),
            const SizedBox(height: 10),
            Text(
              message,
              textAlign: TextAlign.center,
              style: const TextStyle(color: Colors.white70, fontSize: 13),
            ),
            const SizedBox(height: 8),
            TextButton(
              key: const Key('viewer-video-retry'),
              onPressed: onRetry,
              child: const Text('Try again'),
            ),
          ],
        ),
      ),
    );
  }
}

/// Play glyph shown while paused; tapping it starts the clip.
class _PlayGlyph extends StatelessWidget {
  const _PlayGlyph();

  @override
  Widget build(BuildContext context) {
    return DecoratedBox(
      decoration: const BoxDecoration(
        color: Color(0x8C000000),
        shape: BoxShape.circle,
      ),
      child: const Padding(
        padding: EdgeInsets.all(14),
        child: Icon(Icons.play_arrow_rounded, size: 38, color: Colors.white),
      ),
    );
  }
}

/// Scrubber plus elapsed/total. A slider, so a drag seeks instead of paging.
class _VideoTimeline extends StatelessWidget {
  const _VideoTimeline({
    required this.playing,
    required this.position,
    required this.duration,
    required this.onToggle,
    required this.onStart,
    required this.onChanged,
    required this.onEnd,
  });

  final bool playing;
  final Duration position;
  final Duration duration;
  final VoidCallback onToggle;
  final VoidCallback onStart;
  final void Function(Duration position) onChanged;
  final void Function(Duration position) onEnd;

  @override
  Widget build(BuildContext context) {
    final ready = duration > Duration.zero;
    final fraction = ready
        ? (position.inMilliseconds / duration.inMilliseconds).clamp(0.0, 1.0)
        : 0.0;

    return DecoratedBox(
      decoration: const BoxDecoration(
        color: Color(0x8C000000),
        borderRadius: BorderRadius.all(Radius.circular(14)),
      ),
      child: Padding(
        padding: const EdgeInsets.fromLTRB(8, 2, 12, 2),
        child: Row(
          children: <Widget>[
            // Play/pause lives at the head of the bar: the page-wide tap
            // target is invisible, this is the affordance that says so.
            IconButton(
              key: const Key('viewer-video-play-button'),
              onPressed: onToggle,
              tooltip: playing ? 'Pause' : 'Play',
              iconSize: 22,
              color: Colors.white,
              padding: EdgeInsets.zero,
              icon: Icon(
                playing ? Icons.pause_rounded : Icons.play_arrow_rounded,
              ),
            ),
            Text(
              _clock(position),
              style: const TextStyle(color: Colors.white70, fontSize: 12),
            ),
            Expanded(
              child: Slider(
                key: const Key('viewer-video-scrubber'),
                value: fraction,
                onChangeStart: ready ? (_) => onStart() : null,
                onChanged: ready
                    ? (value) => onChanged(duration * value)
                    : null,
                onChangeEnd: ready ? (value) => onEnd(duration * value) : null,
              ),
            ),
            Text(
              _clock(duration),
              style: const TextStyle(color: Colors.white70, fontSize: 12),
            ),
          ],
        ),
      ),
    );
  }

  /// `0:07`, or `1:02:03` for anything past an hour.
  static String _clock(Duration value) {
    final total = value.inSeconds;
    final seconds = (total % 60).toString().padLeft(2, '0');
    final minutes = (total ~/ 60) % 60;
    if (total < 3600) return '$minutes:$seconds';
    final hours = total ~/ 3600;
    return '$hours:${minutes.toString().padLeft(2, '0')}:$seconds';
  }
}

/// What the backup knows about the photo on screen, and the one action left.
class _StatusBar extends StatelessWidget {
  const _StatusBar({
    required this.detail,
    required this.busy,
    required this.onBackUpNow,
  });

  /// Null while the queue is still being asked.
  final BackupDetail? detail;

  /// True while the tap's pass is being started.
  final bool busy;

  /// Null when there is nothing to queue.
  final Future<void> Function()? onBackUpNow;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final value = detail;

    return ColoredBox(
      color: Colors.black,
      child: SafeArea(
        top: false,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(16, 10, 12, 10),
          child: Row(
            children: <Widget>[
              if (value != null) StatusBadge(status: value.status),
              const SizedBox(width: 10),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisSize: MainAxisSize.min,
                  children: <Widget>[
                    Text(
                      value == null ? '' : _sentence(value.status),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: theme.textTheme.labelLarge?.copyWith(
                        color: Colors.white,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                    ..._hintLines(theme, value),
                  ],
                ),
              ),
              if (onBackUpNow != null)
                TextButton(
                  key: const Key('viewer-back-up-now'),
                  onPressed: busy ? null : () => unawaited(onBackUpNow!()),
                  child: const Text('Back up now'),
                ),
            ],
          ),
        ),
      ),
    );
  }

  static String _sentence(BackupStatus status) {
    return switch (status) {
      BackupStatus.backedUp => 'Backed up from this phone',
      BackupStatus.uploading => 'Uploading now',
      BackupStatus.queued => 'Waiting to back up',
      BackupStatus.failed => 'Backup failed',
      BackupStatus.excluded => 'Not in backup scope',
      BackupStatus.unknown => 'Not backed up yet',
    };
  }

  /// One quiet line under the label, only when there is something to explain.
  static List<Widget> _hintLines(ThemeData theme, BackupDetail? value) {
    if (value == null) return const <Widget>[];
    final hint = switch (value.status) {
      BackupStatus.failed => value.error ?? 'The server rejected this file.',
      BackupStatus.excluded =>
        'PhotoX cannot back up this kind of file, or videos are off in '
            'Settings.',
      BackupStatus.unknown => 'This phone has not uploaded these bytes.',
      _ => null,
    };
    if (hint == null) return const <Widget>[];
    return <Widget>[
      Text(
        hint,
        maxLines: 2,
        overflow: TextOverflow.ellipsis,
        style: theme.textTheme.bodySmall?.copyWith(
          color: value.status == BackupStatus.failed
              ? theme.colorScheme.error
              : Colors.white60,
        ),
      ),
    ];
  }
}
