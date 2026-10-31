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
  /// shortcut: the listing never refreshes, so an album created after the
  /// first call stays invisible until restart; refresh it from [changes] when
  /// album management becomes a workflow.
  List<MediaFolder>? _folders;

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
    // A bad caller must not turn a preview into a full-size decode.
    final pixels = size.clamp(64, 512).toInt();
    try {
      final entity = await AssetEntity.fromId(localId);
      if (entity == null) return null;
      final bytes = await entity.thumbnailDataWithSize(
        ThumbnailSize.square(pixels),
        quality: 80,
      );
      if (bytes == null || bytes.isEmpty) return null;
      return bytes;
    } on Object {
      // PlatformException (asset deleted, iCloud fetch failed) or
      // UnsupportedError (format without a renderable thumbnail). The
      // dashboard asks on every library change, so this must never throw.
      return null;
    }
  }

  @override
  Stream<void> get changes => _changes.stream;

  @override
  Future<void> dispose() async {
    if (_disposed) return;
    _disposed = true;
    _scanFiles.clear();
    _folders = null;
    PhotoManager.removeChangeCallback(_onChange);
    await _changes.close();
  }

  void _onChange(MethodCall call) {
    if (_disposed || _changes.isClosed) return;
    _changes.add(null);
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
