import 'dart:async';

import 'package:flutter/material.dart';

import 'app_controller.dart';
import 'library/album_scope.dart';
import 'media/photo_observer.dart';
import 'media/video_playback.dart';
import 'ui/albums_screen.dart';
import 'ui/home_screen.dart';
import 'ui/library_screen.dart';
import 'ui/login_screen.dart';
import 'ui/settings_screen.dart';

/// Dark Material 3 theme shared by the shell and the first-launch screens.
///
/// The palette is fixed rather than seeded: the dashboard's card levels
/// (surface-container hierarchy) and the blue/violet/peach accents are part of
/// the design, so they must not drift with the seed algorithm.
ThemeData photoXTheme() {
  const scheme = ColorScheme(
    brightness: Brightness.dark,
    primary: Color(0xFFAFC6FF),
    onPrimary: Color(0xFF002E69),
    primaryContainer: Color(0xFF136DEC),
    onPrimaryContainer: Color(0xFFFFFFFF),
    secondary: Color(0xFFDDB8FF),
    onSecondary: Color(0xFF3A1D5C),
    secondaryContainer: Color(0xFF51307A),
    onSecondaryContainer: Color(0xFFF1DAFF),
    tertiary: Color(0xFFFFB695),
    onTertiary: Color(0xFF552005),
    tertiaryContainer: Color(0xFF74330F),
    onTertiaryContainer: Color(0xFFFFDBCC),
    error: Color(0xFFFFB4AB),
    onError: Color(0xFF690005),
    errorContainer: Color(0xFF93000A),
    onErrorContainer: Color(0xFFFFDAD6),
    surface: Color(0xFF10131B),
    onSurface: Color(0xFFE1E2ED),
    onSurfaceVariant: Color(0xFFC2C6D7),
    surfaceContainerLowest: Color(0xFF0B0E15),
    surfaceContainerLow: Color(0xFF191B23),
    surfaceContainer: Color(0xFF1D1F27),
    surfaceContainerHigh: Color(0xFF272A32),
    surfaceContainerHighest: Color(0xFF32353D),
    outline: Color(0xFF8C90A0),
    outlineVariant: Color(0xFF424754),
    inverseSurface: Color(0xFFE1E2ED),
    onInverseSurface: Color(0xFF2E3039),
    inversePrimary: Color(0xFF2A5BAF),
    shadow: Color(0xFF000000),
    scrim: Color(0xFF000000),
    surfaceTint: Color(0xFFAFC6FF),
  );

  return ThemeData(
    useMaterial3: true,
    colorScheme: scheme,
    scaffoldBackgroundColor: scheme.surface,
    appBarTheme: AppBarTheme(
      backgroundColor: Colors.transparent,
      surfaceTintColor: Colors.transparent,
      elevation: 0,
      scrolledUnderElevation: 0,
    ),
  );
}

/// Root widget of the PhotoX mobile app; dark Material 3 by default.
class PhotoXApp extends StatefulWidget {
  const PhotoXApp({super.key, required this.controller});

  /// Live app state; every notification rebuilds the shell.
  final AppController controller;

  @override
  State<PhotoXApp> createState() => _PhotoXAppState();
}

class _PhotoXAppState extends State<PhotoXApp> {
  final GlobalKey<NavigatorState> _navigatorKey = GlobalKey<NavigatorState>();

  /// Signed-in state alone, so a stats or progress notification never rebuilds
  /// the whole app: each tab listens for what it actually draws.
  late final ValueNotifier<bool> _signedIn = ValueNotifier<bool>(
    widget.controller.isSignedIn,
  );

  @override
  void initState() {
    super.initState();
    widget.controller.addListener(_syncSignedIn);
  }

  @override
  void dispose() {
    widget.controller.removeListener(_syncSignedIn);
    _signedIn.dispose();
    super.dispose();
  }

  void _syncSignedIn() {
    final signedIn = widget.controller.isSignedIn;
    if (signedIn != _signedIn.value) _signedIn.value = signedIn;
  }

  @override
  Widget build(BuildContext context) {
    final controller = widget.controller;

    return ValueListenableBuilder<bool>(
      valueListenable: _signedIn,
      builder: (context, signedIn, _) => MaterialApp(
        title: 'PhotoX',
        debugShowCheckedModeBanner: false,
        navigatorKey: _navigatorKey,
        themeMode: ThemeMode.dark,
        darkTheme: photoXTheme(),
        home: signedIn
            ? _SignedInShell(
                controller: controller,
                onOpenSettings: _openSettings,
              )
            : ListenableBuilder(
                listenable: controller,
                builder: (context, _) => LoginScreen(
                  onSignIn: controller.signIn,
                  serverUrl: controller.settings.apiBaseUrl,
                  busy: controller.busy,
                  error: controller.error,
                ),
              ),
      ),
    );
  }

  void _openSettings() {
    _navigatorKey.currentState?.push(
      MaterialPageRoute<void>(
        builder: (context) => AnimatedBuilder(
          animation: widget.controller,
          builder: (context, _) => SettingsScreen(
            settings: widget.controller.settings,
            onSave: widget.controller.updateSettings,
            onLoadFolders: widget.controller.folders,
            onSignOut: _signOutFromSettings,
            busy: widget.controller.busy,
          ),
        ),
      ),
    );
  }

  /// Pops back to the shell first so a fresh sign-out never flashes the
  /// settings of the session that is being revoked.
  Future<void> _signOutFromSettings() async {
    _navigatorKey.currentState?.popUntil((route) => route.isFirst);
    await widget.controller.signOut();
  }
}

/// Signed-in shell: the device library, its albums, then the backup dashboard.
///
/// An [IndexedStack] keeps every tab mounted, so scroll position and a live
/// selection survive a trip to another tab; settings stays a pushed route
/// reachable from each.
class _SignedInShell extends StatefulWidget {
  const _SignedInShell({
    required this.controller,
    required this.onOpenSettings,
  });

  final AppController controller;
  final VoidCallback onOpenSettings;

  @override
  State<_SignedInShell> createState() => _SignedInShellState();
}

class _SignedInShellState extends State<_SignedInShell> {
  static const int _libraryTab = 0;
  static const int _albumsTab = 1;

  int _index = _libraryTab;

  /// True once the Albums tab was first opened. [IndexedStack] builds every
  /// child, and `folders()` costs one album-count round trip per album, so the
  /// tab has to be built before it can read anything.
  bool _albumsOpened = false;

  /// Assets in the whole library, so an album holding all of them is known to
  /// cover everything. Read lazily with the Albums tab; null means "unknown".
  int? _libraryCount;

  /// The album the backup actually reads, so every tile in the grid is either
  /// backed up or waiting — never "not backed up" for something the backup was
  /// never asked to take.
  ///
  /// Null (whole library) while "All folders" is on or no album was chosen yet;
  /// browsing the rest of the device is what the Albums tab is for.
  String? get _scopeFolderId {
    final settings = widget.controller.settings;
    if (settings.uploadAllFolders) return null;
    return settings.uploadFolderIds.length == 1
        ? settings.uploadFolderIds.single
        : null;
  }

  /// Opens the Albums tab, reading its platform data on the first visit only.
  void _openAlbums() {
    if (_albumsOpened) {
      if (_index != _albumsTab) setState(() => _index = _albumsTab);
      return;
    }
    setState(() {
      _index = _albumsTab;
      _albumsOpened = true;
    });
    unawaited(_loadLibraryCount());
    unawaited(_loadServerAlbums());
  }

  /// Best effort: the tab must build even when the server is unreachable. The
  /// sheet re-reads the albums itself and shows its own error.
  Future<void> _loadServerAlbums() async {
    try {
      await widget.controller.refreshServerAlbums();
    } on Object {
      return;
    }
  }

  Future<void> _loadLibraryCount() async {
    int count;
    try {
      count = await widget.controller.libraryCount();
    } on Object {
      // The whole-library heuristic is optional: without the number no album is
      // assumed to cover everything.
      return;
    }
    if (!mounted) return;
    setState(() => _libraryCount = count);
  }

  /// The device grid, rebuilt when the state it draws changes.
  ///
  /// [album] is set when the grid was opened from the Albums tab: it titles the
  /// screen and lets the grid say whether that album is inside the scope.
  Widget _library(
    AppController controller, {
    MediaFolder? album,
    VoidCallback? onOpenAlbums,
  }) {
    return LibraryScreen(
      permission: controller.permission,
      settings: controller.settings,
      syncing: controller.syncing,
      queueRevision: controller.queueRevision,
      progress: controller.progress,
      folderId: album?.id ?? _scopeFolderId,
      title: album?.name,
      album: album,
      onOpenAlbums: onOpenAlbums,
      appBarActions: <Widget>[
        if (album != null)
          AlbumScopeAction(
            album: album,
            settings: controller.settings,
            libraryCount: _libraryCount,
            onScopeChanged: controller.updateSettings,
          ),
      ],
      loadPage: controller.libraryPage,
      loadStates: controller.backupStates,
      // The album grid stays device-only, so it gets no server half at all.
      serverPage: album == null ? controller.serverPage : null,
      serverIds: album == null ? controller.serverIds : null,
      serverThumb: album == null ? controller.serverThumb : null,
      thumbnail: controller.thumbnail,
      loadPreview: controller.preview,
      loadDetail: controller.backupDetail,
      video: VideoSupport(
        loadFile: controller.playableVideo,
        createPlayback: VideoPlayerPlayback.new,
      ),
      onBackUpNow: controller.backUpNow,
      onOpenSettings: widget.onOpenSettings,
      onSyncNow: controller.syncNow,
      onRequestAccess: controller.refreshPermission,
    );
  }

  /// Pushes one album's grid over the shell; its scope action can retarget the
  /// backup without leaving the album.
  void _openAlbum(AppController controller, MediaFolder album) {
    Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (routeContext) => ListenableBuilder(
          listenable: controller,
          builder: (context, _) => _library(
            controller,
            album: album,
            // Tapping the scope banner here means "show me the albums", which
            // are behind this route, so it closes first.
            onOpenAlbums: () {
              Navigator.of(routeContext).pop();
              _openAlbums();
            },
          ),
        ),
      ),
    );
  }

  /// The album list, with the scope written on every card.
  Widget _albums(AppController controller) {
    if (!_albumsOpened) return const SizedBox.shrink();
    return AlbumsScreen(
      settings: controller.settings,
      permission: controller.permission,
      libraryCount: _libraryCount,
      loadFolders: controller.folders,
      serverAlbums: controller.serverAlbums,
      serverAlbumsLoaded: controller.serverAlbumsLoaded,
      // The sheet re-reads on every open, so a failed read is its to report.
      loadServerAlbums: () async {
        await controller.refreshServerAlbums();
        return controller.serverAlbums;
      },
      onCreateServerAlbum: controller.createServerAlbum,
      onFolderAlbumChanged: controller.setFolderAlbum,
      // One page (size 1) plus one encoded thumbnail per album, asked once per
      // album: the grid-area preview the platform actually has, not an export.
      cover: (folderId) async {
        final page = await controller.libraryPage(
          offset: 0,
          limit: 1,
          folderId: folderId,
        );
        if (page.isEmpty) return null;
        return controller.thumbnail(page.first.localId, size: 160);
      },
      onScopeChanged: controller.updateSettings,
      onOpenAlbum: (album) => _openAlbum(controller, album),
      onOpenSettings: widget.onOpenSettings,
      loadProgress: controller.albumProgress,
    );
  }

  /// The sync dashboard.
  Widget _backup(AppController controller) {
    return HomeScreen(
      stats: controller.stats,
      progress: controller.progress,
      permission: controller.permission,
      syncing: controller.syncing,
      discovering: controller.discovering,
      paused: controller.paused,
      authRequired: controller.authRequired,
      lastReport: controller.lastReport,
      error: controller.error,
      scopeLabel: albumScopeLabel(controller.settings),
      onSyncNow: controller.syncNow,
      onRetryFailed: controller.retryFailed,
      onPause: controller.pause,
      onResume: controller.resume,
      onOpenSettings: widget.onOpenSettings,
      onSignOut: controller.signOut,
      thumbnail: controller.thumbnail,
    );
  }

  @override
  Widget build(BuildContext context) {
    final controller = widget.controller;

    return Scaffold(
      body: IndexedStack(
        index: _index,
        children: <Widget>[
          // Each tab listens on its own: this shell only rebuilds when a tab is
          // opened or an album count lands, so one tab's counters never rebuild
          // the other.
          ListenableBuilder(
            listenable: controller,
            builder: (context, _) =>
                _library(controller, onOpenAlbums: _openAlbums),
          ),
          ListenableBuilder(
            listenable: controller,
            builder: (context, _) => _albums(controller),
          ),
          ListenableBuilder(
            listenable: controller,
            builder: (context, _) => _backup(controller),
          ),
        ],
      ),
      bottomNavigationBar: NavigationBar(
        selectedIndex: _index,
        onDestinationSelected: (index) {
          if (index == _albumsTab) {
            _openAlbums();
            return;
          }
          setState(() => _index = index);
        },
        destinations: const <NavigationDestination>[
          NavigationDestination(
            icon: Icon(Icons.photo_library_outlined),
            selectedIcon: Icon(Icons.photo_library_rounded),
            label: 'Library',
          ),
          NavigationDestination(
            icon: Icon(Icons.folder_outlined),
            selectedIcon: Icon(Icons.folder_rounded),
            label: 'Albums',
          ),
          NavigationDestination(
            icon: Icon(Icons.cloud_upload_outlined),
            selectedIcon: Icon(Icons.cloud_upload_rounded),
            label: 'Backup',
          ),
        ],
      ),
    );
  }
}
