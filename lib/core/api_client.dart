import 'dart:io';

import 'package:dio/dio.dart';

import 'app_config.dart';
import 'auth_manager.dart';
import 'auth_models.dart';
import '../sync/transfer_progress.dart';
import '../upload/models.dart';

/// Typed failure for every non-2xx core API response.
class ApiException implements Exception {
  const ApiException({
    required this.message,
    this.statusCode,
    this.code,
    this.receivedParts,
    this.retryAfter,
    this.existingAssetId,
    this.existingFileId,
  });

  /// Maps a Dio failure to the server's `{statusCode, message, code}` envelope.
  factory ApiException.fromDio(DioException error) {
    final response = error.response;
    final data = response?.data;
    var message = error.message ?? error.type.name;
    String? code;
    List<int>? receivedParts;
    String? existingAssetId;
    String? existingFileId;
    int? statusCode = response?.statusCode;

    if (data is Map) {
      final rawMessage = data['message'];
      if (rawMessage is String && rawMessage.isNotEmpty) {
        message = rawMessage;
      } else if (rawMessage is List) {
        final joined = rawMessage
            .map((entry) => entry.toString())
            .where((entry) => entry.isNotEmpty)
            .join('; ');
        if (joined.isNotEmpty) message = joined;
      }
      final rawCode = data['code'];
      if (rawCode is String) code = rawCode;
      final rawParts = data['receivedParts'];
      if (rawParts is List) {
        final parts = <int>[];
        for (var index = 0; index < rawParts.length; index++) {
          final part = rawParts[index];
          if (part is! num) {
            // Never silently drop a malformed entry; the bad index lets
            // ApiClient.parseResponse normalize this to a typed ApiException.
            throw FormatException(
              'ApiException.receivedParts[$index] must be a number, '
              'got ${part.runtimeType}',
            );
          }
          parts.add(part.toInt());
        }
        receivedParts = parts;
      }
      final rawAssetId = data['existingAssetId'];
      if (rawAssetId is String) existingAssetId = rawAssetId;
      final rawFileId = data['existingFileId'];
      if (rawFileId is String) existingFileId = rawFileId;
    }

    final inner = error.error;
    if (inner is AuthException) {
      statusCode ??= inner.statusCode;
      message = inner.message;
      code ??= inner.code;
    }

    return ApiException(
      statusCode: statusCode,
      message: message,
      code: code,
      receivedParts: receivedParts,
      retryAfter: _parseRetryAfter(response?.headers.value('retry-after')),
      existingAssetId: existingAssetId,
      existingFileId: existingFileId,
    );
  }

  final int? statusCode;
  final String message;
  final String? code;

  /// Part indices the server is still missing (`PARTS_MISSING`).
  final List<int>? receivedParts;

  /// Server-requested delay (`Retry-After`), when present.
  final Duration? retryAfter;

  /// Existing asset id carried by the single-upload 409 duplicate envelope.
  final String? existingAssetId;

  /// Existing file id carried by the single-upload 409 duplicate envelope.
  final String? existingFileId;

  /// Network failures and 408/429/5xx are worth retrying with backoff.
  bool get isRetryable {
    final status = statusCode;
    return status == null ||
        status == 408 ||
        status == 429 ||
        (status >= 500 && status <= 599);
  }

  /// 401 means the token pair is no longer usable.
  bool get isAuthError => statusCode == 401;

  static Duration? _parseRetryAfter(String? value) {
    if (value == null) return null;
    final trimmed = value.trim();
    if (trimmed.isEmpty) return null;
    final seconds = int.tryParse(trimmed);
    if (seconds != null) {
      return Duration(seconds: seconds < 0 ? 0 : seconds);
    }
    try {
      final delta = HttpDate.parse(trimmed).difference(DateTime.now());
      return delta.isNegative ? Duration.zero : delta;
    } on HttpException {
      return null;
    } on FormatException {
      return null;
    }
  }

  @override
  String toString() {
    final status = statusCode == null ? '' : ' ($statusCode)';
    final errorCode = code == null ? '' : ' [$code]';
    return 'ApiException$status$errorCode: $message';
  }
}

/// Dio transport for the PhotoX core API, signed with the stored Bearer token.
class ApiClient {
  ApiClient({required this.auth, Dio? dio, String? baseUrl, this.progress})
    : dio = dio ?? Dio() {
    final configured = this.dio.options.baseUrl;
    this.dio.options.baseUrl =
        baseUrl ?? (configured.isNotEmpty ? configured : AppConfig.apiBaseUrl);
    this.dio.options.connectTimeout ??= const Duration(seconds: 15);
    this.dio.options.receiveTimeout ??= const Duration(minutes: 2);
    this.dio.options.sendTimeout ??= const Duration(minutes: 5);
    this.dio.interceptors.add(
      InterceptorsWrapper(onRequest: _onRequest, onError: _onError),
    );
  }

  static const String _retriedKey = 'photox.authRetried';

  /// Token provider used to sign every outgoing request.
  final AuthManager auth;

  /// Shared Dio instance; feature clients layer options on top of it.
  final Dio dio;

  /// Points every later upload request at the server the user just entered.
  set baseUrl(String url) => dio.options.baseUrl = url;

  /// Live byte progress fed from every upload request this client sends.
  final TransferProgress? progress;

  Future<void> _onRequest(
    RequestOptions options,
    RequestInterceptorHandler handler,
  ) async {
    if (_isAuthPath(options.path)) {
      handler.next(options);
      return;
    }
    try {
      final token = await auth.ensureAccessToken();
      options.headers['Authorization'] = 'Bearer $token';
      handler.next(options);
    } on AuthException catch (error) {
      handler.reject(
        DioException(
          requestOptions: options,
          error: error,
          message: error.message,
          type: DioExceptionType.unknown,
        ),
      );
    }
  }

  Future<void> _onError(
    DioException error,
    ErrorInterceptorHandler handler,
  ) async {
    final options = error.requestOptions;
    final canRetry =
        error.response?.statusCode == 401 &&
        !_isAuthPath(options.path) &&
        options.extra[_retriedKey] != true &&
        // FormData streams are consumed on first use; uploadFile rebuilds them.
        options.data is! FormData;
    if (!canRetry) {
      handler.next(error);
      return;
    }

    try {
      await auth.forceRefresh();
      final token = await auth.ensureAccessToken();
      final retryOptions = options.copyWith(
        headers: <String, dynamic>{
          ...options.headers,
          'Authorization': 'Bearer $token',
        },
        extra: <String, dynamic>{...options.extra, _retriedKey: true},
      );
      final response = await dio.fetch<dynamic>(retryOptions);
      handler.resolve(response);
    } on Object {
      handler.next(error);
    }
  }

  /// Uploads one asset through the multipart single-request path.
  ///
  /// A 401 is refreshed once here because [FormData] cannot be replayed after a
  /// failed attempt; the request is rebuilt with the rotated token.
  Future<AssetSummary> uploadFile(
    File file,
    String originalName, {
    String? mimeType,
    String? title,
    String? description,
    DateTime? takenAt,
  }) async {
    Future<AssetSummary> send() async {
      final form = FormData.fromMap(<String, dynamic>{
        'file': await MultipartFile.fromFile(
          file.path,
          filename: originalName,
          contentType: mimeType == null ? null : DioMediaType.parse(mimeType),
        ),
        'title': ?title,
        'description': ?description,
        if (takenAt != null) 'takenAt': takenAt.toUtc().toIso8601String(),
      });
      late final Response<dynamic> response;
      try {
        response = await dio.post<dynamic>(
          '/api/v1/files',
          data: form,
          onSendProgress: (sent, total) => progress?.advance(sent),
        );
      } on DioException catch (error) {
        throw ApiException.fromDio(error);
      }
      return parseResponse(
        () => AssetSummary.fromJson(
          _decode<Map<String, dynamic>>(response.data, response.statusCode),
        ),
        context: 'POST /api/v1/files response',
        statusCode: response.statusCode,
      );
    }

    try {
      return await send();
    } on ApiException catch (error) {
      if (!error.isAuthError) rethrow;
      try {
        await auth.forceRefresh();
      } on AuthException catch (authError) {
        // A refresh failure is still an API failure for upload callers.
        throw ApiException(
          statusCode: authError.statusCode ?? 401,
          message: authError.message,
        );
      }
      return send();
    }
  }

  /// Batch dedup pre-check; at most 100 items per request.
  Future<List<DedupHit>> exists(List<DedupCheck> items) async {
    if (items.length > 100) {
      throw ArgumentError.value(
        items.length,
        'items',
        'The core API accepts at most 100 checksums per request',
      );
    }
    final json = await post<Map<String, dynamic>>(
      '/api/v1/files/exists',
      data: <String, dynamic>{
        'items': <Map<String, dynamic>>[
          for (final item in items) item.toJson(),
        ],
      },
    );
    final rawItems = json['items'];
    if (rawItems is! List) {
      throw const ApiException(message: 'Dedup response has no items list');
    }
    return parseResponse(
      () => <DedupHit>[
        for (final item in rawItems)
          DedupHit.fromJson((item as Map).cast<String, dynamic>()),
      ],
      context: 'POST /api/v1/files/exists response',
    );
  }

  /// GET helper converting every transport failure to [ApiException].
  Future<T> get<T>(String path, {Map<String, dynamic>? queryParameters}) async {
    late final Response<dynamic> response;
    try {
      response = await dio.get<dynamic>(path, queryParameters: queryParameters);
    } on DioException catch (error) {
      throw ApiException.fromDio(error);
    }
    return parseResponse(
      () => _decode<T>(response.data, response.statusCode),
      context: 'GET $path response',
      statusCode: response.statusCode,
    );
  }

  /// POST helper converting every transport failure to [ApiException].
  Future<T> post<T>(String path, {Object? data}) async {
    late final Response<dynamic> response;
    try {
      response = await dio.post<dynamic>(path, data: data);
    } on DioException catch (error) {
      throw ApiException.fromDio(error);
    }
    return parseResponse(
      () => _decode<T>(response.data, response.statusCode),
      context: 'POST $path response',
      statusCode: response.statusCode,
    );
  }

  /// PUT helper converting every transport failure to [ApiException].
  Future<T> put<T>(
    String path, {
    Object? data,
    Options? options,
    ProgressCallback? onSendProgress,
  }) async {
    late final Response<dynamic> response;
    try {
      response = await dio.put<dynamic>(
        path,
        data: data,
        options: options,
        onSendProgress: onSendProgress,
      );
    } on DioException catch (error) {
      throw ApiException.fromDio(error);
    }
    return parseResponse(
      () => _decode<T>(response.data, response.statusCode),
      context: 'PUT $path response',
      statusCode: response.statusCode,
    );
  }

  /// DELETE helper converting every transport failure to [ApiException].
  Future<void> delete(String path) async {
    try {
      await dio.delete<dynamic>(path);
    } on DioException catch (error) {
      throw ApiException.fromDio(error);
    }
  }

  /// Closes the underlying connection pool.
  void close() => dio.close(force: true);

  static bool _isAuthPath(String path) => path.contains('api/v1/auth/');

  /// Runs [parse] over a decoded response body, normalizing malformed payloads
  /// to [ApiException] so no raw [FormatException]/[TypeError] escapes.
  static T parseResponse<T>(
    T Function() parse, {
    required String context,
    int? statusCode,
  }) {
    try {
      return parse();
    } on FormatException catch (error) {
      throw ApiException(
        statusCode: statusCode,
        message: '$context has an unexpected shape: ${error.message}',
      );
    } on TypeError catch (error) {
      throw ApiException(
        statusCode: statusCode,
        message: '$context has an unexpected shape: $error',
      );
    }
  }

  static T _decode<T>(Object? data, int? statusCode) {
    if (data is T) return data;
    throw ApiException(
      statusCode: statusCode,
      message: 'Unexpected response shape: ${data.runtimeType}',
    );
  }
}
