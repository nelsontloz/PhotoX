import 'package:flutter/material.dart';

import 'app_controller.dart';
import 'ui/home_screen.dart';
import 'ui/login_screen.dart';
import 'ui/settings_screen.dart';

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
        darkTheme: ThemeData(
          useMaterial3: true,
          colorScheme: ColorScheme.fromSeed(
            seedColor: const Color(0xFF4C6FFF),
            brightness: Brightness.dark,
          ),
        ),
        home: controller.isSignedIn
            ? HomeScreen(
                stats: controller.stats,
                permission: controller.permission,
                syncing: controller.syncing,
                authRequired: controller.authRequired,
                lastReport: controller.lastReport,
                error: controller.error,
                onSyncNow: controller.syncNow,
                onOpenSettings: _openSettings,
                onSignOut: controller.signOut,
              )
            : LoginScreen(
                onSignIn: controller.signIn,
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
