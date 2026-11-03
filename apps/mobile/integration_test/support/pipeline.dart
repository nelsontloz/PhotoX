import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:photox_mobile/app_services.dart';
import 'package:photox_mobile/core/auth_manager.dart';
import 'package:photox_mobile/core/refresh_lock.dart';
import 'package:photox_mobile/core/token_store.dart';
import 'package:photox_mobile/media/photo_observer.dart';
import 'package:photox_mobile/settings/settings_store.dart';
import 'package:photox_mobile/upload/database.dart';
import 'package:photox_mobile/upload/upload_queue.dart';
import 'package:photox_mobile/upload/uploader.dart';

import 'harness.dart';

/// Media `e2e/mobile/run.sh` seeds into the emulator's `DCIM/Camera`.
///
/// The small one is a real 800x600 jpeg (below the 8 MiB single-POST
/// threshold); the large one is the same jpeg padded past 24 MiB so it needs
/// four 8 MiB parts. The server sniffs the header bytes, so padding is enough.
const String smallPhotoName = 'e2e-small.jpg';
const String largePhotoName = 'e2e-large.jpg';

/// Builds the pipeline graph against the run's real core, with an empty queue.
///
/// [reset] clears the drift queue, the scan watermark and the spool, so every
/// file starts from "fresh install" no matter what an earlier file left behind
/// — `flutter test` does not clear app data between files. Pass `false` to
/// keep the state of a previous graph in the same process (the resume test).
///
/// The controller is deliberately not built: `PhotoXController.signIn` starts a
/// pass of its own, and these tests drive the pass themselves.
Future<AppServices> bootPipeline({bool reset = true, TokenStore? store}) async {
  final db = AppDatabase();
  if (reset) await resetLocalState(db);
  // Save after the reset: the pass reads these, and the ApiClient needs the
  // address persisted in the DB before it is built.
  await SettingsStore(db).save(
    const AppSettings(
      apiBaseUrl: apiBaseUrl,
      // The emulator's link is unmetered, but this must never be what a red
      // run is about.
      wifiOnly: false,
    ),
  );
  final auth = AuthManager(
    store: store ?? SecureTokenStore(),
    refreshLock: DriftRefreshLock(db),
    baseUrl: apiBaseUrl,
  );
  return AppServices.initializeBackground(database: db, auth: auth);
}

/// Drops every queue row, part receipt, scan watermark and spooled byte.
///
/// Keeps the stored settings, so a caller that only wants a second pass over
/// the same account ("another device") does not have to re-save them.
Future<void> resetQueueOnly(AppDatabase db) async {
  await db.delete(db.queuedAssets).go();
  await db.delete(db.uploadParts).go();
  await (db.delete(
    db.keyValues,
  )..where((t) => t.namespace.equals(UploadQueue.metaNamespace))).go();
  await clearUploadSpool();
}

/// [resetQueueOnly] plus the preferences: a full fresh-install state.
Future<void> resetLocalState(AppDatabase db) async {
  await resetQueueOnly(db);
  await (db.delete(
    db.keyValues,
  )..where((t) => t.namespace.equals(SettingsStore.namespace))).go();
}

/// Registers a throwaway account, so files never share the login rate limit.
Future<({String email, String password})> registerFreshUser(Dio api) async {
  final email =
      'mobile-e2e-pipe-'
      '${DateTime.now().microsecondsSinceEpoch}@photox.test';
  final response = await api.post<Map<String, dynamic>>(
    '/api/v1/auth/register',
    data: <String, dynamic>{
      'email': email,
      'password': e2ePassword,
      'displayName': 'Mobile E2E',
    },
  );
  expect(response.statusCode, anyOf(200, 201), reason: '$response');
  return (email: email, password: e2ePassword);
}

/// The seeded device asset called [fileName].
Future<AssetCandidate> seededAsset(
  AppServices services,
  String fileName,
) async {
  final candidates = await services.observer.scanNew();
  final matches = candidates.where(
    (candidate) => candidate.fileName == fileName,
  );
  expect(
    matches,
    isNotEmpty,
    reason:
        '$fileName is not in the emulator library. Seed it first '
        '(`pnpm mobile:e2e` does it); found '
        '${candidates.map((c) => c.fileName).toList()}',
  );
  return matches.first;
}

/// One queue row, which must exist.
Future<QueuedAsset> queueRow(AppServices services, String localId) async {
  final row = await services.queue.byLocalId(localId);
  expect(row, isNotNull, reason: 'no queue row for $localId');
  return row!;
}

/// Assets core currently holds for the signed-in user.
Future<int> serverAssetTotal(AppServices services) async {
  final token = await services.auth.ensureAccessToken();
  final response = await apiDio().get<Map<String, dynamic>>(
    '/api/v1/assets',
    options: authHeader(token),
  );
  return (response.data!['total'] as num).toInt();
}

/// Asserts core stores bytes [sha256] as [assetId] for this user.
///
/// The digest is of the exact file that was uploaded and the asset id comes
/// from the queue row, so this proves the uploaded bytes and the created asset
/// are the same object rather than merely "something arrived".
Future<void> expectBytesStored(
  AppServices services, {
  required String sha256,
  required String? assetId,
}) async {
  final token = await services.auth.ensureAccessToken();
  final response = await apiDio().post<Map<String, dynamic>>(
    '/api/v1/files/exists',
    data: <String, dynamic>{
      'items': <Map<String, dynamic>>[
        <String, dynamic>{'checksumSha256': sha256},
      ],
    },
    options: authHeader(token),
  );
  final items = response.data!['items'] as List<dynamic>;
  final hit = (items.single as Map).cast<String, dynamic>();
  expect(hit['exists'], isTrue, reason: 'core has no file for $sha256');
  expect(hit['existingAssetId'], assetId);
}

/// Signs the pipeline into [user] and returns the token pair's refresh token.
Future<String> signInPipeline(
  AppServices services,
  ({String email, String password}) user,
) async {
  await services.auth.signIn(email: user.email, password: user.password);
  final tokens = await services.auth.store.read();
  expect(tokens, isNotNull, reason: 'sign-in did not persist a token pair');
  return tokens!.refreshToken;
}
