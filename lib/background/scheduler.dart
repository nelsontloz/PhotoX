/// Registers OS background schedules and asks for immediate sync passes.
class BackgroundScheduler {
  const BackgroundScheduler();

  /// Registers the periodic and processing tasks with the OS; safe to repeat.
  Future<void> init() async {
    // TODO(spec §3.5): iOS BGProcessingTask(requiresNetworkConnectivity, and
    // requiresExternalPower while chargingOnly) + BGAppRefreshTask, always
    // reschedule-first; Android WorkManager 15-min periodic plus the
    // content-trigger one-shot and a user-initiated job.
  }

  /// Asks the OS for a sync pass as soon as its constraints allow.
  Future<void> requestSyncNow() async {
    // TODO(spec §3.5): app open/resume always triggers a sync pass rather than
    // waiting for the next periodic window.
  }
}
