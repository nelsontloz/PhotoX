import 'dart:io';

import 'package:workmanager/workmanager.dart';

import '../settings/settings_store.dart';
import 'worker.dart';

/// Minimal seam over the Workmanager plugin so registration logic is testable
/// without platform channels.
abstract class WorkRegistrar {
  /// Initializes the plugin once per process with the background entrypoint.
  Future<void> initialize(void Function() callbackDispatcher);

  /// Registers or updates the periodic sync task.
  Future<void> registerPeriodicTask(
    String uniqueName,
    String taskName, {
    required Duration frequency,
    required Constraints constraints,
    required ExistingPeriodicWorkPolicy existingWorkPolicy,
  });

  /// Registers or replaces the one-off "sync now" task.
  Future<void> registerOneOffTask(
    String uniqueName,
    String taskName, {
    required Constraints constraints,
    required ExistingWorkPolicy existingWorkPolicy,
  });

  /// Registers the long-running iOS BGProcessingTask.
  Future<void> registerProcessingTask(
    String uniqueName,
    String taskName, {
    required Constraints constraints,
  });

  /// Removes a pending or running task by its unique name.
  Future<void> cancelByUniqueName(String uniqueName);
}

/// [WorkRegistrar] backed by the real plugin.
class WorkmanagerRegistrar implements WorkRegistrar {
  const WorkmanagerRegistrar();

  @override
  Future<void> initialize(void Function() callbackDispatcher) =>
      Workmanager().initialize(callbackDispatcher);

  @override
  Future<void> registerPeriodicTask(
    String uniqueName,
    String taskName, {
    required Duration frequency,
    required Constraints constraints,
    required ExistingPeriodicWorkPolicy existingWorkPolicy,
  }) {
    return Workmanager().registerPeriodicTask(
      uniqueName,
      taskName,
      frequency: frequency,
      constraints: constraints,
      existingWorkPolicy: existingWorkPolicy,
    );
  }

  @override
  Future<void> registerOneOffTask(
    String uniqueName,
    String taskName, {
    required Constraints constraints,
    required ExistingWorkPolicy existingWorkPolicy,
  }) {
    return Workmanager().registerOneOffTask(
      uniqueName,
      taskName,
      constraints: constraints,
      existingWorkPolicy: existingWorkPolicy,
    );
  }

  @override
  Future<void> registerProcessingTask(
    String uniqueName,
    String taskName, {
    required Constraints constraints,
  }) {
    return Workmanager().registerProcessingTask(
      uniqueName,
      taskName,
      constraints: constraints,
    );
  }

  @override
  Future<void> cancelByUniqueName(String uniqueName) =>
      Workmanager().cancelByUniqueName(uniqueName);
}

/// Registers OS background schedules and asks for immediate sync passes.
///
/// Constraints (network, charging, battery) are always enforced by the OS via
/// [Constraints], never by Dart: a task either becomes eligible or it does
/// not. The unique name doubles as the iOS BGTaskScheduler identifier, which
/// is why it equals the task name and why all three names must stay listed in
/// `BGTaskSchedulerPermittedIdentifiers`.
class BackgroundScheduler {
  BackgroundScheduler({WorkRegistrar? registrar, bool? isIOS})
    : registrar = registrar ?? const WorkmanagerRegistrar(),
      _isIOS = isIOS ?? Platform.isIOS;

  /// Periodic Android task (15-minute floor) / iOS BGAppRefreshTask hint.
  static const String periodicTask = 'photox.sync.periodic';

  /// Long-running iOS BGProcessingTask for bulk backfill.
  static const String processingTask = 'photox.sync.processing';

  /// One-off pass requested by app open, resume or pull-to-sync.
  static const String oneOffTask = 'photox.sync.now';

  /// Android's periodic floor; iOS treats it as a scheduling hint only.
  static const Duration periodicFrequency = Duration(minutes: 15);

  /// Plugin seam.
  final WorkRegistrar registrar;

  final bool _isIOS;

  AppSettings _settings = const AppSettings();
  bool _initialized = false;

  /// Registers every OS schedule; safe to call again on each app start.
  Future<void> init(AppSettings settings) async {
    if (!_initialized) {
      await registrar.initialize(callbackDispatcher);
      _initialized = true;
    }
    await _register(settings);
  }

  /// Re-registers the schedules after the user changed constraints.
  ///
  /// Delegates to [init] so a caller that skipped start-up still initializes
  /// the plugin; [init] guards against double-initialization.
  Future<void> updateSettings(AppSettings settings) => init(settings);

  /// Asks the OS for one pass as soon as its constraints allow.
  ///
  /// ponytail: reserved for a future pull-to-sync / one-off caller; nothing
  /// calls it today, and it is not wired to the home screen.
  Future<void> requestSyncNow() async {
    await registrar.registerOneOffTask(
      oneOffTask,
      oneOffTask,
      constraints: _constraintsFor(_settings),
      existingWorkPolicy: ExistingWorkPolicy.replace,
    );
  }

  /// Cancels every scheduled sync task (used on sign-out).
  ///
  /// Keeps going if one cancellation fails so the other schedules are still
  /// removed, then rethrows the first error.
  Future<void> cancelAll() async {
    Object? firstError;
    StackTrace? firstStackTrace;
    for (final name in <String>[periodicTask, processingTask, oneOffTask]) {
      try {
        await registrar.cancelByUniqueName(name);
      } on Object catch (error, stackTrace) {
        firstError ??= error;
        firstStackTrace ??= stackTrace;
      }
    }
    if (firstError != null) {
      Error.throwWithStackTrace(firstError, firstStackTrace!);
    }
  }

  Future<void> _register(AppSettings settings) async {
    _settings = settings;
    final constraints = _constraintsFor(settings);
    await registrar.registerPeriodicTask(
      periodicTask,
      periodicTask,
      frequency: periodicFrequency,
      constraints: constraints,
      existingWorkPolicy: ExistingPeriodicWorkPolicy.update,
    );
    if (_isIOS) {
      // BGProcessingTask is iOS-only; Android gets the same work through the
      // periodic task above.
      await registrar.registerProcessingTask(
        processingTask,
        processingTask,
        constraints: constraints,
      );
    }
  }

  /// Maps user preferences onto OS-level constraints.
  static Constraints _constraintsFor(AppSettings settings) {
    return Constraints(
      networkType: settings.wifiOnly
          ? NetworkType.unmetered
          : NetworkType.connected,
      requiresCharging: settings.chargingOnly,
      requiresBatteryNotLow: true,
    );
  }
}
