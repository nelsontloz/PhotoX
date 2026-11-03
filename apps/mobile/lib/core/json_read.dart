/// Strict field readers shared by every wire model.
///
/// A wrong shape is a [FormatException] naming the offending field, which
/// `ApiClient.parseResponse` turns into a typed `ApiException`.
library;

String requireString(Map<String, dynamic> json, String field, String context) {
  final value = json[field];
  if (value is String) return value;
  throw FormatException(
    '$context.$field must be a string, got ${value.runtimeType}',
  );
}

String? requireStringOrNull(
  Map<String, dynamic> json,
  String field,
  String context,
) {
  final value = json[field];
  if (value == null || value is String) return value as String?;
  throw FormatException(
    '$context.$field must be a string or null, got ${value.runtimeType}',
  );
}

int requireInt(Map<String, dynamic> json, String field, String context) {
  final value = json[field];
  if (value is num) return value.toInt();
  throw FormatException(
    '$context.$field must be a number, got ${value.runtimeType}',
  );
}

bool requireBool(Map<String, dynamic> json, String field, String context) {
  final value = json[field];
  if (value is bool) return value;
  throw FormatException(
    '$context.$field must be a boolean, got ${value.runtimeType}',
  );
}

Map<String, dynamic> requireMap(
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

DateTime requireDateTime(
  Map<String, dynamic> json,
  String field,
  String context,
) {
  final raw = requireString(json, field, context);
  final parsed = DateTime.tryParse(raw);
  if (parsed == null) {
    throw FormatException(
      '$context.$field must be an ISO-8601 timestamp, got "$raw"',
    );
  }
  return parsed.toUtc();
}

List<int> requireIntList(
  Map<String, dynamic> json,
  String field,
  String context,
) {
  final value = json[field];
  if (value is! List) {
    throw FormatException(
      '$context.$field must be a list, got ${value.runtimeType}',
    );
  }
  final result = <int>[];
  for (var index = 0; index < value.length; index++) {
    final part = value[index];
    if (part is! num) {
      throw FormatException(
        '$context.$field[$index] must be a number, got ${part.runtimeType}',
      );
    }
    result.add(part.toInt());
  }
  return result;
}
