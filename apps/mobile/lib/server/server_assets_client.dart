import 'dart:typed_data';

import '../core/api_client.dart';
import 'server_asset.dart';

/// Read-only access to the server's asset library, for the merged grid.
///
/// Core has no "whole library with ids" call: `GET /assets/layout` carries no
/// asset id, and `GET /assets` caps `limit` at 100. The merged timeline
/// therefore pages this list by date, newest first, exactly like the web's
/// month windows do.
class ServerAssetsClient {
  ServerAssetsClient(this.api);

  final ApiClient api;

  /// Largest page the core API accepts.
  static const int maxLimit = 100;

  /// One page of assets, newest first.
  ///
  /// [dateTo] is an exclusive upper bound on `COALESCE(takenAt, uploadedAt)`,
  /// which is how the caller walks further back without a date window.
  Future<ServerAssetPage> list({
    DateTime? dateFrom,
    DateTime? dateTo,
    int limit = maxLimit,
    int offset = 0,
  }) async {
    final json = await api.get<Map<String, dynamic>>(
      '/api/v1/assets',
      queryParameters: <String, dynamic>{
        'limit': limit,
        'offset': offset,
        if (dateFrom != null) 'dateFrom': dateFrom.toUtc().toIso8601String(),
        if (dateTo != null) 'dateTo': dateTo.toUtc().toIso8601String(),
      },
    );
    return ApiClient.parseResponse(
      () {
        final items = json['items'];
        if (items is! List) {
          throw const FormatException('AssetListResponse.items must be a list');
        }
        return ServerAssetPage(
          items: <ServerAsset>[
            for (final item in items)
              ServerAsset.fromJson((item as Map).cast<String, dynamic>()),
          ],
          total: json['total'] is num
              ? (json['total'] as num).toInt()
              : items.length,
        );
      },
      context: 'GET /api/v1/assets response',
    );
  }

  /// Bytes of one server file (a thumbnail, for now), or null when the file is
  /// gone.
  Future<Uint8List?> thumbnail(String fileId) async {
    try {
      return await api.getBytes('/api/v1/files/$fileId/stream');
    } on ApiException catch (error) {
      if (error.statusCode == 404) return null;
      rethrow;
    }
  }
}
