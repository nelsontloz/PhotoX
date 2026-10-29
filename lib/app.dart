import 'package:flutter/material.dart';

import 'app_controller.dart';
import 'ui/home_screen.dart';
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

  @override
  Widget build(BuildContext context) {
    final controller = widget.controller;

    return AnimatedBuilder(
      animation: controller,
      builder: (context, _) => MaterialApp(
        title: 'PhotoX',
        debugShowCheckedModeBanner: false,
        navigatorKey: _navigatorKey,
        themeMode: ThemeMode.dark,
        darkTheme: photoXTheme(),
        home: controller.isSignedIn
            ? HomeScreen(
                stats: controller.stats,
                progress: controller.progress,
                permission: controller.permission,
                syncing: controller.syncing,
                paused: controller.paused,
                authRequired: controller.authRequired,
                lastReport: controller.lastReport,
                error: controller.error,
                albumCount: controller.settings.uploadFolderIds.length,
                uploadAllFolders: controller.settings.uploadAllFolders,
                onSyncNow: controller.syncNow,
                onRetryFailed: controller.retryFailed,
                onPause: controller.pause,
                onResume: controller.resume,
                onOpenSettings: _openSettings,
                onSignOut: controller.signOut,
                thumbnail: controller.thumbnail,
              )
            : LoginScreen(
                onSignIn: controller.signIn,
                serverUrl: controller.settings.apiBaseUrl,
                busy: controller.busy,
                error: controller.error,
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
