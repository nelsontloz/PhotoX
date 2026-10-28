import 'package:flutter_test/flutter_test.dart';
import 'package:photox_mobile/sync/transfer_progress.dart';

void main() {
  group('phase and fraction', () {
    test('starts idle with no asset in flight', () {
      final progress = TransferProgress();

      expect(progress.phase, TransferPhase.idle);
      expect(progress.active, isFalse);
      expect(progress.localId, isNull);
      expect(progress.fileName, isNull);
      expect(progress.totalBytes, 0);
      expect(progress.sentBytes, 0);
      expect(progress.fraction, 0);
      expect(progress.speedBytesPerSecond, 0);
    });

    test('begin names the asset and reset counters', () {
      final progress = TransferProgress()
        ..begin(
          localId: 'asset-a',
          fileName: 'a.jpg',
          totalBytes: 100,
          phase: TransferPhase.uploading,
        )
        ..advance(40);

      progress.begin(
        localId: 'asset-b',
        fileName: 'b.jpg',
        totalBytes: 200,
        phase: TransferPhase.preparing,
      );

      expect(progress.phase, TransferPhase.preparing);
      expect(progress.active, isTrue);
      expect(progress.localId, 'asset-b');
      expect(progress.fileName, 'b.jpg');
      expect(progress.totalBytes, 200);
      expect(progress.sentBytes, 0);
      expect(progress.fraction, 0);
    });

    test('reports the completed fraction and clamps it', () {
      final progress = TransferProgress()
        ..begin(
          localId: 'asset-a',
          fileName: 'a.jpg',
          totalBytes: 1000,
          phase: TransferPhase.uploading,
        );

      progress.advance(-5);
      expect(progress.sentBytes, 0);
      expect(progress.fraction, 0);

      progress.advance(250);
      expect(progress.fraction, closeTo(0.25, 1e-9));

      progress.advance(5000);
      expect(progress.sentBytes, 5000);
      expect(progress.fraction, 1);
    });

    test('fraction stays zero when the total is unknown', () {
      final progress = TransferProgress()
        ..begin(
          localId: 'asset-a',
          fileName: 'a.jpg',
          totalBytes: 0,
          phase: TransferPhase.uploading,
        )
        ..advance(500);

      expect(progress.sentBytes, 500);
      expect(progress.fraction, 0);

      progress.begin(
        localId: 'asset-a',
        fileName: 'a.jpg',
        totalBytes: -10,
        phase: TransferPhase.uploading,
      );
      expect(progress.totalBytes, 0);
      expect(progress.fraction, 0);
    });

    test('advance is ignored while idle', () {
      final progress = TransferProgress();
      var notifications = 0;
      progress.addListener(() => notifications++);

      progress.advance(100);

      expect(progress.sentBytes, 0);
      expect(progress.phase, TransferPhase.idle);
      expect(notifications, 0);
    });
  });

  group('speed', () {
    test('measures bytes per second over the recent window', () {
      var now = DateTime.utc(2026, 10, 28, 12);
      final progress = TransferProgress(clock: () => now)
        ..begin(
          localId: 'asset-a',
          fileName: 'a.jpg',
          totalBytes: 1000,
          phase: TransferPhase.uploading,
        );

      now = now.add(const Duration(seconds: 1));
      progress.advance(500);
      expect(progress.speedBytesPerSecond, closeTo(500, 0.001));

      now = now.add(const Duration(seconds: 1));
      progress.advance(1000);
      expect(progress.speedBytesPerSecond, closeTo(500, 0.001));
    });

    test('drops to zero when the link stalls', () {
      var now = DateTime.utc(2026, 10, 28, 12);
      final progress = TransferProgress(clock: () => now)
        ..begin(
          localId: 'asset-a',
          fileName: 'a.jpg',
          totalBytes: 1000,
          phase: TransferPhase.uploading,
        );

      now = now.add(const Duration(seconds: 1));
      progress.advance(500);
      expect(progress.speedBytesPerSecond, greaterThan(0));

      now = now.add(const Duration(seconds: 10));
      progress.advance(1000);
      expect(progress.speedBytesPerSecond, 0);
    });

    test('is zero after finish', () {
      var now = DateTime.utc(2026, 10, 28, 12);
      final progress = TransferProgress(clock: () => now)
        ..begin(
          localId: 'asset-a',
          fileName: 'a.jpg',
          totalBytes: 1000,
          phase: TransferPhase.uploading,
        );

      now = now.add(const Duration(seconds: 1));
      progress.advance(500);
      progress.finish();

      expect(progress.phase, TransferPhase.idle);
      expect(progress.active, isFalse);
      expect(progress.speedBytesPerSecond, 0);
    });
  });

  group('completion and notifications', () {
    test('completedTransfers increments once per finish', () {
      final progress = TransferProgress();

      progress.finish();
      expect(progress.completedTransfers, 0);

      progress
        ..begin(
          localId: 'asset-a',
          fileName: 'a.jpg',
          totalBytes: 10,
          phase: TransferPhase.uploading,
        )
        ..finish()
        ..finish();
      expect(progress.completedTransfers, 1);

      progress
        ..begin(
          localId: 'asset-b',
          fileName: 'b.jpg',
          totalBytes: 10,
          phase: TransferPhase.preparing,
        )
        ..finish();
      expect(progress.completedTransfers, 2);
    });

    test('notifies the fraction at most every notifyInterval', () {
      var now = DateTime.utc(2026);
      final progress = TransferProgress(
        clock: () => now,
        notifyInterval: const Duration(milliseconds: 200),
      );
      var notifications = 0;
      progress.addListener(() => notifications++);

      progress.begin(
        localId: 'asset-a',
        fileName: 'a.jpg',
        totalBytes: 1000,
        phase: TransferPhase.uploading,
      );
      expect(notifications, 1, reason: 'begin always notifies');

      progress.advance(10);
      progress.advance(10);
      expect(notifications, 1, reason: 'same instant is throttled');

      now = now.add(const Duration(milliseconds: 100));
      progress.advance(20);
      expect(notifications, 1, reason: 'still inside the interval');

      now = now.add(const Duration(milliseconds: 150));
      progress.advance(30);
      expect(notifications, 2);

      progress.advance(30);
      expect(notifications, 2, reason: 'unchanged bytes do not notify');

      progress.finish();
      expect(notifications, 3, reason: 'finish always notifies');
    });
  });
}
