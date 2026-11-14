import 'dart:async';
import 'dart:io';

import 'package:flutter/widgets.dart';
import 'package:video_player/video_player.dart';
import 'package:wakelock_plus/wakelock_plus.dart';

/// One video behind an interface.
///
/// The viewer drives a [VideoPlayback] and never touches a player plugin
/// directly, so its state machine is testable off-device and the engine can be
/// swapped (for example `fvp` over `video_player`) without touching the UI.
abstract class VideoPlayback extends ChangeNotifier {
  /// Latest player value; also pushed through [notifyListeners].
  VideoPlayerValue get value;

  /// Opens [file] and decodes its first frame.
  Future<void> load(File file);

  Future<void> play();
  Future<void> pause();
  Future<void> seek(Duration position);

  /// The player surface, or null until the first frame is ready.
  Widget? get surface;
}

/// The bytes and the engine the viewer needs, bundled so a screen passes one
/// dependency instead of two callbacks.
class VideoSupport {
  const VideoSupport({required this.loadFile, required this.createPlayback});

  /// Playable bytes for a library id, or null when there are none.
  final Future<File?> Function(
    String localId, {
    void Function(double progress)? onProgress,
  })
  loadFile;

  /// A fresh, unloaded player for one page.
  final VideoPlayback Function() createPlayback;
}

/// [VideoPlayback] on the platform's own player: AVPlayer on iOS, Media3 on
/// Android. Those are the decoders that produced the file in the first place.
class VideoPlayerPlayback extends VideoPlayback {
  VideoPlayerController? _controller;
  VideoPlayerValue _last = const VideoPlayerValue.uninitialized();
  String? _failure;
  bool _disposed = false;
  bool _awake = false;

  @override
  VideoPlayerValue get value {
    final failure = _failure;
    if (failure != null) return VideoPlayerValue.erroneous(failure);
    return _controller?.value ?? const VideoPlayerValue.uninitialized();
  }

  @override
  Widget? get surface {
    final controller = _controller;
    if (controller == null || !controller.value.isInitialized) return null;
    return VideoPlayer(controller);
  }

  @override
  Future<void> load(File file) async {
    final controller = VideoPlayerController.file(
      file,
      // The video is the only sound the user asked for: take audio focus
      // instead of mixing with whatever else is playing.
      videoPlayerOptions: VideoPlayerOptions(mixWithOthers: false),
    );
    _controller = controller;
    controller.addListener(_onTick);
    try {
      await controller.initialize();
    } on Object {
      _failure = 'This video could not be played.';
      _onTick();
      return;
    }
    if (_disposed) {
      await controller.dispose();
      return;
    }
    _onTick();
  }

  @override
  Future<void> play() async {
    final controller = _controller;
    if (controller == null) return;
    final value = controller.value;
    // Tapping play at the end restarts instead of doing nothing.
    if (value.isInitialized &&
        value.duration > Duration.zero &&
        value.position >= value.duration) {
      await controller.seekTo(Duration.zero);
    }
    await controller.play();
    await _keepAwake(true);
  }

  @override
  Future<void> pause() async {
    await _controller?.pause();
    await _keepAwake(false);
  }

  @override
  Future<void> seek(Duration position) =>
      _controller?.seekTo(position) ?? Future<void>.value();

  @override
  void dispose() {
    _disposed = true;
    _controller?.removeListener(_onTick);
    final controller = _controller;
    _controller = null;
    unawaited(controller?.dispose() ?? Future<void>.value());
    unawaited(_keepAwake(false));
    super.dispose();
  }

  void _onTick() {
    if (_disposed) return;
    final next = value;
    // A finished video stops the clock: let the screen sleep again.
    if (!next.isPlaying) unawaited(_keepAwake(false));
    if (next == _last) return;
    _last = next;
    notifyListeners();
  }

  /// Keeps the screen on while a video runs: a phone that locks mid-clip hides
  /// the thing the user asked to watch.
  Future<void> _keepAwake(bool awake) async {
    if (_awake == awake) return;
    _awake = awake;
    try {
      await WakelockPlus.toggle(enable: awake);
    } on Object {
      // Missing platform support is not a playback failure.
    }
  }
}
