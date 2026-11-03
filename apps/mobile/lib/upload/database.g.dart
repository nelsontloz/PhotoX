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
  static const VerificationMeta _fileNameMeta = const VerificationMeta(
    'fileName',
  );
  @override
  late final GeneratedColumn<String> fileName = GeneratedColumn<String>(
    'file_name',
    aliasedName,
    true,
    type: DriftSqlType.string,
    requiredDuringInsert: false,
  );
  static const VerificationMeta _mimeTypeMeta = const VerificationMeta(
    'mimeType',
  );
  @override
  late final GeneratedColumn<String> mimeType = GeneratedColumn<String>(
    'mime_type',
    aliasedName,
    true,
    type: DriftSqlType.string,
    requiredDuringInsert: false,
  );
  static const VerificationMeta _modifiedAtMeta = const VerificationMeta(
    'modifiedAt',
  );
  @override
  late final GeneratedColumn<DateTime> modifiedAt = GeneratedColumn<DateTime>(
    'modified_at',
    aliasedName,
    true,
    type: DriftSqlType.dateTime,
    requiredDuringInsert: false,
  );
  static const VerificationMeta _spoolPathMeta = const VerificationMeta(
    'spoolPath',
  );
  @override
  late final GeneratedColumn<String> spoolPath = GeneratedColumn<String>(
    'spool_path',
    aliasedName,
    true,
    type: DriftSqlType.string,
    requiredDuringInsert: false,
  );
  static const VerificationMeta _protocolMeta = const VerificationMeta(
    'protocol',
  );
  @override
  late final GeneratedColumn<String> protocol = GeneratedColumn<String>(
    'protocol',
    aliasedName,
    true,
    type: DriftSqlType.string,
    requiredDuringInsert: false,
  );
  static const VerificationMeta _errorCodeMeta = const VerificationMeta(
    'errorCode',
  );
  @override
  late final GeneratedColumn<String> errorCode = GeneratedColumn<String>(
    'error_code',
    aliasedName,
    true,
    type: DriftSqlType.string,
    requiredDuringInsert: false,
  );
  static const VerificationMeta _serverFileIdMeta = const VerificationMeta(
    'serverFileId',
  );
  @override
  late final GeneratedColumn<String> serverFileId = GeneratedColumn<String>(
    'server_file_id',
    aliasedName,
    true,
    type: DriftSqlType.string,
    requiredDuringInsert: false,
  );
  static const VerificationMeta _discoveredAtMeta = const VerificationMeta(
    'discoveredAt',
  );
  @override
  late final GeneratedColumn<DateTime> discoveredAt = GeneratedColumn<DateTime>(
    'discovered_at',
    aliasedName,
    true,
    type: DriftSqlType.dateTime,
    requiredDuringInsert: false,
  );
  static const VerificationMeta _lastAttemptAtMeta = const VerificationMeta(
    'lastAttemptAt',
  );
  @override
  late final GeneratedColumn<DateTime> lastAttemptAt =
      GeneratedColumn<DateTime>(
        'last_attempt_at',
        aliasedName,
        true,
        type: DriftSqlType.dateTime,
        requiredDuringInsert: false,
      );
  static const VerificationMeta _folderIdMeta = const VerificationMeta(
    'folderId',
  );
  @override
  late final GeneratedColumn<String> folderId = GeneratedColumn<String>(
    'folder_id',
    aliasedName,
    true,
    type: DriftSqlType.string,
    requiredDuringInsert: false,
  );
  static const VerificationMeta _albumLinkedAtMeta = const VerificationMeta(
    'albumLinkedAt',
  );
  @override
  late final GeneratedColumn<DateTime> albumLinkedAt =
      GeneratedColumn<DateTime>(
        'album_linked_at',
        aliasedName,
        true,
        type: DriftSqlType.dateTime,
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
    fileName,
    mimeType,
    modifiedAt,
    spoolPath,
    protocol,
    errorCode,
    serverFileId,
    discoveredAt,
    lastAttemptAt,
    folderId,
    albumLinkedAt,
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
    if (data.containsKey('file_name')) {
      context.handle(
        _fileNameMeta,
        fileName.isAcceptableOrUnknown(data['file_name']!, _fileNameMeta),
      );
    }
    if (data.containsKey('mime_type')) {
      context.handle(
        _mimeTypeMeta,
        mimeType.isAcceptableOrUnknown(data['mime_type']!, _mimeTypeMeta),
      );
    }
    if (data.containsKey('modified_at')) {
      context.handle(
        _modifiedAtMeta,
        modifiedAt.isAcceptableOrUnknown(data['modified_at']!, _modifiedAtMeta),
      );
    }
    if (data.containsKey('spool_path')) {
      context.handle(
        _spoolPathMeta,
        spoolPath.isAcceptableOrUnknown(data['spool_path']!, _spoolPathMeta),
      );
    }
    if (data.containsKey('protocol')) {
      context.handle(
        _protocolMeta,
        protocol.isAcceptableOrUnknown(data['protocol']!, _protocolMeta),
      );
    }
    if (data.containsKey('error_code')) {
      context.handle(
        _errorCodeMeta,
        errorCode.isAcceptableOrUnknown(data['error_code']!, _errorCodeMeta),
      );
    }
    if (data.containsKey('server_file_id')) {
      context.handle(
        _serverFileIdMeta,
        serverFileId.isAcceptableOrUnknown(
          data['server_file_id']!,
          _serverFileIdMeta,
        ),
      );
    }
    if (data.containsKey('discovered_at')) {
      context.handle(
        _discoveredAtMeta,
        discoveredAt.isAcceptableOrUnknown(
          data['discovered_at']!,
          _discoveredAtMeta,
        ),
      );
    }
    if (data.containsKey('last_attempt_at')) {
      context.handle(
        _lastAttemptAtMeta,
        lastAttemptAt.isAcceptableOrUnknown(
          data['last_attempt_at']!,
          _lastAttemptAtMeta,
        ),
      );
    }
    if (data.containsKey('folder_id')) {
      context.handle(
        _folderIdMeta,
        folderId.isAcceptableOrUnknown(data['folder_id']!, _folderIdMeta),
      );
    }
    if (data.containsKey('album_linked_at')) {
      context.handle(
        _albumLinkedAtMeta,
        albumLinkedAt.isAcceptableOrUnknown(
          data['album_linked_at']!,
          _albumLinkedAtMeta,
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
      fileName: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}file_name'],
      ),
      mimeType: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}mime_type'],
      ),
      modifiedAt: attachedDatabase.typeMapping.read(
        DriftSqlType.dateTime,
        data['${effectivePrefix}modified_at'],
      ),
      spoolPath: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}spool_path'],
      ),
      protocol: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}protocol'],
      ),
      errorCode: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}error_code'],
      ),
      serverFileId: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}server_file_id'],
      ),
      discoveredAt: attachedDatabase.typeMapping.read(
        DriftSqlType.dateTime,
        data['${effectivePrefix}discovered_at'],
      ),
      lastAttemptAt: attachedDatabase.typeMapping.read(
        DriftSqlType.dateTime,
        data['${effectivePrefix}last_attempt_at'],
      ),
      folderId: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}folder_id'],
      ),
      albumLinkedAt: attachedDatabase.typeMapping.read(
        DriftSqlType.dateTime,
        data['${effectivePrefix}album_linked_at'],
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
  final String? fileName;
  final String? mimeType;
  final DateTime? modifiedAt;
  final String? spoolPath;
  final String? protocol;
  final String? errorCode;
  final String? serverFileId;
  final DateTime? discoveredAt;
  final DateTime? lastAttemptAt;
  final String? folderId;
  final DateTime? albumLinkedAt;
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
    this.fileName,
    this.mimeType,
    this.modifiedAt,
    this.spoolPath,
    this.protocol,
    this.errorCode,
    this.serverFileId,
    this.discoveredAt,
    this.lastAttemptAt,
    this.folderId,
    this.albumLinkedAt,
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
    if (!nullToAbsent || fileName != null) {
      map['file_name'] = Variable<String>(fileName);
    }
    if (!nullToAbsent || mimeType != null) {
      map['mime_type'] = Variable<String>(mimeType);
    }
    if (!nullToAbsent || modifiedAt != null) {
      map['modified_at'] = Variable<DateTime>(modifiedAt);
    }
    if (!nullToAbsent || spoolPath != null) {
      map['spool_path'] = Variable<String>(spoolPath);
    }
    if (!nullToAbsent || protocol != null) {
      map['protocol'] = Variable<String>(protocol);
    }
    if (!nullToAbsent || errorCode != null) {
      map['error_code'] = Variable<String>(errorCode);
    }
    if (!nullToAbsent || serverFileId != null) {
      map['server_file_id'] = Variable<String>(serverFileId);
    }
    if (!nullToAbsent || discoveredAt != null) {
      map['discovered_at'] = Variable<DateTime>(discoveredAt);
    }
    if (!nullToAbsent || lastAttemptAt != null) {
      map['last_attempt_at'] = Variable<DateTime>(lastAttemptAt);
    }
    if (!nullToAbsent || folderId != null) {
      map['folder_id'] = Variable<String>(folderId);
    }
    if (!nullToAbsent || albumLinkedAt != null) {
      map['album_linked_at'] = Variable<DateTime>(albumLinkedAt);
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
      fileName: fileName == null && nullToAbsent
          ? const Value.absent()
          : Value(fileName),
      mimeType: mimeType == null && nullToAbsent
          ? const Value.absent()
          : Value(mimeType),
      modifiedAt: modifiedAt == null && nullToAbsent
          ? const Value.absent()
          : Value(modifiedAt),
      spoolPath: spoolPath == null && nullToAbsent
          ? const Value.absent()
          : Value(spoolPath),
      protocol: protocol == null && nullToAbsent
          ? const Value.absent()
          : Value(protocol),
      errorCode: errorCode == null && nullToAbsent
          ? const Value.absent()
          : Value(errorCode),
      serverFileId: serverFileId == null && nullToAbsent
          ? const Value.absent()
          : Value(serverFileId),
      discoveredAt: discoveredAt == null && nullToAbsent
          ? const Value.absent()
          : Value(discoveredAt),
      lastAttemptAt: lastAttemptAt == null && nullToAbsent
          ? const Value.absent()
          : Value(lastAttemptAt),
      folderId: folderId == null && nullToAbsent
          ? const Value.absent()
          : Value(folderId),
      albumLinkedAt: albumLinkedAt == null && nullToAbsent
          ? const Value.absent()
          : Value(albumLinkedAt),
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
      fileName: serializer.fromJson<String?>(json['fileName']),
      mimeType: serializer.fromJson<String?>(json['mimeType']),
      modifiedAt: serializer.fromJson<DateTime?>(json['modifiedAt']),
      spoolPath: serializer.fromJson<String?>(json['spoolPath']),
      protocol: serializer.fromJson<String?>(json['protocol']),
      errorCode: serializer.fromJson<String?>(json['errorCode']),
      serverFileId: serializer.fromJson<String?>(json['serverFileId']),
      discoveredAt: serializer.fromJson<DateTime?>(json['discoveredAt']),
      lastAttemptAt: serializer.fromJson<DateTime?>(json['lastAttemptAt']),
      folderId: serializer.fromJson<String?>(json['folderId']),
      albumLinkedAt: serializer.fromJson<DateTime?>(json['albumLinkedAt']),
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
      'fileName': serializer.toJson<String?>(fileName),
      'mimeType': serializer.toJson<String?>(mimeType),
      'modifiedAt': serializer.toJson<DateTime?>(modifiedAt),
      'spoolPath': serializer.toJson<String?>(spoolPath),
      'protocol': serializer.toJson<String?>(protocol),
      'errorCode': serializer.toJson<String?>(errorCode),
      'serverFileId': serializer.toJson<String?>(serverFileId),
      'discoveredAt': serializer.toJson<DateTime?>(discoveredAt),
      'lastAttemptAt': serializer.toJson<DateTime?>(lastAttemptAt),
      'folderId': serializer.toJson<String?>(folderId),
      'albumLinkedAt': serializer.toJson<DateTime?>(albumLinkedAt),
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
    Value<String?> fileName = const Value.absent(),
    Value<String?> mimeType = const Value.absent(),
    Value<DateTime?> modifiedAt = const Value.absent(),
    Value<String?> spoolPath = const Value.absent(),
    Value<String?> protocol = const Value.absent(),
    Value<String?> errorCode = const Value.absent(),
    Value<String?> serverFileId = const Value.absent(),
    Value<DateTime?> discoveredAt = const Value.absent(),
    Value<DateTime?> lastAttemptAt = const Value.absent(),
    Value<String?> folderId = const Value.absent(),
    Value<DateTime?> albumLinkedAt = const Value.absent(),
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
    fileName: fileName.present ? fileName.value : this.fileName,
    mimeType: mimeType.present ? mimeType.value : this.mimeType,
    modifiedAt: modifiedAt.present ? modifiedAt.value : this.modifiedAt,
    spoolPath: spoolPath.present ? spoolPath.value : this.spoolPath,
    protocol: protocol.present ? protocol.value : this.protocol,
    errorCode: errorCode.present ? errorCode.value : this.errorCode,
    serverFileId: serverFileId.present ? serverFileId.value : this.serverFileId,
    discoveredAt: discoveredAt.present ? discoveredAt.value : this.discoveredAt,
    lastAttemptAt: lastAttemptAt.present
        ? lastAttemptAt.value
        : this.lastAttemptAt,
    folderId: folderId.present ? folderId.value : this.folderId,
    albumLinkedAt: albumLinkedAt.present
        ? albumLinkedAt.value
        : this.albumLinkedAt,
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
      fileName: data.fileName.present ? data.fileName.value : this.fileName,
      mimeType: data.mimeType.present ? data.mimeType.value : this.mimeType,
      modifiedAt: data.modifiedAt.present
          ? data.modifiedAt.value
          : this.modifiedAt,
      spoolPath: data.spoolPath.present ? data.spoolPath.value : this.spoolPath,
      protocol: data.protocol.present ? data.protocol.value : this.protocol,
      errorCode: data.errorCode.present ? data.errorCode.value : this.errorCode,
      serverFileId: data.serverFileId.present
          ? data.serverFileId.value
          : this.serverFileId,
      discoveredAt: data.discoveredAt.present
          ? data.discoveredAt.value
          : this.discoveredAt,
      lastAttemptAt: data.lastAttemptAt.present
          ? data.lastAttemptAt.value
          : this.lastAttemptAt,
      folderId: data.folderId.present ? data.folderId.value : this.folderId,
      albumLinkedAt: data.albumLinkedAt.present
          ? data.albumLinkedAt.value
          : this.albumLinkedAt,
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
          ..write('serverAssetId: $serverAssetId, ')
          ..write('fileName: $fileName, ')
          ..write('mimeType: $mimeType, ')
          ..write('modifiedAt: $modifiedAt, ')
          ..write('spoolPath: $spoolPath, ')
          ..write('protocol: $protocol, ')
          ..write('errorCode: $errorCode, ')
          ..write('serverFileId: $serverFileId, ')
          ..write('discoveredAt: $discoveredAt, ')
          ..write('lastAttemptAt: $lastAttemptAt, ')
          ..write('folderId: $folderId, ')
          ..write('albumLinkedAt: $albumLinkedAt')
          ..write(')'))
        .toString();
  }

  @override
  int get hashCode => Object.hashAll([
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
    fileName,
    mimeType,
    modifiedAt,
    spoolPath,
    protocol,
    errorCode,
    serverFileId,
    discoveredAt,
    lastAttemptAt,
    folderId,
    albumLinkedAt,
  ]);
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
          other.serverAssetId == this.serverAssetId &&
          other.fileName == this.fileName &&
          other.mimeType == this.mimeType &&
          other.modifiedAt == this.modifiedAt &&
          other.spoolPath == this.spoolPath &&
          other.protocol == this.protocol &&
          other.errorCode == this.errorCode &&
          other.serverFileId == this.serverFileId &&
          other.discoveredAt == this.discoveredAt &&
          other.lastAttemptAt == this.lastAttemptAt &&
          other.folderId == this.folderId &&
          other.albumLinkedAt == this.albumLinkedAt);
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
  final Value<String?> fileName;
  final Value<String?> mimeType;
  final Value<DateTime?> modifiedAt;
  final Value<String?> spoolPath;
  final Value<String?> protocol;
  final Value<String?> errorCode;
  final Value<String?> serverFileId;
  final Value<DateTime?> discoveredAt;
  final Value<DateTime?> lastAttemptAt;
  final Value<String?> folderId;
  final Value<DateTime?> albumLinkedAt;
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
    this.fileName = const Value.absent(),
    this.mimeType = const Value.absent(),
    this.modifiedAt = const Value.absent(),
    this.spoolPath = const Value.absent(),
    this.protocol = const Value.absent(),
    this.errorCode = const Value.absent(),
    this.serverFileId = const Value.absent(),
    this.discoveredAt = const Value.absent(),
    this.lastAttemptAt = const Value.absent(),
    this.folderId = const Value.absent(),
    this.albumLinkedAt = const Value.absent(),
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
    this.fileName = const Value.absent(),
    this.mimeType = const Value.absent(),
    this.modifiedAt = const Value.absent(),
    this.spoolPath = const Value.absent(),
    this.protocol = const Value.absent(),
    this.errorCode = const Value.absent(),
    this.serverFileId = const Value.absent(),
    this.discoveredAt = const Value.absent(),
    this.lastAttemptAt = const Value.absent(),
    this.folderId = const Value.absent(),
    this.albumLinkedAt = const Value.absent(),
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
    Expression<String>? fileName,
    Expression<String>? mimeType,
    Expression<DateTime>? modifiedAt,
    Expression<String>? spoolPath,
    Expression<String>? protocol,
    Expression<String>? errorCode,
    Expression<String>? serverFileId,
    Expression<DateTime>? discoveredAt,
    Expression<DateTime>? lastAttemptAt,
    Expression<String>? folderId,
    Expression<DateTime>? albumLinkedAt,
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
      if (fileName != null) 'file_name': fileName,
      if (mimeType != null) 'mime_type': mimeType,
      if (modifiedAt != null) 'modified_at': modifiedAt,
      if (spoolPath != null) 'spool_path': spoolPath,
      if (protocol != null) 'protocol': protocol,
      if (errorCode != null) 'error_code': errorCode,
      if (serverFileId != null) 'server_file_id': serverFileId,
      if (discoveredAt != null) 'discovered_at': discoveredAt,
      if (lastAttemptAt != null) 'last_attempt_at': lastAttemptAt,
      if (folderId != null) 'folder_id': folderId,
      if (albumLinkedAt != null) 'album_linked_at': albumLinkedAt,
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
    Value<String?>? fileName,
    Value<String?>? mimeType,
    Value<DateTime?>? modifiedAt,
    Value<String?>? spoolPath,
    Value<String?>? protocol,
    Value<String?>? errorCode,
    Value<String?>? serverFileId,
    Value<DateTime?>? discoveredAt,
    Value<DateTime?>? lastAttemptAt,
    Value<String?>? folderId,
    Value<DateTime?>? albumLinkedAt,
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
      fileName: fileName ?? this.fileName,
      mimeType: mimeType ?? this.mimeType,
      modifiedAt: modifiedAt ?? this.modifiedAt,
      spoolPath: spoolPath ?? this.spoolPath,
      protocol: protocol ?? this.protocol,
      errorCode: errorCode ?? this.errorCode,
      serverFileId: serverFileId ?? this.serverFileId,
      discoveredAt: discoveredAt ?? this.discoveredAt,
      lastAttemptAt: lastAttemptAt ?? this.lastAttemptAt,
      folderId: folderId ?? this.folderId,
      albumLinkedAt: albumLinkedAt ?? this.albumLinkedAt,
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
    if (fileName.present) {
      map['file_name'] = Variable<String>(fileName.value);
    }
    if (mimeType.present) {
      map['mime_type'] = Variable<String>(mimeType.value);
    }
    if (modifiedAt.present) {
      map['modified_at'] = Variable<DateTime>(modifiedAt.value);
    }
    if (spoolPath.present) {
      map['spool_path'] = Variable<String>(spoolPath.value);
    }
    if (protocol.present) {
      map['protocol'] = Variable<String>(protocol.value);
    }
    if (errorCode.present) {
      map['error_code'] = Variable<String>(errorCode.value);
    }
    if (serverFileId.present) {
      map['server_file_id'] = Variable<String>(serverFileId.value);
    }
    if (discoveredAt.present) {
      map['discovered_at'] = Variable<DateTime>(discoveredAt.value);
    }
    if (lastAttemptAt.present) {
      map['last_attempt_at'] = Variable<DateTime>(lastAttemptAt.value);
    }
    if (folderId.present) {
      map['folder_id'] = Variable<String>(folderId.value);
    }
    if (albumLinkedAt.present) {
      map['album_linked_at'] = Variable<DateTime>(albumLinkedAt.value);
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
          ..write('fileName: $fileName, ')
          ..write('mimeType: $mimeType, ')
          ..write('modifiedAt: $modifiedAt, ')
          ..write('spoolPath: $spoolPath, ')
          ..write('protocol: $protocol, ')
          ..write('errorCode: $errorCode, ')
          ..write('serverFileId: $serverFileId, ')
          ..write('discoveredAt: $discoveredAt, ')
          ..write('lastAttemptAt: $lastAttemptAt, ')
          ..write('folderId: $folderId, ')
          ..write('albumLinkedAt: $albumLinkedAt, ')
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
  static const VerificationMeta _acknowledgedAtMeta = const VerificationMeta(
    'acknowledgedAt',
  );
  @override
  late final GeneratedColumn<DateTime> acknowledgedAt =
      GeneratedColumn<DateTime>(
        'acknowledged_at',
        aliasedName,
        true,
        type: DriftSqlType.dateTime,
        requiredDuringInsert: false,
      );
  @override
  List<GeneratedColumn> get $columns => [
    uploadId,
    partIndex,
    bytes,
    sha256,
    acknowledgedAt,
  ];
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
    if (data.containsKey('acknowledged_at')) {
      context.handle(
        _acknowledgedAtMeta,
        acknowledgedAt.isAcceptableOrUnknown(
          data['acknowledged_at']!,
          _acknowledgedAtMeta,
        ),
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
      acknowledgedAt: attachedDatabase.typeMapping.read(
        DriftSqlType.dateTime,
        data['${effectivePrefix}acknowledged_at'],
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
  final DateTime? acknowledgedAt;
  const UploadPart({
    required this.uploadId,
    required this.partIndex,
    required this.bytes,
    this.sha256,
    this.acknowledgedAt,
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
    if (!nullToAbsent || acknowledgedAt != null) {
      map['acknowledged_at'] = Variable<DateTime>(acknowledgedAt);
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
      acknowledgedAt: acknowledgedAt == null && nullToAbsent
          ? const Value.absent()
          : Value(acknowledgedAt),
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
      acknowledgedAt: serializer.fromJson<DateTime?>(json['acknowledgedAt']),
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
      'acknowledgedAt': serializer.toJson<DateTime?>(acknowledgedAt),
    };
  }

  UploadPart copyWith({
    String? uploadId,
    int? partIndex,
    int? bytes,
    Value<String?> sha256 = const Value.absent(),
    Value<DateTime?> acknowledgedAt = const Value.absent(),
  }) => UploadPart(
    uploadId: uploadId ?? this.uploadId,
    partIndex: partIndex ?? this.partIndex,
    bytes: bytes ?? this.bytes,
    sha256: sha256.present ? sha256.value : this.sha256,
    acknowledgedAt: acknowledgedAt.present
        ? acknowledgedAt.value
        : this.acknowledgedAt,
  );
  UploadPart copyWithCompanion(UploadPartsCompanion data) {
    return UploadPart(
      uploadId: data.uploadId.present ? data.uploadId.value : this.uploadId,
      partIndex: data.partIndex.present ? data.partIndex.value : this.partIndex,
      bytes: data.bytes.present ? data.bytes.value : this.bytes,
      sha256: data.sha256.present ? data.sha256.value : this.sha256,
      acknowledgedAt: data.acknowledgedAt.present
          ? data.acknowledgedAt.value
          : this.acknowledgedAt,
    );
  }

  @override
  String toString() {
    return (StringBuffer('UploadPart(')
          ..write('uploadId: $uploadId, ')
          ..write('partIndex: $partIndex, ')
          ..write('bytes: $bytes, ')
          ..write('sha256: $sha256, ')
          ..write('acknowledgedAt: $acknowledgedAt')
          ..write(')'))
        .toString();
  }

  @override
  int get hashCode =>
      Object.hash(uploadId, partIndex, bytes, sha256, acknowledgedAt);
  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      (other is UploadPart &&
          other.uploadId == this.uploadId &&
          other.partIndex == this.partIndex &&
          other.bytes == this.bytes &&
          other.sha256 == this.sha256 &&
          other.acknowledgedAt == this.acknowledgedAt);
}

class UploadPartsCompanion extends UpdateCompanion<UploadPart> {
  final Value<String> uploadId;
  final Value<int> partIndex;
  final Value<int> bytes;
  final Value<String?> sha256;
  final Value<DateTime?> acknowledgedAt;
  final Value<int> rowid;
  const UploadPartsCompanion({
    this.uploadId = const Value.absent(),
    this.partIndex = const Value.absent(),
    this.bytes = const Value.absent(),
    this.sha256 = const Value.absent(),
    this.acknowledgedAt = const Value.absent(),
    this.rowid = const Value.absent(),
  });
  UploadPartsCompanion.insert({
    required String uploadId,
    required int partIndex,
    required int bytes,
    this.sha256 = const Value.absent(),
    this.acknowledgedAt = const Value.absent(),
    this.rowid = const Value.absent(),
  }) : uploadId = Value(uploadId),
       partIndex = Value(partIndex),
       bytes = Value(bytes);
  static Insertable<UploadPart> custom({
    Expression<String>? uploadId,
    Expression<int>? partIndex,
    Expression<int>? bytes,
    Expression<String>? sha256,
    Expression<DateTime>? acknowledgedAt,
    Expression<int>? rowid,
  }) {
    return RawValuesInsertable({
      if (uploadId != null) 'upload_id': uploadId,
      if (partIndex != null) 'part_index': partIndex,
      if (bytes != null) 'bytes': bytes,
      if (sha256 != null) 'sha256': sha256,
      if (acknowledgedAt != null) 'acknowledged_at': acknowledgedAt,
      if (rowid != null) 'rowid': rowid,
    });
  }

  UploadPartsCompanion copyWith({
    Value<String>? uploadId,
    Value<int>? partIndex,
    Value<int>? bytes,
    Value<String?>? sha256,
    Value<DateTime?>? acknowledgedAt,
    Value<int>? rowid,
  }) {
    return UploadPartsCompanion(
      uploadId: uploadId ?? this.uploadId,
      partIndex: partIndex ?? this.partIndex,
      bytes: bytes ?? this.bytes,
      sha256: sha256 ?? this.sha256,
      acknowledgedAt: acknowledgedAt ?? this.acknowledgedAt,
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
    if (acknowledgedAt.present) {
      map['acknowledged_at'] = Variable<DateTime>(acknowledgedAt.value);
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
          ..write('acknowledgedAt: $acknowledgedAt, ')
          ..write('rowid: $rowid')
          ..write(')'))
        .toString();
  }
}

class $KeyValuesTable extends KeyValues
    with TableInfo<$KeyValuesTable, KeyValue> {
  @override
  final GeneratedDatabase attachedDatabase;
  final String? _alias;
  $KeyValuesTable(this.attachedDatabase, [this._alias]);
  static const VerificationMeta _namespaceMeta = const VerificationMeta(
    'namespace',
  );
  @override
  late final GeneratedColumn<String> namespace = GeneratedColumn<String>(
    'namespace',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _keyMeta = const VerificationMeta('key');
  @override
  late final GeneratedColumn<String> key = GeneratedColumn<String>(
    'key',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _valueMeta = const VerificationMeta('value');
  @override
  late final GeneratedColumn<String> value = GeneratedColumn<String>(
    'value',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _updatedAtMeta = const VerificationMeta(
    'updatedAt',
  );
  @override
  late final GeneratedColumn<DateTime> updatedAt = GeneratedColumn<DateTime>(
    'updated_at',
    aliasedName,
    false,
    type: DriftSqlType.dateTime,
    requiredDuringInsert: true,
  );
  @override
  List<GeneratedColumn> get $columns => [namespace, key, value, updatedAt];
  @override
  String get aliasedName => _alias ?? actualTableName;
  @override
  String get actualTableName => $name;
  static const String $name = 'key_values';
  @override
  VerificationContext validateIntegrity(
    Insertable<KeyValue> instance, {
    bool isInserting = false,
  }) {
    final context = VerificationContext();
    final data = instance.toColumns(true);
    if (data.containsKey('namespace')) {
      context.handle(
        _namespaceMeta,
        namespace.isAcceptableOrUnknown(data['namespace']!, _namespaceMeta),
      );
    } else if (isInserting) {
      context.missing(_namespaceMeta);
    }
    if (data.containsKey('key')) {
      context.handle(
        _keyMeta,
        key.isAcceptableOrUnknown(data['key']!, _keyMeta),
      );
    } else if (isInserting) {
      context.missing(_keyMeta);
    }
    if (data.containsKey('value')) {
      context.handle(
        _valueMeta,
        value.isAcceptableOrUnknown(data['value']!, _valueMeta),
      );
    } else if (isInserting) {
      context.missing(_valueMeta);
    }
    if (data.containsKey('updated_at')) {
      context.handle(
        _updatedAtMeta,
        updatedAt.isAcceptableOrUnknown(data['updated_at']!, _updatedAtMeta),
      );
    } else if (isInserting) {
      context.missing(_updatedAtMeta);
    }
    return context;
  }

  @override
  Set<GeneratedColumn> get $primaryKey => {namespace, key};
  @override
  KeyValue map(Map<String, dynamic> data, {String? tablePrefix}) {
    final effectivePrefix = tablePrefix != null ? '$tablePrefix.' : '';
    return KeyValue(
      namespace: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}namespace'],
      )!,
      key: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}key'],
      )!,
      value: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}value'],
      )!,
      updatedAt: attachedDatabase.typeMapping.read(
        DriftSqlType.dateTime,
        data['${effectivePrefix}updated_at'],
      )!,
    );
  }

  @override
  $KeyValuesTable createAlias(String alias) {
    return $KeyValuesTable(attachedDatabase, alias);
  }
}

class KeyValue extends DataClass implements Insertable<KeyValue> {
  final String namespace;
  final String key;
  final String value;
  final DateTime updatedAt;
  const KeyValue({
    required this.namespace,
    required this.key,
    required this.value,
    required this.updatedAt,
  });
  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    map['namespace'] = Variable<String>(namespace);
    map['key'] = Variable<String>(key);
    map['value'] = Variable<String>(value);
    map['updated_at'] = Variable<DateTime>(updatedAt);
    return map;
  }

  KeyValuesCompanion toCompanion(bool nullToAbsent) {
    return KeyValuesCompanion(
      namespace: Value(namespace),
      key: Value(key),
      value: Value(value),
      updatedAt: Value(updatedAt),
    );
  }

  factory KeyValue.fromJson(
    Map<String, dynamic> json, {
    ValueSerializer? serializer,
  }) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return KeyValue(
      namespace: serializer.fromJson<String>(json['namespace']),
      key: serializer.fromJson<String>(json['key']),
      value: serializer.fromJson<String>(json['value']),
      updatedAt: serializer.fromJson<DateTime>(json['updatedAt']),
    );
  }
  @override
  Map<String, dynamic> toJson({ValueSerializer? serializer}) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return <String, dynamic>{
      'namespace': serializer.toJson<String>(namespace),
      'key': serializer.toJson<String>(key),
      'value': serializer.toJson<String>(value),
      'updatedAt': serializer.toJson<DateTime>(updatedAt),
    };
  }

  KeyValue copyWith({
    String? namespace,
    String? key,
    String? value,
    DateTime? updatedAt,
  }) => KeyValue(
    namespace: namespace ?? this.namespace,
    key: key ?? this.key,
    value: value ?? this.value,
    updatedAt: updatedAt ?? this.updatedAt,
  );
  KeyValue copyWithCompanion(KeyValuesCompanion data) {
    return KeyValue(
      namespace: data.namespace.present ? data.namespace.value : this.namespace,
      key: data.key.present ? data.key.value : this.key,
      value: data.value.present ? data.value.value : this.value,
      updatedAt: data.updatedAt.present ? data.updatedAt.value : this.updatedAt,
    );
  }

  @override
  String toString() {
    return (StringBuffer('KeyValue(')
          ..write('namespace: $namespace, ')
          ..write('key: $key, ')
          ..write('value: $value, ')
          ..write('updatedAt: $updatedAt')
          ..write(')'))
        .toString();
  }

  @override
  int get hashCode => Object.hash(namespace, key, value, updatedAt);
  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      (other is KeyValue &&
          other.namespace == this.namespace &&
          other.key == this.key &&
          other.value == this.value &&
          other.updatedAt == this.updatedAt);
}

class KeyValuesCompanion extends UpdateCompanion<KeyValue> {
  final Value<String> namespace;
  final Value<String> key;
  final Value<String> value;
  final Value<DateTime> updatedAt;
  final Value<int> rowid;
  const KeyValuesCompanion({
    this.namespace = const Value.absent(),
    this.key = const Value.absent(),
    this.value = const Value.absent(),
    this.updatedAt = const Value.absent(),
    this.rowid = const Value.absent(),
  });
  KeyValuesCompanion.insert({
    required String namespace,
    required String key,
    required String value,
    required DateTime updatedAt,
    this.rowid = const Value.absent(),
  }) : namespace = Value(namespace),
       key = Value(key),
       value = Value(value),
       updatedAt = Value(updatedAt);
  static Insertable<KeyValue> custom({
    Expression<String>? namespace,
    Expression<String>? key,
    Expression<String>? value,
    Expression<DateTime>? updatedAt,
    Expression<int>? rowid,
  }) {
    return RawValuesInsertable({
      if (namespace != null) 'namespace': namespace,
      if (key != null) 'key': key,
      if (value != null) 'value': value,
      if (updatedAt != null) 'updated_at': updatedAt,
      if (rowid != null) 'rowid': rowid,
    });
  }

  KeyValuesCompanion copyWith({
    Value<String>? namespace,
    Value<String>? key,
    Value<String>? value,
    Value<DateTime>? updatedAt,
    Value<int>? rowid,
  }) {
    return KeyValuesCompanion(
      namespace: namespace ?? this.namespace,
      key: key ?? this.key,
      value: value ?? this.value,
      updatedAt: updatedAt ?? this.updatedAt,
      rowid: rowid ?? this.rowid,
    );
  }

  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    if (namespace.present) {
      map['namespace'] = Variable<String>(namespace.value);
    }
    if (key.present) {
      map['key'] = Variable<String>(key.value);
    }
    if (value.present) {
      map['value'] = Variable<String>(value.value);
    }
    if (updatedAt.present) {
      map['updated_at'] = Variable<DateTime>(updatedAt.value);
    }
    if (rowid.present) {
      map['rowid'] = Variable<int>(rowid.value);
    }
    return map;
  }

  @override
  String toString() {
    return (StringBuffer('KeyValuesCompanion(')
          ..write('namespace: $namespace, ')
          ..write('key: $key, ')
          ..write('value: $value, ')
          ..write('updatedAt: $updatedAt, ')
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
  late final $KeyValuesTable keyValues = $KeyValuesTable(this);
  @override
  Iterable<TableInfo<Table, Object?>> get allTables =>
      allSchemaEntities.whereType<TableInfo<Table, Object?>>();
  @override
  List<DatabaseSchemaEntity> get allSchemaEntities => [
    queuedAssets,
    uploadParts,
    keyValues,
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
      Value<String?> fileName,
      Value<String?> mimeType,
      Value<DateTime?> modifiedAt,
      Value<String?> spoolPath,
      Value<String?> protocol,
      Value<String?> errorCode,
      Value<String?> serverFileId,
      Value<DateTime?> discoveredAt,
      Value<DateTime?> lastAttemptAt,
      Value<String?> folderId,
      Value<DateTime?> albumLinkedAt,
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
      Value<String?> fileName,
      Value<String?> mimeType,
      Value<DateTime?> modifiedAt,
      Value<String?> spoolPath,
      Value<String?> protocol,
      Value<String?> errorCode,
      Value<String?> serverFileId,
      Value<DateTime?> discoveredAt,
      Value<DateTime?> lastAttemptAt,
      Value<String?> folderId,
      Value<DateTime?> albumLinkedAt,
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

  ColumnFilters<String> get fileName => $composableBuilder(
    column: $table.fileName,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get mimeType => $composableBuilder(
    column: $table.mimeType,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<DateTime> get modifiedAt => $composableBuilder(
    column: $table.modifiedAt,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get spoolPath => $composableBuilder(
    column: $table.spoolPath,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get protocol => $composableBuilder(
    column: $table.protocol,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get errorCode => $composableBuilder(
    column: $table.errorCode,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get serverFileId => $composableBuilder(
    column: $table.serverFileId,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<DateTime> get discoveredAt => $composableBuilder(
    column: $table.discoveredAt,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<DateTime> get lastAttemptAt => $composableBuilder(
    column: $table.lastAttemptAt,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get folderId => $composableBuilder(
    column: $table.folderId,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<DateTime> get albumLinkedAt => $composableBuilder(
    column: $table.albumLinkedAt,
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

  ColumnOrderings<String> get fileName => $composableBuilder(
    column: $table.fileName,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get mimeType => $composableBuilder(
    column: $table.mimeType,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<DateTime> get modifiedAt => $composableBuilder(
    column: $table.modifiedAt,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get spoolPath => $composableBuilder(
    column: $table.spoolPath,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get protocol => $composableBuilder(
    column: $table.protocol,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get errorCode => $composableBuilder(
    column: $table.errorCode,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get serverFileId => $composableBuilder(
    column: $table.serverFileId,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<DateTime> get discoveredAt => $composableBuilder(
    column: $table.discoveredAt,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<DateTime> get lastAttemptAt => $composableBuilder(
    column: $table.lastAttemptAt,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get folderId => $composableBuilder(
    column: $table.folderId,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<DateTime> get albumLinkedAt => $composableBuilder(
    column: $table.albumLinkedAt,
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

  GeneratedColumn<String> get fileName =>
      $composableBuilder(column: $table.fileName, builder: (column) => column);

  GeneratedColumn<String> get mimeType =>
      $composableBuilder(column: $table.mimeType, builder: (column) => column);

  GeneratedColumn<DateTime> get modifiedAt => $composableBuilder(
    column: $table.modifiedAt,
    builder: (column) => column,
  );

  GeneratedColumn<String> get spoolPath =>
      $composableBuilder(column: $table.spoolPath, builder: (column) => column);

  GeneratedColumn<String> get protocol =>
      $composableBuilder(column: $table.protocol, builder: (column) => column);

  GeneratedColumn<String> get errorCode =>
      $composableBuilder(column: $table.errorCode, builder: (column) => column);

  GeneratedColumn<String> get serverFileId => $composableBuilder(
    column: $table.serverFileId,
    builder: (column) => column,
  );

  GeneratedColumn<DateTime> get discoveredAt => $composableBuilder(
    column: $table.discoveredAt,
    builder: (column) => column,
  );

  GeneratedColumn<DateTime> get lastAttemptAt => $composableBuilder(
    column: $table.lastAttemptAt,
    builder: (column) => column,
  );

  GeneratedColumn<String> get folderId =>
      $composableBuilder(column: $table.folderId, builder: (column) => column);

  GeneratedColumn<DateTime> get albumLinkedAt => $composableBuilder(
    column: $table.albumLinkedAt,
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
                Value<String?> fileName = const Value.absent(),
                Value<String?> mimeType = const Value.absent(),
                Value<DateTime?> modifiedAt = const Value.absent(),
                Value<String?> spoolPath = const Value.absent(),
                Value<String?> protocol = const Value.absent(),
                Value<String?> errorCode = const Value.absent(),
                Value<String?> serverFileId = const Value.absent(),
                Value<DateTime?> discoveredAt = const Value.absent(),
                Value<DateTime?> lastAttemptAt = const Value.absent(),
                Value<String?> folderId = const Value.absent(),
                Value<DateTime?> albumLinkedAt = const Value.absent(),
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
                fileName: fileName,
                mimeType: mimeType,
                modifiedAt: modifiedAt,
                spoolPath: spoolPath,
                protocol: protocol,
                errorCode: errorCode,
                serverFileId: serverFileId,
                discoveredAt: discoveredAt,
                lastAttemptAt: lastAttemptAt,
                folderId: folderId,
                albumLinkedAt: albumLinkedAt,
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
                Value<String?> fileName = const Value.absent(),
                Value<String?> mimeType = const Value.absent(),
                Value<DateTime?> modifiedAt = const Value.absent(),
                Value<String?> spoolPath = const Value.absent(),
                Value<String?> protocol = const Value.absent(),
                Value<String?> errorCode = const Value.absent(),
                Value<String?> serverFileId = const Value.absent(),
                Value<DateTime?> discoveredAt = const Value.absent(),
                Value<DateTime?> lastAttemptAt = const Value.absent(),
                Value<String?> folderId = const Value.absent(),
                Value<DateTime?> albumLinkedAt = const Value.absent(),
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
                fileName: fileName,
                mimeType: mimeType,
                modifiedAt: modifiedAt,
                spoolPath: spoolPath,
                protocol: protocol,
                errorCode: errorCode,
                serverFileId: serverFileId,
                discoveredAt: discoveredAt,
                lastAttemptAt: lastAttemptAt,
                folderId: folderId,
                albumLinkedAt: albumLinkedAt,
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
      Value<DateTime?> acknowledgedAt,
      Value<int> rowid,
    });
typedef $$UploadPartsTableUpdateCompanionBuilder =
    UploadPartsCompanion Function({
      Value<String> uploadId,
      Value<int> partIndex,
      Value<int> bytes,
      Value<String?> sha256,
      Value<DateTime?> acknowledgedAt,
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

  ColumnFilters<DateTime> get acknowledgedAt => $composableBuilder(
    column: $table.acknowledgedAt,
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

  ColumnOrderings<DateTime> get acknowledgedAt => $composableBuilder(
    column: $table.acknowledgedAt,
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

  GeneratedColumn<DateTime> get acknowledgedAt => $composableBuilder(
    column: $table.acknowledgedAt,
    builder: (column) => column,
  );
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
                Value<DateTime?> acknowledgedAt = const Value.absent(),
                Value<int> rowid = const Value.absent(),
              }) => UploadPartsCompanion(
                uploadId: uploadId,
                partIndex: partIndex,
                bytes: bytes,
                sha256: sha256,
                acknowledgedAt: acknowledgedAt,
                rowid: rowid,
              ),
          createCompanionCallback:
              ({
                required String uploadId,
                required int partIndex,
                required int bytes,
                Value<String?> sha256 = const Value.absent(),
                Value<DateTime?> acknowledgedAt = const Value.absent(),
                Value<int> rowid = const Value.absent(),
              }) => UploadPartsCompanion.insert(
                uploadId: uploadId,
                partIndex: partIndex,
                bytes: bytes,
                sha256: sha256,
                acknowledgedAt: acknowledgedAt,
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
typedef $$KeyValuesTableCreateCompanionBuilder = KeyValuesCompanion Function({
  required String namespace,
  required String key,
  required String value,
  required DateTime updatedAt,
  Value<int> rowid,
});
typedef $$KeyValuesTableUpdateCompanionBuilder = KeyValuesCompanion Function({
  Value<String> namespace,
  Value<String> key,
  Value<String> value,
  Value<DateTime> updatedAt,
  Value<int> rowid,
});

class $$KeyValuesTableFilterComposer
    extends Composer<_$AppDatabase, $KeyValuesTable> {
  $$KeyValuesTableFilterComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnFilters<String> get namespace => $composableBuilder(
    column: $table.namespace,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get key => $composableBuilder(
    column: $table.key,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get value => $composableBuilder(
    column: $table.value,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<DateTime> get updatedAt => $composableBuilder(
    column: $table.updatedAt,
    builder: (column) => ColumnFilters(column),
  );
}

class $$KeyValuesTableOrderingComposer
    extends Composer<_$AppDatabase, $KeyValuesTable> {
  $$KeyValuesTableOrderingComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnOrderings<String> get namespace => $composableBuilder(
    column: $table.namespace,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get key => $composableBuilder(
    column: $table.key,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get value => $composableBuilder(
    column: $table.value,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<DateTime> get updatedAt => $composableBuilder(
    column: $table.updatedAt,
    builder: (column) => ColumnOrderings(column),
  );
}

class $$KeyValuesTableAnnotationComposer
    extends Composer<_$AppDatabase, $KeyValuesTable> {
  $$KeyValuesTableAnnotationComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  GeneratedColumn<String> get namespace =>
      $composableBuilder(column: $table.namespace, builder: (column) => column);

  GeneratedColumn<String> get key =>
      $composableBuilder(column: $table.key, builder: (column) => column);

  GeneratedColumn<String> get value =>
      $composableBuilder(column: $table.value, builder: (column) => column);

  GeneratedColumn<DateTime> get updatedAt =>
      $composableBuilder(column: $table.updatedAt, builder: (column) => column);
}

class $$KeyValuesTableTableManager
    extends
        RootTableManager<
          _$AppDatabase,
          $KeyValuesTable,
          KeyValue,
          $$KeyValuesTableFilterComposer,
          $$KeyValuesTableOrderingComposer,
          $$KeyValuesTableAnnotationComposer,
          $$KeyValuesTableCreateCompanionBuilder,
          $$KeyValuesTableUpdateCompanionBuilder,
          (KeyValue, BaseReferences<_$AppDatabase, $KeyValuesTable, KeyValue>),
          KeyValue,
          PrefetchHooks Function()
        > {
  $$KeyValuesTableTableManager(_$AppDatabase db, $KeyValuesTable table)
    : super(
        TableManagerState(
          db: db,
          table: table,
          createFilteringComposer: () =>
              $$KeyValuesTableFilterComposer($db: db, $table: table),
          createOrderingComposer: () =>
              $$KeyValuesTableOrderingComposer($db: db, $table: table),
          createComputedFieldComposer: () =>
              $$KeyValuesTableAnnotationComposer($db: db, $table: table),
          updateCompanionCallback:
              ({
                Value<String> namespace = const Value.absent(),
                Value<String> key = const Value.absent(),
                Value<String> value = const Value.absent(),
                Value<DateTime> updatedAt = const Value.absent(),
                Value<int> rowid = const Value.absent(),
              }) => KeyValuesCompanion(
                namespace: namespace,
                key: key,
                value: value,
                updatedAt: updatedAt,
                rowid: rowid,
              ),
          createCompanionCallback:
              ({
                required String namespace,
                required String key,
                required String value,
                required DateTime updatedAt,
                Value<int> rowid = const Value.absent(),
              }) => KeyValuesCompanion.insert(
                namespace: namespace,
                key: key,
                value: value,
                updatedAt: updatedAt,
                rowid: rowid,
              ),
          withReferenceMapper: (p0) => p0
              .map(
                (e) => (
                  e.readTable<$KeyValuesTable, KeyValue>(table),
                  BaseReferences<_$AppDatabase, $KeyValuesTable, KeyValue>(
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

typedef $$KeyValuesTableProcessedTableManager =
    ProcessedTableManager<
      _$AppDatabase,
      $KeyValuesTable,
      KeyValue,
      $$KeyValuesTableFilterComposer,
      $$KeyValuesTableOrderingComposer,
      $$KeyValuesTableAnnotationComposer,
      $$KeyValuesTableCreateCompanionBuilder,
      $$KeyValuesTableUpdateCompanionBuilder,
      (KeyValue, BaseReferences<_$AppDatabase, $KeyValuesTable, KeyValue>),
      KeyValue,
      PrefetchHooks Function()
    >;

class $AppDatabaseManager {
  final _$AppDatabase _db;
  $AppDatabaseManager(this._db);
  $$QueuedAssetsTableTableManager get queuedAssets =>
      $$QueuedAssetsTableTableManager(_db, _db.queuedAssets);
  $$UploadPartsTableTableManager get uploadParts =>
      $$UploadPartsTableTableManager(_db, _db.uploadParts);
  $$KeyValuesTableTableManager get keyValues =>
      $$KeyValuesTableTableManager(_db, _db.keyValues);
}
