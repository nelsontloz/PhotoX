import 'package:flutter/material.dart';

import 'app.dart';
import 'app_services.dart';
import 'settings/settings_store.dart';
import 'ui/server_setup_screen.dart';
import 'upload/database.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();

  final db = AppDatabase();
  final settingsStore = SettingsStore(db);
  final settings = await settingsStore.load();

  // No server configured yet: ask once, then boot with the stored address.
  if (settings.apiBaseUrl.isEmpty) {
    runApp(
      MaterialApp(
        title: 'PhotoX',
        debugShowCheckedModeBanner: false,
        themeMode: ThemeMode.dark,
        darkTheme: photoXTheme(),
        home: ServerSetupScreen(
          onSubmit: (url) async {
            await settingsStore.save(settings.copyWith(apiBaseUrl: url));
            await _launch(db);
          },
        ),
      ),
    );
    return;
  }

  await _launch(db);
}

Future<void> _launch(AppDatabase db) async {
  final services = await AppServices.initialize(database: db);
  final controller = services.controller!;
  try {
    await services.scheduler.init(controller.settings);
  } on Object catch (error) {
    // Background registration is opportunistic; foreground sync still works.
    debugPrint('Background sync could not be scheduled: $error');
  }

  runApp(PhotoXApp(controller: controller));
}
