import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:photox_mobile/media/photo_observer.dart';
import 'package:photox_mobile/settings/settings_store.dart';
import 'package:photox_mobile/sync/sync_coordinator.dart';
import 'package:photox_mobile/sync/transfer_progress.dart';
import 'package:photox_mobile/ui/home_screen.dart';
import 'package:photox_mobile/ui/login_screen.dart';
import 'package:photox_mobile/ui/settings_screen.dart';
import 'package:photox_mobile/ui/widgets/backup_progress.dart';
import 'package:photox_mobile/upload/upload_queue.dart';

Widget _app(Widget home, {double textScale = 1}) {
  return MaterialApp(
    debugShowCheckedModeBanner: false,
    themeMode: ThemeMode.dark,
    darkTheme: ThemeData(
      useMaterial3: true,
      colorScheme: ColorScheme.fromSeed(
        seedColor: const Color(0xFF4C6FFF),
        brightness: Brightness.dark,
      ),
    ),
    builder: textScale == 1
        ? null
        : (context, child) {
            final media = MediaQuery.of(context);
            return MediaQuery(
              data: media.copyWith(textScaler: TextScaler.linear(textScale)),
              child: child!,
            );
          },
    home: home,
  );
}

Finder _filledButton() {
  return find.byWidgetPredicate((widget) => widget is FilledButton);
}

/// Home screen with the state the test cares about; everything else is quiet.
Widget _home({
  QueueStats stats = const QueueStats(
    pending: 0,
    uploaded: 0,
    duplicate: 0,
    failed: 0,
  ),
  TransferProgress? progress,
  PhotoPermission permission = PhotoPermission.authorized,
  bool syncing = false,
  bool discovering = false,
  bool paused = false,
  bool authRequired = false,
  SyncReport? lastReport,
  String? error,
  Future<void> Function()? onSyncNow,
  Future<void> Function()? onPause,
  Future<void> Function()? onResume,
  VoidCallback? onOpenSettings,
  Future<void> Function()? onSignOut,
  Future<void> Function()? onRetryFailed,
  int albumCount = 1,
  bool uploadAllFolders = false,
  double textScale = 1,
}) {
  return _app(
    HomeScreen(
      stats: stats,
      progress: progress ?? TransferProgress(),
      permission: permission,
      syncing: syncing,
      discovering: discovering,
      paused: paused,
      authRequired: authRequired,
      lastReport: lastReport,
      error: error,
      albumCount: albumCount,
      uploadAllFolders: uploadAllFolders,
      onSyncNow: onSyncNow ?? () async {},
      onPause: onPause ?? () async {},
      onResume: onResume ?? () async {},
      onOpenSettings: onOpenSettings ?? () {},
      onSignOut: onSignOut ?? () async {},
      onRetryFailed: onRetryFailed ?? () async {},
    ),
    textScale: textScale,
  );
}

/// A transfer whose clock the test moves by hand, so speeds are deterministic.
({TransferProgress progress, void Function(Duration elapsed) tick})
_transfer() {
  var now = DateTime(2026, 1, 1);
  return (
    progress: TransferProgress(clock: () => now),
    tick: (elapsed) => now = now.add(elapsed),
  );
}

/// Two albums, the first flagged as the camera roll.
const List<MediaFolder> _albums = <MediaFolder>[
  MediaFolder(id: 'camera', name: 'Camera', assetCount: 120, isCamera: true),
  MediaFolder(id: 'screens', name: 'Screenshots', assetCount: 12),
];

/// Settings screen with a fake album list; overrides replace one behaviour.
Widget _settings({
  AppSettings settings = const AppSettings(),
  Future<void> Function(AppSettings settings)? onSave,
  Future<List<MediaFolder>> Function()? onLoadFolders,
  Future<void> Function()? onSignOut,
  double textScale = 1,
}) {
  return _app(
    SettingsScreen(
      settings: settings,
      onSave: onSave ?? (settings) async {},
      onLoadFolders: onLoadFolders ?? () async => _albums,
      onSignOut: onSignOut ?? () async {},
    ),
    textScale: textScale,
  );
}

/// The one-line scope summary in the folders card.
Future<String> _summary(WidgetTester tester) async {
  final finder = find.byKey(const Key('folder-scope-summary'));
  await tester.scrollUntilVisible(finder, 150);
  await tester.pumpAndSettle();
  return tester.widget<Text>(finder).data!;
}

/// Scrolls [finder] into view, then taps it.
Future<void> _tapInView(WidgetTester tester, Finder finder) async {
  await tester.scrollUntilVisible(finder, 150);
  await tester.pumpAndSettle();
  await tester.tap(finder);
  await tester.pumpAndSettle();
}

void main() {
  group('LoginScreen', () {
    testWidgets('shows validation messages and does not submit', (
      tester,
    ) async {
      var calls = 0;
      await tester.pumpWidget(
        _app(
          LoginScreen(
            onSignIn: (email, password, serverUrl) async {
              calls++;
            },
          ),
        ),
      );

      await tester.tap(find.text('Sign in'));
      await tester.pumpAndSettle();

      expect(find.text('Enter your server address.'), findsOneWidget);
      expect(find.text('Enter your email address.'), findsOneWidget);
      expect(find.text('Enter your password.'), findsOneWidget);
      expect(calls, 0);
    });

    testWidgets('submits a trimmed email and the typed password', (
      tester,
    ) async {
      String? email;
      String? password;
      String? server;
      await tester.pumpWidget(
        _app(
          LoginScreen(
            onSignIn: (value, secret, serverUrl) async {
              email = value;
              password = secret;
              server = serverUrl;
            },
          ),
        ),
      );

      await tester.enterText(
        find.byType(TextFormField).at(1),
        '  ada@example.com  ',
      );
      await tester.enterText(find.byType(TextFormField).at(2), 'correct horse');
      await tester.enterText(
        find.byType(TextFormField).at(0),
        '  http://10.0.2.2:3000/  ',
      );
      await tester.tap(find.text('Sign in'));
      await tester.pumpAndSettle();

      expect(email, 'ada@example.com');
      expect(password, 'correct horse');
      expect(server, 'http://10.0.2.2:3000');
    });

    testWidgets('shows the supplied sign-in error until the user edits', (
      tester,
    ) async {
      await tester.pumpWidget(
        _app(
          LoginScreen(
            onSignIn: (email, password, serverUrl) async {},
            error: 'Wrong email or password.',
          ),
        ),
      );

      expect(find.text('Wrong email or password.'), findsOneWidget);
      expect(find.text('Could not sign in'), findsOneWidget);

      await tester.enterText(
        find.byType(TextFormField).at(1),
        'ada@example.com',
      );
      await tester.pumpAndSettle();
      expect(find.text('Wrong email or password.'), findsNothing);

      await tester.enterText(find.byType(TextFormField).at(2), 'secret');
      await tester.enterText(
        find.byType(TextFormField).at(0),
        'http://10.0.2.2:3000',
      );
      await tester.tap(find.text('Sign in'));
      await tester.pumpAndSettle();
      expect(find.text('Wrong email or password.'), findsOneWidget);
    });

    testWidgets('disables submit while busy', (tester) async {
      var calls = 0;
      await tester.pumpWidget(
        _app(
          LoginScreen(
            busy: true,
            onSignIn: (email, password, serverUrl) async {
              calls++;
            },
          ),
        ),
      );

      expect(find.text('Signing in…'), findsOneWidget);
      expect(tester.widget<FilledButton>(_filledButton()).onPressed, isNull);

      await tester.tap(find.text('Signing in…'));
      await tester.pump();
      expect(calls, 0);
    });

    testWidgets('the server address is editable and prefilled', (tester) async {
      var calls = 0;
      await tester.pumpWidget(
        _app(
          LoginScreen(
            onSignIn: (email, password, serverUrl) async {
              calls++;
            },
            serverUrl: 'https://photos.example.com',
          ),
        ),
      );
      await tester.pump();

      expect(find.text('PhotoX APP'), findsOneWidget);
      expect(find.text('https://photos.example.com'), findsOneWidget);
      expect(find.byIcon(Icons.check_rounded), findsOneWidget);
      expect(find.byType(TextFormField), findsNWidgets(3));

      // An address that cannot be parsed is refused before any request.
      await tester.enterText(find.byType(TextFormField).at(0), 'photos.local');
      await tester.pump();
      expect(find.byIcon(Icons.check_rounded), findsNothing);
      await tester.tap(find.text('Sign in'));
      await tester.pumpAndSettle();
      expect(
        find.text('Use a full http:// or https:// address.'),
        findsOneWidget,
      );
      expect(calls, 0);

      await tester.enterText(find.byType(TextFormField).at(0), '');
      await tester.tap(find.text('Sign in'));
      await tester.pumpAndSettle();
      expect(find.text('Enter your server address.'), findsOneWidget);
      expect(calls, 0);
    });
  });

  group('HomeScreen', () {
    testWidgets('renders counts, permission, auth, error, and last pass', (
      tester,
    ) async {
      final report = SyncReport(permission: PhotoPermission.authorized)
        ..scanned = 20
        ..enqueued = 6
        ..uploaded = 2
        ..duplicates = 1
        ..failed = 1
        ..remaining = 4;

      await tester.pumpWidget(
        _home(
          stats: const QueueStats(
            pending: 4,
            uploaded: 12,
            duplicate: 3,
            failed: 1,
          ),
          permission: PhotoPermission.denied,
          lastReport: report,
          error: 'The network is unavailable.',
        ),
      );
      await tester.pumpAndSettle();

      expect(find.text('UPLOADED'), findsOneWidget);
      expect(find.text('REMAINING'), findsOneWidget);
      expect(find.text('SKIPPED'), findsOneWidget);
      expect(find.text('12'), findsOneWidget);
      expect(find.text('4'), findsOneWidget);
      expect(find.text('3'), findsOneWidget);
      expect(find.text('files safe'), findsOneWidget);
      expect(find.text('in queue'), findsOneWidget);
      expect(find.text('1 error'), findsOneWidget);

      expect(find.text('Photo access is off'), findsOneWidget);
      expect(find.text('Sync problem'), findsOneWidget);
      expect(find.text('The network is unavailable.'), findsOneWidget);

      expect(find.text('Checked 20 items. Found 6 new items.'), findsOneWidget);
      expect(
        find.text(
          'Uploaded 2 items. 1 item was already on the server. '
          '1 item could not upload.',
        ),
        findsOneWidget,
      );
      expect(find.text('4 items still waiting.'), findsOneWidget);
    });

    testWidgets('shows the scan instead of counts while discovering', (
      tester,
    ) async {
      await tester.pumpWidget(
        _home(
          discovering: true,
          syncing: true,
          stats: const QueueStats(
            pending: 4,
            uploaded: 12,
            duplicate: 3,
            failed: 0,
          ),
        ),
      );
      // The spinner never settles, so pump a single frame.
      await tester.pump();

      expect(find.byKey(const Key('discovery-progress')), findsOneWidget);
      expect(find.text('Reading your library…'), findsOneWidget);
      expect(find.text('Scanning'), findsOneWidget);
      expect(find.text('UPLOADED'), findsNothing);
      expect(find.text('REMAINING'), findsNothing);
      expect(find.byType(CircularProgressIndicator), findsOneWidget);
    });

    testWidgets('counts come back once the scan ends', (tester) async {
      await tester.pumpWidget(_home());
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('discovery-progress')), findsNothing);
      expect(find.text('UPLOADED'), findsOneWidget);
      expect(find.text('Up to date'), findsOneWidget);
    });

    testWidgets('the scope pill names the album count, not the queue', (
      tester,
    ) async {
      await tester.pumpWidget(_home(albumCount: 1));
      await tester.pump();
      expect(find.text('1 album'), findsOneWidget);

      await tester.pumpWidget(_home(albumCount: 3));
      await tester.pump();
      expect(find.text('3 albums'), findsOneWidget);
      expect(find.text('1 album'), findsNothing);

      await tester.pumpWidget(_home(albumCount: 0));
      await tester.pump();
      expect(
        find.text('1 album'),
        findsOneWidget,
        reason: 'an empty selection still means the camera album',
      );

      await tester.pumpWidget(_home(albumCount: 4, uploadAllFolders: true));
      await tester.pump();
      expect(find.text('All albums'), findsOneWidget);
    });

    testWidgets('a failed count offers one retry at a time', (tester) async {
      final done = Completer<void>();
      var retries = 0;

      await tester.pumpWidget(
        _home(
          stats: const QueueStats(
            pending: 1,
            uploaded: 5,
            duplicate: 2,
            failed: 3,
          ),
          onRetryFailed: () {
            retries++;
            return done.future;
          },
        ),
      );
      await tester.pump();

      final retry = find.text('RETRY FAILED');
      expect(retry, findsOneWidget);
      expect(find.byTooltip('Retry 3 failed items'), findsOneWidget);

      // A real tap target, not a 10px label.
      final target = tester.getSize(find.byTooltip('Retry 3 failed items'));
      expect(target.height, greaterThanOrEqualTo(40));
      expect(target.width, greaterThanOrEqualTo(40));

      await tester.tap(retry);
      await tester.pump();
      // The button is disabled while the pass it started runs.
      await tester.tap(retry, warnIfMissed: false);
      await tester.pump();
      expect(retries, 1);

      done.complete();
      await tester.pump();
      await tester.pump();
      await tester.tap(retry);
      await tester.pump();
      expect(retries, 2);
    });

    testWidgets('duplicates alone offer no retry', (tester) async {
      var retries = 0;

      await tester.pumpWidget(
        _home(
          stats: const QueueStats(
            pending: 0,
            uploaded: 9,
            duplicate: 4,
            failed: 0,
          ),
          onRetryFailed: () async {
            retries++;
          },
        ),
      );
      await tester.pump();

      expect(find.text('RETRY FAILED'), findsNothing);
      expect(find.byIcon(Icons.refresh_rounded), findsNothing);
      expect(find.text('no errors'), findsOneWidget);
      expect(
        find.text('Skipped means the server already had the same file.'),
        findsOneWidget,
      );
      expect(retries, 0);
    });

    testWidgets('the live dot animates only while bytes are moving', (
      tester,
    ) async {
      final progress = TransferProgress();
      addTearDown(progress.dispose);

      await tester.pumpWidget(_home(progress: progress));
      await tester.pump();
      expect(
        tester.hasRunningAnimations,
        isFalse,
        reason: 'an idle dashboard must not schedule frames',
      );

      progress.begin(
        localId: 'asset-1',
        fileName: 'IMG_4821.JPG',
        totalBytes: 1000,
        phase: TransferPhase.uploading,
      );
      await tester.pumpWidget(_home(progress: progress, syncing: true));
      await tester.pump(const Duration(milliseconds: 500));
      expect(tester.hasRunningAnimations, isTrue);

      progress.finish();
      await tester.pump(const Duration(seconds: 1));
      expect(
        tester.hasRunningAnimations,
        isFalse,
        reason: 'the dot and the bar sheen both stop when nothing moves',
      );
    });

    testWidgets('the bar sheen only pulses while bytes are moving', (
      tester,
    ) async {
      Future<void> pumpTrack({required bool animate}) => tester.pumpWidget(
        _app(BackupProgressTrack(value: 0.4, animate: animate)),
      );

      await pumpTrack(animate: false);
      await tester.pump();
      expect(tester.hasRunningAnimations, isFalse);

      await pumpTrack(animate: true);
      await tester.pump(const Duration(milliseconds: 200));
      expect(tester.hasRunningAnimations, isTrue);

      // The fill stays put and the sheen is reset when the pass stops.
      await pumpTrack(animate: false);
      await tester.pump();
      expect(tester.hasRunningAnimations, isFalse);
      expect(
        tester
            .widget<BackupProgressTrack>(find.byType(BackupProgressTrack))
            .value,
        0.4,
      );
    });

    testWidgets('auth-required banner takes over the generic error slot', (
      tester,
    ) async {
      await tester.pumpWidget(
        _home(authRequired: true, error: 'Session expired.'),
      );
      await tester.pump();

      expect(find.text('Sign in needed'), findsNWidgets(2));
      expect(find.text('Session expired.'), findsNothing);
    });

    testWidgets('renders limited and not-determined permission copy', (
      tester,
    ) async {
      const cases = <(PhotoPermission, String, String)>[
        (
          PhotoPermission.limited,
          'Limited photo access',
          'Only the photos you selected can be backed up. Add more in your '
              'device settings.',
        ),
        (
          PhotoPermission.notDetermined,
          'Photo access not set up',
          'Tap the button below to let PhotoX read your camera roll.',
        ),
      ];

      for (final (permission, title, message) in cases) {
        await tester.pumpWidget(_home(permission: permission));
        await tester.pump();

        expect(find.text(title), findsOneWidget);
        expect(find.text(message), findsOneWidget);
      }
    });

    testWidgets('a running pass never claims photo access is missing', (
      tester,
    ) async {
      await tester.pumpWidget(
        _home(
          permission: PhotoPermission.notDetermined,
          syncing: true,
          progress: TransferProgress()
            ..begin(
              localId: 'asset-1',
              fileName: 'IMG_4821.JPG',
              totalBytes: 1000,
              phase: TransferPhase.uploading,
            ),
        ),
      );
      await tester.pump();

      expect(find.text('Photo access not set up'), findsNothing);
      expect(find.text('Syncing'), findsOneWidget);
    });

    testWidgets('Sync now and settings invoke their callbacks', (tester) async {
      var syncs = 0;
      var settingsOpened = 0;

      await tester.pumpWidget(
        _home(
          onSyncNow: () async {
            syncs++;
          },
          onOpenSettings: () {
            settingsOpened++;
          },
        ),
      );

      await tester.tap(find.text('Sync now'));
      await tester.pump();
      expect(syncs, 1);

      await tester.tap(find.byTooltip('Settings'));
      await tester.pump();
      expect(settingsOpened, 1);
    });

    testWidgets('a running pass swaps Sync now for Pause', (tester) async {
      var syncs = 0;
      var pauses = 0;
      await tester.pumpWidget(
        _home(
          syncing: true,
          onSyncNow: () async {
            syncs++;
          },
          onPause: () async {
            pauses++;
          },
        ),
      );

      expect(find.text('Pause'), findsOneWidget);
      expect(find.text('Sync now'), findsNothing);
      expect(find.text('Syncing'), findsOneWidget);

      await tester.tap(find.text('Pause'));
      await tester.pump();

      expect(pauses, 1);
      expect(syncs, 0);
    });

    testWidgets('paused shows Resume backup and no error or Wi-Fi hold', (
      tester,
    ) async {
      var resumes = 0;
      // The pass that was running when the user paused may still report a
      // Wi-Fi hold; it must not outlive the pause.
      final report = SyncReport(permission: PhotoPermission.authorized)
        ..waitingForWifi = true
        ..remaining = 2;

      await tester.pumpWidget(
        _home(
          paused: true,
          lastReport: report,
          onResume: () async {
            resumes++;
          },
        ),
      );

      expect(find.text('Resume backup'), findsOneWidget);
      expect(find.text('Paused'), findsOneWidget);
      expect(find.text('Sync now'), findsNothing);
      expect(find.text('Pause'), findsNothing);
      expect(find.text('Wi-Fi only is on'), findsNothing);

      await tester.tap(find.text('Resume backup'));
      await tester.pump();
      expect(resumes, 1);
    });

    testWidgets('a Wi-Fi hold explains why uploads are waiting', (
      tester,
    ) async {
      final report = SyncReport(permission: PhotoPermission.authorized)
        ..scanned = 4
        ..enqueued = 2
        ..waitingForWifi = true
        ..remaining = 2;

      await tester.pumpWidget(_home(lastReport: report));

      expect(find.text('Waiting for Wi-Fi'), findsOneWidget);
      expect(find.text('Wi-Fi only is on'), findsOneWidget);
      expect(
        find.text(
          'Uploads wait until Wi-Fi is available. New photos stay queued on '
          'this phone.',
        ),
        findsOneWidget,
      );
      expect(find.text('Sync now'), findsOneWidget);
    });

    testWidgets('shows photo and video counts with overall progress', (
      tester,
    ) async {
      await tester.pumpWidget(
        _home(
          stats: const QueueStats(
            pending: 100,
            uploaded: 1184,
            duplicate: 24,
            failed: 3,
            photos: 1284,
            videos: 37,
          ),
        ),
      );
      await tester.pump();

      expect(find.text('1,284 photos · 37 videos'), findsOneWidget);
      expect(find.text('91%'), findsOneWidget);
      expect(find.text('1,208 / 1,321 files synced'), findsOneWidget);

      final bar = tester.widget<BackupProgressTrack>(
        find.byKey(const Key('backup-overall-progress')),
      );
      expect(bar.value, closeTo(1208 / 1321, 0.0001));
    });

    testWidgets('overall progress starts at zero', (tester) async {
      await tester.pumpWidget(
        _home(
          stats: const QueueStats(
            pending: 8,
            uploaded: 0,
            duplicate: 0,
            failed: 0,
            photos: 8,
          ),
        ),
      );
      await tester.pump();

      expect(find.text('0%'), findsOneWidget);
      expect(find.text('0 / 8 files synced'), findsOneWidget);
      final bar = tester.widget<BackupProgressTrack>(
        find.byKey(const Key('backup-overall-progress')),
      );
      expect(bar.value, 0);
    });

    testWidgets('an active transfer shows its speed, and idle hides it', (
      tester,
    ) async {
      final transfer = _transfer();
      final progress = transfer.progress
        ..begin(
          localId: 'asset-1',
          fileName: 'IMG_4821.HEIC',
          totalBytes: 48000000,
          phase: TransferPhase.uploading,
        );

      await tester.pumpWidget(_home(syncing: true, progress: progress));
      await tester.pump();

      // A full sample window is needed before the speed is measurable.
      expect(find.textContaining('/s'), findsNothing);

      // The panel listens to the notifier, so a later chunk updates the speed.
      transfer.tick(const Duration(seconds: 1));
      progress.advance(12000000);
      await tester.pump();

      expect(find.text('12.0 MB/s'), findsOneWidget);

      // Nothing in flight: the speed goes away entirely.
      await tester.pumpWidget(
        _home(
          stats: const QueueStats(
            pending: 2,
            uploaded: 3,
            duplicate: 0,
            failed: 0,
            photos: 4,
            videos: 1,
          ),
        ),
      );
      await tester.pump();

      expect(find.textContaining('/s'), findsNothing);
      expect(find.text('3 / 5 files synced'), findsOneWidget);
    });

    testWidgets('a paused transfer hides the speed and says why', (
      tester,
    ) async {
      final transfer = _transfer();
      final progress = transfer.progress
        ..begin(
          localId: 'asset-1',
          fileName: 'IMG_4821.HEIC',
          totalBytes: 48000000,
          phase: TransferPhase.uploading,
        );
      transfer.tick(const Duration(seconds: 1));
      progress.advance(12000000);

      await tester.pumpWidget(
        _home(syncing: true, paused: true, progress: progress),
      );
      await tester.pump();

      expect(find.text('Pausing'), findsOneWidget);
      expect(find.textContaining('/s'), findsNothing);
      expect(
        find.text('Backups are paused. Resume when you are ready.'),
        findsOneWidget,
      );
    });

    testWidgets('paused with nothing in flight says so in the progress card', (
      tester,
    ) async {
      await tester.pumpWidget(_home(paused: true));
      await tester.pump();

      expect(
        find.text('Backups are paused. Resume when you are ready.'),
        findsOneWidget,
      );
      expect(find.textContaining('/s'), findsNothing);
    });

    testWidgets('the progress header holds up on a narrow screen', (
      tester,
    ) async {
      tester.view.physicalSize = const Size(320, 640);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);

      final transfer = _transfer();
      final progress = transfer.progress
        ..begin(
          localId: 'asset-1',
          fileName: 'IMG_4821.HEIC',
          totalBytes: 48000000,
          phase: TransferPhase.uploading,
        );
      transfer.tick(const Duration(seconds: 1));
      progress.advance(12000000);

      await tester.pumpWidget(
        _home(
          syncing: true,
          progress: progress,
          stats: const QueueStats(
            pending: 1284,
            uploaded: 1184,
            duplicate: 24,
            failed: 3,
            photos: 1284,
            videos: 37,
          ),
          textScale: 1.5,
        ),
      );
      await tester.pump();

      expect(find.text('91%'), findsOneWidget);
      expect(find.text('12.0 MB/s'), findsOneWidget);
    });
  });

  group('SettingsScreen', () {
    testWidgets('toggling switches saves the updated settings', (tester) async {
      final saved = <AppSettings>[];
      await tester.pumpWidget(
        _settings(onSave: (settings) async => saved.add(settings)),
      );

      await tester.tap(find.text('Wi-Fi only'));
      await tester.pumpAndSettle();

      expect(saved, hasLength(1));
      expect(saved.single.wifiOnly, isFalse);
      expect(find.text('Uploads can use mobile data.'), findsOneWidget);

      await tester.tap(find.text('Include videos'));
      await tester.pumpAndSettle();

      expect(saved, hasLength(2));
      expect(saved.last.includeVideos, isTrue);
      expect(
        find.text('Videos are backed up with your photos.'),
        findsOneWidget,
      );
    });

    testWidgets('shows the read-only source and signs out after confirmation', (
      tester,
    ) async {
      var signOuts = 0;
      await tester.pumpWidget(
        _settings(
          onSignOut: () async {
            signOuts++;
          },
        ),
      );

      final signOutButton = find.text('Sign out');
      await tester.scrollUntilVisible(signOutButton, 300);
      await tester.pumpAndSettle();

      expect(find.text('Camera roll'), findsOneWidget);
      expect(find.text('Read only'), findsOneWidget);

      await tester.tap(signOutButton);
      await tester.pumpAndSettle();

      expect(find.text('Sign out?'), findsOneWidget);
      expect(
        find.text(
          'Backups stop until you sign in again. Photos waiting in the queue '
          'stay on this phone.',
        ),
        findsOneWidget,
      );

      await tester.tap(find.text('Cancel'));
      await tester.pumpAndSettle();
      expect(signOuts, 0);

      await tester.tap(signOutButton);
      await tester.pumpAndSettle();
      final dialogSignOut = find.descendant(
        of: find.byType(AlertDialog),
        matching: find.text('Sign out'),
      );
      await tester.tap(dialogSignOut);
      await tester.pumpAndSettle();

      expect(signOuts, 1);
    });

    testWidgets('names the backup scope at a glance', (tester) async {
      await tester.pumpWidget(_settings());
      await tester.pumpAndSettle();
      expect(await _summary(tester), 'Camera folder');

      await tester.pumpWidget(
        _settings(
          settings: const AppSettings(
            uploadFolderIds: <String>['camera', 'screens'],
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(await _summary(tester), '2 folders: Camera, Screenshots');

      await tester.pumpWidget(
        _settings(settings: const AppSettings(uploadAllFolders: true)),
      );
      await tester.pumpAndSettle();
      expect(await _summary(tester), 'All folders');
    });

    testWidgets('picking an album saves just that folder', (tester) async {
      final saved = <AppSettings>[];
      await tester.pumpWidget(
        _settings(onSave: (settings) async => saved.add(settings)),
      );
      await tester.pumpAndSettle();

      // The library is only read once the picker is opened.
      expect(find.text('Screenshots'), findsNothing);

      await _tapInView(tester, find.byKey(const Key('folder-scope-picker')));

      expect(find.text('Camera album · 120 items'), findsOneWidget);
      expect(find.text('12 items'), findsOneWidget);
      expect(
        find.text('Nothing picked, so the camera folder is used.'),
        findsOneWidget,
      );

      await _tapInView(tester, find.text('Screenshots'));

      expect(saved, hasLength(1));
      expect(saved.single.uploadFolderIds, <String>['screens']);
      expect(saved.single.uploadAllFolders, isFalse);
      expect(await _summary(tester), '1 folder: Screenshots');

      // Dropping the last album leaves the camera album, not "nothing".
      await _tapInView(tester, find.text('Screenshots'));

      expect(saved, hasLength(2));
      expect(saved.last.uploadFolderIds, isEmpty);
      expect(saved.last.uploadAllFolders, isFalse);
      expect(await _summary(tester), 'Camera folder');
    });

    testWidgets('the All folders switch saves the whole library', (
      tester,
    ) async {
      final saved = <AppSettings>[];
      await tester.pumpWidget(
        _settings(
          settings: const AppSettings(uploadFolderIds: <String>['camera']),
          onSave: (settings) async => saved.add(settings),
        ),
      );
      await tester.pumpAndSettle();

      await _tapInView(tester, find.text('All folders'));

      expect(saved, hasLength(1));
      expect(saved.single.uploadAllFolders, isTrue);
      expect(saved.single.uploadFolderIds, isEmpty);
      expect(await _summary(tester), 'All folders');
      expect(
        find.text('Every album is included.'),
        findsNothing,
        reason: 'the album list is still collapsed',
      );
    });

    testWidgets('the picker shows a loading row while albums load', (
      tester,
    ) async {
      final folders = Completer<List<MediaFolder>>();
      await tester.pumpWidget(_settings(onLoadFolders: () => folders.future));

      final picker = find.byKey(const Key('folder-scope-picker'));
      await tester.scrollUntilVisible(picker, 150);
      await tester.pumpAndSettle();
      await tester.tap(picker);
      await tester.pump();
      expect(find.byKey(const Key('folders-loading')), findsOneWidget);

      folders.complete(_albums);
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('folders-loading')), findsNothing);
      expect(find.text('Screenshots'), findsOneWidget);
    });

    testWidgets('a failed album load explains itself and can retry', (
      tester,
    ) async {
      var calls = 0;
      await tester.pumpWidget(
        _settings(
          onLoadFolders: () async {
            calls++;
            if (calls == 1) throw StateError('library unavailable');
            return _albums;
          },
        ),
      );

      await _tapInView(tester, find.byKey(const Key('folder-scope-picker')));

      expect(find.byKey(const Key('folders-error')), findsOneWidget);
      expect(find.text('Could not read your albums.'), findsOneWidget);
      // The rest of the screen is still there.
      expect(find.text('Settings'), findsOneWidget);

      await _tapInView(tester, find.text('Retry'));

      expect(calls, 2);
      expect(find.byKey(const Key('folders-error')), findsNothing);
      expect(find.text('Screenshots'), findsOneWidget);
    });
  });

  testWidgets('all three screens hold up on a narrow screen with large text', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(320, 640);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    final report = SyncReport(permission: PhotoPermission.limited)
      ..scanned = 12874
      ..enqueued = 240
      ..uploaded = 200
      ..duplicates = 30
      ..failed = 10
      ..remaining = 40;

    await tester.pumpWidget(
      _home(
        stats: const QueueStats(
          pending: 40,
          uploaded: 12874,
          duplicate: 30,
          failed: 10,
        ),
        permission: PhotoPermission.limited,
        authRequired: true,
        lastReport: report,
        error:
            'The server could not be reached. Check your connection and try '
            'Sync now again.',
        textScale: 1.5,
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('Sync now'), findsOneWidget);
    expect(find.text('12,874'), findsOneWidget);

    await tester.pumpWidget(_settings(textScale: 1.5));
    await tester.pumpAndSettle();
    expect(find.text('Wi-Fi only'), findsOneWidget);

    // The new folder picker is the densest row set; it must not overflow.
    await tester.scrollUntilVisible(
      find.byKey(const Key('folder-scope-picker')),
      300,
    );
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('folder-scope-picker')));
    await tester.pumpAndSettle();
    expect(await _summary(tester), 'Camera folder');

    await tester.scrollUntilVisible(find.text('Screenshots'), 200);
    await tester.pumpAndSettle();
    expect(find.text('12 items'), findsOneWidget);

    await tester.scrollUntilVisible(find.text('Sign out'), 300);
    await tester.pumpAndSettle();
    expect(
      find.textContaining('Backups stop until you sign in again.'),
      findsOneWidget,
    );

    await tester.pumpWidget(
      _app(
        LoginScreen(
          onSignIn: (email, password, serverUrl) async {},
          error:
              'The server rejected this sign-in attempt. Check the email and '
              'password, then try again.',
        ),
        textScale: 1.5,
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('Sign in'), findsOneWidget);
  });
}
