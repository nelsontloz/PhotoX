import 'package:drift/native.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:photox_mobile/core/app_config.dart';
import 'package:photox_mobile/settings/settings_store.dart';
import 'package:photox_mobile/upload/database.dart';

void main() {
  late AppDatabase db;
  late SettingsStore store;

  setUp(() {
    db = AppDatabase(NativeDatabase.memory());
    store = SettingsStore(db);
  });

  tearDown(() => db.close());

  test('returns documented defaults on a fresh database', () async {
    expect(await store.load(), const AppSettings());
  });

  test('round-trips every setting', () async {
    const settings = AppSettings(
      wifiOnly: false,
      chargingOnly: true,
      includeVideos: true,
      apiBaseUrl: 'http://192.168.1.10:3000',
      paused: true,
      uploadFolderIds: <String>['camera', 'favorites'],
      uploadAllFolders: true,
      folderAlbums: <String, String>{'camera': 'album-1', 'screens': 'album-2'},
    );

    await store.save(settings);

    expect(await store.load(), settings);
  });

  test('compares folder maps regardless of insertion order', () {
    const left = AppSettings(
      folderAlbums: <String, String>{'camera': 'album-1', 'screens': 'album-2'},
    );
    const right = AppSettings(
      folderAlbums: <String, String>{'screens': 'album-2', 'camera': 'album-1'},
    );

    expect(left, right);
    expect(left.hashCode, right.hashCode);
  });

  test('falls back per key when values are corrupt or missing', () async {
    final now = DateTime(2026, 10, 19);
    await db
        .into(db.keyValues)
        .insert(
          KeyValuesCompanion.insert(
            namespace: SettingsStore.namespace,
            key: 'wifiOnly',
            value: 'not-a-bool',
            updatedAt: now,
          ),
        );
    await db
        .into(db.keyValues)
        .insert(
          KeyValuesCompanion.insert(
            namespace: SettingsStore.namespace,
            key: 'uploadFolderIds',
            value: '{not a list',
            updatedAt: now,
          ),
        );

    final loaded = await store.load();

    // Missing/corrupt keys keep their defaults; valid neighbours still apply.
    expect(loaded.wifiOnly, isTrue);
    expect(loaded.chargingOnly, isFalse);
    expect(loaded.includeVideos, isFalse);
    expect(loaded.uploadFolderIds, isEmpty);
    expect(loaded.uploadAllFolders, isFalse);
    expect(loaded.folderAlbums, isEmpty);
  });

  test('decodes the folder list defensively', () async {
    final now = DateTime(2026, 10, 19);
    Future<void> setRaw(String value) => db
        .into(db.keyValues)
        .insertOnConflictUpdate(
          KeyValuesCompanion.insert(
            namespace: SettingsStore.namespace,
            key: 'uploadFolderIds',
            value: value,
            updatedAt: now,
          ),
        );

    await setRaw('["camera", 7, {"id": "x"}, "screens"]');
    expect((await store.load()).uploadFolderIds, <String>['camera', 'screens']);

    await setRaw('not json');
    expect((await store.load()).uploadFolderIds, isEmpty);

    await setRaw('{"folder": "camera"}');
    expect((await store.load()).uploadFolderIds, isEmpty);
  });

  test('save overwrites previous values instead of duplicating rows', () async {
    await store.save(const AppSettings(wifiOnly: false));
    await store.save(const AppSettings(wifiOnly: true, includeVideos: true));

    final rows = await db.select(db.keyValues).get();
    expect(rows, hasLength(8));
    final loaded = await store.load();
    expect(loaded.wifiOnly, isTrue);
    expect(loaded.includeVideos, isTrue);
  });

  test('decodes the folder album map defensively', () async {
    final now = DateTime(2026, 10, 19);
    Future<void> setRaw(String value) => db
        .into(db.keyValues)
        .insertOnConflictUpdate(
          KeyValuesCompanion.insert(
            namespace: SettingsStore.namespace,
            key: 'folderAlbums',
            value: value,
            updatedAt: now,
          ),
        );

    await setRaw('{"camera": "album-1", "screens": 7, "other": null}');
    expect((await store.load()).folderAlbums, <String, String>{
      'camera': 'album-1',
    });

    await setRaw('not json');
    expect((await store.load()).folderAlbums, isEmpty);

    await setRaw('["camera"]');
    expect((await store.load()).folderAlbums, isEmpty);
  });

  test('accepts only absolute http(s) server URLs', () {
    expect(
      normalizeServerUrl(' http://10.0.2.2:3000/ '),
      'http://10.0.2.2:3000',
    );
    expect(
      normalizeServerUrl('https://photos.example.com/core/'),
      'https://photos.example.com/core',
    );
    expect(normalizeServerUrl('10.0.2.2:3000'), isNull);
    expect(normalizeServerUrl('ftp://10.0.2.2:3000'), isNull);
    expect(normalizeServerUrl('http://'), isNull);
    expect(normalizeServerUrl('   '), isNull);
  });
}
