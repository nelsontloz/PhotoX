import 'package:flutter_test/flutter_test.dart';
import 'package:photox_mobile/media/media_filter.dart';
import 'package:photox_mobile/media/photo_observer.dart';

void main() {
  const filter = MediaFilter();

  AssetCandidate candidate({
    required String fileName,
    String mimeType = '',
    MediaKind kind = MediaKind.photo,
  }) {
    return AssetCandidate(
      localId: 'asset-1',
      platform: 'ios',
      kind: kind,
      fileName: fileName,
      mimeType: mimeType,
      sizeBytes: 42,
    );
  }

  group('inferMimeType', () {
    test('maps every server-supported photo container', () {
      expect(filter.inferMimeType('IMG_0001.jpg'), 'image/jpeg');
      expect(filter.inferMimeType('IMG_0001.JPEG'), 'image/jpeg');
      expect(filter.inferMimeType('IMG_0001.png'), 'image/png');
      expect(filter.inferMimeType('IMG_0001.gif'), 'image/gif');
      expect(filter.inferMimeType('IMG_0001.webp'), 'image/webp');
      expect(filter.inferMimeType('IMG_0001.heic'), 'image/heic');
      expect(filter.inferMimeType('IMG_0001.heif'), 'image/heif');
      expect(filter.inferMimeType('IMG_0001.avif'), 'image/avif');
    });

    test('maps every server-supported video container', () {
      expect(filter.inferMimeType('clip.mp4'), 'video/mp4');
      expect(filter.inferMimeType('clip.mov'), 'video/quicktime');
      expect(filter.inferMimeType('clip.webm'), 'video/webm');
      expect(filter.inferMimeType('clip.avi'), 'video/x-msvideo');
    });

    test('rejects RAW, DNG, TIFF, MKV and unknown names', () {
      for (final name in <String>[
        'IMG_0001.dng',
        'IMG_0001.cr2',
        'IMG_0001.nef',
        'IMG_0001.arw',
        'IMG_0001.raw',
        'IMG_0001.tif',
        'IMG_0001.tiff',
        'clip.mkv',
        'README',
        'archive.tar.gz',
      ]) {
        expect(filter.inferMimeType(name), isNull, reason: name);
      }
    });
  });

  group('isSupported', () {
    test('accepts supported photos regardless of case and paths', () {
      expect(
        filter.isSupported(
          candidate(fileName: '/DCIM/Camera/IMG_1.JPG'),
          includeVideos: false,
        ),
        isTrue,
      );
      expect(
        filter.isSupported(
          candidate(fileName: 'IMG_1.heic'),
          includeVideos: false,
        ),
        isTrue,
      );
    });

    test('accepts a supported reported MIME even with a weird extension', () {
      expect(
        filter.isSupported(
          candidate(fileName: 'blob.bin', mimeType: 'image/jpeg'),
          includeVideos: false,
        ),
        isTrue,
      );
    });

    test('rejects unsupported photo containers', () {
      expect(
        filter.isSupported(
          candidate(fileName: 'IMG_1.dng', mimeType: 'image/x-adobe-dng'),
          includeVideos: false,
        ),
        isFalse,
      );
      expect(
        filter.isSupported(
          candidate(fileName: 'IMG_1.tiff'),
          includeVideos: false,
        ),
        isFalse,
      );
    });

    test('includes videos only when the setting is on', () {
      final video = candidate(fileName: 'clip.mp4', kind: MediaKind.video);
      expect(filter.isSupported(video, includeVideos: false), isFalse);
      expect(filter.isSupported(video, includeVideos: true), isTrue);
    });

    test('rejects MKV even with videos enabled', () {
      expect(
        filter.isSupported(
          candidate(fileName: 'clip.mkv', kind: MediaKind.video),
          includeVideos: true,
        ),
        isFalse,
      );
    });
  });
}
