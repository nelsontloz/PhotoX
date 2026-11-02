import 'dart:io';

import 'package:flutter/material.dart';
import 'package:photox_mobile/media/video_playback.dart';

/// [VideoPlayback] with no platform behind it: records calls and lets a test
/// push states, so the viewer's video behaviour is testable off-device.
class FakeVideoPlayback extends VideoPlayback {
  /// Every call in order, e.g. `load`, `play`, `seek:5`, `dispose`.
  final List<String> calls = <String>[];

  /// File handed to [load], for assertions about the resolved bytes.
  File? loaded;

  VideoPlaybackState _state = const VideoPlaybackState();

  @override
  VideoPlaybackState get state => _state;

  @override
  Widget? get surface =>
      _state.ready ? const ColoredBox(color: Colors.black) : null;

  /// Pushes a state as the platform player would.
  void emit(VideoPlaybackState next) {
    _state = next;
    notifyListeners();
  }

  @override
  Future<void> load(File file) async {
    calls.add('load');
    loaded = file;
    emit(
      const VideoPlaybackState(ready: true, duration: Duration(seconds: 30)),
    );
  }

  @override
  Future<void> play() async {
    calls.add('play');
    emit(
      VideoPlaybackState(
        ready: true,
        playing: true,
        position: _state.position,
        duration: _state.duration,
      ),
    );
  }

  @override
  Future<void> pause() async {
    calls.add('pause');
    emit(
      VideoPlaybackState(
        ready: true,
        position: _state.position,
        duration: _state.duration,
      ),
    );
  }

  @override
  Future<void> seek(Duration position) async {
    calls.add('seek:${position.inSeconds}');
    emit(
      VideoPlaybackState(
        ready: true,
        playing: _state.playing,
        position: position,
        duration: _state.duration,
      ),
    );
  }

  @override
  void dispose() {
    calls.add('dispose');
    super.dispose();
  }
}

/// Support bound to one fake per page, keeping them in [created].
class FakeVideoSupport {
  FakeVideoSupport({this.file, this.readFailure = false});

  /// Bytes the platform "produces"; null means no file was available.
  final File? file;

  /// When true, [loadFile] throws instead of returning.
  final bool readFailure;

  /// Every player the viewer asked for, in creation order.
  final List<FakeVideoPlayback> created = <FakeVideoPlayback>[];

  /// Progress values reported through the iCloud download hook.
  final List<double> progress = <double>[];

  FakeVideoPlayback get latest => created.last;

  VideoSupport get support => VideoSupport(
    loadFile: (localId, {onProgress}) async {
      onProgress?.call(0.5);
      progress.add(0.5);
      if (readFailure) throw const FileSystemException('gone');
      return file ?? File('/tmp/fake-$localId.mov');
    },
    createPlayback: () {
      final playback = FakeVideoPlayback();
      created.add(playback);
      return playback;
    },
  );
}
