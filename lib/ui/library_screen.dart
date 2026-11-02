import 'dart:async';
import 'dart:typed_data';

import 'package:flutter/material.dart';

import '../library/backup_status.dart';
import '../media/photo_observer.dart';
import '../settings/settings_store.dart';
import '../sync/transfer_progress.dart';
import '../upload/models.dart';
import 'widgets/app_background.dart';
import 'widgets/asset_tile.dart';
import 'widgets/count_format.dart';
import 'widgets/panel.dart';
import 'widgets/status_banner.dart';

/// The device library, newest first, one column-page at a time.
///
/// Every value and action is supplied by the caller, so this screen never
/// touches services, the queue or the platform: it asks for a page, asks what
/// the backup knows about that page, and draws both.
class LibraryScreen extends StatefulWidget {
  const LibraryScreen({
    super.key,
    required this.permission,
    required this.settings,
    required this.syncing,
    required this.queueRevision,
    required this.progress,
    required this.loadPage,
    required this.loadStates,
    required this.thumbnail,
    required this.onBackUpNow,
    required this.onOpenSettings,
    required this.onSyncNow,
    required this.onRequestAccess,
    this.folderId,
    this.title,
  });

  /// Current photo-library permission; the grid only reads when it allows it.
  final PhotoPermission permission;

  /// Backup preferences: which containers count as in scope, and the scope
  /// pill's wording.
  final AppSettings settings;

  /// True while a sync pass runs; the header's sync action steps aside.
  final bool syncing;

  /// Bumped by the controller whenever queue rows changed; the loaded page's
  /// states are re-read then, and only then.
  final int queueRevision;

  /// Live progress of the asset in flight, so its one tile moves on its own.
  final TransferProgress progress;

  /// Newest-first page of the device library.
  final Future<List<AssetCandidate>> Function({
    required int offset,
    int limit,
    String? folderId,
  })
  loadPage;

  /// Queue state of the listed assets; ids with no row are absent.
  final Future<Map<String, UploadState>> Function(List<String> localIds)
  loadStates;

  /// Encoded preview for a library id, or null when the platform has none.
  final Future<Uint8List?> Function(String localId) thumbnail;

  /// Queues the selected assets ahead of the scan scope.
  final Future<void> Function(List<AssetCandidate> assets) onBackUpNow;

  /// Opens the settings screen.
  final VoidCallback onOpenSettings;

  /// Starts a sync pass, including the permission prompt when it is missing.
  final Future<void> Function() onSyncNow;

  /// Re-reads the library permission and prompts for it when undetermined.
  ///
  /// Separate from [onSyncNow] because a paused backup never runs a pass, and
  /// the grid must still be able to ask for the grant.
  final Future<void> Function() onRequestAccess;

  /// Album to page; null reads the whole library.
  final String? folderId;

  /// Screen title, defaulting to `Library`.
  final String? title;

  @override
  State<LibraryScreen> createState() => _LibraryScreenState();
}

/// What the grid is filtered to; filtering never reaches the platform.
enum _LibraryFilter { all, notBackedUp, failed }

class _LibraryScreenState extends State<LibraryScreen> {
  /// Page size asked of the controller; a shorter page ends the list.
  static const int _pageSize = 200;

  /// How close to the end of the list the next page is requested.
  static const double _loadAhead = 600;

  static const List<String> _months = <String>[
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ];

  final List<AssetCandidate> _assets = <AssetCandidate>[];

  /// Queue rows for the loaded page, keyed by platform id.
  final Map<String, UploadState> _states = <String, UploadState>{};

  /// Ids whose states were asked for; anything else shows no mark yet, because
  /// "not backed up" is a claim the screen has no right to make before asking.
  final Set<String> _resolved = <String>{};

  /// Selected assets by id, so the action bar can pass the candidates along.
  final Map<String, AssetCandidate> _selected = <String, AssetCandidate>{};

  final ScrollController _scroll = ScrollController();

  _LibraryFilter _filter = _LibraryFilter.all;
  bool _selecting = false;
  bool _loading = false;
  bool _hasMore = true;
  int _offset = 0;
  String? _error;
  bool _disposed = false;

  /// Bumped by a refresh so a page still in flight is dropped, not appended.
  int _generation = 0;

  bool get _canRead => _isReadable(widget.permission);

  @override
  void initState() {
    super.initState();
    _scroll.addListener(_onScroll);
    if (_canRead) unawaited(_loadMore());
  }

  @override
  void didUpdateWidget(LibraryScreen oldWidget) {
    super.didUpdateWidget(oldWidget);
    // Queue state moved: one chunked re-read of what can still change.
    if (oldWidget.queueRevision != widget.queueRevision) _refreshStates();
    // Access was granted while the screen sat on the permission state.
    if (!_isReadable(oldWidget.permission) && _canRead) {
      unawaited(_refresh());
      return;
    }
    // The backup scope changed under us; the old pages belong to another set.
    if (oldWidget.folderId != widget.folderId) unawaited(_refresh());
  }

  static bool _isReadable(PhotoPermission permission) =>
      permission == PhotoPermission.authorized ||
      permission == PhotoPermission.limited;

  @override
  void dispose() {
    // Anything still in flight checks this before touching state.
    _disposed = true;
    _scroll.removeListener(_onScroll);
    _scroll.dispose();
    super.dispose();
  }

  void _onScroll() {
    if (!_scroll.hasClients) return;
    if (_error != null) return; // the footer offers an explicit retry instead
    if (_scroll.position.extentAfter > _loadAhead) return;
    unawaited(_loadMore());
  }

  /// Clears the grid and reads the first page again; also pull-to-refresh.
  Future<void> _refresh() async {
    if (_disposed) return;
    _generation++;
    setState(() {
      _assets.clear();
      _states.clear();
      _resolved.clear();
      _selected.clear();
      _selecting = false;
      _offset = 0;
      _hasMore = true;
      _error = null;
      _loading = false;
    });
    await _loadMore();
  }

  Future<void> _loadMore() async {
    if (_disposed || _loading || !_hasMore || !_canRead) return;
    final generation = _generation;
    setState(() {
      _loading = true;
      _error = null;
    });

    try {
      final page = await widget.loadPage(
        offset: _offset,
        limit: _pageSize,
        folderId: widget.folderId,
      );
      if (_disposed || generation != _generation) return;

      // A queue pass can re-page under us; keep each asset once.
      final known = <String>{for (final asset in _assets) asset.localId};
      final fresh = <AssetCandidate>[
        for (final asset in page)
          if (known.add(asset.localId)) asset,
      ];
      final ids = <String>[for (final asset in fresh) asset.localId];

      // Asked before the page is shown, so no tile falsely reads "not backed
      // up" for a frame. A failed read leaves the marks off this page: the ids
      // stay unresolved, and unresolved never means "not backed up".
      var resolved = true;
      Map<String, UploadState> states = const <String, UploadState>{};
      if (ids.isNotEmpty) {
        try {
          states = await widget.loadStates(ids);
        } on Object {
          resolved = false;
        }
        if (_disposed || generation != _generation) return;
      }

      setState(() {
        _assets.addAll(fresh);
        _states.addAll(states);
        if (resolved) _resolved.addAll(ids);
        _offset += page.length;
        _hasMore = page.length >= _pageSize;
        _loading = false;
      });
      _fillViewport();
    } on Object {
      if (_disposed || generation != _generation) return;
      setState(() {
        _loading = false;
        _error = 'Could not read your library.';
      });
    }
  }

  /// Keeps paging while a page does not fill the window, so a wide screen is
  /// never stuck on a silent half-empty grid.
  void _fillViewport() {
    if (!_hasMore) return;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (_disposed || !mounted) return;
      if (!_scroll.hasClients || _scroll.position.maxScrollExtent > 0) return;
      unawaited(_loadMore());
    });
  }

  /// Re-reads the states that can still move; finished uploads never change.
  void _refreshStates() {
    final ids = <String>[
      for (final asset in _assets)
        if (_statusOf(asset) != BackupStatus.backedUp) asset.localId,
    ];
    if (ids.isEmpty) return;
    unawaited(_applyStates(ids));
  }

  Future<void> _applyStates(List<String> ids) async {
    Map<String, UploadState> states;
    try {
      states = await widget.loadStates(ids);
    } on Object {
      // Keep the previous marks: a failed read is not a "not backed up" answer.
      return;
    }
    if (_disposed) return;
    setState(() {
      for (final id in ids) {
        _states.remove(id);
      }
      _states.addAll(states);
      _resolved.addAll(ids);
    });
  }

  /// Badge for [asset]; null while its queue state is still unknown.
  BackupStatus? _statusOf(AssetCandidate asset) {
    final progress = widget.progress;
    // The row lags the bytes, so the live transfer wins for its own tile.
    if (progress.active && progress.localId == asset.localId) {
      return BackupStatus.uploading;
    }
    if (!_resolved.contains(asset.localId)) return null;
    return resolveBackupStatus(
      state: _states[asset.localId],
      asset: asset,
      settings: widget.settings,
    );
  }

  /// Live fraction, only on the tile the transfer is working on.
  double? _fractionFor(AssetCandidate asset) {
    final progress = widget.progress;
    if (!progress.active || progress.localId != asset.localId) return null;
    // No byte count while the bytes are still being prepared.
    return progress.phase == TransferPhase.uploading ? progress.fraction : null;
  }

  bool _matchesFilter(AssetCandidate asset) {
    final status = _statusOf(asset);
    if (status == null) return false;
    return switch (_filter) {
      _LibraryFilter.all => true,
      _LibraryFilter.notBackedUp => status != BackupStatus.backedUp,
      _LibraryFilter.failed => status == BackupStatus.failed,
    };
  }

  List<AssetCandidate> _filtered() {
    if (_filter == _LibraryFilter.all) return _assets;
    return <AssetCandidate>[
      for (final asset in _assets)
        if (_matchesFilter(asset)) asset,
    ];
  }

  Map<_LibraryFilter, int> _filterCounts() {
    var notBackedUp = 0;
    var failed = 0;
    for (final asset in _assets) {
      final status = _statusOf(asset);
      if (status == null) continue;
      if (status == BackupStatus.failed) failed++;
      if (status != BackupStatus.backedUp) notBackedUp++;
    }
    return <_LibraryFilter, int>{
      _LibraryFilter.all: _assets.length,
      _LibraryFilter.notBackedUp: notBackedUp,
      _LibraryFilter.failed: failed,
    };
  }

  bool get _selectionCanBackUp {
    for (final asset in _selected.values) {
      if (_statusOf(asset) != BackupStatus.excluded) return true;
    }
    return false;
  }

  /// Mirrors the dashboard's wording for what the backup pass reads.
  String get _scopeLabel {
    if (widget.settings.uploadAllFolders) return 'All albums';
    final count = widget.settings.uploadFolderIds.length;
    return count > 1 ? '${formatCount(count)} albums' : 'Camera album';
  }

  void _toggleSelection(AssetCandidate asset) {
    setState(() {
      _selecting = true;
      if (_selected.remove(asset.localId) == null) {
        _selected[asset.localId] = asset;
      }
    });
  }

  void _exitSelection() {
    if (!_selecting && _selected.isEmpty) return;
    setState(() {
      _selecting = false;
      _selected.clear();
    });
  }

  Future<void> _backUpSelected() async {
    final assets = <AssetCandidate>[..._selected.values];
    _exitSelection();
    try {
      await widget.onBackUpNow(assets);
    } on Object {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Could not queue those photos. Try again.'),
        ),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    return AppBackground(
      child: Scaffold(
        backgroundColor: Colors.transparent,
        appBar: _appBar(context),
        body: SafeArea(
          top: false,
          bottom: false,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: <Widget>[
              if (!_selecting && _canRead) _infoRow(context),
              if (!_selecting && _canRead && _assets.isNotEmpty) _filterRow(),
              Expanded(child: _body(context)),
            ],
          ),
        ),
      ),
    );
  }

  PreferredSizeWidget _appBar(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;

    if (_selecting) {
      return AppBar(
        leadingWidth: 88,
        leading: TextButton(
          onPressed: _exitSelection,
          child: const Text('Cancel'),
        ),
        titleSpacing: 0,
        title: Text(
          '${formatCount(_selected.length)} selected',
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
          style: theme.textTheme.titleMedium?.copyWith(
            color: scheme.onSurface,
            fontWeight: FontWeight.w600,
          ),
        ),
        actions: <Widget>[
          if (_selectionCanBackUp)
            Padding(
              padding: const EdgeInsets.only(right: 8),
              child: TextButton(
                key: const Key('library-back-up-now'),
                onPressed: _backUpSelected,
                child: const Text('Back up now'),
              ),
            ),
        ],
      );
    }

    return AppBar(
      titleSpacing: 20,
      title: Text(
        widget.title ?? 'Library',
        maxLines: 1,
        overflow: TextOverflow.ellipsis,
        style: theme.textTheme.titleLarge?.copyWith(
          color: scheme.onSurface,
          fontWeight: FontWeight.w700,
          letterSpacing: -0.3,
        ),
      ),
      actions: <Widget>[
        if (!widget.syncing)
          IconButton(
            key: const Key('library-sync'),
            tooltip: 'Sync now',
            onPressed: () => unawaited(widget.onSyncNow()),
            icon: const Icon(Icons.sync_rounded),
          ),
        Padding(
          padding: const EdgeInsets.only(right: 12),
          child: IconButton(
            key: const Key('library-settings'),
            tooltip: 'Settings',
            onPressed: widget.onOpenSettings,
            icon: const Icon(Icons.tune_rounded),
          ),
        ),
      ],
    );
  }

  /// Scope, how much is loaded, and the pass state: one quiet line.
  Widget _infoRow(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    final loaded = _assets.length;

    return Padding(
      padding: const EdgeInsets.fromLTRB(20, 0, 20, 8),
      child: Wrap(
        spacing: 10,
        runSpacing: 6,
        crossAxisAlignment: WrapCrossAlignment.center,
        children: <Widget>[
          _ScopePill(label: _scopeLabel),
          if (loaded > 0)
            Text(
              _hasMore
                  ? '${formatCount(loaded)}+ items'
                  : countLabel(loaded, 'item'),
              style: theme.textTheme.labelMedium?.copyWith(
                color: scheme.onSurfaceVariant,
              ),
            ),
          if (widget.syncing)
            Row(
              mainAxisSize: MainAxisSize.min,
              children: <Widget>[
                SizedBox.square(
                  dimension: 12,
                  child: CircularProgressIndicator(
                    strokeWidth: 1.8,
                    color: scheme.primary,
                    semanticsLabel: 'Backing up',
                  ),
                ),
                const SizedBox(width: 6),
                Text(
                  'Backing up',
                  style: theme.textTheme.labelMedium?.copyWith(
                    color: scheme.onSurfaceVariant,
                  ),
                ),
              ],
            ),
        ],
      ),
    );
  }

  /// All / Not backed up / Failed, counted over what is loaded.
  Widget _filterRow() {
    final counts = _filterCounts();
    return SizedBox(
      height: 48,
      child: SingleChildScrollView(
        scrollDirection: Axis.horizontal,
        padding: const EdgeInsets.symmetric(horizontal: 16),
        child: Row(
          children: <Widget>[
            _filterChip(_LibraryFilter.all, 'All', counts),
            const SizedBox(width: 8),
            _filterChip(_LibraryFilter.notBackedUp, 'Not backed up', counts),
            const SizedBox(width: 8),
            _filterChip(_LibraryFilter.failed, 'Failed', counts),
          ],
        ),
      ),
    );
  }

  Widget _filterChip(
    _LibraryFilter filter,
    String label,
    Map<_LibraryFilter, int> counts,
  ) {
    // A '+' says the count describes the loaded pages, not the whole library.
    final suffix = _hasMore ? '+' : '';
    return FilterChip(
      key: Key('filter-${filter.name}'),
      label: Text('$label ${formatCount(counts[filter] ?? 0)}$suffix'),
      selected: _filter == filter,
      materialTapTargetSize: MaterialTapTargetSize.padded,
      onSelected: (_) => setState(() => _filter = filter),
    );
  }

  Widget _body(BuildContext context) {
    final permissionState = _permissionState(context);
    if (permissionState != null) return permissionState;

    if (_error != null && _assets.isEmpty) {
      return ListView(
        padding: const EdgeInsets.fromLTRB(20, 12, 20, 24),
        children: <Widget>[
          StatusBanner(
            tone: StatusTone.danger,
            icon: Icons.cloud_off_rounded,
            title: 'Could not read your library',
            message: _error!,
            action: TextButton(
              onPressed: () => unawaited(_refresh()),
              child: const Text('Try again'),
            ),
          ),
        ],
      );
    }

    if (_assets.isEmpty) {
      if (_loading) {
        return const Center(
          child: CircularProgressIndicator(
            semanticsLabel: 'Reading your library',
          ),
        );
      }
      return _emptyLibrary(context);
    }

    return _grid(context);
  }

  /// Everything the grid needs to know about a blocked library, or null.
  Widget? _permissionState(BuildContext context) {
    final (
      String title,
      String message,
      String action,
      IconData icon,
    ) = switch (widget.permission) {
      PhotoPermission.notDetermined => (
        'Photo access not set up',
        'PhotoX needs to read this device\'s photo library to back it up. '
            'Nothing is uploaded until you allow access.',
        'Allow photo access',
        Icons.photo_library_outlined,
      ),
      PhotoPermission.denied => (
        'Photo access is off',
        'Allow photo access in your device settings, then try again.',
        'Try again',
        Icons.block_rounded,
      ),
      PhotoPermission.restricted => (
        'Photo access is restricted',
        'Device restrictions are blocking access to your photos. Change '
            'that in your device settings, then try again.',
        'Try again',
        Icons.block_rounded,
      ),
      PhotoPermission.authorized ||
      PhotoPermission.limited => ('', '', '', Icons.photo_library_outlined),
    };
    if (title.isEmpty) return null;

    return ListView(
      padding: const EdgeInsets.fromLTRB(20, 12, 20, 24),
      children: <Widget>[
        StatusBanner(
          tone: widget.permission == PhotoPermission.notDetermined
              ? StatusTone.warning
              : StatusTone.danger,
          icon: icon,
          title: title,
          message: message,
          action: TextButton(
            // ponytail: no deep link into OS settings without a permission
            // plugin; this re-reads the grant after the user changes it by hand.
            onPressed: () => unawaited(widget.onRequestAccess()),
            child: Text(action),
          ),
        ),
      ],
    );
  }

  Widget _emptyLibrary(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    final limited = widget.permission == PhotoPermission.limited;

    return ListView(
      padding: const EdgeInsets.fromLTRB(20, 32, 20, 24),
      children: <Widget>[
        Panel(
          child: Column(
            children: <Widget>[
              Icon(
                Icons.photo_library_outlined,
                size: 28,
                color: scheme.onSurfaceVariant,
              ),
              const SizedBox(height: 12),
              Text(
                limited ? 'No photos shared yet' : 'No photos yet',
                textAlign: TextAlign.center,
                style: theme.textTheme.titleSmall?.copyWith(
                  color: scheme.onSurface,
                  fontWeight: FontWeight.w600,
                ),
              ),
              const SizedBox(height: 6),
              Text(
                limited
                    ? 'Only the photos you shared with PhotoX appear here.'
                    : 'Photos and videos on this device appear here, marked '
                          'once they are backed up.',
                textAlign: TextAlign.center,
                style: theme.textTheme.bodySmall?.copyWith(
                  color: scheme.onSurfaceVariant,
                  height: 1.4,
                ),
              ),
              const SizedBox(height: 10),
              TextButton(
                onPressed: () => unawaited(_refresh()),
                child: const Text('Refresh'),
              ),
            ],
          ),
        ),
      ],
    );
  }

  Widget _grid(BuildContext context) {
    final visible = _filtered();
    final groups = _groupByDay(visible);
    final columns = _columnsFor(context);
    final headerHeight = _DayHeaderDelegate.heightFor(context);

    return RefreshIndicator(
      onRefresh: _refresh,
      child: CustomScrollView(
        controller: _scroll,
        physics: const AlwaysScrollableScrollPhysics(),
        slivers: <Widget>[
          if (widget.permission == PhotoPermission.limited)
            const SliverToBoxAdapter(
              child: Padding(
                padding: EdgeInsets.fromLTRB(16, 4, 16, 12),
                child: _LimitedNote(),
              ),
            ),
          if (groups.isEmpty)
            SliverFillRemaining(
              hasScrollBody: false,
              child: _noMatches(context),
            )
          else ...<Widget>[
            // One group per day: a pinned header only gets pushed out by the
            // next pinned header when both sit in the same group. As plain
            // siblings every header pins at the same offset and they stack.
            for (final group in groups)
              SliverMainAxisGroup(
                slivers: <Widget>[
                  SliverPersistentHeader(
                    pinned: true,
                    delegate: _DayHeaderDelegate(
                      label: group.label,
                      count: group.assets.length,
                      height: headerHeight,
                    ),
                  ),
                  SliverPadding(
                    padding: const EdgeInsets.symmetric(horizontal: 12),
                    sliver: SliverGrid(
                      gridDelegate: SliverGridDelegateWithFixedCrossAxisCount(
                        crossAxisCount: columns,
                        crossAxisSpacing: 4,
                        mainAxisSpacing: 4,
                      ),
                      delegate: SliverChildBuilderDelegate((context, index) {
                        final asset = group.assets[index];
                        return AssetTile(
                          key: ValueKey<String>(asset.localId),
                          asset: asset,
                          thumbnail: widget.thumbnail,
                          status: _statusOf(asset),
                          fraction: _fractionFor(asset),
                          selecting: _selecting,
                          selected: _selected.containsKey(asset.localId),
                          onTap: _selecting
                              ? () => _toggleSelection(asset)
                              : null,
                          onLongPress: () => _toggleSelection(asset),
                        );
                      }, childCount: group.assets.length),
                    ),
                  ),
                ],
              ),
            SliverToBoxAdapter(child: _footer(context)),
          ],
        ],
      ),
    );
  }

  Widget _footer(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;

    final error = _error;
    if (error != null) {
      return Padding(
        padding: const EdgeInsets.fromLTRB(16, 16, 16, 24),
        child: StatusBanner(
          tone: StatusTone.danger,
          icon: Icons.cloud_off_rounded,
          title: 'Could not load more photos',
          message: error,
          action: TextButton(
            onPressed: () => unawaited(_loadMore()),
            child: const Text('Try again'),
          ),
        ),
      );
    }

    // Only while a page is actually on its way: a list that merely has more
    // pages must not spin forever (it would also never settle in tests).
    if (_loading) {
      return Padding(
        padding: const EdgeInsets.symmetric(vertical: 20),
        child: Center(
          child: SizedBox.square(
            dimension: 22,
            child: CircularProgressIndicator(
              strokeWidth: 2,
              color: scheme.primary,
              semanticsLabel: 'Loading more',
            ),
          ),
        ),
      );
    }

    return const SizedBox(height: 24);
  }

  Widget _noMatches(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;

    return Padding(
      padding: const EdgeInsets.fromLTRB(20, 40, 20, 20),
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: <Widget>[
          Icon(Icons.filter_alt_off, size: 26, color: scheme.onSurfaceVariant),
          const SizedBox(height: 10),
          Text(
            _filter == _LibraryFilter.failed
                ? 'No failed uploads here'
                : 'Everything loaded is backed up',
            textAlign: TextAlign.center,
            style: theme.textTheme.titleSmall?.copyWith(
              color: scheme.onSurface,
              fontWeight: FontWeight.w600,
            ),
          ),
          const SizedBox(height: 4),
          Text(
            'Filters only cover the photos this screen has loaded so far.',
            textAlign: TextAlign.center,
            style: theme.textTheme.bodySmall?.copyWith(
              color: scheme.onSurfaceVariant,
              height: 1.4,
            ),
          ),
          const SizedBox(height: 6),
          TextButton(
            onPressed: () => setState(() => _filter = _LibraryFilter.all),
            child: const Text('Show all'),
          ),
        ],
      ),
    );
  }

  /// Columns from the window width; tiles carry no text, so text scale only
  /// changes how much room the chrome above them takes.
  int _columnsFor(BuildContext context) {
    final width = MediaQuery.sizeOf(context).width;
    if (width < 360) return 3;
    if (width < 600) return 4;
    return (width / 130).floor().clamp(4, 10);
  }

  /// Groups [assets] into day sections, newest first, undated last.
  List<_DayGroup> _groupByDay(List<AssetCandidate> assets) {
    final groups = <_DayGroup>[];
    final undated = <AssetCandidate>[];
    String? label;
    var bucket = <AssetCandidate>[];

    void flush() {
      if (bucket.isEmpty || label == null) return;
      groups.add(_DayGroup(label, bucket));
      bucket = <AssetCandidate>[];
    }

    for (final asset in assets) {
      final date = asset.takenAt ?? asset.modifiedAt;
      if (date == null) {
        undated.add(asset);
        continue;
      }
      final dayLabel = _dayLabel(date);
      if (dayLabel != label) {
        flush();
        label = dayLabel;
      }
      bucket.add(asset);
    }
    flush();

    if (undated.isNotEmpty) groups.add(_DayGroup('Undated', undated));
    return groups;
  }

  String _dayLabel(DateTime date) {
    final now = DateTime.now();
    final day = DateTime(date.year, date.month, date.day);
    final today = DateTime(now.year, now.month, now.day);
    final days = today.difference(day).inDays;
    if (days == 0) return 'Today';
    if (days == 1) return 'Yesterday';
    final month = _months[date.month - 1];
    return date.year == now.year
        ? '${date.day} $month'
        : '${date.day} $month ${date.year}';
  }
}

/// One day of the grid, already ordered.
class _DayGroup {
  const _DayGroup(this.label, this.assets);

  final String label;
  final List<AssetCandidate> assets;
}

/// Sticky section header: the day, with how many photos it holds.
class _DayHeaderDelegate extends SliverPersistentHeaderDelegate {
  const _DayHeaderDelegate({
    required this.label,
    required this.count,
    required this.height,
  });

  final String label;
  final int count;

  /// Fixed extent for this header, grown for large accessibility text.
  final double height;

  /// A persistent header must fill exactly the extent it claims, and the text
  /// must still fit when the user scales it up.
  static double heightFor(BuildContext context) {
    final theme = Theme.of(context);
    final fontSize = theme.textTheme.labelLarge?.fontSize ?? 14;
    final scaled = MediaQuery.textScalerOf(context).scale(fontSize);
    return (scaled * 1.5 + 14).clamp(44.0, 140.0);
  }

  @override
  double get minExtent => height;

  @override
  double get maxExtent => height;

  @override
  Widget build(
    BuildContext context,
    double shrinkOffset,
    bool overlapsContent,
  ) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;

    return SizedBox(
      // The delegate is laid out with loose constraints: without an explicit
      // height the header would measure only its text and break the sliver.
      height: height,
      child: ColoredBox(
        // Nearly opaque: the grid slides underneath and stays readable.
        color: scheme.surface.withValues(alpha: 0.94),
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16),
          child: Row(
            children: <Widget>[
              Expanded(
                child: Text(
                  label,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: theme.textTheme.labelLarge?.copyWith(
                    color: scheme.onSurface,
                    fontWeight: FontWeight.w700,
                    letterSpacing: 0.2,
                  ),
                ),
              ),
              const SizedBox(width: 8),
              Text(
                formatCount(count),
                style: theme.textTheme.labelMedium?.copyWith(
                  color: scheme.onSurfaceVariant,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  @override
  bool shouldRebuild(covariant _DayHeaderDelegate oldDelegate) =>
      oldDelegate.label != label ||
      oldDelegate.count != count ||
      oldDelegate.height != height;
}

/// Scope pill: which albums the backup reads.
class _ScopePill extends StatelessWidget {
  const _ScopePill({required this.label});

  final String label;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;

    return Semantics(
      container: true,
      label: 'Backup scope: $label',
      child: ExcludeSemantics(
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
          decoration: BoxDecoration(
            color: scheme.surfaceContainer,
            borderRadius: BorderRadius.circular(100),
            border: Border.all(
              color: scheme.outlineVariant.withValues(alpha: 0.5),
            ),
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: <Widget>[
              DecoratedBox(
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  color: scheme.primary,
                ),
                child: const SizedBox.square(dimension: 6),
              ),
              const SizedBox(width: 6),
              Flexible(
                child: Text(
                  label,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: theme.textTheme.labelMedium?.copyWith(
                    color: scheme.onSurfaceVariant,
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

/// Sits above a limited-access grid: the platform only exposed a subset.
class _LimitedNote extends StatelessWidget {
  const _LimitedNote();

  @override
  Widget build(BuildContext context) {
    return const StatusBanner(
      tone: StatusTone.info,
      icon: Icons.photo_library_outlined,
      title: 'Only some photos are visible',
      message:
          'You shared a subset of your library with PhotoX, so only those '
          'photos can be backed up. Add more in your device settings.',
    );
  }
}
