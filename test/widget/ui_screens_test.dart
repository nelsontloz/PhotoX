import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:photox_mobile/media/photo_observer.dart';
import 'package:photox_mobile/settings/settings_store.dart';
import 'package:photox_mobile/sync/sync_coordinator.dart';
import 'package:photox_mobile/ui/home_screen.dart';
import 'package:photox_mobile/ui/login_screen.dart';
import 'package:photox_mobile/ui/settings_screen.dart';
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

void main() {
  group('LoginScreen', () {
    testWidgets('shows validation messages and does not submit', (
      tester,
    ) async {
      var calls = 0;
      await tester.pumpWidget(
        _app(
          LoginScreen(
            onSignIn: (email, password) async {
              calls++;
            },
          ),
        ),
      );

      await tester.tap(find.text('Sign in'));
      await tester.pumpAndSettle();

      expect(find.text('Enter your email address.'), findsOneWidget);
      expect(find.text('Enter your password.'), findsOneWidget);
      expect(calls, 0);
    });

    testWidgets('submits a trimmed email and the typed password', (
      tester,
    ) async {
      String? email;
      String? password;
      await tester.pumpWidget(
        _app(
          LoginScreen(
            onSignIn: (value, secret) async {
              email = value;
              password = secret;
            },
          ),
        ),
      );

      await tester.enterText(
        find.byType(TextFormField).at(0),
        '  ada@example.com  ',
      );
      await tester.enterText(find.byType(TextFormField).at(1), 'correct horse');
      await tester.tap(find.text('Sign in'));
      await tester.pumpAndSettle();

      expect(email, 'ada@example.com');
      expect(password, 'correct horse');
    });

    testWidgets('shows the supplied sign-in error until the user edits', (
      tester,
    ) async {
      await tester.pumpWidget(
        _app(
          LoginScreen(
            onSignIn: (email, password) async {},
            error: 'Wrong email or password.',
          ),
        ),
      );

      expect(find.text('Wrong email or password.'), findsOneWidget);
      expect(find.text('Could not sign in'), findsOneWidget);

      await tester.enterText(
        find.byType(TextFormField).at(0),
        'ada@example.com',
      );
      await tester.pumpAndSettle();
      expect(find.text('Wrong email or password.'), findsNothing);

      await tester.enterText(find.byType(TextFormField).at(1), 'secret');
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
            onSignIn: (email, password) async {
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
        _app(
          HomeScreen(
            stats: const QueueStats(
              pending: 4,
              uploaded: 12,
              duplicate: 3,
              failed: 1,
            ),
            permission: PhotoPermission.denied,
            syncing: false,
            authRequired: false,
            lastReport: report,
            error: 'The network is unavailable.',
            onSyncNow: () async {},
            onOpenSettings: () {},
            onSignOut: () async {},
          ),
        ),
      );
      await tester.pumpAndSettle();

      expect(find.text('Uploaded'), findsOneWidget);
      expect(find.text('Already backed up'), findsOneWidget);
      expect(find.text('Waiting'), findsOneWidget);
      expect(find.text('Failed'), findsOneWidget);
      expect(find.text('12'), findsOneWidget);
      expect(find.text('3'), findsOneWidget);
      expect(find.text('4'), findsOneWidget);
      expect(find.text('1'), findsOneWidget);

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

    testWidgets('auth-required banner takes over the generic error slot', (
      tester,
    ) async {
      await tester.pumpWidget(
        _app(
          HomeScreen(
            stats: const QueueStats(
              pending: 0,
              uploaded: 0,
              duplicate: 0,
              failed: 0,
            ),
            permission: PhotoPermission.authorized,
            syncing: false,
            authRequired: true,
            lastReport: null,
            error: 'Session expired.',
            onSyncNow: () async {},
            onOpenSettings: () {},
            onSignOut: () async {},
          ),
        ),
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
          'Tap Sync now to let PhotoX read your camera roll.',
        ),
      ];

      for (final (permission, title, message) in cases) {
        await tester.pumpWidget(
          _app(
            HomeScreen(
              stats: const QueueStats(
                pending: 0,
                uploaded: 0,
                duplicate: 0,
                failed: 0,
              ),
              permission: permission,
              syncing: false,
              authRequired: false,
              lastReport: null,
              error: null,
              onSyncNow: () async {},
              onOpenSettings: () {},
              onSignOut: () async {},
            ),
          ),
        );
        await tester.pump();

        expect(find.text(title), findsOneWidget);
        expect(find.text(message), findsOneWidget);
      }
    });

    testWidgets('Sync now and settings invoke their callbacks', (tester) async {
      var syncs = 0;
      var settingsOpened = 0;

      await tester.pumpWidget(
        _app(
          HomeScreen(
            stats: const QueueStats(
              pending: 0,
              uploaded: 0,
              duplicate: 0,
              failed: 0,
            ),
            permission: PhotoPermission.authorized,
            syncing: false,
            authRequired: false,
            lastReport: null,
            error: null,
            onSyncNow: () async {
              syncs++;
            },
            onOpenSettings: () {
              settingsOpened++;
            },
            onSignOut: () async {},
          ),
        ),
      );

      await tester.tap(find.text('Sync now'));
      await tester.pump();
      expect(syncs, 1);

      await tester.tap(find.byTooltip('Settings'));
      await tester.pump();
      expect(settingsOpened, 1);
    });

    testWidgets('disables Sync now while a pass is running', (tester) async {
      var syncs = 0;
      await tester.pumpWidget(
        _app(
          HomeScreen(
            stats: const QueueStats(
              pending: 0,
              uploaded: 0,
              duplicate: 0,
              failed: 0,
            ),
            permission: PhotoPermission.authorized,
            syncing: true,
            authRequired: false,
            lastReport: null,
            error: null,
            onSyncNow: () async {
              syncs++;
            },
            onOpenSettings: () {},
            onSignOut: () async {},
          ),
        ),
      );

      expect(find.text('Syncing…'), findsOneWidget);
      expect(tester.widget<FilledButton>(_filledButton()).onPressed, isNull);

      await tester.tap(find.text('Syncing…'));
      await tester.pump();
      expect(syncs, 0);
    });
  });

  group('SettingsScreen', () {
    testWidgets('toggling switches saves the updated settings', (tester) async {
      final saved = <AppSettings>[];
      await tester.pumpWidget(
        _app(
          SettingsScreen(
            settings: const AppSettings(),
            onSave: (settings) async => saved.add(settings),
            onSignOut: () async {},
          ),
        ),
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
        _app(
          SettingsScreen(
            settings: const AppSettings(),
            onSave: (settings) async {},
            onSignOut: () async {
              signOuts++;
            },
          ),
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
      _app(
        HomeScreen(
          stats: const QueueStats(
            pending: 40,
            uploaded: 12874,
            duplicate: 30,
            failed: 10,
          ),
          permission: PhotoPermission.limited,
          syncing: false,
          authRequired: true,
          lastReport: report,
          error:
              'The server could not be reached. Check your connection and try '
              'Sync now again.',
          onSyncNow: () async {},
          onOpenSettings: () {},
          onSignOut: () async {},
        ),
        textScale: 1.5,
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('Sync now'), findsOneWidget);
    expect(find.text('12,874'), findsOneWidget);

    await tester.pumpWidget(
      _app(
        SettingsScreen(
          settings: const AppSettings(),
          onSave: (settings) async {},
          onSignOut: () async {},
        ),
        textScale: 1.5,
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('Wi-Fi only'), findsOneWidget);

    await tester.scrollUntilVisible(find.text('Sign out'), 300);
    await tester.pumpAndSettle();
    expect(find.text('Read only'), findsOneWidget);

    await tester.pumpWidget(
      _app(
        LoginScreen(
          onSignIn: (email, password) async {},
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
