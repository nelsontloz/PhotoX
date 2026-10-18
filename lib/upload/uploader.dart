import '../core/api_client.dart';
import 'database.dart';
import 'session_client.dart';
import 'upload_queue.dart';

/// Runs one queued asset through the whole upload pipeline.
class Uploader {
  const Uploader({
    required this.queue,
    required this.sessions,
    required this.api,
  });

  /// Queue writes for this asset.
  final UploadQueue queue;

  /// Session API client used for the resumable path.
  final SessionClient sessions;

  /// Transport used for the single-request path.
  final ApiClient api;

  /// Hashing, dedup pre-check, then the upload path chosen by asset size.
  Future<void> process(QueuedAsset item) {
    // TODO(spec §0 D3, §3.4): pick single vs session via
    // AppConfig.singleUploadThresholdBytes, then retry/backoff per §3.6.
    throw UnimplementedError('Uploader.process');
  }
}
