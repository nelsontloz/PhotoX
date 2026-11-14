import 'dart:io';

import 'package:flutter/material.dart';
import 'package:photox_mobile/media/video_playback.dart';
import 'package:video_player/video_player.dart';

/// [VideoPlayback] with no platform behind it: records calls and lets a test
/// push values, so the viewer's video behaviour is testable off-device.
class FakeVideoPlayback extends VideoPlayback {
  /// Every call in order, e.g. `load`, `play`, `seek:5`, `dispose`.
  final List<String> calls = <String>[];

  /// File handed to [load], for assertions about the resolved bytes.
  File? loaded;

  VideoPlayerValue _value = const VideoPlayerValue.uninitialized();

  @override
  VideoPlayerValue get value => _value;

  @override
  Widget? get surface =>
      _value.isInitialized ? const ColoredBox(color: Colors.black) : null;

  /// Pushes a value as the platform player would.
  void emit(VideoPlayerValue next) {
    _value = next;
    notifyListeners();
  }

  @override
  Future<void> load(File file) async {
    calls.add('load');
    loaded = file;
    emit(
      const VideoPlayerValue(
        isInitialized: true,
        duration: Duration(seconds: 30),
      ),
    );
  }

  @override
  Future<void> play() async {
    calls.add('play');
    emit(
      VideoPlayerValue(
        isInitialized: true,
        isPlaying: true,
        position: _value.position,
        duration: _value.duration,
      ),
    );
  }

  @override
  Future<void> pause() async {
    calls.add('pause');
    emit(
      VideoPlayerValue(
        isInitialized: true,
        position: _value.position,
        duration: _value.duration,
      ),
    );
  }

  @override
  Future<void> seek(Duration position) async {
    calls.add('seek:${position.inSeconds}');
    emit(
      VideoPlayerValue(
        isInitialized: true,
        isPlaying: _value.isPlaying,
        position: position,
        duration: _value.duration,
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
