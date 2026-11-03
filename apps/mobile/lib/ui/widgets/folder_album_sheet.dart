import 'dart:async';

import 'package:flutter/material.dart';

import '../../core/api_client.dart';
import '../../server/album_client.dart';
import 'count_format.dart';

/// Opens the sheet that points one device folder at a server album.
///
/// Nothing here touches a service: the reads and writes arrive as callbacks, so
/// the sheet pumps in a widget test with no plugins and no network.
Future<void> showFolderAlbumSheet(
  BuildContext context, {
  required String folderId,
  required String folderName,
  required String? currentAlbumId,
  required Future<List<ServerAlbum>> Function() loadAlbums,
  required Future<ServerAlbum> Function(
    String name, {
    required bool hiddenFromTimeline,
  })
  createAlbum,
  required Future<void> Function(String folderId, String? albumId) onChanged,
}) {
  final scheme = Theme.of(context).colorScheme;

  return showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    useSafeArea: true,
    showDragHandle: true,
    backgroundColor: scheme.surfaceContainer,
    shape: const RoundedRectangleBorder(
      borderRadius: BorderRadius.vertical(top: Radius.circular(22)),
    ),
    builder: (context) => FolderAlbumSheet(
      folderId: folderId,
      folderName: folderName,
      currentAlbumId: currentAlbumId,
      loadAlbums: loadAlbums,
      createAlbum: createAlbum,
      onChanged: onChanged,
    ),
  );
}

/// Which server album this folder's uploads join, or none.
///
/// Hiding is the interesting part: an album flagged "hidden" keeps its assets
/// off the web timeline, so the flag is spelled out on every row rather than
/// left to a server-side setting the user has to remember.
class FolderAlbumSheet extends StatefulWidget {
  const FolderAlbumSheet({
    super.key,
    required this.folderId,
    required this.folderName,
    required this.currentAlbumId,
    required this.loadAlbums,
    required this.createAlbum,
    required this.onChanged,
  });

  /// Device folder the mapping is stored for.
  final String folderId;

  /// Device folder name, shown in the header.
  final String folderName;

  /// Album the folder points at now, or null when it points nowhere.
  final String? currentAlbumId;

  /// Reads the server's albums; failures are shown inline.
  final Future<List<ServerAlbum>> Function() loadAlbums;

  /// Creates an album, optionally kept out of the timeline.
  final Future<ServerAlbum> Function(
    String name, {
    required bool hiddenFromTimeline,
  })
  createAlbum;

  /// Persists the mapping; null clears it.
  final Future<void> Function(String folderId, String? albumId) onChanged;

  @override
  State<FolderAlbumSheet> createState() => _FolderAlbumSheetState();
}

class _FolderAlbumSheetState extends State<FolderAlbumSheet> {
  /// Albums from the last read; null until one lands.
  List<ServerAlbum>? _albums;

  /// Failure of the list read, shown with a retry row.
  String? _loadError;

  /// Failure of the last write, shown above the rows.
  String? _actionError;

  /// True while a write is in flight; every row waits for it.
  bool _busy = false;

  /// Whether the inline "New album" form is open.
  bool _creating = false;

  /// New albums hide from the timeline by default: that is what a user who
  /// creates an album for one folder usually means, and the switch says so.
  bool _hidden = true;

  final TextEditingController _name = TextEditingController();

  @override
  void initState() {
    super.initState();
    unawaited(_load());
  }

  @override
  void dispose() {
    _name.dispose();
    super.dispose();
  }

  /// Plain wording for a failure; the server's own message when there is one.
  String _describe(Object error) {
    return error is ApiException
        ? error.message
        : 'Could not reach your server. Try again.';
  }

  Future<void> _load() async {
    setState(() => _loadError = null);
    try {
      final albums = await widget.loadAlbums();
      if (!mounted) return;
      setState(() => _albums = albums);
    } on Object catch (error) {
      if (!mounted) return;
      setState(() => _loadError = _describe(error));
    }
  }

  /// Runs one write, closing the sheet only once it succeeded.
  Future<void> _run(Future<void> Function() write) async {
    if (_busy) return;
    setState(() {
      _busy = true;
      _actionError = null;
    });
    try {
      await write();
      if (!mounted) return;
      Navigator.of(context).pop();
    } on Object catch (error) {
      if (!mounted) return;
      setState(() {
        _busy = false;
        _actionError = _describe(error);
      });
    }
  }

  void _choose(ServerAlbum album) {
    // Re-picking the current album would only queue a pointless backfill pass.
    if (album.id == widget.currentAlbumId) {
      Navigator.of(context).pop();
      return;
    }
    unawaited(_run(() => widget.onChanged(widget.folderId, album.id)));
  }

  void _clear() {
    unawaited(_run(() => widget.onChanged(widget.folderId, null)));
  }

  void _create() {
    final name = _name.text.trim();
    if (name.isEmpty) return;
    unawaited(
      _run(() async {
        final album = await widget.createAlbum(
          name,
          hiddenFromTimeline: _hidden,
        );
        if (!mounted) return;
        // A failed mapping below must not leave the form primed to create the
        // same album twice: the new album joins the list, ready to tap.
        setState(() {
          _albums = <ServerAlbum>[album, ...?_albums];
          _creating = false;
          _name.clear();
        });
        // Creating an album here means "this folder goes there".
        await widget.onChanged(widget.folderId, album.id);
      }),
    );
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;

    return Padding(
      // The create button sits above the keyboard, not under it.
      padding: EdgeInsets.only(bottom: MediaQuery.viewInsetsOf(context).bottom),
      child: ConstrainedBox(
        constraints: BoxConstraints(
          maxHeight: MediaQuery.sizeOf(context).height * 0.85,
        ),
        child: Column(
          key: const Key('folder-album-sheet'),
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: <Widget>[
            Padding(
              padding: const EdgeInsets.fromLTRB(24, 0, 24, 12),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  Text(
                    'Save to server album',
                    style: theme.textTheme.titleMedium?.copyWith(
                      color: scheme.onSurface,
                      fontWeight: FontWeight.w700,
                      letterSpacing: -0.2,
                    ),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    widget.folderName,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: theme.textTheme.bodySmall?.copyWith(
                      color: scheme.onSurfaceVariant,
                    ),
                  ),
                ],
              ),
            ),
            if (_busy)
              const LinearProgressIndicator(
                minHeight: 2,
                semanticsLabel: 'Saving',
              ),
            if (_actionError != null) _InlineError(message: _actionError!),
            Flexible(
              child: ListView(
                shrinkWrap: true,
                padding: const EdgeInsets.fromLTRB(8, 0, 8, 20),
                children: _rows(context),
              ),
            ),
          ],
        ),
      ),
    );
  }

  List<Widget> _rows(BuildContext context) {
    final theme = Theme.of(context);
    final albums = _albums;
    final loadError = _loadError;

    if (loadError != null) {
      return <Widget>[
        _InlineError(message: loadError, onRetry: () => unawaited(_load())),
      ];
    }
    if (albums == null) {
      return const <Widget>[
        Padding(
          padding: EdgeInsets.symmetric(vertical: 28),
          child: Center(
            child: SizedBox.square(
              dimension: 22,
              child: CircularProgressIndicator(
                strokeWidth: 2.2,
                semanticsLabel: 'Reading your server albums',
              ),
            ),
          ),
        ),
      ];
    }

    return <Widget>[
      ListTile(
        key: const Key('folder-album-none'),
        enabled: !_busy && widget.currentAlbumId != null,
        leading: const Icon(Icons.folder_off_outlined),
        title: const Text('Not in an album'),
        trailing: widget.currentAlbumId == null
            ? Icon(Icons.check_circle_rounded, color: theme.colorScheme.primary)
            : null,
        onTap: _clear,
      ),
      for (final album in albums) _albumTile(album),
      if (albums.isEmpty)
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 4, 16, 8),
          child: Text(
            'No albums on your server yet. Create one below.',
            style: theme.textTheme.bodySmall?.copyWith(
              color: theme.colorScheme.onSurfaceVariant,
              height: 1.4,
            ),
          ),
        ),
      ListTile(
        key: const Key('folder-album-new'),
        enabled: !_busy,
        leading: const Icon(Icons.add_rounded),
        title: const Text('New album'),
        trailing: Icon(
          _creating ? Icons.expand_less_rounded : Icons.expand_more_rounded,
        ),
        onTap: () => setState(() => _creating = !_creating),
      ),
      if (_creating) _newAlbumForm(context),
    ];
  }

  Widget _albumTile(ServerAlbum album) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    final current = album.id == widget.currentAlbumId;

    return ListTile(
      key: Key('folder-album-${album.id}'),
      enabled: !_busy,
      leading: Icon(
        current ? Icons.photo_album_rounded : Icons.photo_album_outlined,
        color: current ? scheme.primary : null,
      ),
      title: Text(
        album.name,
        maxLines: 1,
        overflow: TextOverflow.ellipsis,
        style: current
            ? theme.textTheme.bodyLarge?.copyWith(fontWeight: FontWeight.w600)
            : null,
      ),
      subtitle: Wrap(
        spacing: 6,
        runSpacing: 2,
        crossAxisAlignment: WrapCrossAlignment.center,
        children: <Widget>[
          Text(countLabel(album.assetCount, 'asset')),
          if (album.hiddenFromTimeline) const _HiddenChip(),
        ],
      ),
      trailing: current
          ? Icon(Icons.check_circle_rounded, color: scheme.primary)
          : null,
      onTap: () => _choose(album),
    );
  }

  Widget _newAlbumForm(BuildContext context) {
    final canCreate = !_busy && _name.text.trim().isNotEmpty;

    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 4, 16, 4),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          TextField(
            key: const Key('folder-album-name'),
            controller: _name,
            enabled: !_busy,
            autofocus: true,
            textInputAction: TextInputAction.done,
            textCapitalization: TextCapitalization.sentences,
            decoration: const InputDecoration(hintText: 'Album name'),
            onChanged: (_) => setState(() {}),
          ),
          SwitchListTile(
            key: const Key('folder-album-hidden'),
            contentPadding: EdgeInsets.zero,
            value: _hidden,
            onChanged: _busy
                ? null
                : (value) => setState(() => _hidden = value),
            title: const Text('Hide from timeline'),
            subtitle: const Text(
              'Photos stay out of the timeline but are still in the album.',
            ),
          ),
          const SizedBox(height: 6),
          FilledButton(
            key: const Key('folder-album-create'),
            onPressed: canCreate ? _create : null,
            child: const Text('Create album'),
          ),
        ],
      ),
    );
  }
}

/// The "hidden from timeline" marker, small enough for a two-line row.
class _HiddenChip extends StatelessWidget {
  const _HiddenChip();

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
      decoration: BoxDecoration(
        color: scheme.tertiary.withValues(alpha: 0.14),
        borderRadius: BorderRadius.circular(100),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          Icon(Icons.visibility_off_rounded, size: 11, color: scheme.tertiary),
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
    );
  }
}

/// One quiet failure line; the optional retry keeps a read's failure local.
class _InlineError extends StatelessWidget {
  const _InlineError({required this.message, this.onRetry});

  final String message;
  final VoidCallback? onRetry;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;

    return Semantics(
      liveRegion: true,
      child: Padding(
        padding: const EdgeInsets.fromLTRB(16, 0, 8, 4),
        child: Row(
          children: <Widget>[
            Icon(Icons.cloud_off_rounded, size: 18, color: scheme.error),
            const SizedBox(width: 10),
            Expanded(
              child: Text(
                message,
                style: theme.textTheme.bodySmall?.copyWith(
                  color: scheme.onSurfaceVariant,
                  height: 1.35,
                ),
              ),
            ),
            if (onRetry != null)
              TextButton(onPressed: onRetry, child: const Text('Try again')),
          ],
        ),
      ),
    );
  }
}
