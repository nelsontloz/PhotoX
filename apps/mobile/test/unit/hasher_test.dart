import 'dart:convert';
import 'dart:io';

import 'package:crypto/crypto.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:photox_mobile/media/hasher.dart';

void main() {
  group('Hasher known vectors', () {
    test('empty input', () {
      expect(
        Hasher.sha256OfBytes(const <int>[]),
        'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      );
    });

    test('abc', () {
      expect(
        Hasher.sha256OfBytes(utf8.encode('abc')),
        'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
      );
    });
  });

  group('Hasher.sha256OfFile', () {
    late Directory directory;

    setUp(() async {
      directory = await Directory.systemTemp.createTemp('photox-hasher-');
    });

    tearDown(() => directory.delete(recursive: true));

    test('streams the exact file bytes as lowercase hex', () async {
      final bytes = utf8.encode('PhotoX hashes the exact uploaded bytes');
      final file = File('${directory.path}/asset.bin');
      await file.writeAsBytes(bytes);

      final hash = await const Hasher().sha256OfFile(file.path);

      expect(hash, sha256.convert(bytes).toString());
      expect(hash, matches(RegExp(r'^[0-9a-f]{64}$')));
    });

    test('handles a file larger than one stream chunk', () async {
      final bytes = List<int>.generate(1024 * 1024 + 7, (index) => index % 251);
      final file = File('${directory.path}/large.bin');
      await file.writeAsBytes(bytes);

      expect(
        await const Hasher().sha256OfFile(file.path),
        Hasher.sha256OfBytes(bytes),
      );
    });
  });
}
