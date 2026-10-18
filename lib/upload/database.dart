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

  @override
  Set<Column> get primaryKey => {localId};
}

/// Part receipt recorded after the server acknowledges a part.
class UploadParts extends Table {
  TextColumn get uploadId => text()();
  IntColumn get partIndex => integer()();
  IntColumn get bytes => integer()();
  TextColumn get sha256 => text().nullable()();

  @override
  Set<Column> get primaryKey => {uploadId, partIndex};
}

/// Local upload queue; the only source of truth for resume decisions.
@DriftDatabase(tables: [QueuedAssets, UploadParts])
class AppDatabase extends _$AppDatabase {
  AppDatabase() : super(driftDatabase(name: 'photox_mobile'));

  @override
  int get schemaVersion => 1;
}
