import 'package:flutter_test/flutter_test.dart';
import 'package:photox_mobile/ui/widgets/month_rail.dart';

void main() {
  group('rail geometry', () {
    test('the thumb is proportional to the viewport, floored and capped', () {
      final tenth = thumbGeometry(
        pixels: 0,
        contentHeight: 10000,
        viewport: 1000,
        trackHeight: 400,
      );
      expect(tenth.height, closeTo(40, 1e-9));
      expect(tenth.top, 0);

      // A month-sized window over ten years would vanish without the floor.
      final huge = thumbGeometry(
        pixels: 0,
        contentHeight: 1e6,
        viewport: 1000,
        trackHeight: 400,
      );
      expect(huge.height, kRailMinThumb);

      // Content that fits needs no rail at all.
      expect(
        thumbGeometry(
          pixels: 0,
          contentHeight: 800,
          viewport: 800,
          trackHeight: 400,
        ).height,
        0,
      );
    });

    test('the thumb never leaves the track', () {
      for (final pixels in <double>[0, 250, 750, 1500]) {
        final thumb = thumbGeometry(
          pixels: pixels,
          contentHeight: 2000,
          viewport: 500,
          trackHeight: 300,
        );
        expect(thumb.top, greaterThanOrEqualTo(0));
        expect(thumb.top + thumb.height, lessThanOrEqualTo(300 + 1e-9));
      }
      expect(
        thumbGeometry(
          pixels: 1500,
          contentHeight: 2000,
          viewport: 500,
          trackHeight: 300,
        ).top,
        closeTo(225, 1e-9),
      );
    });

    test('scrubbing puts the grabbed offset under the viewport centre', () {
      final fraction = railFractionForContentY(4000, contentHeight: 10000);
      expect(fraction, closeTo(0.4, 1e-9));

      expect(
        contentYForRailFraction(fraction, contentHeight: 10000, viewport: 1000),
        closeTo(3500, 1e-9),
      );

      // Both ends clamp instead of overshooting.
      expect(
        contentYForRailFraction(0, contentHeight: 10000, viewport: 1000),
        0,
      );
      expect(
        contentYForRailFraction(1, contentHeight: 10000, viewport: 1000),
        9000,
      );
    });

    test('month lookup walks the spans and holds at both ends', () {
      const months = <MonthSpan>[
        MonthSpan(key: '2025-05', label: 'May 2025', top: 0, end: 1000),
        MonthSpan(key: '2025-04', label: 'Apr 2025', top: 1000, end: 1800),
        MonthSpan(key: '2025-03', label: 'Mar 2025', top: 1800, end: 2000),
      ];

      expect(monthAtContentY(months, 0), 'May 2025');
      expect(monthAtContentY(months, 999), 'May 2025');
      expect(monthAtContentY(months, 1000), 'Apr 2025');
      expect(monthAtContentY(months, 5000), 'Mar 2025');
      expect(monthAtContentY(const <MonthSpan>[], 0), isNull);
    });

    test('a scrub snaps to the nearest month inside the tolerance', () {
      const months = <MonthSpan>[
        MonthSpan(key: '2025-05', label: 'May 2025', top: 0, end: 1000),
        MonthSpan(key: '2025-04', label: 'Apr 2025', top: 1000, end: 1800),
      ];

      // Inside the window: the month's own top wins.
      expect(snapToMonthTop(1030, months, tolerance: 100), 1000);
      expect(snapToMonthTop(950, months, tolerance: 100), 1000);
      // Outside it: the finger wins, no jump.
      expect(snapToMonthTop(1200, months, tolerance: 100), 1200);
      // The first month snaps too, and an empty list is a no-op.
      expect(snapToMonthTop(40, months, tolerance: 100), 0);
      expect(snapToMonthTop(40, const <MonthSpan>[], tolerance: 100), 40);
      // No tolerance means no snapping.
      expect(snapToMonthTop(1030, months, tolerance: 0), 1030);
    });

    test('December drops its start tick and January owns the year line', () {
      const december = MonthSpan(
        key: '2024-12',
        label: 'Dec 2024',
        top: 0,
        end: 1,
      );
      const january = MonthSpan(
        key: '2025-01',
        label: 'Jan 2025',
        top: 0,
        end: 1,
      );
      const may = MonthSpan(key: '2025-05', label: 'May 2025', top: 0, end: 1);

      expect(december.isDecember, isTrue);
      expect(december.isJanuary, isFalse);
      expect(january.isJanuary, isTrue);
      expect(may.isJanuary, isFalse);
      expect(may.isDecember, isFalse);
    });
  });
}
