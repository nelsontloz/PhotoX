# Validating background backup on real hardware

Background execution is decided by the OS and is **device-only**. Simulators
and emulators do not honour JobScheduler / BGTaskScheduler windows, so the
checks below require a physical Android device and/or iPhone.

The app's guaranteed sync path is app open/resume. Background work is
opportunistic: a pass may be deferred, shortened, or killed by the OS. The
drift queue persists every asset and part receipt before the network attempt,
so a killed pass resumes rather than restarting.

Start the core stack first and keep its host port handy:

```bash
tool/e2e/stack_up.sh
# example output: core healthy at http://127.0.0.1:3917
```

Watch what the server receives while testing:

```bash
# from the repo root
docker compose -p photox-mobile-e2e \
  -f docker-compose.yml -f docker-compose.e2e.yml \
  -f apps/mobile/tool/e2e/docker-compose.mobile.yml \
  logs -f core
```

## Android

### Install and point at core

```bash
# Emulator: 10.0.2.2 is the host loopback.
flutter run -d <device> \
  --dart-define=PHOTOX_API_URL=http://10.0.2.2:3917

# Physical device: reverse the loopback-published core port over USB.
adb reverse tcp:3917 tcp:3917
flutter run -d <device> \
  --dart-define=PHOTOX_API_URL=http://127.0.0.1:3917
```

Use `--release` for realistic timing once the checks are passing in debug; use
debug/profile if you need `adb logcat`.

### Grant permissions and seed media

```bash
# Android 13+ (API 33+)
adb shell pm grant com.photox.photox_mobile android.permission.READ_MEDIA_IMAGES
adb shell pm grant com.photox.photox_mobile android.permission.READ_MEDIA_VIDEO
adb shell pm grant com.photox.photox_mobile android.permission.READ_MEDIA_VISUAL_USER_SELECTED

# Android 12 and below
adb shell pm grant com.photox.photox_mobile android.permission.READ_EXTERNAL_STORAGE

# Generated 1x1 PNG or your own files
tool/e2e/seed_android.sh
tool/e2e/seed_android.sh ~/Pictures/sample.jpg

# Confirm MediaStore sees it
adb shell content query \
  --uri content://media/external/images/media \
  --projection _id:_display_name
```

If `pm grant` says the permission is not changeable, grant Photos access from
the app/OS settings UI (Android 14 partial access is expected). The app must be
signed in for any upload to happen.

### Find and force-run the WorkManager job

```bash
adb shell dumpsys jobscheduler \
  | grep -n -B4 -A30 'com.photox.photox_mobile'
```

Each WorkManager job appears as `JOB #u0aXXX/<id>: com.photox.photox_mobile`.
Use the `<id>`:

```bash
adb shell cmd jobscheduler run -f com.photox.photox_mobile <id>
```

`-f` runs it even when constraints are unmet. Without `-f` the command asks
the OS to run it when the job's constraints allow.

Expected: `Running job ...`, a short background window, then requests in the
core log. The app may not update its UI until reopened; the queue database and
server are the source of truth.

### Force-stop, Doze, battery saver, reboot, airplane mode

```bash
# Force-stop: no further background work until the app is launched again.
adb shell am force-stop com.photox.photox_mobile
# Expect: no new core requests from scheduled work; Jobs may show stopped.
# Reopen to re-register:
adb shell monkey -p com.photox.photox_mobile 1

# Doze (screen off, unplugged is the realistic case)
adb shell dumpsys battery unplug
adb shell dumpsys deviceidle force-idle
adb shell dumpsys deviceidle get deep
# Expect: jobs wait for a maintenance window; force-run with -f still works.
adb shell dumpsys deviceidle unforce
adb shell dumpsys battery reset

# Battery saver
adb shell settings put global low_power 1
adb shell dumpsys power | grep -i 'low power'
# Expect: deferred background work; app-open sync still runs.
adb shell settings put global low_power 0

# Reboot: JobScheduler jobs survive, but expect no immediate run.
adb reboot
# After unlock:
adb shell dumpsys jobscheduler | grep -A20 'com.photox.photox_mobile'

# Airplane mode
adb shell cmd connectivity airplane-mode enable
adb shell cmd jobscheduler run com.photox.photox_mobile <id>
# Expect: job pending / constraint not met, no new core requests.
adb shell cmd connectivity airplane-mode disable
# Expect: job eligible again; queue retries with backoff.
```

On older Android versions use
`adb shell settings put global airplane_mode_on 1` followed by the
`android.intent.action.AIRPLANE_MODE` broadcast.

## iOS

Real background scheduling requires a **physical iPhone**. A Simulator can
show the UI and run foreground sync, but BGTaskScheduler does not deliver real
background windows there.

1. Start the core stack. A physical iPhone cannot reach the host's loopback, so
   point `PHOTOX_API_URL` at a URL reachable from the phone (LAN address or a
   tunnel). Use the same URL in the Xcode scheme/debug configuration.
2. Install a debug build and launch it from Xcode with the debugger attached:
   open `ios/Runner.xcworkspace`, select the device, Run.
3. Sign in, grant Photos access, and seed the library (use Xcode's Devices
   window, AirDrop, or sync photos; the Simulator helper below only targets a
   booted Simulator):
   `tool/e2e/seed_ios.sh` (Simulator) or add files through Photos/Finder.
4. Keep the app foregrounded once so `main.dart` registers the schedules, then
   background it.

### Simulate BGTask launches with LLDB

Pause execution in Xcode (Debug > Pause), then in the LLDB console:

```lldb
e -l objc -- (void)[[BGTaskScheduler sharedScheduler] _simulateLaunchForTaskWithIdentifier:@"photox.sync.periodic"]
e -l objc -- (void)[[BGTaskScheduler sharedScheduler] _simulateLaunchForTaskWithIdentifier:@"photox.sync.processing"]
e -l objc -- (void)[[BGTaskScheduler sharedScheduler] _simulateLaunchForTaskWithIdentifier:@"photox.sync.now"]
```

The identifiers must match `BGTaskSchedulerPermittedIdentifiers` in
`ios/Runner/Info.plist`.

Notes:

- `photox.sync.periodic` maps to `BGAppRefreshTask`; `photox.sync.processing`
  maps to `BGProcessingTask`. Both are submitted during app start.
- `photox.sync.now` is a one-off `UIApplication` background task in the
  Workmanager plugin, not a `BGTaskScheduler` request. The identifier is listed
  for completeness, but `_simulateLaunch` only works when that task has actually
  been submitted; the current UI does not call `requestSyncNow()`.

To exercise expiration, pause again and use:

```lldb
e -l objc -- (void)[[BGTaskScheduler sharedScheduler] _simulateExpirationForTaskWithIdentifier:@"photox.sync.processing"]
```

Expected: the debugger prints the launch, then the worker logs/queue activity
appear; the core receives requests if the device has network and the asset is
pending.

### Low Power Mode and force-quit

- Low Power Mode (Settings > Battery, or Control Center): BGAppRefresh and
  BGProcessing are deferred. The app-open/resume pass still syncs.
  Simulator-only visual override:
  `xcrun simctl status_bar booted override --batteryState discharging --batteryLevel 20`
  (this does not enable Low Power Mode).
- Force-quit (swipe the app away): iOS does not relaunch the app for background
  tasks. Expect no uploads until the user opens the app again. This is expected
  behavior, not a bug.

### Background URLSession caveat

The app uses Dart/Dio HTTP inside Workmanager tasks, **not** an iOS background
`URLSession`. Therefore:

- a large single upload pauses when the OS suspends the background task and
  resumes from the persisted queue/part receipts on the next window or app open;
- the app cannot rely on `URLSession`'s discretionary transfer/relaunch
  behavior;
- this is exactly why the drift queue is the source of truth and why app-open
  sync is the guaranteed path.

## B1–B12 verification checklist

| ID | Case | Command | Expected result |
| --- | --- | --- | --- |
| B1 | App-open sync | Force-quit/reopen the app while signed in; seed one new image first | Foreground pass starts, new asset uploads, queue count reaches uploaded |
| B2 | App-resume sync | Put the app in background, wait 5s, resume | A foreground pass starts on `resumed`; no duplicate upload |
| B3 | Android periodic job registered | `adb shell dumpsys jobscheduler \| grep -A30 com.photox.photox_mobile` | A periodic job for the package exists with a ~15 min interval |
| B4 | Android periodic job executes | `adb shell cmd jobscheduler run -f com.photox.photox_mobile <id>` | Job runs; core log shows requests; queue advances |
| B5 | One-off sync request | Call `BackgroundScheduler.requestSyncNow()` (not currently wired to UI) then inspect jobs | A one-off job appears; force-running it performs a pass |
| B6 | Android force-stop | `adb shell am force-stop com.photox.photox_mobile`; wait for the periodic window | No background requests until the app is launched again |
| B7 | Android reboot persistence | `adb reboot`, unlock, inspect jobs | Periodic job is present again; a run may be deferred by constraints |
| B8 | Airplane mode / offline retry | Enable airplane mode, force-run a job, restore network | No upload while offline; no crash; retry/backoff resumes when online |
| B9 | Doze / battery saver | `dumpsys deviceidle force-idle`, `settings put global low_power 1` | Background windows defer; app-open sync still works; no data loss |
| B10 | iOS Low Power Mode | Toggle Low Power Mode, background the app, wait | BG tasks defer; app-open sync succeeds when reopened |
| B11 | iOS force-quit | Swipe the app away, wait for a BG task window | No relaunch/upload until the user opens the app |
| B12 | iOS BGTask launch/expiration | LLDB `_simulateLaunch...` for `periodic` and `processing`, then `_simulateExpiration...` | Task starts, performs a bounded pass, and survives expiration without losing queue progress |

For every case, verify both sides: the drift queue state in the app (or its UI
counters) and the request/response trail in the core container log. A green
`flutter test` says nothing about OS background behavior.
