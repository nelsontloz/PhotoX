// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'database.dart';

// ignore_for_file: type=lint
class $QueuedAssetsTable extends QueuedAssets
    with TableInfo<$QueuedAssetsTable, QueuedAsset> {
  @override
  final GeneratedDatabase attachedDatabase;
  final String? _alias;
  $QueuedAssetsTable(this.attachedDatabase, [this._alias]);
  static const VerificationMeta _localIdMeta = const VerificationMeta(
    'localId',
  );
  @override
  late final GeneratedColumn<String> localId = GeneratedColumn<String>(
    'local_id',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _platformMeta = const VerificationMeta(
    'platform',
  );
  @override
  late final GeneratedColumn<String> platform = GeneratedColumn<String>(
    'platform',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _kindMeta = const VerificationMeta('kind');
  @override
  late final GeneratedColumn<String> kind = GeneratedColumn<String>(
    'kind',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _sizeBytesMeta = const VerificationMeta(
    'sizeBytes',
  );
  @override
  late final GeneratedColumn<int> sizeBytes = GeneratedColumn<int>(
    'size_bytes',
    aliasedName,
    false,
    type: DriftSqlType.int,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _takenAtMeta = const VerificationMeta(
    'takenAt',
  );
  @override
  late final GeneratedColumn<DateTime> takenAt = GeneratedColumn<DateTime>(
    'taken_at',
    aliasedName,
    true,
    type: DriftSqlType.dateTime,
    requiredDuringInsert: false,
  );
  static const VerificationMeta _sha256Meta = const VerificationMeta('sha256');
  @override
  late final GeneratedColumn<String> sha256 = GeneratedColumn<String>(
    'sha256',
    aliasedName,
    true,
    type: DriftSqlType.string,
    requiredDuringInsert: false,
  );
  static const VerificationMeta _uploadIdMeta = const VerificationMeta(
    'uploadId',
  );
  @override
  late final GeneratedColumn<String> uploadId = GeneratedColumn<String>(
    'upload_id',
    aliasedName,
    true,
    type: DriftSqlType.string,
    requiredDuringInsert: false,
  );
  static const VerificationMeta _partSizeMeta = const VerificationMeta(
    'partSize',
  );
  @override
  late final GeneratedColumn<int> partSize = GeneratedColumn<int>(
    'part_size',
    aliasedName,
    true,
    type: DriftSqlType.int,
    requiredDuringInsert: false,
  );
  static const VerificationMeta _partCountMeta = const VerificationMeta(
    'partCount',
  );
  @override
  late final GeneratedColumn<int> partCount = GeneratedColumn<int>(
    'part_count',
    aliasedName,
    true,
    type: DriftSqlType.int,
    requiredDuringInsert: false,
  );
  static const VerificationMeta _stateMeta = const VerificationMeta('state');
  @override
  late final GeneratedColumn<String> state = GeneratedColumn<String>(
    'state',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _attemptsMeta = const VerificationMeta(
    'attempts',
  );
  @override
  late final GeneratedColumn<int> attempts = GeneratedColumn<int>(
    'attempts',
    aliasedName,
    false,
    type: DriftSqlType.int,
    requiredDuringInsert: false,
    defaultValue: const Constant(0),
  );
  static const VerificationMeta _nextAttemptAtMeta = const VerificationMeta(
    'nextAttemptAt',
  );
  @override
  late final GeneratedColumn<DateTime> nextAttemptAt =
      GeneratedColumn<DateTime>(
        'next_attempt_at',
        aliasedName,
        true,
        type: DriftSqlType.dateTime,
        requiredDuringInsert: false,
      );
  static const VerificationMeta _lastErrorMeta = const VerificationMeta(
    'lastError',
  );
  @override
  late final GeneratedColumn<String> lastError = GeneratedColumn<String>(
    'last_error',
    aliasedName,
    true,
    type: DriftSqlType.string,
    requiredDuringInsert: false,
  );
  static const VerificationMeta _serverAssetIdMeta = const VerificationMeta(
    'serverAssetId',
  );
  @override
  late final GeneratedColumn<String> serverAssetId = GeneratedColumn<String>(
    'server_asset_id',
    aliasedName,
    true,
    type: DriftSqlType.string,
    requiredDuringInsert: false,
  );
  @override
  List<GeneratedColumn> get $columns => [
    localId,
    platform,
    kind,
    sizeBytes,
    takenAt,
    sha256,
    uploadId,
    partSize,
    partCount,
    state,
    attempts,
    nextAttemptAt,
    lastError,
    serverAssetId,
  ];
  @override
  String get aliasedName => _alias ?? actualTableName;
  @override
  String get actualTableName => $name;
  static const String $name = 'queued_assets';
  @override
  VerificationContext validateIntegrity(
    Insertable<QueuedAsset> instance, {
    bool isInserting = false,
  }) {
    final context = VerificationContext();
    final data = instance.toColumns(true);
    if (data.containsKey('local_id')) {
      context.handle(
        _localIdMeta,
        localId.isAcceptableOrUnknown(data['local_id']!, _localIdMeta),
      );
    } else if (isInserting) {
      context.missing(_localIdMeta);
    }
    if (data.containsKey('platform')) {
      context.handle(
        _platformMeta,
        platform.isAcceptableOrUnknown(data['platform']!, _platformMeta),
      );
    } else if (isInserting) {
      context.missing(_platformMeta);
    }
    if (data.containsKey('kind')) {
      context.handle(
        _kindMeta,
        kind.isAcceptableOrUnknown(data['kind']!, _kindMeta),
      );
    } else if (isInserting) {
      context.missing(_kindMeta);
    }
    if (data.containsKey('size_bytes')) {
      context.handle(
        _sizeBytesMeta,
        sizeBytes.isAcceptableOrUnknown(data['size_bytes']!, _sizeBytesMeta),
      );
    } else if (isInserting) {
      context.missing(_sizeBytesMeta);
    }
    if (data.containsKey('taken_at')) {
      context.handle(
        _takenAtMeta,
        takenAt.isAcceptableOrUnknown(data['taken_at']!, _takenAtMeta),
      );
    }
    if (data.containsKey('sha256')) {
      context.handle(
        _sha256Meta,
        sha256.isAcceptableOrUnknown(data['sha256']!, _sha256Meta),
      );
    }
    if (data.containsKey('upload_id')) {
      context.handle(
        _uploadIdMeta,
        uploadId.isAcceptableOrUnknown(data['upload_id']!, _uploadIdMeta),
      );
    }
    if (data.containsKey('part_size')) {
      context.handle(
        _partSizeMeta,
        partSize.isAcceptableOrUnknown(data['part_size']!, _partSizeMeta),
      );
    }
    if (data.containsKey('part_count')) {
      context.handle(
        _partCountMeta,
        partCount.isAcceptableOrUnknown(data['part_count']!, _partCountMeta),
      );
    }
    if (data.containsKey('state')) {
      context.handle(
        _stateMeta,
        state.isAcceptableOrUnknown(data['state']!, _stateMeta),
      );
    } else if (isInserting) {
      context.missing(_stateMeta);
    }
    if (data.containsKey('attempts')) {
      context.handle(
        _attemptsMeta,
        attempts.isAcceptableOrUnknown(data['attempts']!, _attemptsMeta),
      );
    }
    if (data.containsKey('next_attempt_at')) {
      context.handle(
        _nextAttemptAtMeta,
        nextAttemptAt.isAcceptableOrUnknown(
          data['next_attempt_at']!,
          _nextAttemptAtMeta,
        ),
      );
    }
    if (data.containsKey('last_error')) {
      context.handle(
        _lastErrorMeta,
        lastError.isAcceptableOrUnknown(data['last_error']!, _lastErrorMeta),
      );
    }
    if (data.containsKey('server_asset_id')) {
      context.handle(
        _serverAssetIdMeta,
        serverAssetId.isAcceptableOrUnknown(
          data['server_asset_id']!,
          _serverAssetIdMeta,
        ),
      );
    }
    return context;
  }

  @override
  Set<GeneratedColumn> get $primaryKey => {localId};
  @override
  QueuedAsset map(Map<String, dynamic> data, {String? tablePrefix}) {
    final effectivePrefix = tablePrefix != null ? '$tablePrefix.' : '';
    return QueuedAsset(
      localId: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}local_id'],
      )!,
      platform: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}platform'],
      )!,
      kind: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}kind'],
      )!,
      sizeBytes: attachedDatabase.typeMapping.read(
        DriftSqlType.int,
        data['${effectivePrefix}size_bytes'],
      )!,
      takenAt: attachedDatabase.typeMapping.read(
        DriftSqlType.dateTime,
        data['${effectivePrefix}taken_at'],
      ),
      sha256: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}sha256'],
      ),
      uploadId: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}upload_id'],
      ),
      partSize: attachedDatabase.typeMapping.read(
        DriftSqlType.int,
        data['${effectivePrefix}part_size'],
      ),
      partCount: attachedDatabase.typeMapping.read(
        DriftSqlType.int,
        data['${effectivePrefix}part_count'],
      ),
      state: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}state'],
      )!,
      attempts: attachedDatabase.typeMapping.read(
        DriftSqlType.int,
        data['${effectivePrefix}attempts'],
      )!,
      nextAttemptAt: attachedDatabase.typeMapping.read(
        DriftSqlType.dateTime,
        data['${effectivePrefix}next_attempt_at'],
      ),
      lastError: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}last_error'],
      ),
      serverAssetId: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}server_asset_id'],
      ),
    );
  }

  @override
  $QueuedAssetsTable createAlias(String alias) {
    return $QueuedAssetsTable(attachedDatabase, alias);
  }
}

class QueuedAsset extends DataClass implements Insertable<QueuedAsset> {
  final String localId;
  final String platform;
  final String kind;
  final int sizeBytes;
  final DateTime? takenAt;
  final String? sha256;
  final String? uploadId;
  final int? partSize;
  final int? partCount;
  final String state;
  final int attempts;
  final DateTime? nextAttemptAt;
  final String? lastError;
  final String? serverAssetId;
  const QueuedAsset({
    required this.localId,
    required this.platform,
    required this.kind,
    required this.sizeBytes,
    this.takenAt,
    this.sha256,
    this.uploadId,
    this.partSize,
    this.partCount,
    required this.state,
    required this.attempts,
    this.nextAttemptAt,
    this.lastError,
    this.serverAssetId,
  });
  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    map['local_id'] = Variable<String>(localId);
    map['platform'] = Variable<String>(platform);
    map['kind'] = Variable<String>(kind);
    map['size_bytes'] = Variable<int>(sizeBytes);
    if (!nullToAbsent || takenAt != null) {
      map['taken_at'] = Variable<DateTime>(takenAt);
    }
    if (!nullToAbsent || sha256 != null) {
      map['sha256'] = Variable<String>(sha256);
    }
    if (!nullToAbsent || uploadId != null) {
      map['upload_id'] = Variable<String>(uploadId);
    }
    if (!nullToAbsent || partSize != null) {
      map['part_size'] = Variable<int>(partSize);
    }
    if (!nullToAbsent || partCount != null) {
      map['part_count'] = Variable<int>(partCount);
    }
    map['state'] = Variable<String>(state);
    map['attempts'] = Variable<int>(attempts);
    if (!nullToAbsent || nextAttemptAt != null) {
      map['next_attempt_at'] = Variable<DateTime>(nextAttemptAt);
    }
    if (!nullToAbsent || lastError != null) {
      map['last_error'] = Variable<String>(lastError);
    }
    if (!nullToAbsent || serverAssetId != null) {
      map['server_asset_id'] = Variable<String>(serverAssetId);
    }
    return map;
  }

  QueuedAssetsCompanion toCompanion(bool nullToAbsent) {
    return QueuedAssetsCompanion(
      localId: Value(localId),
      platform: Value(platform),
      kind: Value(kind),
      sizeBytes: Value(sizeBytes),
      takenAt: takenAt == null && nullToAbsent
          ? const Value.absent()
          : Value(takenAt),
      sha256: sha256 == null && nullToAbsent
          ? const Value.absent()
          : Value(sha256),
      uploadId: uploadId == null && nullToAbsent
          ? const Value.absent()
          : Value(uploadId),
      partSize: partSize == null && nullToAbsent
          ? const Value.absent()
          : Value(partSize),
      partCount: partCount == null && nullToAbsent
          ? const Value.absent()
          : Value(partCount),
      state: Value(state),
      attempts: Value(attempts),
      nextAttemptAt: nextAttemptAt == null && nullToAbsent
          ? const Value.absent()
          : Value(nextAttemptAt),
      lastError: lastError == null && nullToAbsent
          ? const Value.absent()
          : Value(lastError),
      serverAssetId: serverAssetId == null && nullToAbsent
          ? const Value.absent()
          : Value(serverAssetId),
    );
  }

  factory QueuedAsset.fromJson(
    Map<String, dynamic> json, {
    ValueSerializer? serializer,
  }) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return QueuedAsset(
      localId: serializer.fromJson<String>(json['localId']),
      platform: serializer.fromJson<String>(json['platform']),
      kind: serializer.fromJson<String>(json['kind']),
      sizeBytes: serializer.fromJson<int>(json['sizeBytes']),
      takenAt: serializer.fromJson<DateTime?>(json['takenAt']),
      sha256: serializer.fromJson<String?>(json['sha256']),
      uploadId: serializer.fromJson<String?>(json['uploadId']),
      partSize: serializer.fromJson<int?>(json['partSize']),
      partCount: serializer.fromJson<int?>(json['partCount']),
      state: serializer.fromJson<String>(json['state']),
      attempts: serializer.fromJson<int>(json['attempts']),
      nextAttemptAt: serializer.fromJson<DateTime?>(json['nextAttemptAt']),
      lastError: serializer.fromJson<String?>(json['lastError']),
      serverAssetId: serializer.fromJson<String?>(json['serverAssetId']),
    );
  }
  @override
  Map<String, dynamic> toJson({ValueSerializer? serializer}) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return <String, dynamic>{
      'localId': serializer.toJson<String>(localId),
      'platform': serializer.toJson<String>(platform),
      'kind': serializer.toJson<String>(kind),
      'sizeBytes': serializer.toJson<int>(sizeBytes),
      'takenAt': serializer.toJson<DateTime?>(takenAt),
      'sha256': serializer.toJson<String?>(sha256),
      'uploadId': serializer.toJson<String?>(uploadId),
      'partSize': serializer.toJson<int?>(partSize),
      'partCount': serializer.toJson<int?>(partCount),
      'state': serializer.toJson<String>(state),
      'attempts': serializer.toJson<int>(attempts),
      'nextAttemptAt': serializer.toJson<DateTime?>(nextAttemptAt),
      'lastError': serializer.toJson<String?>(lastError),
      'serverAssetId': serializer.toJson<String?>(serverAssetId),
    };
  }

  QueuedAsset copyWith({
    String? localId,
    String? platform,
    String? kind,
    int? sizeBytes,
    Value<DateTime?> takenAt = const Value.absent(),
    Value<String?> sha256 = const Value.absent(),
    Value<String?> uploadId = const Value.absent(),
    Value<int?> partSize = const Value.absent(),
    Value<int?> partCount = const Value.absent(),
    String? state,
    int? attempts,
    Value<DateTime?> nextAttemptAt = const Value.absent(),
    Value<String?> lastError = const Value.absent(),
    Value<String?> serverAssetId = const Value.absent(),
  }) => QueuedAsset(
    localId: localId ?? this.localId,
    platform: platform ?? this.platform,
    kind: kind ?? this.kind,
    sizeBytes: sizeBytes ?? this.sizeBytes,
    takenAt: takenAt.present ? takenAt.value : this.takenAt,
    sha256: sha256.present ? sha256.value : this.sha256,
    uploadId: uploadId.present ? uploadId.value : this.uploadId,
    partSize: partSize.present ? partSize.value : this.partSize,
    partCount: partCount.present ? partCount.value : this.partCount,
    state: state ?? this.state,
    attempts: attempts ?? this.attempts,
    nextAttemptAt: nextAttemptAt.present
        ? nextAttemptAt.value
        : this.nextAttemptAt,
    lastError: lastError.present ? lastError.value : this.lastError,
    serverAssetId: serverAssetId.present
        ? serverAssetId.value
        : this.serverAssetId,
  );
  QueuedAsset copyWithCompanion(QueuedAssetsCompanion data) {
    return QueuedAsset(
      localId: data.localId.present ? data.localId.value : this.localId,
      platform: data.platform.present ? data.platform.value : this.platform,
      kind: data.kind.present ? data.kind.value : this.kind,
      sizeBytes: data.sizeBytes.present ? data.sizeBytes.value : this.sizeBytes,
      takenAt: data.takenAt.present ? data.takenAt.value : this.takenAt,
      sha256: data.sha256.present ? data.sha256.value : this.sha256,
      uploadId: data.uploadId.present ? data.uploadId.value : this.uploadId,
      partSize: data.partSize.present ? data.partSize.value : this.partSize,
      partCount: data.partCount.present ? data.partCount.value : this.partCount,
      state: data.state.present ? data.state.value : this.state,
      attempts: data.attempts.present ? data.attempts.value : this.attempts,
      nextAttemptAt: data.nextAttemptAt.present
          ? data.nextAttemptAt.value
          : this.nextAttemptAt,
      lastError: data.lastError.present ? data.lastError.value : this.lastError,
      serverAssetId: data.serverAssetId.present
          ? data.serverAssetId.value
          : this.serverAssetId,
    );
  }

  @override
  String toString() {
    return (StringBuffer('QueuedAsset(')
          ..write('localId: $localId, ')
          ..write('platform: $platform, ')
          ..write('kind: $kind, ')
          ..write('sizeBytes: $sizeBytes, ')
          ..write('takenAt: $takenAt, ')
          ..write('sha256: $sha256, ')
          ..write('uploadId: $uploadId, ')
          ..write('partSize: $partSize, ')
          ..write('partCount: $partCount, ')
          ..write('state: $state, ')
          ..write('attempts: $attempts, ')
          ..write('nextAttemptAt: $nextAttemptAt, ')
          ..write('lastError: $lastError, ')
          ..write('serverAssetId: $serverAssetId')
          ..write(')'))
        .toString();
  }

  @override
  int get hashCode => Object.hash(
    localId,
    platform,
    kind,
    sizeBytes,
    takenAt,
    sha256,
    uploadId,
    partSize,
    partCount,
    state,
    attempts,
    nextAttemptAt,
    lastError,
    serverAssetId,
  );
  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      (other is QueuedAsset &&
          other.localId == this.localId &&
          other.platform == this.platform &&
          other.kind == this.kind &&
          other.sizeBytes == this.sizeBytes &&
          other.takenAt == this.takenAt &&
          other.sha256 == this.sha256 &&
          other.uploadId == this.uploadId &&
          other.partSize == this.partSize &&
          other.partCount == this.partCount &&
          other.state == this.state &&
          other.attempts == this.attempts &&
          other.nextAttemptAt == this.nextAttemptAt &&
          other.lastError == this.lastError &&
          other.serverAssetId == this.serverAssetId);
}

class QueuedAssetsCompanion extends UpdateCompanion<QueuedAsset> {
  final Value<String> localId;
  final Value<String> platform;
  final Value<String> kind;
  final Value<int> sizeBytes;
  final Value<DateTime?> takenAt;
  final Value<String?> sha256;
  final Value<String?> uploadId;
  final Value<int?> partSize;
  final Value<int?> partCount;
  final Value<String> state;
  final Value<int> attempts;
  final Value<DateTime?> nextAttemptAt;
  final Value<String?> lastError;
  final Value<String?> serverAssetId;
  final Value<int> rowid;
  const QueuedAssetsCompanion({
    this.localId = const Value.absent(),
    this.platform = const Value.absent(),
    this.kind = const Value.absent(),
    this.sizeBytes = const Value.absent(),
    this.takenAt = const Value.absent(),
    this.sha256 = const Value.absent(),
    this.uploadId = const Value.absent(),
    this.partSize = const Value.absent(),
    this.partCount = const Value.absent(),
    this.state = const Value.absent(),
    this.attempts = const Value.absent(),
    this.nextAttemptAt = const Value.absent(),
    this.lastError = const Value.absent(),
    this.serverAssetId = const Value.absent(),
    this.rowid = const Value.absent(),
  });
  QueuedAssetsCompanion.insert({
    required String localId,
    required String platform,
    required String kind,
    required int sizeBytes,
    this.takenAt = const Value.absent(),
    this.sha256 = const Value.absent(),
    this.uploadId = const Value.absent(),
    this.partSize = const Value.absent(),
    this.partCount = const Value.absent(),
    required String state,
    this.attempts = const Value.absent(),
    this.nextAttemptAt = const Value.absent(),
    this.lastError = const Value.absent(),
    this.serverAssetId = const Value.absent(),
    this.rowid = const Value.absent(),
  }) : localId = Value(localId),
       platform = Value(platform),
       kind = Value(kind),
       sizeBytes = Value(sizeBytes),
       state = Value(state);
  static Insertable<QueuedAsset> custom({
    Expression<String>? localId,
    Expression<String>? platform,
    Expression<String>? kind,
    Expression<int>? sizeBytes,
    Expression<DateTime>? takenAt,
    Expression<String>? sha256,
    Expression<String>? uploadId,
    Expression<int>? partSize,
    Expression<int>? partCount,
    Expression<String>? state,
    Expression<int>? attempts,
    Expression<DateTime>? nextAttemptAt,
    Expression<String>? lastError,
    Expression<String>? serverAssetId,
    Expression<int>? rowid,
  }) {
    return RawValuesInsertable({
      if (localId != null) 'local_id': localId,
      if (platform != null) 'platform': platform,
      if (kind != null) 'kind': kind,
      if (sizeBytes != null) 'size_bytes': sizeBytes,
      if (takenAt != null) 'taken_at': takenAt,
      if (sha256 != null) 'sha256': sha256,
      if (uploadId != null) 'upload_id': uploadId,
      if (partSize != null) 'part_size': partSize,
      if (partCount != null) 'part_count': partCount,
      if (state != null) 'state': state,
      if (attempts != null) 'attempts': attempts,
      if (nextAttemptAt != null) 'next_attempt_at': nextAttemptAt,
      if (lastError != null) 'last_error': lastError,
      if (serverAssetId != null) 'server_asset_id': serverAssetId,
      if (rowid != null) 'rowid': rowid,
    });
  }

  QueuedAssetsCompanion copyWith({
    Value<String>? localId,
    Value<String>? platform,
    Value<String>? kind,
    Value<int>? sizeBytes,
    Value<DateTime?>? takenAt,
    Value<String?>? sha256,
    Value<String?>? uploadId,
    Value<int?>? partSize,
    Value<int?>? partCount,
    Value<String>? state,
    Value<int>? attempts,
    Value<DateTime?>? nextAttemptAt,
    Value<String?>? lastError,
    Value<String?>? serverAssetId,
    Value<int>? rowid,
  }) {
    return QueuedAssetsCompanion(
      localId: localId ?? this.localId,
      platform: platform ?? this.platform,
      kind: kind ?? this.kind,
      sizeBytes: sizeBytes ?? this.sizeBytes,
      takenAt: takenAt ?? this.takenAt,
      sha256: sha256 ?? this.sha256,
      uploadId: uploadId ?? this.uploadId,
      partSize: partSize ?? this.partSize,
      partCount: partCount ?? this.partCount,
      state: state ?? this.state,
      attempts: attempts ?? this.attempts,
      nextAttemptAt: nextAttemptAt ?? this.nextAttemptAt,
      lastError: lastError ?? this.lastError,
      serverAssetId: serverAssetId ?? this.serverAssetId,
      rowid: rowid ?? this.rowid,
    );
  }

  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    if (localId.present) {
      map['local_id'] = Variable<String>(localId.value);
    }
    if (platform.present) {
      map['platform'] = Variable<String>(platform.value);
    }
    if (kind.present) {
      map['kind'] = Variable<String>(kind.value);
    }
    if (sizeBytes.present) {
      map['size_bytes'] = Variable<int>(sizeBytes.value);
    }
    if (takenAt.present) {
      map['taken_at'] = Variable<DateTime>(takenAt.value);
    }
    if (sha256.present) {
      map['sha256'] = Variable<String>(sha256.value);
    }
    if (uploadId.present) {
      map['upload_id'] = Variable<String>(uploadId.value);
    }
    if (partSize.present) {
      map['part_size'] = Variable<int>(partSize.value);
    }
    if (partCount.present) {
      map['part_count'] = Variable<int>(partCount.value);
    }
    if (state.present) {
      map['state'] = Variable<String>(state.value);
    }
    if (attempts.present) {
      map['attempts'] = Variable<int>(attempts.value);
    }
    if (nextAttemptAt.present) {
      map['next_attempt_at'] = Variable<DateTime>(nextAttemptAt.value);
    }
    if (lastError.present) {
      map['last_error'] = Variable<String>(lastError.value);
    }
    if (serverAssetId.present) {
      map['server_asset_id'] = Variable<String>(serverAssetId.value);
    }
    if (rowid.present) {
      map['rowid'] = Variable<int>(rowid.value);
    }
    return map;
  }

  @override
  String toString() {
    return (StringBuffer('QueuedAssetsCompanion(')
          ..write('localId: $localId, ')
          ..write('platform: $platform, ')
          ..write('kind: $kind, ')
          ..write('sizeBytes: $sizeBytes, ')
          ..write('takenAt: $takenAt, ')
          ..write('sha256: $sha256, ')
          ..write('uploadId: $uploadId, ')
          ..write('partSize: $partSize, ')
          ..write('partCount: $partCount, ')
          ..write('state: $state, ')
          ..write('attempts: $attempts, ')
          ..write('nextAttemptAt: $nextAttemptAt, ')
          ..write('lastError: $lastError, ')
          ..write('serverAssetId: $serverAssetId, ')
          ..write('rowid: $rowid')
          ..write(')'))
        .toString();
  }
}

class $UploadPartsTable extends UploadParts
    with TableInfo<$UploadPartsTable, UploadPart> {
  @override
  final GeneratedDatabase attachedDatabase;
  final String? _alias;
  $UploadPartsTable(this.attachedDatabase, [this._alias]);
  static const VerificationMeta _uploadIdMeta = const VerificationMeta(
    'uploadId',
  );
  @override
  late final GeneratedColumn<String> uploadId = GeneratedColumn<String>(
    'upload_id',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _partIndexMeta = const VerificationMeta(
    'partIndex',
  );
  @override
  late final GeneratedColumn<int> partIndex = GeneratedColumn<int>(
    'part_index',
    aliasedName,
    false,
    type: DriftSqlType.int,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _bytesMeta = const VerificationMeta('bytes');
  @override
  late final GeneratedColumn<int> bytes = GeneratedColumn<int>(
    'bytes',
    aliasedName,
    false,
    type: DriftSqlType.int,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _sha256Meta = const VerificationMeta('sha256');
  @override
  late final GeneratedColumn<String> sha256 = GeneratedColumn<String>(
    'sha256',
    aliasedName,
    true,
    type: DriftSqlType.string,
    requiredDuringInsert: false,
  );
  @override
  List<GeneratedColumn> get $columns => [uploadId, partIndex, bytes, sha256];
  @override
  String get aliasedName => _alias ?? actualTableName;
  @override
  String get actualTableName => $name;
  static const String $name = 'upload_parts';
  @override
  VerificationContext validateIntegrity(
    Insertable<UploadPart> instance, {
    bool isInserting = false,
  }) {
    final context = VerificationContext();
    final data = instance.toColumns(true);
    if (data.containsKey('upload_id')) {
      context.handle(
        _uploadIdMeta,
        uploadId.isAcceptableOrUnknown(data['upload_id']!, _uploadIdMeta),
      );
    } else if (isInserting) {
      context.missing(_uploadIdMeta);
    }
    if (data.containsKey('part_index')) {
      context.handle(
        _partIndexMeta,
        partIndex.isAcceptableOrUnknown(data['part_index']!, _partIndexMeta),
      );
    } else if (isInserting) {
      context.missing(_partIndexMeta);
    }
    if (data.containsKey('bytes')) {
      context.handle(
        _bytesMeta,
        bytes.isAcceptableOrUnknown(data['bytes']!, _bytesMeta),
      );
    } else if (isInserting) {
      context.missing(_bytesMeta);
    }
    if (data.containsKey('sha256')) {
      context.handle(
        _sha256Meta,
        sha256.isAcceptableOrUnknown(data['sha256']!, _sha256Meta),
      );
    }
    return context;
  }

  @override
  Set<GeneratedColumn> get $primaryKey => {uploadId, partIndex};
  @override
  UploadPart map(Map<String, dynamic> data, {String? tablePrefix}) {
    final effectivePrefix = tablePrefix != null ? '$tablePrefix.' : '';
    return UploadPart(
      uploadId: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}upload_id'],
      )!,
      partIndex: attachedDatabase.typeMapping.read(
        DriftSqlType.int,
        data['${effectivePrefix}part_index'],
      )!,
      bytes: attachedDatabase.typeMapping.read(
        DriftSqlType.int,
        data['${effectivePrefix}bytes'],
      )!,
      sha256: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}sha256'],
      ),
    );
  }

  @override
  $UploadPartsTable createAlias(String alias) {
    return $UploadPartsTable(attachedDatabase, alias);
  }
}

class UploadPart extends DataClass implements Insertable<UploadPart> {
  final String uploadId;
  final int partIndex;
  final int bytes;
  final String? sha256;
  const UploadPart({
    required this.uploadId,
    required this.partIndex,
    required this.bytes,
    this.sha256,
  });
  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    map['upload_id'] = Variable<String>(uploadId);
    map['part_index'] = Variable<int>(partIndex);
    map['bytes'] = Variable<int>(bytes);
    if (!nullToAbsent || sha256 != null) {
      map['sha256'] = Variable<String>(sha256);
    }
    return map;
  }

  UploadPartsCompanion toCompanion(bool nullToAbsent) {
    return UploadPartsCompanion(
      uploadId: Value(uploadId),
      partIndex: Value(partIndex),
      bytes: Value(bytes),
      sha256: sha256 == null && nullToAbsent
          ? const Value.absent()
          : Value(sha256),
    );
  }

  factory UploadPart.fromJson(
    Map<String, dynamic> json, {
    ValueSerializer? serializer,
  }) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return UploadPart(
      uploadId: serializer.fromJson<String>(json['uploadId']),
      partIndex: serializer.fromJson<int>(json['partIndex']),
      bytes: serializer.fromJson<int>(json['bytes']),
      sha256: serializer.fromJson<String?>(json['sha256']),
    );
  }
  @override
  Map<String, dynamic> toJson({ValueSerializer? serializer}) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return <String, dynamic>{
      'uploadId': serializer.toJson<String>(uploadId),
      'partIndex': serializer.toJson<int>(partIndex),
      'bytes': serializer.toJson<int>(bytes),
      'sha256': serializer.toJson<String?>(sha256),
    };
  }

  UploadPart copyWith({
    String? uploadId,
    int? partIndex,
    int? bytes,
    Value<String?> sha256 = const Value.absent(),
  }) => UploadPart(
    uploadId: uploadId ?? this.uploadId,
    partIndex: partIndex ?? this.partIndex,
    bytes: bytes ?? this.bytes,
    sha256: sha256.present ? sha256.value : this.sha256,
  );
  UploadPart copyWithCompanion(UploadPartsCompanion data) {
    return UploadPart(
      uploadId: data.uploadId.present ? data.uploadId.value : this.uploadId,
      partIndex: data.partIndex.present ? data.partIndex.value : this.partIndex,
      bytes: data.bytes.present ? data.bytes.value : this.bytes,
      sha256: data.sha256.present ? data.sha256.value : this.sha256,
    );
  }

  @override
  String toString() {
    return (StringBuffer('UploadPart(')
          ..write('uploadId: $uploadId, ')
          ..write('partIndex: $partIndex, ')
          ..write('bytes: $bytes, ')
          ..write('sha256: $sha256')
          ..write(')'))
        .toString();
  }

  @override
  int get hashCode => Object.hash(uploadId, partIndex, bytes, sha256);
  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      (other is UploadPart &&
          other.uploadId == this.uploadId &&
          other.partIndex == this.partIndex &&
          other.bytes == this.bytes &&
          other.sha256 == this.sha256);
}

class UploadPartsCompanion extends UpdateCompanion<UploadPart> {
  final Value<String> uploadId;
  final Value<int> partIndex;
  final Value<int> bytes;
  final Value<String?> sha256;
  final Value<int> rowid;
  const UploadPartsCompanion({
    this.uploadId = const Value.absent(),
    this.partIndex = const Value.absent(),
    this.bytes = const Value.absent(),
    this.sha256 = const Value.absent(),
    this.rowid = const Value.absent(),
  });
  UploadPartsCompanion.insert({
    required String uploadId,
    required int partIndex,
    required int bytes,
    this.sha256 = const Value.absent(),
    this.rowid = const Value.absent(),
  }) : uploadId = Value(uploadId),
       partIndex = Value(partIndex),
       bytes = Value(bytes);
  static Insertable<UploadPart> custom({
    Expression<String>? uploadId,
    Expression<int>? partIndex,
    Expression<int>? bytes,
    Expression<String>? sha256,
    Expression<int>? rowid,
  }) {
    return RawValuesInsertable({
      if (uploadId != null) 'upload_id': uploadId,
      if (partIndex != null) 'part_index': partIndex,
      if (bytes != null) 'bytes': bytes,
      if (sha256 != null) 'sha256': sha256,
      if (rowid != null) 'rowid': rowid,
    });
  }

  UploadPartsCompanion copyWith({
    Value<String>? uploadId,
    Value<int>? partIndex,
    Value<int>? bytes,
    Value<String?>? sha256,
    Value<int>? rowid,
  }) {
    return UploadPartsCompanion(
      uploadId: uploadId ?? this.uploadId,
      partIndex: partIndex ?? this.partIndex,
      bytes: bytes ?? this.bytes,
      sha256: sha256 ?? this.sha256,
      rowid: rowid ?? this.rowid,
    );
  }

  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    if (uploadId.present) {
      map['upload_id'] = Variable<String>(uploadId.value);
    }
    if (partIndex.present) {
      map['part_index'] = Variable<int>(partIndex.value);
    }
    if (bytes.present) {
      map['bytes'] = Variable<int>(bytes.value);
    }
    if (sha256.present) {
      map['sha256'] = Variable<String>(sha256.value);
    }
    if (rowid.present) {
      map['rowid'] = Variable<int>(rowid.value);
    }
    return map;
  }

  @override
  String toString() {
    return (StringBuffer('UploadPartsCompanion(')
          ..write('uploadId: $uploadId, ')
          ..write('partIndex: $partIndex, ')
          ..write('bytes: $bytes, ')
          ..write('sha256: $sha256, ')
          ..write('rowid: $rowid')
          ..write(')'))
        .toString();
  }
}

abstract class _$AppDatabase extends GeneratedDatabase {
  _$AppDatabase(QueryExecutor e) : super(e);
  $AppDatabaseManager get managers => $AppDatabaseManager(this);
  late final $QueuedAssetsTable queuedAssets = $QueuedAssetsTable(this);
  late final $UploadPartsTable uploadParts = $UploadPartsTable(this);
  @override
  Iterable<TableInfo<Table, Object?>> get allTables =>
      allSchemaEntities.whereType<TableInfo<Table, Object?>>();
  @override
  List<DatabaseSchemaEntity> get allSchemaEntities => [
    queuedAssets,
    uploadParts,
  ];
}

typedef $$QueuedAssetsTableCreateCompanionBuilder =
    QueuedAssetsCompanion Function({
      required String localId,
      required String platform,
      required String kind,
      required int sizeBytes,
      Value<DateTime?> takenAt,
      Value<String?> sha256,
      Value<String?> uploadId,
      Value<int?> partSize,
      Value<int?> partCount,
      required String state,
      Value<int> attempts,
      Value<DateTime?> nextAttemptAt,
      Value<String?> lastError,
      Value<String?> serverAssetId,
      Value<int> rowid,
    });
typedef $$QueuedAssetsTableUpdateCompanionBuilder =
    QueuedAssetsCompanion Function({
      Value<String> localId,
      Value<String> platform,
      Value<String> kind,
      Value<int> sizeBytes,
      Value<DateTime?> takenAt,
      Value<String?> sha256,
      Value<String?> uploadId,
      Value<int?> partSize,
      Value<int?> partCount,
      Value<String> state,
      Value<int> attempts,
      Value<DateTime?> nextAttemptAt,
      Value<String?> lastError,
      Value<String?> serverAssetId,
      Value<int> rowid,
    });

class $$QueuedAssetsTableFilterComposer
    extends Composer<_$AppDatabase, $QueuedAssetsTable> {
  $$QueuedAssetsTableFilterComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnFilters<String> get localId => $composableBuilder(
    column: $table.localId,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get platform => $composableBuilder(
    column: $table.platform,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get kind => $composableBuilder(
    column: $table.kind,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<int> get sizeBytes => $composableBuilder(
    column: $table.sizeBytes,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<DateTime> get takenAt => $composableBuilder(
    column: $table.takenAt,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get sha256 => $composableBuilder(
    column: $table.sha256,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get uploadId => $composableBuilder(
    column: $table.uploadId,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<int> get partSize => $composableBuilder(
    column: $table.partSize,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<int> get partCount => $composableBuilder(
    column: $table.partCount,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get state => $composableBuilder(
    column: $table.state,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<int> get attempts => $composableBuilder(
    column: $table.attempts,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<DateTime> get nextAttemptAt => $composableBuilder(
    column: $table.nextAttemptAt,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get lastError => $composableBuilder(
    column: $table.lastError,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get serverAssetId => $composableBuilder(
    column: $table.serverAssetId,
    builder: (column) => ColumnFilters(column),
  );
}

class $$QueuedAssetsTableOrderingComposer
    extends Composer<_$AppDatabase, $QueuedAssetsTable> {
  $$QueuedAssetsTableOrderingComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnOrderings<String> get localId => $composableBuilder(
    column: $table.localId,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get platform => $composableBuilder(
    column: $table.platform,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get kind => $composableBuilder(
    column: $table.kind,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<int> get sizeBytes => $composableBuilder(
    column: $table.sizeBytes,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<DateTime> get takenAt => $composableBuilder(
    column: $table.takenAt,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get sha256 => $composableBuilder(
    column: $table.sha256,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get uploadId => $composableBuilder(
    column: $table.uploadId,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<int> get partSize => $composableBuilder(
    column: $table.partSize,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<int> get partCount => $composableBuilder(
    column: $table.partCount,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get state => $composableBuilder(
    column: $table.state,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<int> get attempts => $composableBuilder(
    column: $table.attempts,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<DateTime> get nextAttemptAt => $composableBuilder(
    column: $table.nextAttemptAt,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get lastError => $composableBuilder(
    column: $table.lastError,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get serverAssetId => $composableBuilder(
    column: $table.serverAssetId,
    builder: (column) => ColumnOrderings(column),
  );
}

class $$QueuedAssetsTableAnnotationComposer
    extends Composer<_$AppDatabase, $QueuedAssetsTable> {
  $$QueuedAssetsTableAnnotationComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  GeneratedColumn<String> get localId =>
      $composableBuilder(column: $table.localId, builder: (column) => column);

  GeneratedColumn<String> get platform =>
      $composableBuilder(column: $table.platform, builder: (column) => column);

  GeneratedColumn<String> get kind =>
      $composableBuilder(column: $table.kind, builder: (column) => column);

  GeneratedColumn<int> get sizeBytes =>
      $composableBuilder(column: $table.sizeBytes, builder: (column) => column);

  GeneratedColumn<DateTime> get takenAt =>
      $composableBuilder(column: $table.takenAt, builder: (column) => column);

  GeneratedColumn<String> get sha256 =>
      $composableBuilder(column: $table.sha256, builder: (column) => column);

  GeneratedColumn<String> get uploadId =>
      $composableBuilder(column: $table.uploadId, builder: (column) => column);

  GeneratedColumn<int> get partSize =>
      $composableBuilder(column: $table.partSize, builder: (column) => column);

  GeneratedColumn<int> get partCount =>
      $composableBuilder(column: $table.partCount, builder: (column) => column);

  GeneratedColumn<String> get state =>
      $composableBuilder(column: $table.state, builder: (column) => column);

  GeneratedColumn<int> get attempts =>
      $composableBuilder(column: $table.attempts, builder: (column) => column);

  GeneratedColumn<DateTime> get nextAttemptAt => $composableBuilder(
    column: $table.nextAttemptAt,
    builder: (column) => column,
  );

  GeneratedColumn<String> get lastError =>
      $composableBuilder(column: $table.lastError, builder: (column) => column);

  GeneratedColumn<String> get serverAssetId => $composableBuilder(
    column: $table.serverAssetId,
    builder: (column) => column,
  );
}

class $$QueuedAssetsTableTableManager
    extends
        RootTableManager<
          _$AppDatabase,
          $QueuedAssetsTable,
          QueuedAsset,
          $$QueuedAssetsTableFilterComposer,
          $$QueuedAssetsTableOrderingComposer,
          $$QueuedAssetsTableAnnotationComposer,
          $$QueuedAssetsTableCreateCompanionBuilder,
          $$QueuedAssetsTableUpdateCompanionBuilder,
          (
            QueuedAsset,
            BaseReferences<_$AppDatabase, $QueuedAssetsTable, QueuedAsset>,
          ),
          QueuedAsset,
          PrefetchHooks Function()
        > {
  $$QueuedAssetsTableTableManager(_$AppDatabase db, $QueuedAssetsTable table)
    : super(
        TableManagerState(
          db: db,
          table: table,
          createFilteringComposer: () =>
              $$QueuedAssetsTableFilterComposer($db: db, $table: table),
          createOrderingComposer: () =>
              $$QueuedAssetsTableOrderingComposer($db: db, $table: table),
          createComputedFieldComposer: () =>
              $$QueuedAssetsTableAnnotationComposer($db: db, $table: table),
          updateCompanionCallback:
              ({
                Value<String> localId = const Value.absent(),
                Value<String> platform = const Value.absent(),
                Value<String> kind = const Value.absent(),
                Value<int> sizeBytes = const Value.absent(),
                Value<DateTime?> takenAt = const Value.absent(),
                Value<String?> sha256 = const Value.absent(),
                Value<String?> uploadId = const Value.absent(),
                Value<int?> partSize = const Value.absent(),
                Value<int?> partCount = const Value.absent(),
                Value<String> state = const Value.absent(),
                Value<int> attempts = const Value.absent(),
                Value<DateTime?> nextAttemptAt = const Value.absent(),
                Value<String?> lastError = const Value.absent(),
                Value<String?> serverAssetId = const Value.absent(),
                Value<int> rowid = const Value.absent(),
              }) => QueuedAssetsCompanion(
                localId: localId,
                platform: platform,
                kind: kind,
                sizeBytes: sizeBytes,
                takenAt: takenAt,
                sha256: sha256,
                uploadId: uploadId,
                partSize: partSize,
                partCount: partCount,
                state: state,
                attempts: attempts,
                nextAttemptAt: nextAttemptAt,
                lastError: lastError,
                serverAssetId: serverAssetId,
                rowid: rowid,
              ),
          createCompanionCallback:
              ({
                required String localId,
                required String platform,
                required String kind,
                required int sizeBytes,
                Value<DateTime?> takenAt = const Value.absent(),
                Value<String?> sha256 = const Value.absent(),
                Value<String?> uploadId = const Value.absent(),
                Value<int?> partSize = const Value.absent(),
                Value<int?> partCount = const Value.absent(),
                required String state,
                Value<int> attempts = const Value.absent(),
                Value<DateTime?> nextAttemptAt = const Value.absent(),
                Value<String?> lastError = const Value.absent(),
                Value<String?> serverAssetId = const Value.absent(),
                Value<int> rowid = const Value.absent(),
              }) => QueuedAssetsCompanion.insert(
                localId: localId,
                platform: platform,
                kind: kind,
                sizeBytes: sizeBytes,
                takenAt: takenAt,
                sha256: sha256,
                uploadId: uploadId,
                partSize: partSize,
                partCount: partCount,
                state: state,
                attempts: attempts,
                nextAttemptAt: nextAttemptAt,
                lastError: lastError,
                serverAssetId: serverAssetId,
                rowid: rowid,
              ),
          withReferenceMapper: (p0) => p0
              .map(
                (e) => (
                  e.readTable<$QueuedAssetsTable, QueuedAsset>(table),
                  BaseReferences<
                    _$AppDatabase,
                    $QueuedAssetsTable,
                    QueuedAsset
                  >(db, table, e),
                ),
              )
              .toList(),
          prefetchHooksCallback: null,
        ),
      );
}

typedef $$QueuedAssetsTableProcessedTableManager =
    ProcessedTableManager<
      _$AppDatabase,
      $QueuedAssetsTable,
      QueuedAsset,
      $$QueuedAssetsTableFilterComposer,
      $$QueuedAssetsTableOrderingComposer,
      $$QueuedAssetsTableAnnotationComposer,
      $$QueuedAssetsTableCreateCompanionBuilder,
      $$QueuedAssetsTableUpdateCompanionBuilder,
      (
        QueuedAsset,
        BaseReferences<_$AppDatabase, $QueuedAssetsTable, QueuedAsset>,
      ),
      QueuedAsset,
      PrefetchHooks Function()
    >;
typedef $$UploadPartsTableCreateCompanionBuilder =
    UploadPartsCompanion Function({
      required String uploadId,
      required int partIndex,
      required int bytes,
      Value<String?> sha256,
      Value<int> rowid,
    });
typedef $$UploadPartsTableUpdateCompanionBuilder =
    UploadPartsCompanion Function({
      Value<String> uploadId,
      Value<int> partIndex,
      Value<int> bytes,
      Value<String?> sha256,
      Value<int> rowid,
    });

class $$UploadPartsTableFilterComposer
    extends Composer<_$AppDatabase, $UploadPartsTable> {
  $$UploadPartsTableFilterComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnFilters<String> get uploadId => $composableBuilder(
    column: $table.uploadId,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<int> get partIndex => $composableBuilder(
    column: $table.partIndex,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<int> get bytes => $composableBuilder(
    column: $table.bytes,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get sha256 => $composableBuilder(
    column: $table.sha256,
    builder: (column) => ColumnFilters(column),
  );
}

class $$UploadPartsTableOrderingComposer
    extends Composer<_$AppDatabase, $UploadPartsTable> {
  $$UploadPartsTableOrderingComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnOrderings<String> get uploadId => $composableBuilder(
    column: $table.uploadId,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<int> get partIndex => $composableBuilder(
    column: $table.partIndex,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<int> get bytes => $composableBuilder(
    column: $table.bytes,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get sha256 => $composableBuilder(
    column: $table.sha256,
    builder: (column) => ColumnOrderings(column),
  );
}

class $$UploadPartsTableAnnotationComposer
    extends Composer<_$AppDatabase, $UploadPartsTable> {
  $$UploadPartsTableAnnotationComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  GeneratedColumn<String> get uploadId =>
      $composableBuilder(column: $table.uploadId, builder: (column) => column);

  GeneratedColumn<int> get partIndex =>
      $composableBuilder(column: $table.partIndex, builder: (column) => column);

  GeneratedColumn<int> get bytes =>
      $composableBuilder(column: $table.bytes, builder: (column) => column);

  GeneratedColumn<String> get sha256 =>
      $composableBuilder(column: $table.sha256, builder: (column) => column);
}

class $$UploadPartsTableTableManager
    extends
        RootTableManager<
          _$AppDatabase,
          $UploadPartsTable,
          UploadPart,
          $$UploadPartsTableFilterComposer,
          $$UploadPartsTableOrderingComposer,
          $$UploadPartsTableAnnotationComposer,
          $$UploadPartsTableCreateCompanionBuilder,
          $$UploadPartsTableUpdateCompanionBuilder,
          (
            UploadPart,
            BaseReferences<_$AppDatabase, $UploadPartsTable, UploadPart>,
          ),
          UploadPart,
          PrefetchHooks Function()
        > {
  $$UploadPartsTableTableManager(_$AppDatabase db, $UploadPartsTable table)
    : super(
        TableManagerState(
          db: db,
          table: table,
          createFilteringComposer: () =>
              $$UploadPartsTableFilterComposer($db: db, $table: table),
          createOrderingComposer: () =>
              $$UploadPartsTableOrderingComposer($db: db, $table: table),
          createComputedFieldComposer: () =>
              $$UploadPartsTableAnnotationComposer($db: db, $table: table),
          updateCompanionCallback:
              ({
                Value<String> uploadId = const Value.absent(),
                Value<int> partIndex = const Value.absent(),
                Value<int> bytes = const Value.absent(),
                Value<String?> sha256 = const Value.absent(),
                Value<int> rowid = const Value.absent(),
              }) => UploadPartsCompanion(
                uploadId: uploadId,
                partIndex: partIndex,
                bytes: bytes,
                sha256: sha256,
                rowid: rowid,
              ),
          createCompanionCallback:
              ({
                required String uploadId,
                required int partIndex,
                required int bytes,
                Value<String?> sha256 = const Value.absent(),
                Value<int> rowid = const Value.absent(),
              }) => UploadPartsCompanion.insert(
                uploadId: uploadId,
                partIndex: partIndex,
                bytes: bytes,
                sha256: sha256,
                rowid: rowid,
              ),
          withReferenceMapper: (p0) => p0
              .map(
                (e) => (
                  e.readTable<$UploadPartsTable, UploadPart>(table),
                  BaseReferences<_$AppDatabase, $UploadPartsTable, UploadPart>(
                    db,
                    table,
                    e,
                  ),
                ),
              )
              .toList(),
          prefetchHooksCallback: null,
        ),
      );
}

typedef $$UploadPartsTableProcessedTableManager =
    ProcessedTableManager<
      _$AppDatabase,
      $UploadPartsTable,
      UploadPart,
      $$UploadPartsTableFilterComposer,
      $$UploadPartsTableOrderingComposer,
      $$UploadPartsTableAnnotationComposer,
      $$UploadPartsTableCreateCompanionBuilder,
      $$UploadPartsTableUpdateCompanionBuilder,
      (
        UploadPart,
        BaseReferences<_$AppDatabase, $UploadPartsTable, UploadPart>,
      ),
      UploadPart,
      PrefetchHooks Function()
    >;

class $AppDatabaseManager {
  final _$AppDatabase _db;
  $AppDatabaseManager(this._db);
  $$QueuedAssetsTableTableManager get queuedAssets =>
      $$QueuedAssetsTableTableManager(_db, _db.queuedAssets);
  $$UploadPartsTableTableManager get uploadParts =>
      $$UploadPartsTableTableManager(_db, _db.uploadParts);
}
