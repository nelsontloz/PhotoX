import 'package:workmanager/workmanager.dart';

import '../app_services.dart';
import 'scheduler.dart';

/// Wall-clock budget for one opportunistic pass. Periodic and one-off tasks
/// share the short window; the iOS processing task is allowed to run for
/// minutes before it is interrupted.
const Duration _shortBudget = Duration(seconds: 25);
const Duration _processingBudget = Duration(minutes: 2);

/// Entry point the OS calls in a background isolate for scheduled work.
///
/// WorkManager/BGTask execution is device-only: simulators and emulators do
/// not honour real background windows, so schedule behaviour can only be
/// validated on physical hardware.
///
/// The queue is the source of truth: every retry schedule is persisted before
/// the network attempt, so returning `true` after a partial pass never loses
/// progress and never triggers a retry storm. Only an unexpected failure (the
/// graph could not be built, a transport blew up outside the coordinator)
/// returns `false` so the OS schedules its own retry.
@pragma('vm:entry-point')
void callbackDispatcher() {
  Workmanager().executeTask((task, inputData) async {
    AppServices? services;
    try {
      services = await AppServices.initializeBackground();
      await services.auth.restore();
      if (!services.auth.isSignedIn) {
        // Nothing to sync, and a background isolate must never prompt for
        // photo access. Finish successfully; there is no work to retry.
        return true;
      }
      final budget = task == BackgroundScheduler.processingTask
          ? _processingBudget
          : _shortBudget;
      // An unusable session surfaces as `report.authRequired` without
      // throwing, so this returns true and sign-in stays a foreground action.
      await services.coordinator.run(budget: budget);
      return true;
    } on Object {
      return false;
    } finally {
      try {
        await services?.dispose();
      } on Object {
        // Cleanup failures must never replace the task result.
      }
    }
  });
}
