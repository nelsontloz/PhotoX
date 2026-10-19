import 'package:flutter/material.dart';

import 'app.dart';
import 'app_services.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();

  final services = await AppServices.initialize();
  final controller = services.controller!;
  try {
    await services.scheduler.init(controller.settings);
  } on Object catch (error) {
    // Background registration is opportunistic; foreground sync still works.
    debugPrint('Background sync could not be scheduled: $error');
  }

  runApp(PhotoXApp(controller: controller));
}
