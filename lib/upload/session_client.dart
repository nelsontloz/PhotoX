import 'dart:typed_data';

import 'package:crypto/crypto.dart';
import 'package:dio/dio.dart';

import '../core/api_client.dart';
import '../core/app_config.dart';
import 'models.dart';

/// Client for the resumable part-based upload session API.
class SessionClient {
  SessionClient(this.api);

  static final RegExp _sha256HexPattern = RegExp(r'^[0-9a-fA-F]{64}$');

  /// Signed transport used for every session call.
  final ApiClient api;

  /// Opens a session for a file whose bytes hash to [sha256Hex].
  ///
  /// The server fixes the part size at 8 MiB; only whitelisted body fields are
  /// sent (`forbidNonWhitelisted` rejects anything else).
  Future<CreateSessionResult> createSession({
    required String sha256Hex,
    required int sizeBytes,
    required String filename,
    String? mimeHint,
    DateTime? takenAt,
    String? title,
    String? description,
  }) async {
    if (sizeBytes < 1 || sizeBytes > AppConfig.maxUploadSizeBytes) {
      throw ArgumentError.value(
        sizeBytes,
        'sizeBytes',
        'must be between 1 and ${AppConfig.maxUploadSizeBytes} bytes',
      );
    }
    if (sha256Hex.isNotEmpty && !_sha256HexPattern.hasMatch(sha256Hex)) {
      throw ArgumentError.value(
        sha256Hex,
        'sha256Hex',
        'must be 64 hexadecimal characters',
      );
    }
    final body = <String, dynamic>{
      'sizeBytes': sizeBytes,
      'originalName': filename,
      if (sha256Hex.isNotEmpty) 'checksumSha256': sha256Hex.toLowerCase(),
      'mimeHint': ?mimeHint,
      'title': ?title,
      'description': ?description,
      if (takenAt != null) 'takenAt': takenAt.toUtc().toIso8601String(),
    };
    final json = await api.post<Map<String, dynamic>>(
      '/api/v1/uploads',
      data: body,
    );
    return ApiClient.parseResponse(
      () => CreateSessionResult.fromJson(json),
      context: 'POST /api/v1/uploads response',
    );
  }

  /// Reads the server view of a session so a restart can skip received parts.
  ///
  /// A 410 means the session expired and must be recreated.
  Future<UploadSessionStatus> getStatus(String uploadId) async {
    final json = await api.get<Map<String, dynamic>>(
      '/api/v1/uploads/$uploadId',
    );
    return ApiClient.parseResponse(
      () => UploadSessionStatus.fromJson(json),
      context: 'GET /api/v1/uploads/$uploadId response',
    );
  }

  /// Uploads one raw part; repeating a successful index is idempotent.
  ///
  /// The part digest is computed from [bytes] unless [sha256Hex] is supplied,
  /// and sent as `X-Part-Sha256` so the server rejects corrupt transport.
  Future<void> putPart(
    String uploadId,
    int partIndex, {
    required List<int> bytes,
    String? sha256Hex,
  }) async {
    final payload = bytes is Uint8List ? bytes : Uint8List.fromList(bytes);
    final digest = sha256Hex ?? sha256.convert(payload).toString();
    await api.put<dynamic>(
      '/api/v1/uploads/$uploadId/parts/$partIndex',
      data: payload,
      options: Options(
        contentType: 'application/octet-stream',
        headers: <String, dynamic>{
          Headers.contentLengthHeader: payload.length,
          'X-Part-Sha256': digest.toLowerCase(),
        },
      ),
    );
  }

  /// Completes the session; a 409 carries the missing part indices.
  Future<UploadCompleteResult> complete(String uploadId) async {
    final json = await api.post<Map<String, dynamic>>(
      '/api/v1/uploads/$uploadId/complete',
    );
    return ApiClient.parseResponse(
      () => UploadCompleteResult.fromJson(json),
      context: 'POST /api/v1/uploads/$uploadId/complete response',
    );
  }

  /// Abandons a session whose bytes are no longer needed.
  ///
  /// The server treats a missing or expired session as already aborted.
  Future<void> abort(String uploadId) async {
    try {
      await api.delete('/api/v1/uploads/$uploadId');
    } on ApiException catch (error) {
      if (error.statusCode == 404 || error.statusCode == 410) return;
      rethrow;
    }
  }
}
