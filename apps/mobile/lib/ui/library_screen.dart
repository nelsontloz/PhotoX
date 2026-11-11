import 'dart:async';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart' show HapticFeedback;
import 'package:flutter/rendering.dart' show ScrollCacheExtent;
import 'package:flutter/scheduler.dart';

import '../library/album_scope.dart';
import '../library/backup_status.dart';
import '../library/library_item.dart';
import '../media/photo_observer.dart';
import '../media/video_playback.dart';
import '../server/server_asset.dart';
import '../settings/settings_store.dart';
import '../sync/transfer_progress.dart';
import '../upload/models.dart';
import 'viewer_screen.dart';
import 'widgets/app_background.dart';
import 'widgets/asset_tile.dart';
import 'widgets/count_format.dart';
import 'widgets/month_names.dart';
import 'widgets/month_rail.dart';
import 'widgets/rows_sliver.dart';
import 'widgets/panel.dart';
import 'widgets/scope_pill.dart';
import 'widgets/status_banner.dart';

/// The library, newest first, one column-page at a time.
///
/// Every value and action is supplied by the caller, so this screen never
/// touches services, the queue or the platform: it asks for a page, asks what
/// the backup knows about that page, and draws both.
///
/// With [serverPage] wired the grid is the merged timeline: device rows and the
/// server's own rows, deduplicated where the server already holds a photo this
/// phone shows. Without it (the album screen) it stays device-only.
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
    required this.loadPreview,
    required this.loadDetail,
    required this.video,
    required this.onBackUpNow,
    required this.onOpenSettings,
    required this.onSyncNow,
    required this.onRequestAccess,
    this.folderId,
    this.title,
    this.album,
    this.onOpenAlbums,
    this.appBarActions = const <Widget>[],
    this.serverPage,
    this.serverIds,
    this.serverThumb,
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
  final Future<Uint8List?> Function(String localId, {int size}) thumbnail;

  /// Display-resolution preview for the full-screen viewer.
  final Future<Uint8List?> Function(String localId) loadPreview;

  /// Badge and last failure for the asset the viewer is showing.
  final Future<BackupDetail> Function(AssetCandidate asset) loadDetail;

  /// Bytes and player for video pages.
  final VideoSupport video;

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

  /// The album this grid was opened for, when it came from the Albums tab.
  ///
  /// Only used to say whether what is on screen is inside the backup scope;
  /// [folderId] still decides what is read.
  final MediaFolder? album;

  /// Opens the Albums tab; null leaves the scope banner out entirely.
  final VoidCallback? onOpenAlbums;

  /// Extra app-bar actions, drawn before the sync and settings shortcuts.
  final List<Widget> appBarActions;

  /// One newest-first page of the server's library, or null for a device-only
  /// grid (the album screen).
  ///
  /// [dateTo] is an exclusive upper bound on the date a row sorts by; the grid
  /// passes none and walks further back by [offset].
  final Future<ServerAssetPage> Function({
    DateTime? dateTo,
    int offset,
    int limit,
  })?
  serverPage;

  /// Server asset id of every listed device asset the server already holds.
  ///
  /// This is what stops a photo rendering twice: a server row whose id is
  /// claimed here is already represented by its device row.
  final Future<Map<String, String>> Function(List<String> localIds)? serverIds;

  /// Encoded thumbnail for one server file id, or null when the file is gone.
  final Future<Uint8List?> Function(String fileId)? serverThumb;

  @override
  State<LibraryScreen> createState() => _LibraryScreenState();
}

/// What the grid is filtered to; filtering never reaches the platform.
enum _LibraryFilter { all, notBackedUp, onlineOnly, failed }

class _LibraryScreenState extends State<LibraryScreen> {
  /// Page size asked of the controller; a shorter page ends the list.
  static const int _pageSize = 200;

  /// Page size for the server half; the largest page the core API accepts.
  static const int _serverPageSize = 100;

  /// Server pages one device page may pull, so a dense server cannot starve
  /// the grid the user is already looking at.
  static const int _serverPagesPerDevicePage = 5;

  /// Page size for the background index sweep: metadata only, so a bigger page
  /// costs nothing but round trips.
  static const int _hydratePageSize = 500;

  /// Height the footer adds below the last row, kept in the model's own units.
  static const double _footerExtent = 24;

  /// How close to the end of the list the next page is requested.
  static const double _loadAhead = 600;

  /// Horizontal inset of the grid and the gap between two tiles.
  ///
  /// The rows are sized from these, so a row's recorded height is exactly what
  /// the list draws and a row offset never has to be measured.
  static const double _gutter = 12;
  static const double _gap = 4;

  /// Quiet period before the loaded page's queue states are re-read.
  static const Duration _statesQuiet = Duration(milliseconds: 400);

  final List<AssetCandidate> _assets = <AssetCandidate>[];

  /// Queue rows for the loaded page, keyed by platform id.
  final Map<String, UploadState> _states = <String, UploadState>{};

  /// Ids whose states were asked for; anything else shows no mark yet, because
  /// "not backed up" is a claim the screen has no right to make before asking.
  final Set<String> _resolved = <String>{};

  /// Selected rows by tile key, so the action bar can pass the candidates along.
  final Map<String, LibraryItem> _selected = <String, LibraryItem>{};

  /// The server half, newest first, exactly as its pages arrived.
  ///
  /// ponytail: the whole server half lives in memory next to the device half.
  /// The upgrade path is the web's: window the merge by month and re-ask as the
  /// user scrolls. Revisit if a very large server library is ever measured to
  /// suffer.
  final List<ServerAsset> _serverItems = <ServerAsset>[];

  /// Offset of the next server page.
  int _serverOffset = 0;

  /// Rows the server says it holds, so [hasMore] has a total to compare.
  int _serverTotal = 0;

  /// False once the server list is exhausted.
  bool _serverHasMore = true;

  /// True while a server page is on its way.
  bool _serverLoading = false;

  /// True once the first server page answered, so "0 online only" is a fact.
  bool _serverAnswered = false;

  /// Set when the server half could not be read. Never [_error], which means
  /// the device library itself could not be read; the grid survives this one.
  String? _serverError;

  /// Server asset id of every device asset the merge already shows.
  final Map<String, String> _serverIdsByLocalId = <String, String>{};

  /// The server page request in flight, so callers join instead of stacking.
  Future<void>? _serverInFlight;

  final ScrollController _scroll = ScrollController();

  /// The grid as lines: a day header, or one row of tiles.
  ///
  /// One list rather than one sliver per day, so a frame costs what is on
  /// screen instead of what is loaded. Rebuilt only when the data changes —
  /// never for a selection tap or a transfer tick.
  List<_GridRow> _rows = const <_GridRow>[];

  /// Absolute top offset of each row, plus the total as the last entry.
  List<double> _rowTops = const <double>[0];

  /// Chip counts over the loaded pages, computed with [_rows].
  Map<_LibraryFilter, int> _counts = const <_LibraryFilter, int>{};

  /// True when [_rows] no longer describes [_assets], [_states] or the filter.
  bool _rowsDirty = true;

  /// Geometry [_rows] was built for; a rotation or text-scale change rebuilds.
  int _modelColumns = 0;
  double _modelTileSide = 0;
  double _modelHeaderHeight = 0;

  /// Day bar following the top edge; null while a real header sits there.
  final ValueNotifier<_StickyBar?> _stickyDay = ValueNotifier<_StickyBar?>(
    null,
  );

  /// Months of the loaded rows, in content coordinates.
  List<MonthSpan> _months = const <MonthSpan>[];

  /// What the month rail draws; null while there is nothing to scroll.
  final ValueNotifier<MonthRailState?> _rail = ValueNotifier<MonthRailState?>(
    null,
  );

  /// Keeps the rail popup up for a moment after the last scroll step.
  Timer? _railPopupTimer;

  /// Rail geometry frozen for the drag in progress, so loading more pages does
  /// not rescale the rail under the finger.
  MonthRailState? _railFrozen;

  /// Scroll offset a drag asked for; consumed by [_runSeek].
  double? _seekTarget;

  /// True while [_runSeek] is loading pages towards [_seekTarget].
  bool _seeking = false;

  /// Bumped when a drag starts, so an older seek stops loading pages.
  int _scrubGeneration = 0;

  /// Month last buzzed during a drag, so one month is one tick.
  String? _scrubMonth;

  /// Months a scrub must have before snapping is worth it.
  static const int _snapMonths = 12;

  /// The page request in flight, so callers join instead of stacking two.
  Future<void>? _pageInFlight;

  /// True while the rest of the library is being indexed in the background.
  bool _hydrating = false;

  /// True while the grid is flinging: tiles wait before asking for a preview,
  /// because a fling mounts far more of them than the platform can encode.
  final ValueNotifier<bool> _deferring = ValueNotifier<bool>(false);

  /// Pending end of the deferral, re-armed by every movement.
  Timer? _deferTimer;

  /// Quiet period after a fling before previews are requested again.
  static const Duration _deferSettle = Duration(milliseconds: 120);

  /// Pending state re-read, so a pass that finishes ten assets is one query.
  Timer? _statesTimer;

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
    if (_canRead) {
      unawaited(_loadFirstPage());
    } else if (widget.serverPage != null) {
      // The server half does not need photo access: render it on its own.
      unawaited(_catchUpServer());
    }
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
    if (oldWidget.folderId != widget.folderId) {
      unawaited(_refresh());
      return;
    }
    // Losing read access hides the chips that were chosen; start from All.
    if (_isReadable(oldWidget.permission) && !_canRead) {
      _filter = _LibraryFilter.all;
      _rowsDirty = true;
    }
    // The container and video rules decide the badge, so the rows are stale.
    if (oldWidget.settings != widget.settings) _rowsDirty = true;
  }

  static bool _isReadable(PhotoPermission permission) =>
      permission == PhotoPermission.authorized ||
      permission == PhotoPermission.limited;

  @override
  void dispose() {
    // Anything still in flight checks this before touching state.
    _disposed = true;
    _statesTimer?.cancel();
    _railPopupTimer?.cancel();
    _deferTimer?.cancel();
    _deferring.dispose();
    _stickyDay.dispose();
    _rail.dispose();
    _scroll.removeListener(_onScroll);
    _scroll.dispose();
    super.dispose();
  }

  void _onScroll() {
    if (!_scroll.hasClients) return;
    _updateDeferring();
    _updateSticky();
    _updateRail();
    if (_error != null) return; // the footer offers an explicit retry instead
    // The banner offers the server retry; scrolling must not hammer it.
    if (!_hasMore && _serverError != null) return;
    if (_scroll.position.extentAfter > _loadAhead) return;
    unawaited(_loadMore());
  }

  /// Points the floating day bar at the day under the top edge.
  ///
  /// A header row already draws its own label there, so the bar steps aside
  /// instead of printing it twice. As the next day's header reaches the edge it
  /// pushes the bar up and out, which is what a pinned header does — without a
  /// pinned header per day, and without a second label on screen.
  void _updateSticky() {
    if (!_scroll.hasClients || _rows.isEmpty) {
      if (_stickyDay.value != null) _stickyDay.value = null;
      return;
    }

    final pixels = _scroll.position.pixels;
    var index = _rowIndexAt(pixels);
    if (_rows[index].items == null) {
      if (_stickyDay.value != null) _stickyDay.value = null;
      return;
    }
    while (index > 0 && _rows[index].items != null) {
      index--;
    }
    final header = _rows[index];

    var next = _rowIndexAt(pixels) + 1;
    while (next < _rows.length && _rows[next].items != null) {
      next++;
    }
    final nextTop = next < _rows.length
        ? _rowTops[next] - pixels
        : double.infinity;
    // The next day's header is taking over, and it draws the same bar in the
    // same place: stand down rather than print two days at once.
    if (nextTop < header.height) {
      if (_stickyDay.value != null) _stickyDay.value = null;
      return;
    }

    final current = _stickyDay.value;
    if (current != null &&
        current.row.label == header.label &&
        current.row.count == header.count) {
      return;
    }
    _stickyDay.value = _StickyBar(row: header, top: 0);
  }

  /// Holds tile previews back while the grid is flung.
  ///
  /// A fling mounts far more tiles than the platform can encode, and most of
  /// them are already gone by the time a preview would arrive; the tiles ask
  /// again once the scroll settles.
  void _updateDeferring() {
    if (!_scroll.hasClients) return;
    final deferred = _scroll.position.recommendDeferredLoading(context);
    if (deferred && !_deferring.value) _deferring.value = true;
    // Every scroll step re-arms the settle timer, so the flag clears after the
    // *last* movement — including a fling that stops without telling anyone.
    _deferTimer?.cancel();
    _deferTimer = Timer(_deferSettle, () {
      _deferTimer = null;
      if (!_disposed) _deferring.value = false;
    });
  }

  /// Publishes what the rail draws, or hides it when nothing scrolls.
  ///
  /// While a drag is in progress the content height is the frozen one, so
  /// loading pages cannot rescale the rail under the finger.
  void _updateRail() {
    if (!_scroll.hasClients || _months.isEmpty) {
      if (_rail.value != null) _rail.value = null;
      return;
    }
    final position = _scroll.position;
    if (!position.hasContentDimensions) return;

    final frozen = _railFrozen;
    // From the row model, not `maxScrollExtent`: a lazy sliver only estimates
    // its extent until it has laid the rows out, and an estimate rescales the
    // rail while it is being looked at.
    final contentHeight =
        frozen?.contentHeight ?? (_rowTops.last + _footerExtent);
    final months = frozen?.months ?? _months;
    if (frozen == null && contentHeight <= position.viewportDimension) {
      if (_rail.value != null) _rail.value = null;
      return;
    }

    final current = _rail.value;
    // The popup belongs to scrolling, not to the model being rebuilt: an
    // upload finishing must not flash a month over the grid.
    final moved =
        current != null && (current.pixels - position.pixels).abs() >= 0.5;
    if (moved) _armRailPopup();

    final next = MonthRailState(
      contentHeight: contentHeight,
      viewport: position.viewportDimension,
      pixels: position.pixels,
      months: months,
      month: monthAtContentY(
        months,
        position.pixels + position.viewportDimension / 2,
      ),
      showPopup: _railFrozen != null || _railPopupTimer != null,
    );
    if (current != null && current.sameAs(next)) return;
    _rail.value = next;
  }

  /// Holds the month popup open for a moment after the grid stopped moving.
  void _armRailPopup() {
    _railPopupTimer?.cancel();
    _railPopupTimer = Timer(const Duration(seconds: 1), () {
      _railPopupTimer = null;
      if (!_disposed) _updateRail();
    });
  }

  void _onRailScrubStart() {
    _railFrozen = _rail.value;
    _scrubMonth = null;
    _scrubGeneration++;
  }

  /// Drags map through the geometry frozen at the start of the gesture.
  void _onRailScrub(double fraction) {
    final frozen = _railFrozen;
    if (frozen == null) return;
    final target = contentYForRailFraction(
      fraction,
      contentHeight: frozen.contentHeight,
      viewport: frozen.viewport,
    );
    // A tick per month crossed, the way a physical scrubber feels.
    final month = monthAtContentY(frozen.months, target);
    if (month != _scrubMonth) {
      _scrubMonth = month;
      unawaited(HapticFeedback.selectionClick());
    }
    _seekTarget = target;
    if (!_seeking) unawaited(_runSeek());
  }

  void _onRailScrubEnd() {
    final target = _seekTarget;
    if (target != null && _months.length >= _snapMonths) {
      final snapped = snapToMonthTop(
        target,
        _months,
        tolerance: (_modelTileSide + _gap) * 1.5,
      );
      if (snapped != target) _seekTo(snapped);
    }
    _railFrozen = null;
    _scrubMonth = null;
    _updateRail();
  }

  void _onRailJump(double fraction) {
    final current = _rail.value;
    if (current == null) return;
    _seekTo(
      contentYForRailFraction(
        fraction,
        contentHeight: current.contentHeight,
        viewport: current.viewport,
      ),
    );
  }

  /// Accessibility stepping: `delta` months older (+) or newer (−).
  void _onRailStep(int delta) {
    if (_months.isEmpty || !_scroll.hasClients) return;
    final position = _scroll.position;
    final current = monthAtContentY(
      _months,
      position.pixels + position.viewportDimension / 2,
    );
    final index = _months.indexWhere((month) => month.label == current);
    final target = (index < 0 ? 0 : index + delta).clamp(0, _months.length - 1);
    _seekTo(_months[target].top);
  }

  void _seekTo(double contentY) {
    _seekTarget = contentY;
    if (!_seeking) unawaited(_runSeek());
  }

  /// Scrolls towards [_seekTarget], loading pages while the content is too
  /// short to reach it.
  ///
  /// One seek runs at a time: a moving finger just replaces the target, so the
  /// grid never loads the same page twice or jumps backwards to a stale one.
  Future<void> _runSeek() async {
    _seeking = true;
    final generation = _scrubGeneration;
    var budget = _seekPages;
    try {
      while (_seekTarget != null && generation == _scrubGeneration) {
        if (_disposed || !_scroll.hasClients) return;
        final target = _seekTarget!;
        if (target <= _scroll.position.maxScrollExtent) {
          // The sliver reports the real extent, so one jump is enough.
          _scroll.jumpTo(target);
          _seekTarget = null;
          continue;
        }
        if ((!_hasMore && !_serverHasMore) ||
            _error != null ||
            (!_hasMore && _serverError != null) ||
            budget-- <= 0) {
          _seekTarget = null;
          continue;
        }
        final before = _assets.length + _serverItems.length;
        await _loadMore();
        if (_disposed || generation != _scrubGeneration) return;
        // A page that added nothing (in flight, failed, or the end) would spin.
        if (_assets.length + _serverItems.length == before) {
          _seekTarget = null;
        }
      }
    } finally {
      _seeking = false;
    }
  }

  /// Pages one seek may load before giving up; a new drag resets the target.
  static const int _seekPages = 25;

  /// Row covering [offset]; rows tile the list, so a binary search is exact.
  int _rowIndexAt(double offset) {
    var low = 0;
    var high = _rows.length - 1;
    while (low < high) {
      final mid = (low + high + 1) >> 1;
      if (_rowTops[mid] <= offset) {
        low = mid;
      } else {
        high = mid - 1;
      }
    }
    return low;
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
      _rows = const <_GridRow>[];
      _rowTops = const <double>[0];
      _counts = const <_LibraryFilter, int>{};
      _months = const <MonthSpan>[];
      _rowsDirty = true;
      _serverItems.clear();
      _serverOffset = 0;
      _serverTotal = 0;
      _serverHasMore = true;
      _serverLoading = false;
      _serverAnswered = false;
      _serverError = null;
      _serverIdsByLocalId.clear();
    });
    // A bar and a rail describing rows that no longer exist must not survive
    // the reset, and a drag in progress has nothing left to point at.
    _stickyDay.value = null;
    _rail.value = null;
    _railFrozen = null;
    _seekTarget = null;
    _scrubGeneration++;
    _pageInFlight = null;
    _serverInFlight = null;
    // Reads the device half, or the server half when the device is unreadable.
    await _loadMore();
    if (_disposed) return;
    unawaited(_hydrate(generation: _generation));
  }

  Future<void> _loadFirstPage() async {
    await _loadMore();
    if (_disposed) return;
    unawaited(_hydrate(generation: _generation));
  }

  /// Indexes the rest of the library's metadata in the background.
  ///
  /// The web knows the whole timeline's height up front because the server
  /// returns a layout; the device does not, so the grid reads every page's
  /// metadata — dates and sizes, no thumbnails and no bytes — and the rail then
  /// describes the whole library instead of growing as the user scrolls.
  ///
  /// ponytail: the whole library lives in memory as candidates (~200 bytes
  /// each, so 50k photos ≈ 10 MB) and the row model is rebuilt per page. A
  /// byte-budgeted window would mean reworking the model; revisit if a very
  /// large library is ever measured to suffer.
  Future<void> _hydrate({required int generation}) async {
    if (_hydrating) return;
    _hydrating = true;
    try {
      while (!_disposed && generation == _generation && _hasMore && _canRead) {
        final before = _assets.length;
        await _loadMore(limit: _hydratePageSize, withStates: false);
        if (_disposed || generation != _generation) return;
        if (_assets.length == before) break;
        // One page per frame at most, so a fling or a tap never queues behind
        // the index.
        await SchedulerBinding.instance.endOfFrame;
      }
      // The device half is exhausted (or unreadable): index the server half
      // too, so the rail and the counts describe the whole merged timeline.
      while (!_disposed &&
          generation == _generation &&
          widget.serverPage != null &&
          _serverHasMore &&
          _serverError == null) {
        final before = _serverItems.length;
        await _catchUpServer();
        if (_disposed || generation != _generation) return;
        if (_serverItems.length == before) break;
        await SchedulerBinding.instance.endOfFrame;
      }
    } finally {
      _hydrating = false;
    }
    if (_disposed || generation != _generation) return;
    // One pass for the badges the sweep skipped: they are only read once the
    // ids exist, and this is the cheapest moment to ask.
    _readStates();
  }

  /// Loads one more page, joining a request that is already in flight.
  ///
  /// Once the device half is exhausted the server half takes over, so every
  /// caller (scroll, seek, footer) extends the merged list without knowing
  /// which half still has rows.
  Future<void> _loadMore({int? limit, bool withStates = true}) {
    final inFlight = _pageInFlight;
    if (inFlight != null) return inFlight;
    final future = _loadNextPage(
      limit: limit ?? _pageSize,
      withStates: withStates,
    ).whenComplete(() => _pageInFlight = null);
    _pageInFlight = future;
    return future;
  }

  Future<void> _loadNextPage({
    required int limit,
    required bool withStates,
  }) async {
    if (_canRead && _hasMore) {
      await _fetchPage(limit: limit, withStates: withStates);
      return;
    }
    await _catchUpServer();
  }

  Future<void> _fetchPage({
    required int limit,
    required bool withStates,
  }) async {
    if (_disposed || !_hasMore || !_canRead) return;
    final generation = _generation;
    setState(() {
      _loading = true;
      _error = null;
    });

    try {
      final page = await widget.loadPage(
        offset: _offset,
        limit: limit,
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
      var resolved = false;
      Map<String, UploadState> states = const <String, UploadState>{};
      if (withStates && ids.isNotEmpty) {
        try {
          states = await widget.loadStates(ids);
          resolved = true;
        } on Object {
          resolved = false;
        }
        if (_disposed || generation != _generation) return;
      }

      // Which of these the server already holds, so it does not draw a second
      // row for a photo this phone shows.
      await _refreshServerIds(ids);
      if (_disposed || generation != _generation) return;

      setState(() {
        _assets.addAll(fresh);
        _states.addAll(states);
        if (resolved) _resolved.addAll(ids);
        _offset += page.length;
        _hasMore = page.length >= limit;
        _loading = false;
        _rowsDirty = true;
      });
      await _catchUpServer();
      if (_disposed || generation != _generation) return;
      _fillViewport();
    } on Object {
      if (_disposed || generation != _generation) return;
      setState(() {
        _loading = false;
        _error = 'Could not read your library.';
      });
    }
  }

  /// Loads one more server page, joining a request that is already in flight.
  Future<void> _loadServerMore() {
    final inFlight = _serverInFlight;
    if (inFlight != null) return inFlight;
    final future = _fetchServerPage().whenComplete(
      () => _serverInFlight = null,
    );
    _serverInFlight = future;
    return future;
  }

  Future<void> _fetchServerPage() async {
    final page = widget.serverPage;
    if (page == null || _disposed || !_serverHasMore) return;
    final generation = _generation;
    setState(() {
      _serverLoading = true;
      _serverError = null;
    });
    try {
      final result = await page(offset: _serverOffset, limit: _serverPageSize);
      if (_disposed || generation != _generation) return;
      // The server list can shift while pages load; keep each row once.
      final known = <String>{for (final asset in _serverItems) asset.id};
      final fresh = <ServerAsset>[
        for (final asset in result.items)
          if (known.add(asset.id)) asset,
      ];
      setState(() {
        _serverItems.addAll(fresh);
        _serverOffset += result.items.length;
        _serverTotal = result.total;
        _serverHasMore =
            result.items.isNotEmpty && _serverOffset < _serverTotal;
        _serverLoading = false;
        _serverAnswered = true;
        _rowsDirty = true;
      });
    } on Object {
      if (_disposed || generation != _generation) return;
      setState(() {
        _serverLoading = false;
        _serverError = 'Could not load photos from the server.';
      });
    }
  }

  /// The oldest date in the loaded server half, or null when it is empty.
  DateTime? get _oldestServerDate =>
      _serverItems.isEmpty ? null : _serverItems.last.date;

  /// The oldest date in the loaded device half, skipping undated rows.
  DateTime? get _oldestDeviceDate {
    for (final asset in _assets.reversed) {
      final date = asset.takenAt ?? asset.modifiedAt;
      if (date != null) return date;
    }
    return null;
  }

  /// Pulls server pages until the two halves overlap in time, so the merged
  /// timeline has no gap above the device half.
  ///
  /// Once the device half is exhausted the server half is drained instead: the
  /// merged list is then complete from both sides.
  Future<void> _catchUpServer() async {
    if (widget.serverPage == null || _serverError != null) return;
    final drained = !_hasMore;
    var budget = drained ? null : _serverPagesPerDevicePage;
    while (!_disposed && _serverHasMore && (budget == null || budget > 0)) {
      if (budget != null) budget--;
      final before = _serverItems.length;
      await _loadServerMore();
      if (_disposed || _serverError != null) return;
      // A page that added nothing would spin forever: the server moved under
      // the offsets and a retry will not help this pass.
      if (_serverItems.length == before) return;
      if (drained) continue;
      final oldestServer = _oldestServerDate;
      final oldestDevice = _oldestDeviceDate;
      if (oldestServer == null || oldestDevice == null) return;
      if (!oldestServer.isAfter(oldestDevice)) return;
    }
  }

  /// Asks which of [localIds] the server already holds.
  Future<void> _refreshServerIds(List<String> localIds) async {
    final lookup = widget.serverIds;
    if (lookup == null || localIds.isEmpty) return;
    final generation = _generation;
    try {
      final linked = await lookup(localIds);
      if (_disposed || generation != _generation) return;
      _serverIdsByLocalId.addAll(linked);
    } on Object {
      // A failed lookup can only duplicate a server row; the next page asks
      // again for its own ids.
    }
  }

  /// The banner's action: forget the failure and ask the server half again.
  void _retryServer() {
    if (_serverError == null) return;
    setState(() => _serverError = null);
    unawaited(_catchUpServer());
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

  /// Re-reads the states that can still move, once the pass goes quiet.
  ///
  /// A pass finishes assets one at a time and bumps the revision each time; a
  /// trailing debounce turns a burst into a single query.
  void _refreshStates() {
    _statesTimer?.cancel();
    _statesTimer = Timer(_statesQuiet, _readStates);
  }

  void _readStates() {
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
      _rowsDirty = true;
    });
  }

  /// Badge for [asset]; null while its queue state is still unknown.
  ///
  /// The live transfer is not consulted here: the tile follows [widget.progress]
  /// itself, so a byte tick never rebuilds the grid.
  BackupStatus? _statusOf(AssetCandidate asset) {
    if (!_resolved.contains(asset.localId)) return null;
    return resolveBackupStatus(
      state: _states[asset.localId],
      asset: asset,
      settings: widget.settings,
    );
  }

  /// Badge for one merged row; a server-only row has no queue state at all.
  BackupStatus? _statusOfItem(LibraryItem item) {
    final device = item.device;
    return device == null ? null : _statusOf(device);
  }

  /// The two halves as one newest-first list.
  ///
  /// Server rows whose id a device row already claims are dropped: that photo
  /// is on the phone and on the server, and one row says so with its own mark.
  List<LibraryItem> _displayItems() {
    final claimed = _serverIdsByLocalId.values.toSet();
    return mergeLibraryItems(<LibraryItem>[
      // Without read access the device half is not what is on screen, whatever
      // the last page held.
      if (_canRead)
        for (final asset in _assets)
          if (_statusOf(asset) == BackupStatus.backedUp)
            LibraryItem.backedUp(asset)
          else
            LibraryItem.deviceOnly(asset),
      // A server half that cannot be reached draws no rows: a row it cannot
      // show must not claim a place in the timeline.
      if (_serverError == null)
        for (final asset in _serverItems)
          if (!claimed.contains(asset.id)) LibraryItem.onlineOnly(asset),
    ]);
  }

  bool _matchesFilter(LibraryItem item) {
    final status = _statusOfItem(item);
    return switch (_filter) {
      _LibraryFilter.all => true,
      // An unresolved device row makes no claim; "not backed up" waits for the
      // queue's answer.
      _LibraryFilter.notBackedUp =>
        item.provenance == Provenance.deviceOnly && status != null,
      _LibraryFilter.onlineOnly => item.provenance == Provenance.onlineOnly,
      _LibraryFilter.failed =>
        item.provenance == Provenance.deviceOnly &&
            status == BackupStatus.failed,
    };
  }

  List<LibraryItem> _filtered(List<LibraryItem> items) {
    if (_filter == _LibraryFilter.all) return items;
    return <LibraryItem>[
      for (final item in items)
        if (_matchesFilter(item)) item,
    ];
  }

  Map<_LibraryFilter, int> _filterCounts(List<LibraryItem> items) {
    var notBackedUp = 0;
    var onlineOnly = 0;
    var failed = 0;
    for (final item in items) {
      if (item.provenance == Provenance.onlineOnly) {
        onlineOnly++;
        continue;
      }
      if (item.provenance == Provenance.both) continue;
      // Device-only: an unresolved row makes no claim either way.
      final status = _statusOfItem(item);
      if (status == null) continue;
      if (status == BackupStatus.failed) failed++;
      notBackedUp++;
    }
    return <_LibraryFilter, int>{
      _LibraryFilter.all: items.length,
      _LibraryFilter.notBackedUp: notBackedUp,
      _LibraryFilter.onlineOnly: onlineOnly,
      _LibraryFilter.failed: failed,
    };
  }

  bool get _selectionCanBackUp {
    for (final item in _selected.values) {
      final device = item.device;
      if (device != null && _statusOf(device) != BackupStatus.excluded) {
        return true;
      }
    }
    return false;
  }

  void _toggleSelection(LibraryItem item) {
    // Nothing can be queued for a row that only the server holds.
    if (item.provenance == Provenance.onlineOnly) return;
    setState(() {
      _selecting = true;
      if (_selected.remove(item.key) == null) {
        _selected[item.key] = item;
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

  /// Opens the tapped photo full screen, paging through what is on screen.
  ///
  /// The filtered order is the snapshot the viewer pages through, so a
  /// "Not backed up" filter stays a review of exactly those photos.
  void _openViewer(LibraryItem item) {
    final visible = _filtered(_displayItems());
    final index = visible.indexWhere((entry) => entry.key == item.key);
    if (index < 0) return;
    unawaited(
      Navigator.of(context).push(
        MaterialPageRoute<void>(
          builder: (context) => ViewerScreen(
            items: visible,
            initialIndex: index,
            loadPreview: (entry) => _preview(entry, size: 0),
            loadDetail: widget.loadDetail,
            video: widget.video,
            onBackUpNow: widget.onBackUpNow,
          ),
        ),
      ),
    );
  }

  /// Encoded preview for one row: the device's own thumbnail, or the server's.
  ///
  /// [size] is the grid's tile size; 0 is the viewer asking for the
  /// display-resolution preview, which only a device row can supply at a
  /// bigger size than the tile.
  Future<Uint8List?> _preview(LibraryItem item, {int size = 320}) {
    final device = item.device;
    if (device != null) {
      if (size <= 0) return widget.loadPreview(device.localId);
      return widget.thumbnail(device.localId, size: size);
    }
    final fileId = item.server?.thumbnailFileId;
    final load = widget.serverThumb;
    if (fileId == null || load == null) return Future<Uint8List?>.value();
    return load(fileId);
  }

  Future<void> _backUpSelected() async {
    final assets = <AssetCandidate>[
      for (final item in _selected.values) ?item.device,
    ];
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
    final columns = _columnsFor(context);
    final tileSide = _tileSideFor(context, columns);
    final headerHeight = _DayHeader.heightFor(context);
    if (_rowsDirty ||
        columns != _modelColumns ||
        tileSide != _modelTileSide ||
        headerHeight != _modelHeaderHeight) {
      _ensureRows(
        columns: columns,
        tileSide: tileSide,
        headerHeight: headerHeight,
      );
    }

    // At most one banner above the grid; [_notice] picks it.
    final notice = _notice();

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
              if (!_selecting && _showChrome) _infoRow(context),
              if (!_selecting && _hasAnyRows) _filterRow(),
              if (notice != null)
                Padding(
                  padding: const EdgeInsets.fromLTRB(20, 0, 20, 10),
                  child: notice,
                ),
              Expanded(child: _body(context)),
            ],
          ),
        ),
      ),
    );
  }

  /// True when the header line has something to describe: the device half is
  /// readable, or the server half already has rows to show.
  bool get _showChrome => _canRead || _visibleServerItems.isNotEmpty;

  /// True when at least one row of either half is loaded.
  bool get _hasAnyRows => _assets.isNotEmpty || _visibleServerItems.isNotEmpty;

  /// True while a half still has pages that will actually be fetched.
  bool get _moreRows =>
      _hasMore ||
      (widget.serverPage != null && _serverError == null && _serverHasMore);

  /// Server rows the grid may draw.
  ///
  /// None while the server half is unreachable: a row that cannot be shown must
  /// not claim a place in the timeline or in the chips.
  List<ServerAsset> get _visibleServerItems =>
      _serverError == null ? _serverItems : const <ServerAsset>[];

  /// The one banner above the grid: server trouble outranks permission trouble,
  /// which outranks the backup-scope note.
  Widget? _notice() {
    if (_selecting) return null;
    if (_serverError != null) {
      return StatusBanner(
        key: const Key('library-server-banner'),
        tone: StatusTone.warning,
        icon: Icons.cloud_off_rounded,
        title: 'Server unavailable',
        message:
            'Showing photos on this phone. Server photos reappear when the '
            'connection is back.',
        action: TextButton(
          key: const Key('library-retry-server'),
          onPressed: _retryServer,
          child: const Text('Try again'),
        ),
      );
    }
    if (!_canRead) {
      // Only worth saying when a grid is actually under it; with no server rows
      // the body keeps the full-screen permission state instead.
      return _serverItems.isEmpty ? null : _permissionBanner();
    }
    return _scopeBanner();
  }

  /// The grant that would bring the device half back, said above the grid.
  Widget _permissionBanner() {
    final (String title, _, String action, IconData icon) = _permissionCopy;
    return StatusBanner(
      key: const Key('library-permission-banner'),
      tone: widget.permission == PhotoPermission.notDetermined
          ? StatusTone.warning
          : StatusTone.danger,
      icon: icon,
      title: title,
      message:
          'Server photos are shown. Allow photo access to see and back up '
          'this phone\'s photos.',
      action: TextButton(
        onPressed: () => unawaited(widget.onRequestAccess()),
        child: Text(action),
      ),
    );
  }

  /// Says so when what is on screen is not what the backup reads.
  ///
  /// Two cases: the whole library is shown while the scope is a few albums, or
  /// an album was opened that the backup does not include. Both point at the
  /// Albums tab, which is where the scope is changed.
  Widget? _scopeBanner() {
    final open = widget.onOpenAlbums;
    if (open == null) return null;

    final scope = AlbumScope.of(widget.settings);
    final album = widget.album;

    if (album != null) {
      if (scope.includes(album)) return null;
      return StatusBanner(
        key: const Key('library-scope-banner'),
        tone: StatusTone.info,
        icon: Icons.filter_alt_outlined,
        title: 'This album is not backed up',
        message:
            'Backup covers ${albumScopeLabel(widget.settings)}, so photos in '
            '${album.name} stay on this phone until you add it.',
        action: TextButton(
          key: const Key('library-open-albums'),
          onPressed: open,
          child: const Text('Change scope'),
        ),
      );
    }

    // A grid read from a single album id it cannot name, or everything: either
    // way there is nothing the banner could honestly claim.
    if (widget.folderId != null || scope.all) return null;

    return StatusBanner(
      key: const Key('library-scope-banner'),
      tone: StatusTone.info,
      icon: Icons.filter_alt_outlined,
      title: 'Not everything here is backed up',
      message:
          'Backup only scans ${albumScopeLabel(widget.settings)}, so photos '
          'from other albums are not uploaded.',
      action: TextButton(
        key: const Key('library-open-albums'),
        onPressed: open,
        child: const Text('Choose albums'),
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
        ...widget.appBarActions,
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

  /// How much is loaded, what is not backed up, and what only the server has.
  Widget _infoRow(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    final counts = _counts;
    final loaded = counts[_LibraryFilter.all] ?? 0;
    final textStyle = theme.textTheme.labelMedium?.copyWith(
      color: scheme.onSurfaceVariant,
    );

    final children = <Widget>[];
    if (widget.serverPage == null) {
      // Device-only (album) grid: exactly the line it always had.
      children.add(ScopePill(label: albumScopeLabel(widget.settings)));
      if (loaded > 0) {
        children.add(
          Text(
            _hasMore
                ? '${formatCount(loaded)}+ items'
                : countLabel(loaded, 'item'),
            style: textStyle,
          ),
        );
      }
    } else {
      final parts = <String>[
        _moreRows
            ? '${formatCount(loaded)}+ items'
            : countLabel(loaded, 'item'),
        if (_canRead)
          '${formatCount(counts[_LibraryFilter.notBackedUp] ?? 0)} '
              'not backed up',
        if (_serverError == null)
          _serverAnswered
              ? '${formatCount(counts[_LibraryFilter.onlineOnly] ?? 0)} '
                    'online only'
              : 'Checking the server…',
      ];
      children.add(Text(parts.join(' · '), style: textStyle));
    }
    if (widget.syncing) {
      children.add(
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
            Text('Backing up', style: textStyle),
          ],
        ),
      );
    }

    return Padding(
      padding: const EdgeInsets.fromLTRB(20, 0, 20, 8),
      child: Wrap(
        spacing: 10,
        runSpacing: 6,
        crossAxisAlignment: WrapCrossAlignment.center,
        children: children,
      ),
    );
  }

  /// All / Not backed up / Online only / Failed, counted over what is loaded.
  Widget _filterRow() {
    final counts = _counts;
    return SizedBox(
      height: 48,
      child: SingleChildScrollView(
        scrollDirection: Axis.horizontal,
        padding: const EdgeInsets.symmetric(horizontal: 16),
        child: Row(
          children: <Widget>[
            _filterChip(_LibraryFilter.all, 'All', counts),
            if (_canRead) ...<Widget>[
              const SizedBox(width: 8),
              _filterChip(_LibraryFilter.notBackedUp, 'Not backed up', counts),
            ],
            if (widget.serverPage != null && _serverError == null) ...<Widget>[
              const SizedBox(width: 8),
              _filterChip(_LibraryFilter.onlineOnly, 'Online only', counts),
            ],
            if (_canRead) ...<Widget>[
              const SizedBox(width: 8),
              _filterChip(_LibraryFilter.failed, 'Failed', counts),
            ],
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
    final suffix = _moreRows ? '+' : '';
    return FilterChip(
      key: Key('filter-${filter.name}'),
      label: Text('$label ${formatCount(counts[filter] ?? 0)}$suffix'),
      selected: _filter == filter,
      materialTapTargetSize: MaterialTapTargetSize.padded,
      onSelected: (_) => setState(() {
        _filter = filter;
        _rowsDirty = true;
      }),
    );
  }

  Widget _body(BuildContext context) {
    final serverRows = _visibleServerItems;
    // A device-only screen with no server rows keeps the full-screen permission
    // state; with server rows the grid renders and the banner says the rest.
    if (!_canRead && serverRows.isEmpty) {
      final permissionState = _permissionState(context);
      if (permissionState != null) return permissionState;
    }

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

    if (_assets.isEmpty && serverRows.isEmpty) {
      if (_loading || _serverLoading) {
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

  /// Headline, default message, action label and icon for the current grant.
  (String, String, String, IconData) get _permissionCopy =>
      switch (widget.permission) {
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

  /// Everything the grid needs to know about a blocked library, or null.
  Widget? _permissionState(BuildContext context) {
    final (String title, String message, String action, IconData icon) =
        _permissionCopy;
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
    // Reachable only when the grid has no rows. An unreachable server half is
    // not an empty one, so only a clean read lets the merged copy claim both.
    final nothingAnywhere = _serverError == null && _serverItems.isEmpty;

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
                nothingAnywhere
                    ? 'Nothing on this phone or on the server yet. Photos '
                          'appear here from either side.'
                    : limited
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
    final columns = _modelColumns;

    return Stack(
      children: <Widget>[
        RefreshIndicator(
          onRefresh: _refresh,
          child: CustomScrollView(
            controller: _scroll,
            physics: const AlwaysScrollableScrollPhysics(),
            // Two screens of slack: fewer blank tiles when a fling reverses.
            scrollCacheExtent: ScrollCacheExtent.pixels(
              MediaQuery.sizeOf(context).height * 2,
            ),
            slivers: <Widget>[
              if (widget.permission == PhotoPermission.limited)
                const SliverToBoxAdapter(
                  child: Padding(
                    padding: EdgeInsets.fromLTRB(16, 4, 16, 12),
                    child: _LimitedNote(),
                  ),
                ),
              if (_rows.isEmpty)
                SliverFillRemaining(
                  hasScrollBody: false,
                  child: _noMatches(context),
                )
              else ...<Widget>[
                SliverRows(
                  layout: RowsLayout(_rowTops),
                  delegate: SliverChildBuilderDelegate(
                    (context, index) => _buildRow(context, index, columns),
                    childCount: _rows.length,
                  ),
                ),
                SliverToBoxAdapter(child: _footer(context)),
              ],
            ],
          ),
        ),
        // The chronological rail: proportional to the loaded rows and extended
        // on demand, because the device cannot tell the app how tall the
        // unread part of the library is.
        Positioned(
          top: 0,
          bottom: 0,
          right: 0,
          width: MonthRail.width,
          child: MonthRail(
            state: _rail,
            onScrubStart: _onRailScrubStart,
            onScrub: _onRailScrub,
            onScrubEnd: _onRailScrubEnd,
            onJump: _onRailJump,
            onStep: _onRailStep,
          ),
        ),
        // The day bar floats over the list instead of being one pinned header
        // per day: its extent never changes, so nothing shifts under the
        // finger and only this bar rebuilds as the days go by.
        ValueListenableBuilder<_StickyBar?>(
          valueListenable: _stickyDay,
          builder: (context, bar, _) {
            if (bar == null) return const SizedBox.shrink();
            return Positioned(
              top: bar.top,
              left: 0,
              right: 0,
              child: _DayHeader(
                label: bar.row.label!,
                count: bar.row.count,
                height: bar.row.height,
                sticky: true,
              ),
            );
          },
        ),
      ],
    );
  }

  /// One line of the list: a day header, or the tiles of one row.
  Widget _buildRow(BuildContext context, int index, int columns) {
    final row = _rows[index];
    final items = row.items;
    if (items == null) {
      return _DayHeader(
        label: row.label!,
        count: row.count,
        height: row.height,
      );
    }

    return Padding(
      padding: const EdgeInsets.only(
        bottom: _gap,
        left: _gutter,
        right: _gutter,
      ),
      child: SizedBox(
        // Exactly [_gap] less than the height the model recorded, so the rows
        // keep tiling the offsets the day bar and "jump to day" rely on.
        height: row.height - _gap,
        child: Row(
          children: <Widget>[
            for (var column = 0; column < columns; column++) ...<Widget>[
              if (column > 0) const SizedBox(width: _gap),
              Expanded(
                child: column < items.length
                    ? _tile(items[column])
                    : const SizedBox.shrink(),
              ),
            ],
          ],
        ),
      ),
    );
  }

  Widget _tile(LibraryItem item) {
    final selectable = item.provenance != Provenance.onlineOnly;
    return AssetTile(
      key: ValueKey<String>(item.key),
      item: item,
      preview: _preview,
      progress: widget.progress,
      deferring: _deferring,
      status: _statusOfItem(item),
      selecting: _selecting,
      selected: _selected.containsKey(item.key),
      onTap: _selecting && selectable
          ? () => _toggleSelection(item)
          : () => _openViewer(item),
      // A row only the server holds has nothing this phone can queue.
      onLongPress: selectable ? () => _toggleSelection(item) : null,
    );
  }

  /// Rebuilds [_rows] for the current data, filter and geometry.
  void _ensureRows({
    required int columns,
    required double tileSide,
    required double headerHeight,
  }) {
    final rows = <_GridRow>[];
    final tops = <double>[0];
    final months = <MonthSpan>[];
    var top = 0.0;

    void add(_GridRow row) {
      rows.add(row);
      top += row.height;
      tops.add(top);
    }

    void addDay(String label, List<LibraryItem> items) {
      final date = items.first.date;
      final monthKey = date == null ? null : _monthKey(date);
      final headerTop = top;
      add(
        _GridRow.header(
          label: label,
          count: items.length,
          height: headerHeight,
        ),
      );
      for (var start = 0; start < items.length; start += columns) {
        final end = start + columns < items.length
            ? start + columns
            : items.length;
        add(
          _GridRow.tiles(
            items: items.sublist(start, end),
            height: tileSide + _gap,
          ),
        );
      }
      if (monthKey == null || date == null) return;
      // Days arrive newest first, so a month either extends the last span or
      // starts a new one. Undated assets belong to no month.
      if (months.isNotEmpty && months.last.key == monthKey) {
        final last = months.removeLast();
        months.add(
          MonthSpan(key: monthKey, label: last.label, top: last.top, end: top),
        );
      } else {
        months.add(
          MonthSpan(
            key: monthKey,
            label: _monthLabel(date),
            top: headerTop,
            end: top,
          ),
        );
      }
    }

    String? label;
    var day = <LibraryItem>[];
    final undated = <LibraryItem>[];
    final items = _displayItems();

    for (final item in _filtered(items)) {
      final date = item.date;
      if (date == null) {
        undated.add(item);
        continue;
      }
      final dayLabel = _dayLabel(date);
      if (dayLabel != label) {
        if (day.isNotEmpty) addDay(label!, day);
        label = dayLabel;
        day = <LibraryItem>[];
      }
      day.add(item);
    }
    if (day.isNotEmpty) addDay(label!, day);
    if (undated.isNotEmpty) addDay('Undated', undated);

    _rows = rows;
    _rowTops = tops;
    _counts = _filterCounts(items);
    _months = months;
    _rowsDirty = false;
    _modelColumns = columns;
    _modelTileSide = tileSide;
    _modelHeaderHeight = headerHeight;
    // The bar and the rail must follow the new rows without touching state
    // during a build.
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (_disposed) return;
      _updateSticky();
      _updateRail();
    });
  }

  static String _monthKey(DateTime date) =>
      '${date.year}-${date.month.toString().padLeft(2, '0')}';

  String _monthLabel(DateTime date) =>
      '${monthAbbreviations[date.month - 1]} ${date.year}';

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
    // pages must not spin forever (it would also never settle in tests). The
    // server half uses the same spinner; it draws no placeholders of its own.
    if (_loading || _serverLoading) {
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

  /// Side of one square tile, so a row height matches what is drawn exactly.
  double _tileSideFor(BuildContext context, int columns) {
    final width = MediaQuery.sizeOf(context).width;
    return (width - 2 * _gutter - (columns - 1) * _gap) / columns;
  }

  String _dayLabel(DateTime date) {
    final now = DateTime.now();
    final day = DateTime(date.year, date.month, date.day);
    final today = DateTime(now.year, now.month, now.day);
    final days = today.difference(day).inDays;
    if (days == 0) return 'Today';
    if (days == 1) return 'Yesterday';
    final month = monthAbbreviations[date.month - 1];
    return date.year == now.year
        ? '${date.day} $month'
        : '${date.day} $month ${date.year}';
  }
}

/// Day separator: the day, how many photos it holds, and its exact height.
///
/// As a plain row it costs one widget; the bar that follows the top edge is the
/// same widget with [sticky] set.
class _DayHeader extends StatelessWidget {
  const _DayHeader({
    required this.label,
    required this.count,
    required this.height,
    this.sticky = false,
  });

  final String label;
  final int count;

  /// Fixed height, grown for large accessibility text so the label still fits.
  final double height;

  /// True for the bar floating over the top edge while a day scrolls by.
  final bool sticky;

  /// Height of one header row; the grid model counts on this exactly.
  static double heightFor(BuildContext context) {
    final theme = Theme.of(context);
    final fontSize = theme.textTheme.labelLarge?.fontSize ?? 14;
    final scaled = MediaQuery.textScalerOf(context).scale(fontSize);
    return (scaled * 1.5 + 14).clamp(44.0, 140.0);
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;

    return SizedBox(
      height: height,
      child: DecoratedBox(
        // Nearly opaque: the grid slides underneath and stays readable.
        decoration: BoxDecoration(
          color: scheme.surface.withValues(alpha: sticky ? 0.97 : 0.94),
          border: sticky
              ? Border(
                  bottom: BorderSide(
                    color: scheme.outlineVariant.withValues(alpha: 0.35),
                  ),
                )
              : null,
        ),
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

/// One line of the grid: a day header, or up to `columns` tiles.
///
/// The grid is a list of these instead of one sliver per day, so a frame costs
/// what is on screen rather than how many days are loaded. [height] is exact,
/// which is what makes a row offset a prefix sum rather than a measurement.
class _GridRow {
  const _GridRow.header({
    required this.label,
    required this.count,
    required this.height,
  }) : items = null;

  const _GridRow.tiles({required this.items, required this.height})
    : label = null,
      count = 0;

  /// Day the row belongs to; set on header rows only.
  final String? label;

  /// Items in that day; set on header rows only.
  final int count;

  /// Tiles of this row; set on tile rows only.
  final List<LibraryItem>? items;

  final double height;
}

/// The floating day bar: which day, and how far the next day pushed it up.
class _StickyBar {
  const _StickyBar({required this.row, required this.top});

  final _GridRow row;
  final double top;
}
