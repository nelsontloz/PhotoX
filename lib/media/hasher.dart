import 'dart:io';
import 'dart:isolate';

import 'package:crypto/crypto.dart';

/// Computes the content hashes the dedup flow relies on.
class Hasher {
  const Hasher();

  /// Returns the lowercase hex SHA-256 of the file at [path].
  ///
  /// The file is streamed chunk by chunk inside a worker isolate, so hashing a
  /// multi-gigabyte video neither loads it in memory nor blocks the UI isolate.
  /// The hash always covers the exact bytes that will be uploaded; callers must
  /// never hash a transcoded or resized copy.
  Future<String> sha256OfFile(String path) {
    return Isolate.run(() async {
      final digest = await sha256.bind(File(path).openRead()).first;
      return digest.toString();
    });
  }

  /// Lowercase hex SHA-256 of [bytes]; useful for small in-memory payloads and
  /// tests.
  static String sha256OfBytes(List<int> bytes) =>
      sha256.convert(bytes).toString();
}
