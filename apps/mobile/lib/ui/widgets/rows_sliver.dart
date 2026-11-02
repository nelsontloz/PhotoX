import 'package:flutter/rendering.dart';
import 'package:flutter/widgets.dart';

/// A sliver over rows whose offsets are already known.
///
/// The grid builds every row's height before it lays anything out, so the total
/// extent is a fact rather than an estimate: the usual [SliverList] guesses from
/// the rows it has built, which makes `maxScrollExtent` drift while scrolling
/// and clamps a deep `jumpTo` short of where it was asked to go. Here every
/// offset comes from [RowsLayout], so the extent is exact from the first frame
/// and the month rail can be proportional to it.
@immutable
class RowsLayout {
  const RowsLayout(this.tops);

  /// Absolute top of each row in scroll coordinates; the last entry is the
  /// total extent, so `tops.length == rowCount + 1`.
  final List<double> tops;

  int get rowCount => tops.isEmpty ? 0 : tops.length - 1;

  double get totalExtent => tops.isEmpty ? 0 : tops.last;

  /// Height of one row, from the same table the offsets come from.
  double heightOf(int index) {
    if (index < 0 || index + 1 >= tops.length) return 0;
    return tops[index + 1] - tops[index];
  }

  /// Row covering [offset]; rows tile the list, so a binary search is exact.
  int rowAt(double offset) {
    if (rowCount == 0) return 0;
    var low = 0;
    var high = rowCount - 1;
    while (low < high) {
      final mid = (low + high + 1) >> 1;
      if (tops[mid] <= offset) {
        low = mid;
      } else {
        high = mid - 1;
      }
    }
    return low;
  }
}

/// Lays out [RowsLayout] rows with their exact extents, lazily, like
/// [SliverVariedExtentList] but with O(log n) index lookups and an O(1) extent.
class SliverRows extends SliverMultiBoxAdaptorWidget {
  const SliverRows({super.key, required super.delegate, required this.layout});

  /// Offsets and heights of every row, owned by the caller.
  final RowsLayout layout;

  @override
  RenderSliverRows createRenderObject(BuildContext context) => RenderSliverRows(
    childManager: context as SliverMultiBoxAdaptorElement,
    layout: layout,
  );

  @override
  void updateRenderObject(BuildContext context, RenderSliverRows renderObject) {
    renderObject.rows = layout;
  }
}

/// [RenderSliverVariedExtentList] with the row table behind every lookup.
class RenderSliverRows extends RenderSliverVariedExtentList {
  RenderSliverRows({required super.childManager, required RowsLayout layout})
    : super(itemExtentBuilder: _zeroExtent) {
    rows = layout;
  }

  /// Replaced by [rows] before anything is laid out.
  static double _zeroExtent(int index, SliverLayoutDimensions? dimensions) => 0;

  RowsLayout _rows = const RowsLayout(<double>[0]);

  /// Offsets and heights to lay out; a new table re-lays the sliver.
  set rows(RowsLayout value) {
    if (identical(value, _rows)) return;
    _rows = value;
    itemExtentBuilder = (index, dimensions) => value.heightOf(index);
    markNeedsLayout();
  }

  @override
  double indexToLayoutOffset(double itemExtent, int index) {
    if (index < 0) return 0;
    if (index >= _rows.tops.length) return _rows.totalExtent;
    return _rows.tops[index];
  }

  @override
  int getMinChildIndexForScrollOffset(
    double scrollOffset, [
    double? itemExtent,
  ]) {
    if (_rows.rowCount == 0) return 0;
    return _rows.rowAt(scrollOffset);
  }

  @override
  int getMaxChildIndexForScrollOffset(
    double scrollOffset, [
    double? itemExtent,
  ]) {
    if (_rows.rowCount == 0) return 0;
    return _rows.rowAt(scrollOffset);
  }

  @override
  double estimateMaxScrollOffset(
    SliverConstraints constraints, {
    int? firstIndex,
    int? lastIndex,
    double? leadingScrollOffset,
    double? trailingScrollOffset,
  }) => _rows.totalExtent;

  @override
  double computeMaxScrollOffset(
    SliverConstraints constraints,
    double itemExtent,
  ) => _rows.totalExtent;
}
