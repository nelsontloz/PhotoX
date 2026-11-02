import '../media/photo_observer.dart';
import '../settings/settings_store.dart';

/// What the stored backup scope currently means.
///
/// Three states hide behind two fields: no album chosen yet means the camera
/// album (the first-launch default), an explicit set means exactly those
/// albums, and `uploadAllFolders` means everything. The pipeline already reads
/// it that way in [SyncCoordinator]; this is the same rule for the UI.
class AlbumScope {
  const AlbumScope._({
    required this.all,
    required this.folderIds,
    required this.usesDefault,
  });

  /// Reads [settings] the way discovery does.
  factory AlbumScope.of(AppSettings settings) {
    return AlbumScope._(
      all: settings.uploadAllFolders,
      folderIds: List<String>.unmodifiable(settings.uploadFolderIds),
      usesDefault:
          !settings.uploadAllFolders && settings.uploadFolderIds.isEmpty,
    );
  }

  /// Every album is included.
  final bool all;

  /// Albums chosen explicitly; empty when [all] or [usesDefault].
  final List<String> folderIds;

  /// Nothing chosen yet, so discovery backs up the camera album.
  final bool usesDefault;

  /// True when an explicit multi-album set is used, which the whole-library
  /// grid cannot show as "all of this is in scope".
  bool get isPartial => !all && folderIds.isNotEmpty;

  /// Whether [folder] is inside the current scope.
  bool includes(MediaFolder folder) {
    if (all) return true;
    if (folderIds.contains(folder.id)) return true;
    return usesDefault && folder.isCamera;
  }
}

/// One line naming the scope, shared by every screen that mentions it.
String albumScopeLabel(AppSettings settings) {
  if (settings.uploadAllFolders) return 'All albums';
  final count = settings.uploadFolderIds.length;
  return count > 1 ? '$count albums' : 'Camera album';
}

/// Adds [album] to the scope, or removes it.
///
/// [folders] is the live device album list, needed to spell out "everything
/// except this one" when the scope was "all albums". Adding the camera album
/// to a default scope is a no-op: the camera album already is the default.
///
/// Removing the last album never produces an empty explicit set, because the
/// pipeline reads that as "camera album" — a different scope than the user
/// just asked for. Removing the camera album from a default scope therefore
/// becomes every other album, and removing the only album of a one-album scope
/// is refused (the caller hides the action).
AppSettings withAlbumInScope(
  AppSettings current, {
  required MediaFolder album,
  required bool include,
  required List<MediaFolder> folders,
}) {
  if (include) {
    if (current.uploadAllFolders) return current;
    if (current.uploadFolderIds.isEmpty) {
      if (album.isCamera) return current;
      String? cameraId;
      for (final folder in folders) {
        if (folder.isCamera) {
          cameraId = folder.id;
          break;
        }
      }
      return current.copyWith(uploadFolderIds: <String>[?cameraId, album.id]);
    }
    if (current.uploadFolderIds.contains(album.id)) return current;
    return current.copyWith(
      uploadFolderIds: <String>[...current.uploadFolderIds, album.id],
    );
  }

  if (current.uploadAllFolders) {
    final rest = <String>[
      for (final folder in folders)
        if (folder.id != album.id) folder.id,
    ];
    if (rest.isEmpty) return current;
    return current.copyWith(
      uploadAllFolders: false,
      uploadFolderIds: List<String>.unmodifiable(rest),
    );
  }

  if (current.uploadFolderIds.isEmpty) {
    // Default scope: only the camera album is in it, and only the camera album
    // can be asked to leave.
    if (!album.isCamera) return current;
    final rest = <String>[
      for (final folder in folders)
        if (!folder.isCamera) folder.id,
    ];
    if (rest.isEmpty) return current;
    return current.copyWith(uploadFolderIds: List<String>.unmodifiable(rest));
  }

  if (!current.uploadFolderIds.contains(album.id)) return current;
  final next = <String>[
    for (final id in current.uploadFolderIds)
      if (id != album.id) id,
  ];
  if (next.isEmpty) return current;
  return current.copyWith(uploadFolderIds: List<String>.unmodifiable(next));
}

/// Backs up exactly [album] and nothing else.
///
/// [coversWholeLibrary] is for smart albums that contain the whole library
/// (iOS "All Photos"/"Recents"): pointing the scan at one of those is the same
/// as "everything" and must not become an explicit folder id, which would
/// double the scan.
AppSettings onlyAlbumInScope(
  AppSettings current, {
  required MediaFolder album,
  required bool coversWholeLibrary,
}) {
  if (coversWholeLibrary) {
    return current.copyWith(
      uploadAllFolders: true,
      uploadFolderIds: const <String>[],
    );
  }
  // The camera album is the pipeline's default for an empty selection.
  if (album.isCamera) {
    return current.copyWith(
      uploadAllFolders: false,
      uploadFolderIds: const <String>[],
    );
  }
  return current.copyWith(
    uploadAllFolders: false,
    uploadFolderIds: <String>[album.id],
  );
}

/// Drops stored album ids the device no longer has.
///
/// A deleted album would otherwise leave discovery scanning nothing, silently:
/// an unknown id pages back an empty list instead of an error. An emptied
/// selection falls back to the default (camera album), which is the same rule
/// [AlbumScope] applies everywhere else.
List<String> pruneMissingFolders(List<String> stored, List<MediaFolder> live) {
  if (stored.isEmpty) return const <String>[];
  final ids = <String>{for (final folder in live) folder.id};
  final kept = <String>[
    for (final id in stored)
      if (ids.contains(id)) id,
  ];
  return kept.length == stored.length
      ? stored
      : List<String>.unmodifiable(kept);
}
