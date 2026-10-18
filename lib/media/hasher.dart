/// Computes the content hashes the dedup flow relies on.
class Hasher {
  const Hasher();

  /// Returns the lowercase hex SHA-256 of the file at [path].
  Future<String> sha256OfFile(String path) {
    // TODO(spec §3.2, D5): stream the SHA-256 of the EXACT bytes that will be
    // uploaded; never hash a transcoded copy.
    throw UnimplementedError('Hasher.sha256OfFile');
  }
}
