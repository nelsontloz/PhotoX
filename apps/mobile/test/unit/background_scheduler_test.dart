import 'package:flutter_test/flutter_test.dart';
import 'package:photox_mobile/background/scheduler.dart';
import 'package:photox_mobile/settings/settings_store.dart';
import 'package:workmanager/workmanager.dart';

class _PeriodicCall {
  const _PeriodicCall(
    this.uniqueName,
    this.taskName,
    this.frequency,
    this.constraints,
    this.policy,
  );

  final String uniqueName;
  final String taskName;
  final Duration frequency;
  final Constraints constraints;
  final ExistingPeriodicWorkPolicy policy;
}

class _OneOffCall {
  const _OneOffCall(
    this.uniqueName,
    this.taskName,
    this.constraints,
    this.policy,
  );

  final String uniqueName;
  final String taskName;
  final Constraints constraints;
  final ExistingWorkPolicy policy;
}

class _ProcessingCall {
  const _ProcessingCall(this.uniqueName, this.taskName, this.constraints);

  final String uniqueName;
  final String taskName;
  final Constraints constraints;
}

class _FakeRegistrar implements WorkRegistrar {
  int initializeCalls = 0;
  final List<_PeriodicCall> periodicCalls = <_PeriodicCall>[];
  final List<_OneOffCall> oneOffCalls = <_OneOffCall>[];
  final List<_ProcessingCall> processingCalls = <_ProcessingCall>[];
  final List<String> cancelled = <String>[];
  final Set<String> failCancellations = <String>{};

  @override
  Future<void> initialize(void Function() callbackDispatcher) async {
    initializeCalls++;
  }

  @override
  Future<void> registerPeriodicTask(
    String uniqueName,
    String taskName, {
    required Duration frequency,
    required Constraints constraints,
    required ExistingPeriodicWorkPolicy existingWorkPolicy,
  }) async {
    periodicCalls.add(
      _PeriodicCall(
        uniqueName,
        taskName,
        frequency,
        constraints,
        existingWorkPolicy,
      ),
    );
  }

  @override
  Future<void> registerOneOffTask(
    String uniqueName,
    String taskName, {
    required Constraints constraints,
    required ExistingWorkPolicy existingWorkPolicy,
  }) async {
    oneOffCalls.add(
      _OneOffCall(uniqueName, taskName, constraints, existingWorkPolicy),
    );
  }

  @override
  Future<void> registerProcessingTask(
    String uniqueName,
    String taskName, {
    required Constraints constraints,
  }) async {
    processingCalls.add(_ProcessingCall(uniqueName, taskName, constraints));
  }

  @override
  Future<void> cancelByUniqueName(String uniqueName) async {
    cancelled.add(uniqueName);
    if (failCancellations.contains(uniqueName)) {
      throw StateError('cancel failed: $uniqueName');
    }
  }
}

void main() {
  late _FakeRegistrar registrar;
  late BackgroundScheduler scheduler;

  setUp(() {
    registrar = _FakeRegistrar();
    scheduler = BackgroundScheduler(registrar: registrar, isIOS: false);
  });

  test('init schedules the periodic task with wifi-only constraints', () async {
    await scheduler.init(const AppSettings(wifiOnly: true));
    await scheduler.init(const AppSettings(wifiOnly: true));

    expect(registrar.initializeCalls, 1, reason: 'plugin init once');
    final call = registrar.periodicCalls.last;
    expect(call.uniqueName, BackgroundScheduler.periodicTask);
    expect(call.taskName, BackgroundScheduler.periodicTask);
    expect(call.frequency, const Duration(minutes: 15));
    expect(call.policy, ExistingPeriodicWorkPolicy.update);
    expect(call.constraints.networkType, NetworkType.unmetered);
    expect(call.constraints.requiresCharging, isFalse);
    expect(call.constraints.requiresBatteryNotLow, isTrue);
    expect(registrar.processingCalls, isEmpty, reason: 'Android only');
  });

  test('updateSettings re-registers with the new constraints', () async {
    await scheduler.init(
      const AppSettings(wifiOnly: true, chargingOnly: false),
    );
    expect(
      registrar.periodicCalls.single.constraints.networkType,
      NetworkType.unmetered,
    );
    expect(
      registrar.periodicCalls.single.constraints.requiresCharging,
      isFalse,
    );

    await scheduler.updateSettings(
      const AppSettings(wifiOnly: false, chargingOnly: true),
    );

    expect(registrar.initializeCalls, 1, reason: 'never re-initializes');
    expect(registrar.periodicCalls, hasLength(2));
    final call = registrar.periodicCalls.last;
    expect(call.constraints.networkType, NetworkType.connected);
    expect(call.constraints.requiresCharging, isTrue);
    expect(call.constraints.requiresBatteryNotLow, isTrue);
  });

  test('iOS registers the processing task with the same constraints', () async {
    final iosScheduler = BackgroundScheduler(registrar: registrar, isIOS: true);
    await iosScheduler.init(
      const AppSettings(wifiOnly: true, chargingOnly: true),
    );

    final call = registrar.processingCalls.single;
    expect(call.uniqueName, BackgroundScheduler.processingTask);
    expect(call.taskName, BackgroundScheduler.processingTask);
    expect(call.constraints.networkType, NetworkType.unmetered);
    expect(call.constraints.requiresCharging, isTrue);
    expect(call.constraints.requiresBatteryNotLow, isTrue);
  });

  test(
    'requestSyncNow replaces the one-off task with current constraints',
    () async {
      await scheduler.init(const AppSettings(wifiOnly: false));
      await scheduler.requestSyncNow();

      final first = registrar.oneOffCalls.single;
      expect(first.uniqueName, BackgroundScheduler.oneOffTask);
      expect(first.taskName, BackgroundScheduler.oneOffTask);
      expect(first.policy, ExistingWorkPolicy.replace);
      expect(first.constraints.networkType, NetworkType.connected);

      await scheduler.updateSettings(const AppSettings(wifiOnly: true));
      await scheduler.requestSyncNow();

      expect(registrar.oneOffCalls, hasLength(2));
      expect(registrar.oneOffCalls.last.policy, ExistingWorkPolicy.replace);
      expect(
        registrar.oneOffCalls.last.constraints.networkType,
        NetworkType.unmetered,
      );
    },
  );

  test('cancelAll cancels all three tasks', () async {
    await scheduler.cancelAll();

    expect(registrar.cancelled, <String>[
      BackgroundScheduler.periodicTask,
      BackgroundScheduler.processingTask,
      BackgroundScheduler.oneOffTask,
    ]);
  });

  test('updateSettings initializes the plugin when init was skipped', () async {
    await scheduler.updateSettings(const AppSettings(wifiOnly: false));

    expect(registrar.initializeCalls, 1);
    expect(registrar.periodicCalls, hasLength(1));
    expect(
      registrar.periodicCalls.single.constraints.networkType,
      NetworkType.connected,
    );

    await scheduler.updateSettings(const AppSettings(wifiOnly: true));

    expect(registrar.initializeCalls, 1, reason: 'initialized only once');
    expect(registrar.periodicCalls, hasLength(2));
    expect(
      registrar.periodicCalls.last.constraints.networkType,
      NetworkType.unmetered,
    );
  });

  test(
    'cancelAll attempts every cancellation and rethrows the first error',
    () async {
      registrar.failCancellations.addAll(<String>[
        BackgroundScheduler.periodicTask,
        BackgroundScheduler.processingTask,
      ]);

      await expectLater(
        scheduler.cancelAll(),
        throwsA(
          isA<StateError>().having(
            (error) => error.message,
            'message',
            'cancel failed: ${BackgroundScheduler.periodicTask}',
          ),
        ),
      );

      expect(registrar.cancelled, <String>[
        BackgroundScheduler.periodicTask,
        BackgroundScheduler.processingTask,
        BackgroundScheduler.oneOffTask,
      ]);
    },
  );
}
