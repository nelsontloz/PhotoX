import 'dart:async';

import 'package:flutter/widgets.dart';

import 'background/scheduler.dart';
import 'core/api_client.dart';
import 'core/auth_manager.dart';
import 'core/auth_models.dart';
import 'media/photo_observer.dart';
import 'settings/settings_store.dart';
import 'sync/sync_coordinator.dart';
import 'upload/upload_queue.dart';

/// State and actions the app shell needs from the sync stack.
///
/// The interface exists so widget tests can drive the screens without a
/// database, network or platform plugins; [PhotoXController] is the real
/// implementation wired by the app services graph.
abstract class AppController extends ChangeNotifier {
  /// Whether a token pair is held (the access token may be expired).
  bool get isSignedIn;

  /// True while an account action (sign-in, sign-out, settings write) runs.
  bool get busy;

  /// True while a sync pass is running.
  bool get syncing;

  /// True when the last pass found the stored session unusable.
  bool get authRequired;

  /// Photo-library permission observed by the most recent pass.
  PhotoPermission get permission;

  /// Aggregate queue counts.
  QueueStats get stats;

  /// Summary of the most recent pass, or null before the first one.
  SyncReport? get lastReport;

  /// Last unexpected error, already phrased for the user.
  String? get error;

  /// Current persisted preferences.
  AppSettings get settings;

  /// Restores auth, loads settings and queue counts, then starts a pass when
  /// the user is already signed in.
  Future<void> initialize();

  /// Signs in and, on success, starts an immediate sync pass.
  Future<void> signIn(String email, String password);

  /// Revokes the session, cancels background work and resets counters.
  Future<void> signOut();

  /// Starts a sync pass; joins one that is already running instead of queueing.
  Future<void> syncNow();

  /// Persists [settings] and re-registers background work with the new
  /// constraints.
  Future<void> updateSettings(AppSettings settings);
}

/// [AppController] backed by the real auth, queue and scheduler stack.
///
/// Owns no widgets: the shell rebuilds from [notifyListeners], and resume
/// passes are driven by [WidgetsBindingObserver] so a foreground app syncs
/// without waiting for the next OS window.
class PhotoXController extends AppController with WidgetsBindingObserver {
  PhotoXController({
    required this.auth,
    required this.queue,
    required this.coordinator,
    required this.settingsStore,
    required this.scheduler,
  });

  /// Token owner; also the source of [isSignedIn].
  final AuthManager auth;

  /// Queue persistence used for the home-screen counters.
  final UploadQueue queue;

  /// Runs discovery and upload passes.
  final SyncCoordinator coordinator;

  /// Persistence for user preferences.
  final SettingsStore settingsStore;

  /// OS schedule used by [signOut] and settings changes.
  final BackgroundScheduler scheduler;

  static const QueueStats _emptyStats = QueueStats(
    pending: 0,
    uploaded: 0,
    duplicate: 0,
    failed: 0,
  );

  bool _busy = false;
  bool _syncing = false;
  bool _authRequired = false;
  PhotoPermission _permission = PhotoPermission.notDetermined;
  QueueStats _stats = _emptyStats;
  SyncReport? _lastReport;
  String? _error;
  AppSettings _settings = const AppSettings();

  /// The in-flight pass, so callers join instead of stacking passes.
  Future<void>? _pass;

  /// Bumped by [signOut] so an in-flight pass cannot restore stale state after
  /// the account it belongs to is gone.
  int _generation = 0;

  bool _observing = false;
  bool _disposed = false;

  @override
  bool get isSignedIn => auth.isSignedIn;

  @override
  bool get busy => _busy;

  @override
  bool get syncing => _syncing;

  @override
  bool get authRequired => _authRequired;

  @override
  PhotoPermission get permission => _permission;

  @override
  QueueStats get stats => _stats;

  @override
  SyncReport? get lastReport => _lastReport;

  @override
  String? get error => _error;

  @override
  AppSettings get settings => _settings;

  @override
  Future<void> initialize() async {
    if (!_observing) {
      _observing = true;
      WidgetsBinding.instance.addObserver(this);
      auth.addListener(_onAuthChanged);
    }
    await auth.restore();
    _settings = await settingsStore.load();
    _stats = await queue.stats();
    _notify();
    if (auth.isSignedIn) {
      // Not awaited: the first frame must not wait for a full pass.
      unawaited(syncNow());
    }
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed && auth.isSignedIn) {
      unawaited(syncNow());
    }
  }

  @override
  Future<void> syncNow() {
    final inFlight = _pass;
    if (inFlight != null) return inFlight;
    if (!auth.isSignedIn) return Future<void>.value();
    final future = _runPass().whenComplete(() => _pass = null);
    _pass = future;
    return future;
  }

  @override
  Future<void> signIn(String email, String password) async {
    if (_busy) return;
    _busy = true;
    _error = null;
    _notify();

    var signedIn = false;
    String? scheduleError;
    try {
      await auth.signIn(email: email, password: password);
      _authRequired = false;
      signedIn = true;
      // signOut() cancels every scheduled task, so signing back in must
      // re-register them or background sync stays dead until a restart.
      try {
        await scheduler.updateSettings(_settings);
      } on Object {
        // The session is valid; a scheduler failure must never lose the login.
        scheduleError =
            'Signed in, but background sync could not be scheduled.';
      }
    } on AuthException catch (error) {
      // The server message ("Invalid credentials", ...) is what the login
      // screen shows; it is already phrased for the user.
      _error = error.message;
    } finally {
      _busy = false;
      _notify();
    }

    if (signedIn) {
      // Not awaited: the first frame must not wait for a full pass.
      unawaited(syncNow());
      if (scheduleError != null) {
        // Assigned after syncNow() because starting a pass clears `_error`;
        // the user must still see that scheduling failed.
        _error = scheduleError;
        _notify();
      }
    }
  }

  @override
  Future<void> signOut() async {
    if (_busy) return;
    _busy = true;
    _generation++;
    _notify();
    try {
      await auth.signOut();
      // Nothing should keep waking the device for a signed-out account.
      await scheduler.cancelAll();
      // Queue rows intentionally stay on device and reload on next initialize.
      _authRequired = false;
      _error = null;
      _lastReport = null;
      _stats = _emptyStats;
    } on Object {
      _error = 'Could not sign out. Try again.';
      rethrow;
    } finally {
      _busy = false;
      _notify();
    }
  }

  @override
  Future<void> updateSettings(AppSettings next) async {
    if (_busy) return;
    _busy = true;
    _notify();
    try {
      await settingsStore.save(next);
      // Constraints are enforced by the OS, never by Dart: re-register so
      // wifi/charging changes take effect on the next scheduled run.
      await scheduler.updateSettings(next);
      // Only expose the new settings once both the save and re-register
      // succeeded, so a failed write leaves the UI on the persisted values.
      _settings = next;
    } finally {
      _busy = false;
      _notify();
    }
  }

  @override
  void dispose() {
    _disposed = true;
    auth.removeListener(_onAuthChanged);
    if (_observing) {
      WidgetsBinding.instance.removeObserver(this);
      _observing = false;
    }
    super.dispose();
  }

  Future<void> _runPass() async {
    final generation = _generation;
    _syncing = true;
    _error = null;
    _notify();
    try {
      final report = await coordinator.run();
      final stats = await queue.stats();
      // A sign-out happened while the pass was running: its results describe
      // an account that is gone, so never write them back.
      if (generation != _generation) return;
      _lastReport = report;
      _permission = report.permission;
      _authRequired = report.authRequired;
      final reportError = report.error;
      if (reportError != null && reportError.isNotEmpty) _error = reportError;
      _stats = stats;
    } on AuthException catch (error) {
      if (generation != _generation) return;
      _authRequired = true;
      _error = error.message;
    } on ApiException catch (error) {
      if (generation != _generation) return;
      if (error.isAuthError) {
        _authRequired = true;
        _error = error.message;
      } else {
        _error = 'Sync could not finish. Check your connection and try again.';
      }
    } on Object {
      if (generation != _generation) return;
      _error = 'Sync could not finish. Check your connection and try again.';
    } finally {
      _syncing = false;
      _notify();
    }
  }

  void _onAuthChanged() => _notify();

  void _notify() {
    if (_disposed) return;
    notifyListeners();
  }
}
