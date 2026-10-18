import 'package:workmanager/workmanager.dart';

/// Entry point the OS calls in a background isolate for scheduled work.
@pragma('vm:entry-point')
void callbackDispatcher() {
  Workmanager().executeTask((task, inputData) async {
    // TODO(spec §3.5): open the queue, run one sync pass, persist progress, and
    // return false only when the OS should retry the task.
    return true;
  });
}
