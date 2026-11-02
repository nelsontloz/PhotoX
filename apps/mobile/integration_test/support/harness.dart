import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

/// Base URL the runner points the app at: the host loopback port this run
/// published, as seen from the emulator (10.0.2.2 is the host through the
/// emulator's NAT). Passed to the app through the setup screen, so it is not
/// tied to `AppConfig.apiBaseUrl`'s dev default.
const String apiBaseUrl = String.fromEnvironment(
  'PHOTOX_E2E_API_URL',
  defaultValue: 'http://localhost:3000',
);

/// Account registered by `e2e/mobile/run.sh`; the app has no register form.
const String e2eEmail = String.fromEnvironment('PHOTOX_E2E_EMAIL');
const String e2ePassword = String.fromEnvironment(
  'PHOTOX_E2E_PASSWORD',
  defaultValue: 'password123',
);

/// Unauthenticated client for the test's own server-side assertions.
///
/// These calls run inside the emulator, so they exercise the same path as the
/// app: out through the emulator's NAT to the published core port.
Dio apiDio() => Dio(
  BaseOptions(
    baseUrl: apiBaseUrl,
    connectTimeout: const Duration(seconds: 10),
    receiveTimeout: const Duration(seconds: 30),
    contentType: Headers.jsonContentType,
    responseType: ResponseType.json,
  ),
);

Options authHeader(String accessToken) =>
    Options(headers: <String, String>{'Authorization': 'Bearer $accessToken'});

/// Pumps a live frame every 100 ms until [finder] matches.
///
/// Integration tests run on `LiveTestWidgetsFlutterBinding`, so real network
/// and plugin work completes between pumps; `pumpAndSettle` would block on
/// animations and never see them land.
Future<void> pumpUntil(
  WidgetTester tester,
  Finder finder, {
  Duration timeout = const Duration(seconds: 60),
}) async {
  final deadline = DateTime.now().add(timeout);
  while (DateTime.now().isBefore(deadline)) {
    await tester.pump(const Duration(milliseconds: 100));
    if (finder.evaluate().isNotEmpty) return;
  }
  fail(
    'Timed out after ${timeout.inSeconds}s waiting for $finder. '
    '${visibleText(tester)}',
  );
}

/// Pumps a live frame every 100 ms until any of [finders] matches; returns the
/// index that matched.
Future<int> pumpUntilAny(
  WidgetTester tester,
  List<Finder> finders, {
  Duration timeout = const Duration(seconds: 30),
}) async {
  final deadline = DateTime.now().add(timeout);
  while (DateTime.now().isBefore(deadline)) {
    await tester.pump(const Duration(milliseconds: 100));
    for (var index = 0; index < finders.length; index++) {
      if (finders[index].evaluate().isNotEmpty) return index;
    }
  }
  fail(
    'Timed out after ${timeout.inSeconds}s waiting for any of $finders. '
    '${visibleText(tester)}',
  );
}

/// Submits the sign-in form once and reports whether it reached the shell.
///
/// Never retried: every tap is a login attempt, and core allows 5 per
/// email+ip per 15 minutes — a blind retry loop locks the run out with 429.
Future<bool> submitLogin(WidgetTester tester) async {
  final button = find.widgetWithText(FilledButton, 'Sign in');
  await pumpUntil(tester, button);
  // The form scrolls; an inline banner can push the button below the fold.
  await tester.ensureVisible(button);
  await tester.pump(const Duration(milliseconds: 100));

  await tester.tap(button);

  // The button swaps to "Signing in…" for the duration of the request; a fast
  // response can land before the first frame, hence the either/or. Waiting on
  // the busy label rather than the result banner keeps a banner left by the
  // previous attempt from being read as this attempt's outcome.
  final signingIn = find.text('Signing in…');
  final shell = find.byType(NavigationBar);
  if (await pumpUntilAny(tester, <Finder>[signingIn, shell]) == 1) return true;
  await pumpUntilGone(tester, signingIn);
  return shell.evaluate().isNotEmpty;
}

/// Pumps a live frame every 100 ms until [finder] stops matching.
Future<void> pumpUntilGone(
  WidgetTester tester,
  Finder finder, {
  Duration timeout = const Duration(seconds: 60),
}) async {
  final deadline = DateTime.now().add(timeout);
  while (DateTime.now().isBefore(deadline)) {
    await tester.pump(const Duration(milliseconds: 100));
    if (finder.evaluate().isEmpty) return;
  }
  fail(
    'Timed out after ${timeout.inSeconds}s waiting for $finder to disappear. '
    '${visibleText(tester)}',
  );
}

/// Taps [target] until [done] appears.
///
/// Buttons swap their label for a spinner while a request runs and the sign-out
/// avatar is disabled during a sync pass, so a single tap can be dropped. Only
/// use this for taps that are safe to repeat.
Future<void> tapUntil(
  WidgetTester tester,
  Finder target,
  Finder done, {
  int attempts = 10,
}) async {
  for (var attempt = 0; attempt < attempts; attempt++) {
    if (target.evaluate().isNotEmpty) {
      await tester.ensureVisible(target.first);
      await tester.pump(const Duration(milliseconds: 100));
      await tester.tap(target.first, warnIfMissed: false);
    }
    for (var frame = 0; frame < 5; frame++) {
      await tester.pump(const Duration(milliseconds: 200));
      if (done.evaluate().isNotEmpty) return;
    }
  }
  fail('Tapping $target never revealed $done. ${visibleText(tester)}');
}

/// Visible text on screen, for failure messages.
String visibleText(WidgetTester tester) {
  final texts = find
      .byType(Text)
      .evaluate()
      .map((element) => (element.widget as Text).data)
      .whereType<String>()
      .toList();
  return 'Visible text: $texts';
}

/// Current text of the [index]th form field on screen.
String fieldText(WidgetTester tester, int index) {
  final editable = find.descendant(
    of: find.byType(TextFormField).at(index),
    matching: find.byType(EditableText),
  );
  return tester.widget<EditableText>(editable).controller.text;
}

/// Types [text] into [field], replacing what is there.
///
/// The tap is load-bearing: `_submit` calls `unfocus()`, which closes the text
/// input connection, but `enterText` still sees the same focused editable and
/// skips re-attaching — so a second `enterText` on the same field silently does
/// nothing. A real tap reopens the connection first.
Future<void> setField(WidgetTester tester, Finder field, String text) async {
  await tester.ensureVisible(field);
  await tester.pump(const Duration(milliseconds: 100));
  await tester.tap(field, warnIfMissed: false);
  await tester.pump(const Duration(milliseconds: 200));
  await tester.enterText(field, text);
  await tester.pump(const Duration(milliseconds: 100));
}

/// Signs out through the Backup tab's account avatar, confirming the dialog.
///
/// Leaves the app on the login screen.
Future<void> signOutThroughUi(WidgetTester tester) async {
  final backupIcon = find.descendant(
    of: find.byType(NavigationBar),
    matching: find.byIcon(Icons.cloud_upload_outlined),
  );
  if (backupIcon.evaluate().isNotEmpty) {
    await tester.tap(backupIcon.first);
    await tester.pump(const Duration(milliseconds: 400));
  }
  await tapUntil(tester, find.byTooltip('Sign out'), find.text('Sign out?'));
  await tapUntil(
    tester,
    find.widgetWithText(FilledButton, 'Sign out'),
    find.text('Welcome back'),
  );
}
