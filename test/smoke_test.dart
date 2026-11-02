import 'dart:io';
import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:photox_mobile/app.dart';
import 'package:photox_mobile/app_controller.dart';
import 'package:photox_mobile/library/album_progress.dart';
import 'package:photox_mobile/library/backup_status.dart';
import 'package:photox_mobile/media/photo_observer.dart';
import 'package:photox_mobile/settings/settings_store.dart';
import 'package:photox_mobile/sync/sync_coordinator.dart';
import 'package:photox_mobile/sync/transfer_progress.dart';
import 'package:photox_mobile/upload/models.dart';
import 'package:photox_mobile/upload/upload_queue.dart';

/// Inert controller so the shell can be pumped without a real stack.
class FakeAppController extends AppController {
  FakeAppController({
    this.signedIn = true,
    this.busyValue = false,
    this.syncingValue = false,
    this.discoveringValue = false,
    this.pausedValue = false,
    this.authRequiredValue = false,
    this.permissionValue = PhotoPermission.authorized,
    this.statsValue = const QueueStats(
      pending: 0,
      uploaded: 0,
      duplicate: 0,
      failed: 0,
    ),
    this.lastReportValue,
    this.errorValue,
    this.settingsValue = const AppSettings(),
  });

  final bool signedIn;
  final bool busyValue;
  final bool syncingValue;
  final bool discoveringValue;
  final bool pausedValue;
  final bool authRequiredValue;
  final PhotoPermission permissionValue;
  final QueueStats statsValue;
  final SyncReport? lastReportValue;
  final String? errorValue;
  final AppSettings settingsValue;
  final TransferProgress progressValue = TransferProgress();

  /// Names of the controller actions the shell invoked, in order.
  final List<String> calls = <String>[];

  @override
  bool get isSignedIn => signedIn;

  @override
  bool get busy => busyValue;

  @override
  bool get syncing => syncingValue;

  @override
  bool get discovering => discoveringValue;

  @override
  bool get paused => pausedValue;

  @override
  bool get authRequired => authRequiredValue;

  @override
  PhotoPermission get permission => permissionValue;

  @override
  Future<void> refreshPermission() async => calls.add('refreshPermission');

  @override
  Future<List<AssetCandidate>> libraryPage({
    required int offset,
    int limit = 200,
    String? folderId,
  }) async => const <AssetCandidate>[];

  @override
  Future<int> libraryCount({String? folderId}) async => 0;

  @override
  Future<AlbumProgress> albumProgress(String folderId) async =>
      const AlbumProgress(backedUp: 0, total: 0);

  @override
  Future<Map<String, UploadState>> backupStates(List<String> localIds) async =>
      const <String, UploadState>{};

  @override
  int get queueRevision => 0;

  @override
  Future<void> backUpNow(List<AssetCandidate> assets) async =>
      calls.add('backUpNow');

  @override
  Future<List<MediaFolder>> folders() async => const <MediaFolder>[];

  @override
  Future<Uint8List?> thumbnail(String localId, {int size = 128}) async => null;

  @override
  Future<Uint8List?> preview(String localId) async => null;

  @override
  Future<BackupDetail> backupDetail(AssetCandidate asset) async =>
      const BackupDetail(status: BackupStatus.unknown);

  @override
  Future<File?> playableVideo(
    String localId, {
    void Function(double progress)? onProgress,
  }) async => null;

  @override
  QueueStats get stats => statsValue;

  @override
  SyncReport? get lastReport => lastReportValue;

  @override
  String? get error => errorValue;

  @override
  AppSettings get settings => settingsValue;

  @override
  TransferProgress get progress => progressValue;

  @override
  Future<void> initialize() async => calls.add('initialize');

  @override
  Future<void> signIn(String email, String password, String serverUrl) async =>
      calls.add('signIn:$email');

  @override
  Future<void> signOut() async => calls.add('signOut');

  @override
  Future<void> syncNow() async => calls.add('syncNow');

  @override
  Future<void> retryFailed() async => calls.add('retryFailed');

  @override
  Future<void> pause() async => calls.add('pause');

  @override
  Future<void> resume() async => calls.add('resume');

  @override
  Future<void> updateSettings(AppSettings settings) async =>
      calls.add('updateSettings');
}

void main() {
  testWidgets('PhotoXApp lands on the photo library when signed in', (
    tester,
  ) async {
    await tester.pumpWidget(PhotoXApp(controller: FakeAppController()));
    await tester.pump();

    // Library is the landing tab; its title and the nav label both say it.
    expect(find.text('Library'), findsWidgets);
    expect(find.byTooltip('Sync now'), findsOneWidget);
  });

  testWidgets('PhotoXApp shows the login screen when signed out', (
    tester,
  ) async {
    await tester.pumpWidget(
      PhotoXApp(controller: FakeAppController(signedIn: false)),
    );
    await tester.pump();

    expect(find.text('Welcome back'), findsOneWidget);
    expect(find.text('Sync now'), findsNothing);
  });
}
