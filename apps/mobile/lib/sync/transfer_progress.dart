import 'package:flutter/foundation.dart';

/// What the pipeline is doing with the one asset it is handling.
enum TransferPhase {
  /// Nothing in flight.
  idle,

  /// Copying the exact bytes to the spool and hashing them.
  preparing,

  /// Sending bytes to the server.
  uploading,
}

/// Live progress of the asset currently in flight, for the home screen.
///
/// Uploads are strictly sequential (one asset at a time), so a single slot is
/// enough: whoever starts a transfer calls [begin], the transport reports
/// cumulative bytes through [advance], and the end is marked with [finish].
class TransferProgress extends ChangeNotifier {
  TransferProgress({
    DateTime Function()? clock,
    this.notifyInterval = const Duration(milliseconds: 200),
  }) : _clock = clock ?? DateTime.now;

  /// Minimum gap between [notifyListeners] calls while bytes stream in.
  final Duration notifyInterval;

  final DateTime Function() _clock;

  /// Samples older than this do not count towards the speed estimate.
  static const Duration _speedWindow = Duration(seconds: 3);

  final List<({DateTime at, int sent})> _samples =
      <({DateTime at, int sent})>[];
  DateTime _lastNotify = DateTime.fromMillisecondsSinceEpoch(0);

  TransferPhase _phase = TransferPhase.idle;
  String? _localId;
  String? _fileName;
  int _totalBytes = 0;
  int _sentBytes = 0;
  double _speed = 0;

  /// Number of transfers finished so far; lets a listener refresh queue counts.
  int completedTransfers = 0;

  TransferPhase get phase => _phase;

  /// Platform id of the asset in flight, or null when idle.
  String? get localId => _localId;

  /// Display name of the asset in flight, or null when idle.
  String? get fileName => _fileName;

  int get totalBytes => _totalBytes;

  int get sentBytes => _sentBytes;

  /// True while an asset is being prepared or uploaded.
  bool get active => _phase != TransferPhase.idle;

  /// Completed fraction, `0`..`1`; `0` while not uploading so the UI can show
  /// an indeterminate bar for [TransferPhase.preparing].
  double get fraction {
    if (_totalBytes <= 0) return 0;
    final value = _sentBytes / _totalBytes;
    return value.isNaN ? 0 : value.clamp(0.0, 1.0);
  }

  /// Bytes per second over the recent window, `0` when not measured yet.
  double get speedBytesPerSecond => _speed;

  /// Starts tracking [localId]; resets counters and the speed window.
  void begin({
    required String localId,
    required String fileName,
    required int totalBytes,
    required TransferPhase phase,
  }) {
    _localId = localId;
    _fileName = fileName;
    _totalBytes = totalBytes < 0 ? 0 : totalBytes;
    _sentBytes = 0;
    _speed = 0;
    _phase = phase;
    _samples.clear();
    _samples.add((at: _clock(), sent: 0));
    _notify(force: true);
  }

  /// Reports cumulative bytes handled (read for preparing, sent for uploading).
  void advance(int sentBytes) {
    if (_phase == TransferPhase.idle) return;
    final sent = sentBytes < 0 ? 0 : sentBytes;
    if (sent == _sentBytes) return;
    _sentBytes = sent;
    final at = _clock();
    _samples.add((at: at, sent: sent));
    // Keep the window short enough to react to a stalled link.
    _samples.removeWhere(
      (sample) =>
          at.difference(sample.at) > _speedWindow && sample.sent != sent,
    );
    _speed = _measureSpeed(at);
    _notify();
  }

  /// Marks the current transfer done; the last name stays for the caller to
  /// read until the next [begin].
  void finish() {
    if (_phase == TransferPhase.idle) return;
    _phase = TransferPhase.idle;
    _speed = 0;
    _samples.clear();
    completedTransfers++;
    _notify(force: true);
  }

  /// Forgets the transfer in flight and the completed counter (new account).
  void reset() {
    _phase = TransferPhase.idle;
    _localId = null;
    _fileName = null;
    _totalBytes = 0;
    _sentBytes = 0;
    _speed = 0;
    _samples.clear();
    completedTransfers = 0;
    _notify(force: true);
  }

  double _measureSpeed(DateTime now) {
    if (_samples.length < 2) return 0;
    final first = _samples.first;
    final seconds = now.difference(first.at).inMilliseconds / 1000;
    if (seconds < 0.2) return 0;
    final bytes = _samples.last.sent - first.sent;
    if (bytes <= 0) return 0;
    return bytes / seconds;
  }

  /// Notifies at most every [notifyInterval] unless [force] is set, so a fast
  /// link does not rebuild the UI per network chunk.
  void _notify({bool force = false}) {
    final now = _clock();
    if (!force && now.difference(_lastNotify) < notifyInterval) return;
    _lastNotify = now;
    notifyListeners();
  }
}
