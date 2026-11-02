import 'package:flutter_test/flutter_test.dart';
import 'package:photox_mobile/library/backup_status.dart';
import 'package:photox_mobile/media/photo_observer.dart';
import 'package:photox_mobile/settings/settings_store.dart';
import 'package:photox_mobile/upload/models.dart';

void main() {
  const settings = AppSettings();

  AssetCandidate photo({
    String fileName = 'IMG_0001.jpg',
    String mimeType = 'image/jpeg',
  }) => AssetCandidate(
    localId: 'asset-1',
    platform: 'ios',
    kind: MediaKind.photo,
    fileName: fileName,
    mimeType: mimeType,
    sizeBytes: 42,
  );

  AssetCandidate video() => AssetCandidate(
    localId: 'video-1',
    platform: 'ios',
    kind: MediaKind.video,
    fileName: 'clip.mp4',
    mimeType: 'video/mp4',
    sizeBytes: 4200,
  );

  group('queue row', () {
    test('maps every UploadState', () {
      const expected = <UploadState, BackupStatus>{
        UploadState.uploaded: BackupStatus.backedUp,
        UploadState.duplicate: BackupStatus.backedUp,
        UploadState.hashing: BackupStatus.uploading,
        UploadState.creating: BackupStatus.uploading,
        UploadState.uploading: BackupStatus.uploading,
        UploadState.completing: BackupStatus.uploading,
        UploadState.discovered: BackupStatus.queued,
        UploadState.pending: BackupStatus.queued,
        UploadState.failedRetryable: BackupStatus.queued,
        UploadState.failedPermanent: BackupStatus.failed,
        UploadState.skippedQuota: BackupStatus.failed,
        UploadState.excluded: BackupStatus.excluded,
      };
      // A new state without a badge must fail here, not default to a lie.
      expect(expected, hasLength(UploadState.values.length));

      for (final entry in expected.entries) {
        expect(
          resolveBackupStatus(
            state: entry.key,
            asset: photo(),
            settings: settings,
          ),
          entry.value,
          reason: entry.key.name,
        );
      }
    });

    test('a row wins even when the container is unsupported', () {
      expect(
        resolveBackupStatus(
          state: UploadState.uploaded,
          asset: photo(fileName: 'IMG_0001.dng', mimeType: ''),
          settings: settings,
        ),
        BackupStatus.backedUp,
      );
    });
  });

  group('no queue row', () {
    test('a supported jpeg is unknown', () {
      expect(
        resolveBackupStatus(state: null, asset: photo(), settings: settings),
        BackupStatus.unknown,
      );
    });

    test('a DNG is excluded', () {
      expect(
        resolveBackupStatus(
          state: null,
          // PhotoKit reports no MIME, so the extension decides.
          asset: photo(fileName: 'IMG_0001.dng', mimeType: ''),
          settings: settings,
        ),
        BackupStatus.excluded,
      );
    });

    test('an mp4 is excluded while videos are off', () {
      expect(
        resolveBackupStatus(state: null, asset: video(), settings: settings),
        BackupStatus.excluded,
      );
    });

    test('an mp4 is unknown while videos are on', () {
      expect(
        resolveBackupStatus(
          state: null,
          asset: video(),
          settings: const AppSettings(includeVideos: true),
        ),
        BackupStatus.unknown,
      );
    });
  });
}
