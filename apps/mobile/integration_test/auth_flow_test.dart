import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:photox_mobile/main.dart' as app;

import 'support/harness.dart';

/// First-launch flow against the real stack: point at the server, fail once,
/// sign in, sign out, sign back in. Runs from a cleared app (`pm clear` in the
/// runner), so the login screen with an empty address is guaranteed.
void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('connect, reject a bad password, sign in, sign out', (
    tester,
  ) async {
    app.main();

    // The login screen is the first screen on a fresh install; its first field
    // is the server address, persisted by the sign-in itself.
    await pumpUntil(tester, find.text('Welcome back'));
    expect(find.byType(TextFormField), findsNWidgets(3));

    // Field order comes from LoginScreen.build: server, email, password.
    final fields = find.byType(TextFormField);
    await setField(tester, fields.at(0), apiBaseUrl);
    await setField(tester, fields.at(1), e2eEmail);
    await setField(tester, fields.at(2), 'definitely-not-the-password');
    expect(fieldText(tester, 1), e2eEmail, reason: 'email field');

    // The banner text is core's own 401 message, so this proves the app reached
    // the server it was pointed at.
    expect(await submitLogin(tester), isFalse, reason: visibleText(tester));
    expect(find.textContaining('Invalid credentials'), findsOneWidget);

    await setField(tester, fields.at(2), e2ePassword);
    expect(fieldText(tester, 1), e2eEmail, reason: 'email field');
    expect(fieldText(tester, 2), e2ePassword, reason: 'password field');
    expect(await submitLogin(tester), isTrue, reason: visibleText(tester));

    await signOutThroughUi(tester);
    expect(find.byType(NavigationBar), findsNothing);
    // The server address stays configured; only the session is gone.
    expect(fieldText(tester, 0), apiBaseUrl, reason: 'server field');

    // Leave the app signed in: `session_persistence_test.dart` runs next, in a
    // fresh process, and asserts this pair survived the restart. The login
    // screen was rebuilt, so its fields start empty again.
    expect(find.byType(TextFormField), findsNWidgets(3));
    await setField(tester, find.byType(TextFormField).at(1), e2eEmail);
    await setField(tester, find.byType(TextFormField).at(2), e2ePassword);
    expect(await submitLogin(tester), isTrue, reason: visibleText(tester));

    // Fresh app graph over the same storage: the token pair and the server
    // address must come back (`AuthManager.restore`). A real process restart
    // cannot be scripted from inside the test, and `flutter test` clears app
    // data between files, so this restarts the widget tree and services.
    await tester.pumpWidget(const SizedBox.shrink());
    await tester.pump(const Duration(milliseconds: 300));
    app.main();
    await pumpUntil(tester, find.byType(NavigationBar));
    expect(find.text('Welcome back'), findsNothing);
  }, timeout: const Timeout(Duration(minutes: 5)));
}
