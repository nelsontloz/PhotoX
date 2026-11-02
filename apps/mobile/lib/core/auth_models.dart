/// User record embedded in every auth response.
class AuthUser {
  const AuthUser({
    required this.id,
    required this.email,
    required this.role,
    required this.displayName,
    required this.createdAt,
    required this.updatedAt,
  });

  factory AuthUser.fromJson(Map<String, dynamic> json) {
    return AuthUser(
      id: _requireString(json, 'id', 'AuthUser'),
      email: _requireString(json, 'email', 'AuthUser'),
      role: _requireString(json, 'role', 'AuthUser'),
      displayName: _requireString(json, 'displayName', 'AuthUser'),
      createdAt: _requireDateTime(json, 'createdAt', 'AuthUser'),
      updatedAt: _requireDateTime(json, 'updatedAt', 'AuthUser'),
    );
  }

  final String id;
  final String email;
  final String role;
  final String displayName;
  final DateTime createdAt;
  final DateTime updatedAt;

  Map<String, dynamic> toJson() => <String, dynamic>{
    'id': id,
    'email': email,
    'role': role,
    'displayName': displayName,
    'createdAt': createdAt.toUtc().toIso8601String(),
    'updatedAt': updatedAt.toUtc().toIso8601String(),
  };
}

/// A token pair plus the user it belongs to.
///
/// [accessExpiresAt] is absolute wall-clock time derived from the server's
/// `accessTokenExpiresIn` (seconds) and is stored so a restart does not refetch
/// the same token before its lifetime is actually over.
class AuthTokens {
  const AuthTokens({
    required this.accessToken,
    required this.refreshToken,
    required this.accessExpiresAt,
    required this.user,
  });

  /// Parses the persisted representation written by [toJson].
  factory AuthTokens.fromJson(Map<String, dynamic> json) {
    return AuthTokens(
      accessToken: _requireString(json, 'accessToken', 'AuthTokens'),
      refreshToken: _requireString(json, 'refreshToken', 'AuthTokens'),
      accessExpiresAt: _requireDateTime(json, 'accessExpiresAt', 'AuthTokens'),
      user: AuthUser.fromJson(_requireMap(json, 'user', 'AuthTokens')),
    );
  }

  /// Parses a login/refresh response, deriving the absolute access expiry from
  /// the server's relative lifetime. [now] is injectable for deterministic tests.
  factory AuthTokens.fromResponseJson(
    Map<String, dynamic> json, {
    DateTime? now,
  }) {
    final expiresIn = _requireNum(
      json,
      'accessTokenExpiresIn',
      'AuthTokens',
    ).toInt();
    final issuedAt = (now ?? DateTime.now()).toUtc();
    return AuthTokens(
      accessToken: _requireString(json, 'accessToken', 'AuthTokens'),
      refreshToken: _requireString(json, 'refreshToken', 'AuthTokens'),
      accessExpiresAt: issuedAt.add(Duration(seconds: expiresIn)),
      user: AuthUser.fromJson(_requireMap(json, 'user', 'AuthTokens')),
    );
  }

  final String accessToken;
  final String refreshToken;
  final DateTime accessExpiresAt;
  final AuthUser user;

  Map<String, dynamic> toJson() => <String, dynamic>{
    'accessToken': accessToken,
    'refreshToken': refreshToken,
    'accessExpiresAt': accessExpiresAt.toUtc().toIso8601String(),
    'user': user.toJson(),
  };
}

/// Authentication failure surfaced to callers.
class AuthException implements Exception {
  const AuthException(this.message, {this.statusCode, this.code});

  final String message;
  final int? statusCode;
  final String? code;

  @override
  String toString() {
    final status = statusCode == null ? '' : ' ($statusCode)';
    final errorCode = code == null ? '' : ' [$code]';
    return 'AuthException$status$errorCode: $message';
  }
}

String _requireString(Map<String, dynamic> json, String field, String context) {
  final value = json[field];
  if (value is String) return value;
  throw FormatException(
    '$context.$field must be a string, got ${value.runtimeType}',
  );
}

num _requireNum(Map<String, dynamic> json, String field, String context) {
  final value = json[field];
  if (value is num) return value;
  throw FormatException(
    '$context.$field must be a number, got ${value.runtimeType}',
  );
}

Map<String, dynamic> _requireMap(
  Map<String, dynamic> json,
  String field,
  String context,
) {
  final value = json[field];
  if (value is Map<String, dynamic>) return value;
  if (value is Map) {
    try {
      return Map<String, dynamic>.from(value);
    } on TypeError {
      // Fall through to the FormatException below.
    }
  }
  throw FormatException(
    '$context.$field must be an object, got ${value.runtimeType}',
  );
}

DateTime _requireDateTime(
  Map<String, dynamic> json,
  String field,
  String context,
) {
  final raw = _requireString(json, field, context);
  final parsed = DateTime.tryParse(raw);
  if (parsed == null) {
    throw FormatException(
      '$context.$field must be an ISO-8601 timestamp, got "$raw"',
    );
  }
  return parsed.toUtc();
}
