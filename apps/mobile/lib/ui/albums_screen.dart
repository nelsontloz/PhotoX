import 'dart:async';
import 'dart:typed_data';

import 'package:flutter/material.dart';

import '../library/album_progress.dart';
import '../library/album_scope.dart';
import '../media/photo_observer.dart';
import '../server/album_client.dart';
import '../settings/settings_store.dart';
import 'widgets/app_background.dart';
import 'widgets/count_format.dart';
import 'widgets/folder_album_sheet.dart';
import 'widgets/panel.dart';
import 'widgets/section_label.dart';
import 'widgets/status_banner.dart';

/// The device's albums, one card each, with the backup scope on every one.
///
/// Every value and action arrives from the caller, exactly like
/// [LibraryScreen]: the screen never touches the platform, the settings store
/// or the queue, so it pumps in a widget test with no plugins.
class AlbumsScreen extends StatefulWidget {
  const AlbumsScreen({
    super.key,
    required this.settings,
    required this.loadFolders,
    required this.onScopeChanged,
    required this.onOpenAlbum,
    this.serverAlbums = const <ServerAlbum>[],
    this.serverAlbumsLoaded = false,
    this.loadServerAlbums,
    this.onCreateServerAlbum,
    this.onFolderAlbumChanged,
    this.permission = PhotoPermission.authorized,
    this.libraryCount,
    this.cover,
    this.loadProgress,
    this.onOpenSettings,
  });

  /// Current backup preferences; chips and actions are derived from it.
  final AppSettings settings;

  /// Lists the albums the platform exposes, camera album flagged.
  final Future<List<MediaFolder>> Function() loadFolders;

  /// Persists a new scope, returning only once it is saved.
  final Future<void> Function(AppSettings settings) onScopeChanged;

  /// Opens one album's grid.
  final void Function(MediaFolder album) onOpenAlbum;

  /// Server albums a folder can be pointed at; the card reads names from it.
  final List<ServerAlbum> serverAlbums;

  /// True once [serverAlbums] came back from the server at least once.
  ///
  /// Tells a mapping's "not read yet" apart from "the album is gone", which an
  /// empty [serverAlbums] alone cannot: an account whose only album was deleted
  /// also has an empty list.
  final bool serverAlbumsLoaded;

  /// Reads the server's albums for the sheet; its failures show inline there.
  final Future<List<ServerAlbum>> Function()? loadServerAlbums;

  /// Creates a server album, optionally kept out of the timeline.
  final Future<ServerAlbum> Function(
    String name, {
    required bool hiddenFromTimeline,
  })?
  onCreateServerAlbum;

  /// Persists a folder's album; null clears it.
  final Future<void> Function(String folderId, String? albumId)?
  onFolderAlbumChanged;

  /// Current photo-library permission; albums are only read when it allows it.
  final PhotoPermission permission;

  /// Assets in the whole library, so an album holding that many covers all of
  /// it (iOS "Recents") and "back up this album" means "everything".
  final int? libraryCount;

  /// Cover preview for an album id; null draws a neutral cover instead.
  final Future<Uint8List?> Function(String folderId)? cover;

  /// Backed-up tally for one album; null keeps the platform's own count.
  ///
  /// Only asked for albums inside the backup scope — see [AlbumsScreen].
  final Future<AlbumProgress> Function(String folderId)? loadProgress;

  /// Opens the settings screen; the action is absent when this is null.
  final VoidCallback? onOpenSettings;

  @override
  State<AlbumsScreen> createState() => _AlbumsScreenState();
}

class _AlbumsScreenState extends State<AlbumsScreen> {
  /// Device albums; null until the first read lands, then kept across reloads
  /// so a refresh never blanks the list.
  List<MediaFolder>? _albums;

  String? _error;
  bool _loading = false;

  /// The read in flight, so a pull-to-refresh joins it instead of stacking.
  Future<void>? _inFlight;

  /// Cover futures per album id, so a rebuild never re-asks the platform.
  final Map<String, Future<Uint8List?>> _covers =
      <String, Future<Uint8List?>>{};

  /// Backed-up tallies per album id, asked once per album per screen session.
  ///
  /// shortcut: a long sync pass leaves this number behind until the list is
  /// refreshed; upgrade by re-reading the tally when the queue revision moves.
  final Map<String, Future<AlbumProgress?>> _progress =
      <String, Future<AlbumProgress?>>{};

  bool get _canRead =>
      widget.permission == PhotoPermission.authorized ||
      widget.permission == PhotoPermission.limited;

  @override
  void initState() {
    super.initState();
    if (_canRead) unawaited(_load());
  }

  @override
  void didUpdateWidget(AlbumsScreen oldWidget) {
    super.didUpdateWidget(oldWidget);
    // Access was granted while the tab sat on the permission note.
    if (!_readable(oldWidget.permission) && _readable(widget.permission)) {
      unawaited(_load());
    }
  }

  static bool _readable(PhotoPermission permission) =>
      permission == PhotoPermission.authorized ||
      permission == PhotoPermission.limited;

  Future<void> _load() {
    final inFlight = _inFlight;
    if (inFlight != null) return inFlight;
    final future = _fetch().whenComplete(() => _inFlight = null);
    _inFlight = future;
    return future;
  }

  Future<void> _fetch() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final albums = await widget.loadFolders();
      if (!mounted) return;
      setState(() {
        _albums = albums;
        // The tallies were read against the old list; ask again for the new one.
        _progress.clear();
        _loading = false;
      });
    } on Object {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _error = 'Could not read your albums.';
      });
    }
  }

  Future<void> _apply(AppSettings next) async {
    try {
      await widget.onScopeChanged(next);
    } on Object {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Could not change the backup scope. Try again.'),
        ),
      );
    }
  }

  /// Widening, so no confirmation: nothing leaves the scope.
  Future<void> _backUpEverything() {
    return _apply(
      widget.settings.copyWith(
        uploadAllFolders: true,
        uploadFolderIds: const <String>[],
      ),
    );
  }

  Future<void> _runChoice(MediaFolder album, _AlbumScopeChoice choice) async {
    if (choice.confirm) {
      final confirmed = await confirmScopeNarrowing(
        context,
        title: choice.action == _AlbumAction.remove
            ? 'Remove “${album.name}” from backup?'
            : 'Back up only “${album.name}”?',
        action: choice.label,
      );
      if (!confirmed || !mounted) return;
    }
    await _apply(choice.next);
  }

  /// True when the album holds the whole library, so pointing the backup at it
  /// is the same as "everything" (and must not become an explicit album id).
  bool _coversWholeLibrary(MediaFolder album) {
    final count = widget.libraryCount;
    return count != null && album.assetCount == count;
  }

  /// Every scope action that would actually change the stored settings.
  ///
  /// The rules live in [album_scope.dart]; an action whose next settings equal
  /// the current ones is a no-op, so it is left out instead of shown and lost.
  List<_AlbumScopeChoice> _choices(MediaFolder album) {
    final choices = <_AlbumScopeChoice>[];
    final coversAll = _coversWholeLibrary(album);

    final only = onlyAlbumInScope(
      widget.settings,
      album: album,
      coversWholeLibrary: coversAll,
    );
    if (only != widget.settings) {
      choices.add(
        _AlbumScopeChoice(
          action: _AlbumAction.only,
          label: coversAll ? 'Back up everything' : 'Back up this album',
          next: only,
          // Only a scope that drops albums is worth a warning; "everything"
          // takes more in, not less.
          confirm: !coversAll,
        ),
      );
    }

    final add = withAlbumInScope(
      widget.settings,
      album: album,
      include: true,
      folders: _albums ?? const <MediaFolder>[],
    );
    if (add != widget.settings) {
      choices.add(
        _AlbumScopeChoice(
          action: _AlbumAction.include,
          label: 'Include in backup',
          next: add,
        ),
      );
    }

    final remove = withAlbumInScope(
      widget.settings,
      album: album,
      include: false,
      folders: _albums ?? const <MediaFolder>[],
    );
    if (remove != widget.settings) {
      choices.add(
        _AlbumScopeChoice(
          action: _AlbumAction.remove,
          label: 'Remove from backup',
          next: remove,
          confirm: true,
        ),
      );
    }
    return choices;
  }

  /// True when a folder can be pointed at a server album at all.
  bool get _canMapFolder =>
      widget.loadServerAlbums != null &&
      widget.onCreateServerAlbum != null &&
      widget.onFolderAlbumChanged != null;

  Widget _menu(MediaFolder album) {
    final choices = _choices(album);
    final canMap = _canMapFolder;
    if (choices.isEmpty && !canMap) return const SizedBox.shrink();

    return PopupMenuButton<_AlbumAction>(
      key: Key('album-menu-${album.id}'),
      tooltip: 'Album actions',
      icon: const Icon(Icons.more_vert_rounded),
      onSelected: (action) {
        if (action == _AlbumAction.album) {
          unawaited(_openFolderAlbum(album));
          return;
        }
        final choice = choices.firstWhere((item) => item.action == action);
        unawaited(_runChoice(album, choice));
      },
      itemBuilder: (context) => <PopupMenuEntry<_AlbumAction>>[
        if (canMap)
          const PopupMenuItem<_AlbumAction>(
            value: _AlbumAction.album,
            child: Text('Save to server album…'),
          ),
        if (canMap && choices.isNotEmpty) const PopupMenuDivider(),
        for (final choice in choices)
          PopupMenuItem<_AlbumAction>(
            value: choice.action,
            child: Text(choice.label),
          ),
      ],
    );
  }

  /// Opens the sheet that points [album]'s uploads at a server album.
  Future<void> _openFolderAlbum(MediaFolder album) async {
    final load = widget.loadServerAlbums;
    final create = widget.onCreateServerAlbum;
    final changed = widget.onFolderAlbumChanged;
    if (load == null || create == null || changed == null) return;

    await showFolderAlbumSheet(
      context,
      folderId: album.id,
      folderName: album.name,
      currentAlbumId: widget.settings.folderAlbums[album.id],
      loadAlbums: load,
      createAlbum: create,
      onChanged: changed,
    );
  }

  /// Cover future for [album]; asked once per album, kept for the session.
  Future<Uint8List?>? _coverFor(MediaFolder album) {
    final load = widget.cover;
    if (load == null) return null;
    return _covers.putIfAbsent(album.id, () => load(album.id));
  }

  /// Backed-up tally for [album], or null when there is nothing to show.
  ///
  /// Only albums inside the scope are counted: elsewhere the number would
  /// describe a set the backup never reads, and counting every album on the tab
  /// would walk the library once per album. Asked once per album, kept for the
  /// session, dropped when the list is re-read.
  Future<AlbumProgress?>? _progressFor(MediaFolder album) {
    final load = widget.loadProgress;
    if (load == null) return null;
    if (!AlbumScope.of(widget.settings).includes(album)) return null;
    return _progress.putIfAbsent(album.id, () async {
      try {
        return await load(album.id);
      } on Object {
        // A tally is a hint on a card: its absence is not an error state.
        return null;
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return AppBackground(
      child: Scaffold(
        backgroundColor: Colors.transparent,
        appBar: AppBar(
          titleSpacing: 20,
          title: Text(
            'Albums',
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: theme.textTheme.titleLarge?.copyWith(
              color: theme.colorScheme.onSurface,
              fontWeight: FontWeight.w700,
              letterSpacing: -0.3,
            ),
          ),
          actions: <Widget>[
            if (widget.onOpenSettings != null)
              Padding(
                padding: const EdgeInsets.only(right: 12),
                child: IconButton(
                  key: const Key('albums-settings'),
                  tooltip: 'Settings',
                  onPressed: widget.onOpenSettings,
                  icon: const Icon(Icons.tune_rounded),
                ),
              ),
          ],
        ),
        body: SafeArea(
          top: false,
          bottom: false,
          child: RefreshIndicator(
            onRefresh: _load,
            child: ListView(
              // Pull to refresh must work on the empty and error states too.
              physics: const AlwaysScrollableScrollPhysics(),
              padding: const EdgeInsets.fromLTRB(20, 4, 20, 32),
              children: <Widget>[
                Center(
                  child: ConstrainedBox(
                    constraints: const BoxConstraints(maxWidth: 680),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: _content(context),
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  List<Widget> _content(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;

    if (!_canRead) {
      return const <Widget>[
        StatusBanner(
          tone: StatusTone.warning,
          icon: Icons.photo_library_outlined,
          title: 'Photo access is off',
          message:
              'Allow photo access in the Library tab or your device settings '
              'to see the albums on this phone.',
        ),
      ];
    }

    final albums = _albums;
    final error = _error;
    final all = widget.settings.uploadAllFolders;
    final folderAlbums = widget.settings.folderAlbums;
    final serverAlbums = <String, ServerAlbum>{
      for (final album in widget.serverAlbums) album.id: album,
    };

    return <Widget>[
      if (_loading && albums != null)
        const Padding(
          padding: EdgeInsets.only(bottom: 10),
          child: LinearProgressIndicator(
            minHeight: 2,
            semanticsLabel: 'Reading your albums',
          ),
        ),
      _ScopePanel(
        settings: widget.settings,
        onBackUpEverything: all ? null : () => unawaited(_backUpEverything()),
      ),
      if (error != null && albums != null) ...<Widget>[
        const SizedBox(height: 10),
        StatusBanner(
          tone: StatusTone.danger,
          icon: Icons.cloud_off_rounded,
          title: 'Could not refresh your albums',
          message:
              'The list below may be out of date. Your backup scope is '
              'unchanged.',
          action: TextButton(
            onPressed: () => unawaited(_load()),
            child: const Text('Try again'),
          ),
        ),
      ],
      if (albums == null) ...<Widget>[
        const SizedBox(height: 44),
        if (error != null)
          StatusBanner(
            tone: StatusTone.danger,
            icon: Icons.cloud_off_rounded,
            title: 'Could not read your albums',
            message:
                'PhotoX could not list the albums on this device. Your '
                'backup scope is unchanged.',
            action: TextButton(
              key: const Key('albums-retry'),
              onPressed: () => unawaited(_load()),
              child: const Text('Try again'),
            ),
          )
        else
          Center(
            child: SizedBox.square(
              dimension: 26,
              child: CircularProgressIndicator(
                strokeWidth: 2.2,
                semanticsLabel: 'Reading your albums',
              ),
            ),
          ),
      ] else if (albums.isEmpty) ...<Widget>[
        const SizedBox(height: 24),
        Panel(
          key: const Key('albums-empty'),
          child: Column(
            children: <Widget>[
              Icon(
                Icons.folder_off_outlined,
                size: 26,
                color: scheme.onSurfaceVariant,
              ),
              const SizedBox(height: 10),
              Text(
                'No albums on this device',
                textAlign: TextAlign.center,
                style: theme.textTheme.titleSmall?.copyWith(
                  color: scheme.onSurface,
                  fontWeight: FontWeight.w600,
                ),
              ),
              const SizedBox(height: 6),
              Text(
                'Albums appear here once the system reports them. Pull down to '
                'check again.',
                textAlign: TextAlign.center,
                style: theme.textTheme.bodySmall?.copyWith(
                  color: scheme.onSurfaceVariant,
                  height: 1.4,
                ),
              ),
            ],
          ),
        ),
      ] else ...<Widget>[
        const SectionLabel('On this device'),
        for (final album in albums) ...<Widget>[
          _AlbumCard(
            album: album,
            inScope: AlbumScope.of(widget.settings).includes(album),
            cover: _coverFor(album),
            progress: _progressFor(album),
            folderAlbumId: folderAlbums[album.id],
            folderAlbum: serverAlbums[folderAlbums[album.id]],
            // An empty list means "not read yet" as often as "no albums", so the
            // flag decides; the id's absence then means the album is gone.
            albumsKnown: widget.serverAlbumsLoaded,
            onOpen: () => widget.onOpenAlbum(album),
            menu: _menu(album),
          ),
          const SizedBox(height: 8),
        ],
      ],
    ];
  }
}

/// Which scope change a menu entry makes; only used for building the menu.
enum _AlbumAction {
  /// Points the folder at a server album; carries no settings of its own.
  album,
  only,
  include,
  remove,
}

/// One scope action, with the settings it would store.
class _AlbumScopeChoice {
  const _AlbumScopeChoice({
    required this.action,
    required this.label,
    required this.next,
    this.confirm = false,
  });

  final _AlbumAction action;
  final String label;
  final AppSettings next;

  /// True when the action drops albums, which discards queued work.
  final bool confirm;
}

/// Asks before a scope change drops albums.
///
/// The pipeline clears every queued row that has not uploaded yet and rescans
/// from zero, so the dialog says both things rather than surprising the user
/// with an empty queue afterwards.
Future<bool> confirmScopeNarrowing(
  BuildContext context, {
  required String title,
  required String action,
}) async {
  final confirmed = await showDialog<bool>(
    context: context,
    builder: (context) => AlertDialog(
      title: Text(title),
      content: const Text(
        'Photos still waiting to upload are dropped, and the scan starts over '
        'for the new scope. Photos that are already backed up stay on your '
        'server.',
      ),
      actions: <Widget>[
        TextButton(
          key: const Key('scope-cancel'),
          onPressed: () => Navigator.of(context).pop(false),
          child: const Text('Cancel'),
        ),
        FilledButton(
          key: const Key('scope-confirm'),
          onPressed: () => Navigator.of(context).pop(true),
          child: Text(action),
        ),
      ],
    ),
  );
  return confirmed ?? false;
}

/// App-bar action for one album's grid: puts that album in scope.
///
/// Shown as a quiet "In backup" label when it already is, so the album's own
/// screen always says where it stands.
class AlbumScopeAction extends StatelessWidget {
  const AlbumScopeAction({
    super.key,
    required this.album,
    required this.settings,
    required this.onScopeChanged,
    this.libraryCount,
  });

  /// Album the grid shows.
  final MediaFolder album;

  /// Current backup preferences.
  final AppSettings settings;

  /// Persists the new scope.
  final Future<void> Function(AppSettings settings) onScopeChanged;

  /// Assets in the whole library, for the "this album is everything" case.
  final int? libraryCount;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;

    if (AlbumScope.of(settings).includes(album)) {
      return Padding(
        padding: const EdgeInsets.only(right: 12),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: <Widget>[
            Icon(Icons.check_circle_rounded, size: 16, color: scheme.primary),
            const SizedBox(width: 6),
            Text(
              'In backup',
              style: theme.textTheme.labelLarge?.copyWith(
                color: scheme.primary,
                fontWeight: FontWeight.w600,
              ),
            ),
          ],
        ),
      );
    }

    return TextButton(
      key: const Key('album-back-up'),
      onPressed: () => unawaited(_backUpAlbum(context)),
      child: const Text('Back up album'),
    );
  }

  Future<void> _backUpAlbum(BuildContext context) async {
    final count = libraryCount;
    final coversAll = count != null && album.assetCount == count;
    final next = onlyAlbumInScope(
      settings,
      album: album,
      coversWholeLibrary: coversAll,
    );
    if (next == settings) return;

    if (!coversAll) {
      final confirmed = await confirmScopeNarrowing(
        context,
        title: 'Back up only “${album.name}”?',
        action: 'Back up this album',
      );
      if (!confirmed || !context.mounted) return;
    }

    try {
      await onScopeChanged(next);
    } on Object {
      if (!context.mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Could not change the backup scope. Try again.'),
        ),
      );
    }
  }
}

/// What the backup reads right now, and the one-tap way to widen it.
class _ScopePanel extends StatelessWidget {
  const _ScopePanel({required this.settings, required this.onBackUpEverything});

  final AppSettings settings;

  /// Null when every album is already in scope.
  final VoidCallback? onBackUpEverything;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    final all = settings.uploadAllFolders;

    final summary = Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        Text(
          'BACKUP SCOPE',
          style: theme.textTheme.labelSmall?.copyWith(
            color: scheme.onSurfaceVariant,
            fontWeight: FontWeight.w600,
            letterSpacing: 1.2,
          ),
        ),
        const SizedBox(height: 5),
        Text(
          albumScopeLabel(settings),
          style: theme.textTheme.titleMedium?.copyWith(
            color: scheme.onSurface,
            fontWeight: FontWeight.w700,
            letterSpacing: -0.2,
          ),
        ),
        const SizedBox(height: 4),
        Text(
          all
              ? 'Every album on this phone is backed up.'
              : 'Only albums marked “Backing up” are scanned. The rest '
                    'stay on this phone.',
          style: theme.textTheme.bodySmall?.copyWith(
            color: scheme.onSurfaceVariant,
            height: 1.4,
          ),
        ),
      ],
    );
    final action = onBackUpEverything != null
        ? TextButton(
            key: const Key('scope-all'),
            onPressed: onBackUpEverything,
            child: const Text('Back up everything'),
          )
        : Icon(Icons.check_circle_rounded, size: 20, color: scheme.primary);

    return Panel(
      child: LayoutBuilder(
        builder: (context, constraints) {
          // The button needs ~300 dp of panel width next to the copy (more once
          // text is scaled), else it clips the label the user has to read.
          // shortcut: a width breakpoint, not a measured row; upgrade by
          // measuring the intrinsic row if the copy grows.
          final stacked =
              onBackUpEverything != null &&
              constraints.maxWidth <
                  300 * MediaQuery.textScalerOf(context).scale(1);

          if (stacked) {
            return Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[summary, const SizedBox(height: 4), action],
            );
          }

          return Row(
            crossAxisAlignment: CrossAxisAlignment.center,
            children: <Widget>[
              Expanded(child: summary),
              const SizedBox(width: 8),
              action,
            ],
          );
        },
      ),
    );
  }
}

/// One album: cover, name, how many items, and whether it is in scope.
class _AlbumCard extends StatelessWidget {
  const _AlbumCard({
    required this.album,
    required this.inScope,
    required this.cover,
    required this.progress,
    required this.onOpen,
    required this.menu,
    this.folderAlbumId,
    this.folderAlbum,
    this.albumsKnown = false,
  });

  final MediaFolder album;
  final bool inScope;
  final Future<Uint8List?>? cover;

  /// Backed-up tally, or null when the card shows the platform count only.
  final Future<AlbumProgress?>? progress;

  /// Server album this folder's uploads join, or null when none is set.
  final String? folderAlbumId;

  /// The album behind [folderAlbumId]; null while the list has not loaded, or
  /// once the album was deleted on the server.
  final ServerAlbum? folderAlbum;

  /// Whether [serverAlbums] arrived, so a missing id means "deleted", not
  /// "not read yet".
  final bool albumsKnown;

  final VoidCallback onOpen;

  /// Trailing action menu, or an empty box when nothing would change.
  final Widget menu;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    final mappedId = folderAlbumId;

    return Panel(
      padding: EdgeInsets.zero,
      child: InkWell(
        key: Key('album-${album.id}'),
        onTap: onOpen,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(10, 10, 4, 10),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: <Widget>[
              Row(
                children: <Widget>[
                  _AlbumCover(album: album, cover: cover),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      mainAxisSize: MainAxisSize.min,
                      children: <Widget>[
                        Text(
                          album.name,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: theme.textTheme.titleSmall?.copyWith(
                            color: scheme.onSurface,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                        const SizedBox(height: 4),
                        _AlbumSummary(album: album, progress: progress),
                        const SizedBox(height: 5),
                        _ScopeChip(inScope: inScope),
                      ],
                    ),
                  ),
                  menu,
                ],
              ),
              if (mappedId != null) ...<Widget>[
                const SizedBox(height: 8),
                Padding(
                  padding: const EdgeInsets.only(right: 10),
                  child: _FolderAlbumLine(
                    album: folderAlbum,
                    albumsKnown: albumsKnown,
                  ),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }
}

/// Where this folder's uploads also land, and whether that hides them.
///
/// A footer under the card rather than another chip: the scope chip already
/// owns the loud row, and hiding must still be readable in one line.
///
/// Three states, decided by [albumsKnown] and the lookup alone: the list has not
/// arrived yet (neutral "Album set", because the id has not been looked for), it
/// arrived and the id is absent — including an empty list — ("Album missing",
/// which is what a deleted album looks like), or the album is found.
class _FolderAlbumLine extends StatelessWidget {
  const _FolderAlbumLine({required this.album, required this.albumsKnown});

  /// The album behind the mapping; null means it is not in the list.
  final ServerAlbum? album;

  /// Whether the list [album] was looked up in actually arrived from the server.
  final bool albumsKnown;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    final album = this.album;

    if (album == null && !albumsKnown) {
      return Row(
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          Icon(Icons.folder_rounded, size: 12, color: scheme.onSurfaceVariant),
          const SizedBox(width: 5),
          Text(
            'Album set',
            style: theme.textTheme.labelSmall?.copyWith(
              color: scheme.onSurfaceVariant,
              fontWeight: FontWeight.w500,
            ),
          ),
        ],
      );
    }

    if (album == null) {
      return Row(
        children: <Widget>[
          Icon(Icons.link_off_rounded, size: 12, color: scheme.error),
          const SizedBox(width: 5),
          Text(
            'Album missing',
            style: theme.textTheme.labelSmall?.copyWith(
              color: scheme.error,
              fontWeight: FontWeight.w600,
            ),
          ),
        ],
      );
    }

    return Wrap(
      spacing: 8,
      runSpacing: 2,
      crossAxisAlignment: WrapCrossAlignment.center,
      children: <Widget>[
        Row(
          mainAxisSize: MainAxisSize.min,
          children: <Widget>[
            Icon(
              Icons.folder_rounded,
              size: 12,
              color: scheme.onSurfaceVariant,
            ),
            const SizedBox(width: 5),
            Flexible(
              child: Text(
                album.name,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: theme.textTheme.labelSmall?.copyWith(
                  color: scheme.onSurfaceVariant,
                  fontWeight: FontWeight.w500,
                ),
              ),
            ),
          ],
        ),
        if (album.hiddenFromTimeline)
          Row(
            mainAxisSize: MainAxisSize.min,
            children: <Widget>[
              Icon(
                Icons.visibility_off_rounded,
                size: 12,
                color: scheme.tertiary,
              ),
              const SizedBox(width: 3),
              Flexible(
                child: Text(
                  'Hidden from timeline',
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: theme.textTheme.labelSmall?.copyWith(
                    color: scheme.tertiary,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ),
            ],
          ),
      ],
    );
  }
}

/// How many of the album's assets the backup already holds.
///
/// The platform's own count is what the card shows until the tally answers, and
/// what it keeps when the tally was not asked for or failed: a hint that is
/// missing must never read as an error.
class _AlbumSummary extends StatelessWidget {
  const _AlbumSummary({required this.album, required this.progress});

  final MediaFolder album;

  /// Backed-up tally, or null when one was not asked for.
  final Future<AlbumProgress?>? progress;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final style = theme.textTheme.labelMedium?.copyWith(
      color: theme.colorScheme.onSurfaceVariant,
    );

    return FutureBuilder<AlbumProgress?>(
      future: progress,
      builder: (context, snapshot) {
        final tally = snapshot.data;
        if (tally == null || tally.total <= 0) {
          return Text(countLabel(album.assetCount, 'item'), style: style);
        }
        final backedUp = formatCount(tally.backedUp);
        final total = formatCount(tally.total);
        return Text(
          tally.partial
              ? '$backedUp of the first $total backed up'
              : '$backedUp of $total backed up',
          style: style,
        );
      },
    );
  }
}

/// Album cover: the preview when the caller has one, a quiet tint otherwise.
class _AlbumCover extends StatelessWidget {
  const _AlbumCover({required this.album, required this.cover});

  final MediaFolder album;
  final Future<Uint8List?>? cover;

  static const double side = 52;

  @override
  Widget build(BuildContext context) {
    return ClipRRect(
      borderRadius: BorderRadius.circular(10),
      child: SizedBox.square(
        dimension: side,
        child: FutureBuilder<Uint8List?>(
          future: cover,
          builder: (context, snapshot) {
            final bytes = snapshot.data;
            if (bytes == null || bytes.isEmpty) return _fallback(context);
            return Image.memory(
              bytes,
              fit: BoxFit.cover,
              gaplessPlayback: true,
              errorBuilder: (context, error, stack) => _fallback(context),
            );
          },
        ),
      ),
    );
  }

  /// Neutral cover, tinted from the album id so neighbours stay tellable apart
  /// even before any preview exists.
  Widget _fallback(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final palette = <Color>[scheme.primary, scheme.secondary, scheme.tertiary];
    var hash = 0;
    for (final unit in album.id.codeUnits) {
      hash = (hash * 31 + unit) & 0x7fffffff;
    }
    final tint = palette[hash % palette.length];

    return DecoratedBox(
      decoration: BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: <Color>[
            Color.alphaBlend(
              tint.withValues(alpha: 0.35),
              scheme.surfaceContainer,
            ),
            scheme.surfaceContainerHigh,
          ],
        ),
      ),
      child: Center(
        child: Icon(
          album.isCamera
              ? Icons.photo_camera_outlined
              : Icons.photo_library_outlined,
          size: 20,
          color: scheme.onSurface.withValues(alpha: 0.75),
        ),
      ),
    );
  }
}

/// Whether this album is part of the backup set.
class _ScopeChip extends StatelessWidget {
  const _ScopeChip({required this.inScope});

  final bool inScope;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    final (Color foreground, Color background, IconData icon) = inScope
        ? (
            scheme.onPrimaryContainer,
            scheme.primaryContainer,
            Icons.check_circle_rounded,
          )
        : (
            scheme.onSurfaceVariant,
            scheme.surfaceContainerHighest,
            Icons.circle_outlined,
          );

    return Semantics(
      container: true,
      label: inScope ? 'Backing up' : 'Not backed up',
      child: ExcludeSemantics(
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
          decoration: BoxDecoration(
            color: background,
            borderRadius: BorderRadius.circular(100),
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: <Widget>[
              Icon(icon, size: 12, color: foreground),
              const SizedBox(width: 4),
              Flexible(
                child: Text(
                  inScope ? 'Backing up' : 'Not backed up',
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: theme.textTheme.labelSmall?.copyWith(
                    color: foreground,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
