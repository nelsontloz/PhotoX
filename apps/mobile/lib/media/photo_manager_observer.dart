import 'dart:async';
import 'dart:io';
import 'dart:typed_data';

import 'package:flutter/services.dart' show MethodCall;
import 'package:photo_manager/photo_manager.dart';

import 'media_filter.dart';
import 'photo_observer.dart';

/// [PhotoObserver] backed by the `photo_manager` plugin (PhotoKit/MediaStore).
class PhotoManagerObserver implements PhotoObserver {
  PhotoManagerObserver({
    this.pageSize = 200,
    this.filter = const MediaFilter(),
  }) {
    PhotoManager.addChangeCallback(_onChange);
    // Without this the platform never calls back, so the folder/path caches
    // would outlive an album created or deleted by another app.
    unawaited(PhotoManager.startChangeNotify());
  }

  /// Assets fetched per page; a short page ends the scan.
  final int pageSize;

  /// Client-side container/MIME filter used to describe candidates.
  final MediaFilter filter;

  final StreamController<void> _changes = StreamController<void>.broadcast();

  /// Files materialised by the current [scanNew] pass, keyed by asset id.
  ///
  /// [Uploader.prepare] asks [fileFor] for the same bytes right after a scan.
  /// Keeping the path avoids a second PhotoKit/MediaStore export for assets
  /// whose bytes are already on disk. Cleared at the start of every scan.
  final Map<String, File> _scanFiles = <String, File>{};

  /// Folder listing memoised for the process.
  ///
  /// Dropped by [_onChange], so an album created or deleted by another app
  /// shows up on the next library change. [changes] only emits while the
  /// platform notify listener runs (`PhotoManager.startChangeNotify`), which
  /// the app does not start yet, so today this lives until restart.
  List<MediaFolder>? _folders;

  /// Library paths resolved for [page]/[libraryCount], keyed by album id
  /// (`null` = whole library).
  ///
  /// Those two run per scroll page, and resolving a path is a platform
  /// round-trip. Dropped with [_folders] by [_onChange].
  final Map<String?, AssetPathEntity> _paths = <String?, AssetPathEntity>{};

  /// Encoded previews by asset and requested size, oldest use first.
  ///
  /// A grid tile asks again every time it is mounted, so without this each
  /// scroll-back costs an `AssetEntity.fromId` round trip plus a platform
  /// re-encode. Budgeted in bytes: an entry count says nothing about size.
  final Map<_ThumbKey, Uint8List> _thumbs = <_ThumbKey, Uint8List>{};

  /// Bytes currently held by [_thumbs].
  int _thumbBytes = 0;

  /// Encoded previews kept before the coldest is dropped.
  static const int _thumbBudgetBytes = 24 << 20;

  /// Platform encodes allowed at once; a fling mounts tiles faster than the
  /// platform can encode them, and the backlog is what stutters the scroll.
  static const int _thumbConcurrency = 6;

  int _thumbsInFlight = 0;
  final List<Completer<void>> _thumbWaiters = <Completer<void>>[];

  bool _disposed = false;

  @override
  Future<PhotoPermission> ensurePermission() async {
    // mediaLocation: Android 10+ redacts EXIF GPS from media (FUSE and
    // ContentResolver alike) unless ACCESS_MEDIA_LOCATION is held; photo_manager
    // only requests it when asked here *and* it is declared in the manifest.
    final state = await PhotoManager.requestPermissionExtend(
      requestOption: const PermissionRequestOption(
        androidPermission: AndroidPermission(
          type: RequestType.common,
          mediaLocation: true,
        ),
      ),
    );
    return switch (state) {
      PermissionState.authorized => PhotoPermission.authorized,
      PermissionState.limited => PhotoPermission.limited,
      PermissionState.denied => PhotoPermission.denied,
      PermissionState.restricted => PhotoPermission.restricted,
      PermissionState.notDetermined => PhotoPermission.notDetermined,
    };
  }

  @override
  Future<List<MediaFolder>> folders() async {
    final cached = _folders;
    if (cached != null) return cached;

    final paths = await PhotoManager.getAssetPathList(
      onlyAll: false,
      type: RequestType.common,
      filterOption: FilterOptionGroup(
        imageOption: const FilterOption(needTitle: true),
        videoOption: const FilterOption(needTitle: true),
      ),
    );
    final folders = <MediaFolder>[
      for (final path in paths)
        MediaFolder(
          id: path.id,
          name: path.name,
          assetCount: await path.assetCountAsync,
          isCamera: _isCameraPath(path),
        ),
    ];
    folders.sort((left, right) {
      if (left.isCamera != right.isCamera) return left.isCamera ? -1 : 1;
      return right.assetCount.compareTo(left.assetCount);
    });
    _folders = List<MediaFolder>.unmodifiable(folders);
    return _folders!;
  }

  @override
  Future<List<AssetCandidate>> page({
    required int offset,
    required int limit,
    String? folderId,
  }) async {
    if (offset < 0 || limit <= 0) return const <AssetCandidate>[];
    final path = await _path(folderId);
    if (path == null) return const <AssetCandidate>[];
    // Range beats pages here: the plugin clamps the end to the asset count, so
    // a short or past-the-end page is an empty list, never a RangeError.
    final assets = await path.getAssetListRange(
      start: offset,
      end: offset + limit,
    );
    final candidates = <AssetCandidate>[];
    for (final asset in assets) {
      final candidate = _displayCandidate(asset);
      if (candidate != null) candidates.add(candidate);
    }
    return candidates;
  }

  @override
  Future<int> libraryCount({String? folderId}) async {
    final path = await _path(folderId);
    if (path == null) return 0;
    return path.assetCountAsync;
  }

  /// Resolves [folderId] once per library change; null when the album is gone.
  Future<AssetPathEntity?> _path(String? folderId) async {
    final cached = _paths[folderId];
    if (cached != null) return cached;

    final AssetPathEntity path;
    if (folderId == null) {
      final all = await PhotoManager.getAssetPathList(
        onlyAll: true,
        type: RequestType.common,
        filterOption: _displayFilter,
      );
      if (all.isEmpty) return null;
      path = all.first;
    } else {
      try {
        path = await AssetPathEntity.fromId(
          folderId,
          filterOption: _displayFilter,
        );
      } on Object {
        // Deleted album: an empty page, not an app error.
        return null;
      }
    }
    return _paths[folderId] = path;
  }

  /// Newest capture first, titles kept for display names.
  FilterOptionGroup get _displayFilter => FilterOptionGroup(
    imageOption: const FilterOption(needTitle: true),
    videoOption: const FilterOption(needTitle: true),
    orders: const <OrderOption>[
      OrderOption(type: OrderOptionType.createDate, asc: false),
    ],
  );

  @override
  Future<List<AssetCandidate>> scanNew({
    DateTime? since,
    List<String>? folderIds,
  }) async {
    _scanFiles.clear();
    final now = DateTime.now();
    final filterOption = FilterOptionGroup(
      imageOption: const FilterOption(needTitle: true),
      videoOption: const FilterOption(needTitle: true),
      // Creation time stays unfiltered: edits keep the original creation date,
      // so only the update window can surface an old asset that changed.
      updateTimeCond: since == null
          ? DateTimeCond.def()
          : DateTimeCond(min: since, max: now),
      orders: const <OrderOption>[
        OrderOption(type: OrderOptionType.createDate, asc: true),
      ],
    );

    final albums = await _albums(folderIds, filterOption);
    final candidates = <AssetCandidate>[];
    // A photo can sit in several albums (smart albums, Recents), so the same
    // id must reach the queue only once.
    final seen = <String>{};
    for (final album in albums) {
      var page = 0;
      while (true) {
        final assets = await album.getAssetListPaged(
          page: page,
          size: pageSize,
        );
        if (assets.isEmpty) break;
        for (final asset in assets) {
          if (!seen.add(asset.id)) continue;
          final candidate = await _toCandidate(asset);
          if (candidate != null) candidates.add(candidate);
        }
        if (assets.length < pageSize) break;
        page++;
      }
    }

    candidates.sort((left, right) {
      final leftDate = left.takenAt ?? left.modifiedAt;
      final rightDate = right.takenAt ?? right.modifiedAt;
      if (leftDate == null && rightDate == null) return 0;
      if (leftDate == null) return -1;
      if (rightDate == null) return 1;
      return leftDate.compareTo(rightDate);
    });
    return candidates;
  }

  /// Whole library for an empty selection, else the chosen albums.
  ///
  /// A chosen album can disappear between the settings write and this scan;
  /// it is skipped rather than aborting the whole pass.
  Future<List<AssetPathEntity>> _albums(
    List<String>? folderIds,
    FilterOptionGroup filterOption,
  ) async {
    if (folderIds == null || folderIds.isEmpty) {
      return PhotoManager.getAssetPathList(
        onlyAll: true,
        type: RequestType.common,
        filterOption: filterOption,
      );
    }
    final albums = <AssetPathEntity>[];
    for (final id in folderIds) {
      try {
        albums.add(
          await AssetPathEntity.fromId(id, filterOption: filterOption),
        );
      } on Object {
        // The album is gone; the remaining selection still scans.
      }
    }
    return albums;
  }

  @override
  Future<File?> playableVideo(
    String localId, {
    void Function(double progress)? onProgress,
  }) async {
    // The iCloud progress channel is Darwin-only; constructing its handler on
    // Android trips a platform assertion, and Android bytes are always local.
    final handler = onProgress != null && (Platform.isIOS || Platform.isMacOS)
        ? PMProgressHandler()
        : null;
    final subscription = handler?.stream.listen(
      (state) => onProgress?.call(state.progress),
    );
    try {
      final entity = await AssetEntity.fromId(localId);
      if (entity == null) return null;
      final file = await entity.loadFile(
        isOrigin: true,
        progressHandler: handler,
      );
      if (file == null) return null;
      if (!await file.exists()) return null;
      return file;
    } on Object {
      // Deleted asset, refused iCloud fetch, unreadable container: the viewer
      // shows its own retry, so this must not throw.
      return null;
    } finally {
      await subscription?.cancel();
    }
  }

  @override
  Future<File?> fileFor(String localId) async {
    final cached = _scanFiles[localId];
    if (cached != null) {
      try {
        if (await cached.exists()) return cached;
      } on Object {
        // Fall through and ask the platform for a fresh path.
      }
    }
    try {
      final entity = await AssetEntity.fromId(localId);
      if (entity == null) return null;
      final file = await entity.originFile;
      if (file == null) return null;
      if (!await file.exists()) return null;
      return file;
    } on Object {
      return null;
    }
  }

  @override
  Future<Uint8List?> thumbnailFor(String localId, {int size = 128}) async {
    // A bad caller must not turn a preview into a full-size decode. The ceiling
    // is what the full-screen viewer asks for; the grid asks for its own tile.
    final pixels = size.clamp(64, 2048).toInt();
    final key = _ThumbKey(localId, pixels);
    final cached = _thumbs.remove(key);
    if (cached != null) {
      // Re-inserted so the eviction order follows use, not creation.
      _thumbs[key] = cached;
      return cached;
    }

    await _acquireThumbSlot();
    try {
      final entity = await AssetEntity.fromId(localId);
      if (entity == null) return null;
      final bytes = await entity.thumbnailDataWithSize(
        ThumbnailSize.square(pixels),
        quality: 80,
      );
      if (bytes == null || bytes.isEmpty) return null;
      _rememberThumb(key, bytes);
      return bytes;
    } on Object {
      // PlatformException (asset deleted, iCloud fetch failed) or
      // UnsupportedError (format without a renderable thumbnail). The
      // dashboard asks on every library change, so this must never throw.
      return null;
    } finally {
      _releaseThumbSlot();
    }
  }

  /// Keeps [bytes] as the newest entry, dropping the coldest past the budget.
  void _rememberThumb(_ThumbKey key, Uint8List bytes) {
    final previous = _thumbs.remove(key);
    if (previous != null) _thumbBytes -= previous.length;
    _thumbs[key] = bytes;
    _thumbBytes += bytes.length;
    while (_thumbBytes > _thumbBudgetBytes && _thumbs.isNotEmpty) {
      final dropped = _thumbs.remove(_thumbs.keys.first);
      if (dropped == null) break;
      _thumbBytes -= dropped.length;
    }
  }

  /// Blocks until fewer than [_thumbConcurrency] encodes are running.
  Future<void> _acquireThumbSlot() {
    if (_thumbsInFlight < _thumbConcurrency) {
      _thumbsInFlight++;
      return Future<void>.value();
    }
    final waiter = Completer<void>();
    _thumbWaiters.add(waiter);
    return waiter.future;
  }

  /// Frees a slot, handing it to the *newest* waiter.
  ///
  /// LIFO on purpose: requests come from tiles mounting as the grid scrolls, so
  /// the latest one is the one now on screen. FIFO would spend the freed slot
  /// on a tile the finger has already left, which starves the visible window
  /// behind slow iCloud fetches.
  void _releaseThumbSlot() {
    if (_thumbWaiters.isEmpty) {
      if (_thumbsInFlight > 0) _thumbsInFlight--;
      return;
    }
    _thumbWaiters.removeLast().complete();
  }

  /// Drops previews whose bytes may have changed, keeping the rest.
  void _forgetThumbs(Set<String>? ids) {
    if (ids == null) {
      _thumbs.clear();
      _thumbBytes = 0;
      return;
    }
    for (final entry in _thumbs.entries.toList(growable: false)) {
      if (!ids.contains(entry.key.localId)) continue;
      _thumbs.remove(entry.key);
      _thumbBytes -= entry.value.length;
    }
  }

  /// Asset ids carried by a platform change callback, or null when it carries
  /// none and every preview must then be treated as suspect.
  static Set<String>? _changedIds(MethodCall call) {
    final args = call.arguments;
    final raw = args is Map ? args['ids'] : args;
    if (raw is! List) return null;
    final ids = <String>{
      for (final id in raw)
        if (id is String && id.isNotEmpty) id,
    };
    return ids.isEmpty ? null : ids;
  }

  @override
  Stream<void> get changes => _changes.stream;

  @override
  Future<void> dispose() async {
    if (_disposed) return;
    _disposed = true;
    _scanFiles.clear();
    _folders = null;
    _paths.clear();
    _forgetThumbs(null);
    // Nothing may wait on a slot that will never be handed over.
    for (final waiter in _thumbWaiters) {
      if (!waiter.isCompleted) waiter.complete();
    }
    _thumbWaiters.clear();
    PhotoManager.removeChangeCallback(_onChange);
    await PhotoManager.stopChangeNotify();
    await _changes.close();
  }

  void _onChange(MethodCall call) {
    if (_disposed || _changes.isClosed) return;
    // An album can be created or deleted without the app knowing; any cached
    // id may now resolve elsewhere, so both listings reload on next use.
    _folders = null;
    _paths.clear();
    // An edited asset keeps its id but changes its bytes, so the previews held
    // for it are stale. The callback names the assets when the platform says
    // so; otherwise everything is suspect and the cache starts over.
    _forgetThumbs(_changedIds(call));
    _changes.add(null);
  }

  /// Cheap [AssetCandidate] for the grid: no byte export, so the candidate's
  /// `sizeBytes` is 0 and only the uploader may decide upload strategy.
  AssetCandidate? _displayCandidate(AssetEntity asset) {
    final kind = switch (asset.type) {
      AssetType.image => MediaKind.photo,
      AssetType.video => MediaKind.video,
      _ => null,
    };
    if (kind == null) return null;

    final title = asset.title?.trim();
    final fileName = title != null && title.isNotEmpty
        ? title
        : _basename(asset.relativePath ?? '');

    return AssetCandidate(
      localId: asset.id,
      platform: _platform,
      kind: kind,
      fileName: fileName,
      mimeType: filter.inferMimeType(fileName) ?? asset.mimeType ?? '',
      // shortcut: entity.sizeBytes is not exposed by photo_manager and a real
      // size needs an originFile export; the grid does not need it.
      sizeBytes: 0,
      takenAt: asset.createDateSecond == null ? null : asset.createDateTime,
      modifiedAt: asset.modifiedDateSecond == null
          ? null
          : asset.modifiedDateTime,
      relativePath: asset.relativePath,
      width: asset.width,
      height: asset.height,
      durationSeconds: asset.duration,
    );
  }

  Future<AssetCandidate?> _toCandidate(AssetEntity asset) async {
    final kind = switch (asset.type) {
      AssetType.image => MediaKind.photo,
      AssetType.video => MediaKind.video,
      _ => null,
    };
    if (kind == null) return null;

    final File? file;
    try {
      file = await asset.originFile;
    } on Object {
      // iCloud-only assets can fail to materialise; they are retried by a
      // later scan once the system has downloaded them.
      return null;
    }
    if (file == null) return null;

    final int length;
    try {
      length = await file.length();
    } on FileSystemException {
      return null;
    }
    _scanFiles[asset.id] = file;

    var fileName = asset.title?.trim();
    if (fileName == null || fileName.isEmpty) {
      try {
        final asyncTitle = (await asset.titleAsync).trim();
        if (asyncTitle.isNotEmpty) fileName = asyncTitle;
      } on Object {
        fileName = null;
      }
    }
    fileName ??= _basename(file.path);

    final takenAt = asset.createDateSecond == null
        ? null
        : asset.createDateTime;
    final modifiedAt = asset.modifiedDateSecond == null
        ? null
        : asset.modifiedDateTime;

    return AssetCandidate(
      localId: asset.id,
      platform: _platform,
      kind: kind,
      fileName: fileName,
      mimeType: filter.inferMimeType(fileName) ?? asset.mimeType ?? '',
      sizeBytes: length,
      takenAt: takenAt,
      modifiedAt: modifiedAt,
      relativePath: asset.relativePath,
    );
  }

  String get _platform {
    if (Platform.isIOS) return 'ios';
    if (Platform.isAndroid) return 'android';
    return Platform.operatingSystem;
  }

  /// MediaStore names the camera bucket `Camera` (DCIM/Camera); PhotoKit
  /// exposes it as the "all assets" collection (Recents).
  bool _isCameraPath(AssetPathEntity path) {
    if (Platform.isAndroid) {
      return path.name.endsWith('Camera') || path.id.endsWith('Camera');
    }
    return path.isAll;
  }

  static String _basename(String path) {
    final slash = path.lastIndexOf('/');
    final backslash = path.lastIndexOf('\\');
    final index = slash > backslash ? slash : backslash;
    return index >= 0 && index < path.length - 1
        ? path.substring(index + 1)
        : path;
  }
}

/// Identity of one cached preview: the asset and the square size asked for.
class _ThumbKey {
  const _ThumbKey(this.localId, this.pixels);

  final String localId;
  final int pixels;

  @override
  bool operator ==(Object other) =>
      other is _ThumbKey && other.localId == localId && other.pixels == pixels;

  @override
  int get hashCode => Object.hash(localId, pixels);
}
