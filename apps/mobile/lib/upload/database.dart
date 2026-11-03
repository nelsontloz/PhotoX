import 'package:drift/drift.dart';
import 'package:drift_flutter/drift_flutter.dart';

part 'database.g.dart';

/// One asset tracked by the local backup queue.
class QueuedAssets extends Table {
  TextColumn get localId => text()();
  TextColumn get platform => text()();
  TextColumn get kind => text()();
  IntColumn get sizeBytes => integer()();
  DateTimeColumn get takenAt => dateTime().nullable()();
  TextColumn get sha256 => text().nullable()();
  TextColumn get uploadId => text().nullable()();
  IntColumn get partSize => integer().nullable()();
  IntColumn get partCount => integer().nullable()();
  TextColumn get state => text()();
  IntColumn get attempts => integer().withDefault(const Constant(0))();
  DateTimeColumn get nextAttemptAt => dateTime().nullable()();
  TextColumn get lastError => text().nullable()();
  TextColumn get serverAssetId => text().nullable()();

  // Schema v2: metadata needed to re-open the exact bytes after a restart.
  TextColumn get fileName => text().nullable()();
  TextColumn get mimeType => text().nullable()();
  DateTimeColumn get modifiedAt => dateTime().nullable()();
  TextColumn get spoolPath => text().nullable()();
  TextColumn get protocol => text().nullable()();
  TextColumn get errorCode => text().nullable()();
  TextColumn get serverFileId => text().nullable()();
  DateTimeColumn get discoveredAt => dateTime().nullable()();
  DateTimeColumn get lastAttemptAt => dateTime().nullable()();

  // Schema v3: which device folder the asset came from, and when its upload
  // joined that folder's server album (null = still to link).
  TextColumn get folderId => text().nullable()();
  DateTimeColumn get albumLinkedAt => dateTime().nullable()();

  @override
  Set<Column> get primaryKey => {localId};
}

/// Part receipt recorded after the server acknowledges a part.
class UploadParts extends Table {
  TextColumn get uploadId => text()();
  IntColumn get partIndex => integer()();
  IntColumn get bytes => integer()();
  TextColumn get sha256 => text().nullable()();
  DateTimeColumn get acknowledgedAt => dateTime().nullable()();

  @override
  Set<Column> get primaryKey => {uploadId, partIndex};
}

/// Small namespaced key/value store for settings, queue metadata and locks.
@DataClassName('KeyValue')
class KeyValues extends Table {
  TextColumn get namespace => text()();
  TextColumn get key => text()();
  TextColumn get value => text()();
  DateTimeColumn get updatedAt => dateTime()();

  @override
  Set<Column> get primaryKey => {namespace, key};
}

/// Local upload queue; the only source of truth for resume decisions.
@DriftDatabase(tables: [QueuedAssets, UploadParts, KeyValues])
class AppDatabase extends _$AppDatabase {
  AppDatabase([QueryExecutor? executor])
    : super(executor ?? driftDatabase(name: 'photox_mobile'));

  @override
  int get schemaVersion => 3;

  @override
  MigrationStrategy get migration => MigrationStrategy(
    onCreate: (m) async {
      await m.createAll();
    },
    onUpgrade: (m, from, to) async {
      if (from < 2) {
        await m.addColumn(queuedAssets, queuedAssets.fileName);
        await m.addColumn(queuedAssets, queuedAssets.mimeType);
        await m.addColumn(queuedAssets, queuedAssets.modifiedAt);
        await m.addColumn(queuedAssets, queuedAssets.spoolPath);
        await m.addColumn(queuedAssets, queuedAssets.protocol);
        await m.addColumn(queuedAssets, queuedAssets.errorCode);
        await m.addColumn(queuedAssets, queuedAssets.serverFileId);
        await m.addColumn(queuedAssets, queuedAssets.discoveredAt);
        await m.addColumn(queuedAssets, queuedAssets.lastAttemptAt);
        await m.addColumn(uploadParts, uploadParts.acknowledgedAt);
        await m.createTable(keyValues);
      }
      if (from < 3) {
        await m.addColumn(queuedAssets, queuedAssets.folderId);
        await m.addColumn(queuedAssets, queuedAssets.albumLinkedAt);
      }
    },
    beforeOpen: (details) async {
      // Multiple isolates share this file; wait instead of failing instantly.
      await customStatement('PRAGMA busy_timeout = 5000');
      try {
        await customStatement('PRAGMA journal_mode = WAL');
      } on Object {
        // ponytail: WAL is best effort. In-memory and read-only databases (and
        // some platform sandboxes) can refuse it; rollback journal still works.
      }
    },
  );
}
