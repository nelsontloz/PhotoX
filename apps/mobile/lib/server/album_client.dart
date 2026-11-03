import 'dart:math' show min;

import '../core/api_client.dart';
import '../core/json_read.dart';

/// One album on the server, reduced to what the folder mapping needs.
class ServerAlbum {
  const ServerAlbum({
    required this.id,
    required this.name,
    required this.assetCount,
    required this.hiddenFromTimeline,
  });

  factory ServerAlbum.fromJson(Map<String, dynamic> json) {
    return ServerAlbum(
      id: requireString(json, 'id', 'ServerAlbum'),
      name: requireString(json, 'name', 'ServerAlbum'),
      assetCount: requireInt(json, 'assetCount', 'ServerAlbum'),
      hiddenFromTimeline: requireBool(
        json,
        'hiddenFromTimeline',
        'ServerAlbum',
      ),
    );
  }

  /// Server-side album id, the value a folder mapping stores.
  final String id;

  /// Name shown in the folder sheet.
  final String name;

  /// Non-trashed assets the server counts in this album.
  final int assetCount;

  /// True when the album's assets are kept out of the server timeline.
  final bool hiddenFromTimeline;
}

/// Creates server albums and adds already-uploaded assets to them.
///
/// This is what makes a device folder's uploads land in an album: the sync pass
/// resolves a queued row's folder to an album id and posts the asset ids here.
/// The server ignores duplicates, so re-posting a row that already joined is
/// safe and a retried pass costs nothing.
class AlbumClient {
  AlbumClient(this.api);

  final ApiClient api;

  /// Largest album page the core API accepts.
  static const int maxLimit = 1000;

  /// Ids per add call, the cap `AddAssetsBodyDto` enforces.
  static const int maxAssetsPerCall = 100;

  /// Every album the account owns.
  ///
  /// shortcut: one page covers a normal account; page it if an account ever
  /// holds more than [maxLimit] albums.
  Future<List<ServerAlbum>> list() async {
    final json = await api.get<Map<String, dynamic>>(
      '/api/v1/albums',
      queryParameters: <String, dynamic>{'limit': maxLimit, 'offset': 0},
    );
    return ApiClient.parseResponse(() {
      final items = json['items'];
      if (items is! List) {
        throw const FormatException('AlbumListResponse.items must be a list');
      }
      return <ServerAlbum>[
        for (final item in items)
          ServerAlbum.fromJson((item as Map).cast<String, dynamic>()),
      ];
    }, context: 'GET /api/v1/albums response');
  }

  /// Creates one album, optionally keeping its assets off the timeline.
  Future<ServerAlbum> create(
    String name, {
    required bool hiddenFromTimeline,
  }) async {
    final json = await api.post<Map<String, dynamic>>(
      '/api/v1/albums',
      data: <String, dynamic>{
        'name': name,
        'hiddenFromTimeline': hiddenFromTimeline,
      },
    );
    return ApiClient.parseResponse(
      () => ServerAlbum.fromJson(json),
      context: 'POST /api/v1/albums response',
    );
  }

  /// Whether [albumId] still exists on the server.
  ///
  /// The disambiguator for [addAssets]' 404: core returns it both when the
  /// album is gone and when any one asset id in the batch is.
  Future<bool> exists(String albumId) async {
    try {
      await api.get<Map<String, dynamic>>('/api/v1/albums/$albumId');
      return true;
    } on ApiException catch (error) {
      if (error.statusCode == 404) return false;
      rethrow;
    }
  }

  /// Adds [assetIds] to [albumId], chunked to the per-request cap.
  Future<void> addAssets(String albumId, List<String> assetIds) async {
    for (var start = 0; start < assetIds.length; start += maxAssetsPerCall) {
      await api.post<Map<String, dynamic>>(
        '/api/v1/albums/$albumId/assets',
        data: <String, dynamic>{
          'assetIds': assetIds.sublist(
            start,
            min(start + maxAssetsPerCall, assetIds.length),
          ),
        },
      );
    }
  }
}
