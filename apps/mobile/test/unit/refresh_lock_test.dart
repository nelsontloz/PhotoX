import 'package:drift/native.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:photox_mobile/core/refresh_lock.dart';
import 'package:photox_mobile/upload/database.dart';

void main() {
  late AppDatabase db;
  late DriftRefreshLock lock;

  setUp(() {
    db = AppDatabase(NativeDatabase.memory());
    lock = DriftRefreshLock(db);
  });

  tearDown(() => db.close());

  test('acquires a free lock and rejects another owner', () async {
    expect(await lock.acquire('isolate-a', const Duration(minutes: 1)), isTrue);
    expect(
      await lock.acquire('isolate-b', const Duration(minutes: 1)),
      isFalse,
    );
  });

  test('re-acquiring as the same owner refreshes the expiry', () async {
    expect(await lock.acquire('isolate-a', const Duration(minutes: 1)), isTrue);
    expect(await lock.acquire('isolate-a', const Duration(minutes: 1)), isTrue);
  });

  test('release only deletes the matching owner', () async {
    expect(await lock.acquire('isolate-a', const Duration(minutes: 1)), isTrue);

    await lock.release('isolate-b');
    expect(
      await lock.acquire('isolate-b', const Duration(minutes: 1)),
      isFalse,
    );

    await lock.release('isolate-a');
    expect(await lock.acquire('isolate-b', const Duration(minutes: 1)), isTrue);
  });

  test('an expired lock can be acquired by another owner', () async {
    expect(await lock.acquire('isolate-a', Duration.zero), isTrue);
    expect(await lock.acquire('isolate-b', const Duration(minutes: 1)), isTrue);
  });

  test('state is shared across lock instances on the same database', () async {
    final other = DriftRefreshLock(db);

    expect(await lock.acquire('isolate-a', const Duration(minutes: 1)), isTrue);
    expect(
      await other.acquire('isolate-b', const Duration(minutes: 1)),
      isFalse,
    );

    await other.release('isolate-a');
    expect(
      await other.acquire('isolate-b', const Duration(minutes: 1)),
      isTrue,
    );
  });

  test('corrupt lock documents are treated as absent', () async {
    await db
        .into(db.keyValues)
        .insert(
          KeyValuesCompanion.insert(
            namespace: DriftRefreshLock.namespace,
            key: DriftRefreshLock.lockKey,
            value: '{not-json',
            updatedAt: DateTime(2026),
          ),
        );

    expect(await lock.acquire('isolate-a', const Duration(minutes: 1)), isTrue);
  });

  test('parallel contenders elect exactly one owner', () async {
    final results = await Future.wait(<Future<bool>>[
      lock.acquire('isolate-a', const Duration(minutes: 1)),
      DriftRefreshLock(db).acquire('isolate-b', const Duration(minutes: 1)),
    ]);

    expect(results.where((acquired) => acquired), hasLength(1));
  });
}
