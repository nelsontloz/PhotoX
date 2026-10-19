import 'package:drift/native.dart';
import 'package:flutter_test/flutter_test.dart';
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
      notificationsEnabled: false,
      backfill: false,
      source: 'albums',
    );

    await store.save(settings);

    expect(await store.load(), settings);
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
            key: 'notificationsEnabled',
            value: '  FALSE  ',
            updatedAt: now,
          ),
        );
    await db
        .into(db.keyValues)
        .insert(
          KeyValuesCompanion.insert(
            namespace: SettingsStore.namespace,
            key: 'source',
            value: '   ',
            updatedAt: now,
          ),
        );

    final loaded = await store.load();

    // Missing/corrupt keys keep their defaults; valid neighbours still apply.
    expect(loaded.wifiOnly, isTrue);
    expect(loaded.chargingOnly, isFalse);
    expect(loaded.includeVideos, isFalse);
    expect(loaded.notificationsEnabled, isFalse);
    expect(loaded.backfill, isTrue);
    expect(loaded.source, 'cameraRoll');
  });

  test('save overwrites previous values instead of duplicating rows', () async {
    await store.save(const AppSettings(wifiOnly: false));
    await store.save(const AppSettings(wifiOnly: true, includeVideos: true));

    final rows = await db.select(db.keyValues).get();
    expect(rows, hasLength(6));
    final loaded = await store.load();
    expect(loaded.wifiOnly, isTrue);
    expect(loaded.includeVideos, isTrue);
  });
}
