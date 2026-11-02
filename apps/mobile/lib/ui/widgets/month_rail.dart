import 'dart:math' as math;

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';

/// Unused space at both ends of the rail, matching the web timeline's strip.
const double kRailInset = 16;

/// Shortest thumb the rail ever draws, so a huge library stays grabbable.
const double kRailMinThumb = 32;

/// One month of the loaded library, with its exact place in the row model.
///
/// Months are ordered like the grid: newest first.
class MonthSpan {
  const MonthSpan({
    required this.key,
    required this.label,
    required this.top,
    required this.end,
  });

  /// `YYYY-MM`; only the month/year boundary tests look at it.
  final String key;

  /// Display label, e.g. `May 2025`.
  final String label;

  /// Content offset of the month's first row.
  final double top;

  /// Content offset just past the month's last row — where the year flips.
  final double end;

  /// December's start tick is dropped: it coincides with the year line.
  bool get isDecember => key.endsWith('-12');

  /// January owns the year line, drawn at [end].
  bool get isJanuary => key.endsWith('-01');
}

/// Where a content offset sits on the rail, `0`..`1`.
double railFractionForContentY(
  double contentY, {
  required double contentHeight,
}) {
  if (contentHeight <= 0) return 0;
  return (contentY / contentHeight).clamp(0.0, 1.0).toDouble();
}

/// Content offset a rail grab points at, with the viewport centred on it.
///
/// Deliberately the inverse of [railFractionForContentY] up to that centring,
/// so whatever sits under the finger is placed under the viewport's middle —
/// which is the month the popup names.
double contentYForRailFraction(
  double fraction, {
  required double contentHeight,
  required double viewport,
}) {
  final maxScroll = math.max(0.0, contentHeight - viewport);
  final offset =
      fraction.clamp(0.0, 1.0).toDouble() * contentHeight - viewport / 2;
  return offset.clamp(0.0, maxScroll).toDouble();
}

/// Thumb rectangle for a content offset, proportional to the viewport.
///
/// A zero height means "nothing to scroll": the caller hides the rail.
({double top, double height}) thumbGeometry({
  required double pixels,
  required double contentHeight,
  required double viewport,
  required double trackHeight,
}) {
  if (contentHeight <= 0 || trackHeight <= 0 || contentHeight <= viewport) {
    return (top: 0, height: 0);
  }
  final height = (viewport / contentHeight * trackHeight)
      .clamp(kRailMinThumb, trackHeight)
      .toDouble();
  final top = (pixels / contentHeight * trackHeight)
      .clamp(0.0, trackHeight - height)
      .toDouble();
  return (top: top, height: height);
}

/// Month covering a content offset, or null when nothing is loaded.
String? monthAtContentY(List<MonthSpan> months, double contentY) {
  if (months.isEmpty) return null;
  var label = months.first.label;
  for (final month in months) {
    if (contentY < month.top) break;
    label = month.label;
  }
  return label;
}

/// The month start nearest [offset], when it is within [tolerance].
///
/// Snapping matters on a phone: the rail is a few hundred pixels tall over a
/// library of years, so a finger cannot land inside a month on purpose.
double snapToMonthTop(
  double offset,
  List<MonthSpan> months, {
  required double tolerance,
}) {
  if (months.isEmpty || tolerance <= 0) return offset;
  var target = offset;
  var closest = tolerance;
  var snapped = false;
  for (final month in months) {
    final distance = (month.top - offset).abs();
    if (distance > tolerance) continue;
    if (snapped && distance >= closest) continue;
    closest = distance;
    target = month.top;
    snapped = true;
  }
  return target;
}

/// Everything the rail draws for one scroll position.
class MonthRailState {
  const MonthRailState({
    required this.contentHeight,
    required this.viewport,
    required this.pixels,
    required this.months,
    required this.month,
    required this.showPopup,
  });

  /// Height of the whole scrollable content, loaded rows included.
  final double contentHeight;

  /// Height of the viewport the grid scrolls in.
  final double viewport;

  /// Current scroll offset.
  final double pixels;

  /// Months currently in [top]/[end] content coordinates.
  final List<MonthSpan> months;

  /// Month under the viewport's middle, shown in the popup.
  final String? month;

  /// True while the popup is worth showing: scrolling, or being scrubbed.
  final bool showPopup;

  /// True when nothing the rail draws changed; a sub-pixel scroll or a timer
  /// expiry is not worth a repaint.
  bool sameAs(MonthRailState other) =>
      contentHeight == other.contentHeight &&
      viewport == other.viewport &&
      months == other.months &&
      month == other.month &&
      showPopup == other.showPopup &&
      (pixels - other.pixels).abs() < 0.5;
}

/// Chronological scrollbar: a rail over the grid's right edge with one tick per
/// loaded month, a thumb proportional to the viewport, and a month popup.
///
/// It reports positions as a `0`..`1` fraction of the rail instead of pixels, so
/// the caller owns the content geometry and this widget owns only what is drawn.
class MonthRail extends StatelessWidget {
  const MonthRail({
    super.key,
    required this.state,
    this.onScrubStart,
    this.onScrub,
    this.onScrubEnd,
    this.onJump,
    this.onStep,
  });

  /// Live rail geometry; null hides the rail.
  final ValueListenable<MonthRailState?> state;

  final VoidCallback? onScrubStart;

  /// Drag position as a fraction of the track.
  final ValueChanged<double>? onScrub;

  final VoidCallback? onScrubEnd;

  /// Tap position as a fraction of the track.
  final ValueChanged<double>? onJump;

  /// Accessibility stepping, in months: `1` older, `-1` newer.
  final ValueChanged<int>? onStep;

  /// Width of the grabbable strip inside this widget's (wider) box.
  static const double strip = 26;

  /// Width this widget needs, so the popup fits to the left of the strip.
  static const double width = 150;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;

    return ValueListenableBuilder<MonthRailState?>(
      valueListenable: state,
      builder: (context, rail, _) {
        if (rail == null) return const SizedBox.shrink();

        return LayoutBuilder(
          builder: (context, constraints) {
            final trackHeight = constraints.maxHeight - 2 * kRailInset;
            if (trackHeight <= 0) return const SizedBox.shrink();
            final thumb = thumbGeometry(
              pixels: rail.pixels,
              contentHeight: rail.contentHeight,
              viewport: rail.viewport,
              trackHeight: trackHeight,
            );
            if (thumb.height <= 0) return const SizedBox.shrink();

            double fractionFor(Offset local) =>
                ((local.dy - kRailInset) / trackHeight)
                    .clamp(0.0, 1.0)
                    .toDouble();

            final popupTop = (kRailInset + thumb.top + thumb.height / 2 - 14)
                .clamp(0.0, math.max(0.0, constraints.maxHeight - 28))
                .toDouble();

            // Stepping needs the neighbours named, and Flutter requires a value
            // pair for every action it is given.
            final index = rail.months.indexWhere(
              (month) => month.label == rail.month,
            );
            final newer = index > 0 ? rail.months[index - 1].label : null;
            final older = index >= 0 && index + 1 < rail.months.length
                ? rail.months[index + 1].label
                : null;

            return Stack(
              children: <Widget>[
                Positioned(
                  top: 0,
                  bottom: 0,
                  right: 0,
                  width: strip,
                  child: Semantics(
                    slider: true,
                    label: 'Library position',
                    value: rail.month ?? '',
                    increasedValue: newer,
                    decreasedValue: older,
                    onIncrease: onStep == null || newer == null
                        ? null
                        : () => onStep!(-1),
                    onDecrease: onStep == null || older == null
                        ? null
                        : () => onStep!(1),
                    child: GestureDetector(
                      behavior: HitTestBehavior.opaque,
                      onVerticalDragStart: (_) => onScrubStart?.call(),
                      onVerticalDragUpdate: (details) =>
                          onScrub?.call(fractionFor(details.localPosition)),
                      onVerticalDragEnd: (_) => onScrubEnd?.call(),
                      onVerticalDragCancel: () => onScrubEnd?.call(),
                      onTapUp: (details) =>
                          onJump?.call(fractionFor(details.localPosition)),
                      child: CustomPaint(
                        painter: _RailPainter(
                          months: rail.months,
                          contentHeight: rail.contentHeight,
                          trackHeight: trackHeight,
                          thumbTop: thumb.top,
                          thumbHeight: thumb.height,
                          scrubbing: rail.showPopup,
                          railColor: scheme.onSurface.withValues(alpha: 0.12),
                          tickColor: scheme.onSurfaceVariant.withValues(
                            alpha: 0.45,
                          ),
                          yearColor: scheme.primary,
                          thumbColor: rail.showPopup
                              ? scheme.primary
                              : scheme.onSurfaceVariant.withValues(alpha: 0.8),
                        ),
                      ),
                    ),
                  ),
                ),
                if (rail.showPopup && rail.month != null)
                  Positioned(
                    right: strip + 4,
                    top: popupTop,
                    child: IgnorePointer(
                      child: DecoratedBox(
                        decoration: BoxDecoration(
                          color: scheme.surfaceContainerHigh,
                          borderRadius: BorderRadius.circular(8),
                          border: Border.all(
                            color: scheme.outlineVariant.withValues(alpha: 0.5),
                          ),
                          boxShadow: const <BoxShadow>[
                            BoxShadow(
                              color: Color(0x66000000),
                              blurRadius: 8,
                              offset: Offset(0, 2),
                            ),
                          ],
                        ),
                        child: Padding(
                          padding: const EdgeInsets.symmetric(
                            horizontal: 10,
                            vertical: 5,
                          ),
                          child: Text(
                            rail.month!,
                            style: theme.textTheme.labelLarge?.copyWith(
                              color: scheme.onSurface,
                              fontWeight: FontWeight.w700,
                            ),
                          ),
                        ),
                      ),
                    ),
                  ),
              ],
            );
          },
        );
      },
    );
  }
}

/// Draws the rail, its month ticks and the thumb in one pass.
///
/// Painting beats one widget per tick: a library of ten years has ~120 ticks
/// and they would otherwise be rebuilt on every scroll frame.
class _RailPainter extends CustomPainter {
  const _RailPainter({
    required this.months,
    required this.contentHeight,
    required this.trackHeight,
    required this.thumbTop,
    required this.thumbHeight,
    required this.scrubbing,
    required this.railColor,
    required this.tickColor,
    required this.yearColor,
    required this.thumbColor,
  });

  final List<MonthSpan> months;
  final double contentHeight;
  final double trackHeight;
  final double thumbTop;
  final double thumbHeight;
  final bool scrubbing;
  final Color railColor;
  final Color tickColor;
  final Color yearColor;
  final Color thumbColor;

  @override
  void paint(Canvas canvas, Size size) {
    final centre = size.width / 2;

    canvas.drawRRect(
      RRect.fromRectAndRadius(
        Rect.fromLTWH(centre - 2, kRailInset, 4, trackHeight),
        const Radius.circular(2),
      ),
      Paint()..color = railColor,
    );

    final tick = Paint()
      ..strokeWidth = 2
      ..strokeCap = StrokeCap.round;
    for (final month in months) {
      if (!month.isDecember) {
        final y =
            kRailInset +
            railFractionForContentY(month.top, contentHeight: contentHeight) *
                trackHeight;
        tick.color = tickColor;
        canvas.drawLine(Offset(centre - 5, y), Offset(centre + 5, y), tick);
      }
      if (month.isJanuary) {
        // The year line sits where December meets January.
        final y =
            kRailInset +
            railFractionForContentY(month.end, contentHeight: contentHeight) *
                trackHeight;
        tick.color = yearColor;
        canvas.drawLine(Offset(centre - 8, y), Offset(centre + 8, y), tick);
      }
    }

    final halfWidth = scrubbing ? 3.5 : 3.0;
    canvas.drawRRect(
      RRect.fromRectAndRadius(
        Rect.fromLTWH(
          centre - halfWidth,
          kRailInset + thumbTop,
          halfWidth * 2,
          thumbHeight,
        ),
        Radius.circular(halfWidth),
      ),
      Paint()..color = thumbColor,
    );
  }

  @override
  bool shouldRepaint(covariant _RailPainter old) =>
      old.months != months ||
      old.contentHeight != contentHeight ||
      old.trackHeight != trackHeight ||
      old.thumbTop != thumbTop ||
      old.thumbHeight != thumbHeight ||
      old.scrubbing != scrubbing ||
      old.railColor != railColor ||
      old.tickColor != tickColor ||
      old.yearColor != yearColor ||
      old.thumbColor != thumbColor;
}
