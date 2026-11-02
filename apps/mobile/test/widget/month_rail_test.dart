import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:photox_mobile/ui/widgets/month_rail.dart';

MonthRailState _state({
  double pixels = 0,
  bool popup = false,
  String month = 'May 2025',
}) {
  return MonthRailState(
    contentHeight: 10000,
    viewport: 800,
    pixels: pixels,
    months: const <MonthSpan>[
      MonthSpan(key: '2025-05', label: 'May 2025', top: 0, end: 5000),
      MonthSpan(key: '2025-04', label: 'Apr 2025', top: 5000, end: 10000),
    ],
    month: month,
    showPopup: popup,
  );
}

Widget _host(
  ValueNotifier<MonthRailState?> state, {
  ValueChanged<double>? onScrub,
  ValueChanged<double>? onJump,
  ValueChanged<int>? onStep,
}) {
  return MaterialApp(
    home: Scaffold(
      body: SizedBox(
        width: MonthRail.width,
        height: 800,
        child: MonthRail(
          state: state,
          onScrub: onScrub,
          onJump: onJump,
          onStep: onStep,
        ),
      ),
    ),
  );
}

void main() {
  testWidgets('draws nothing when there is nothing to scroll', (tester) async {
    final handle = tester.ensureSemantics();
    final state = ValueNotifier<MonthRailState?>(null);
    addTearDown(state.dispose);

    await tester.pumpWidget(_host(state));
    expect(find.bySemanticsLabel('Library position'), findsNothing);

    state.value = _state();
    await tester.pump();
    expect(find.bySemanticsLabel('Library position'), findsOneWidget);
    handle.dispose();
  });

  testWidgets('a drag reports increasing rail fractions', (tester) async {
    final state = ValueNotifier<MonthRailState?>(_state());
    addTearDown(state.dispose);
    final fractions = <double>[];

    await tester.pumpWidget(_host(state, onScrub: fractions.add));
    final box = tester.getRect(find.byType(MonthRail));
    final gesture = await tester.startGesture(
      Offset(box.right - 10, box.top + 120),
    );
    for (var step = 0; step < 3; step++) {
      await gesture.moveBy(const Offset(0, 80));
      await tester.pump();
    }
    await gesture.up();
    await tester.pump();

    expect(fractions, isNotEmpty);
    expect(fractions.every((value) => value >= 0 && value <= 1), isTrue);
    expect(fractions.last, greaterThan(fractions.first));
  });

  testWidgets('a tap reports the fraction under the finger', (tester) async {
    final state = ValueNotifier<MonthRailState?>(_state());
    addTearDown(state.dispose);
    final jumps = <double>[];

    await tester.pumpWidget(_host(state, onJump: jumps.add));
    final box = tester.getRect(find.byType(MonthRail));

    await tester.tapAt(Offset(box.right - 10, box.top + 400));
    await tester.pump();

    expect(jumps, hasLength(1));
    expect(jumps.single, greaterThan(0.3));
    expect(jumps.single, lessThan(0.7));
  });

  testWidgets('the popup names the month, and only while it is asked for', (
    tester,
  ) async {
    final state = ValueNotifier<MonthRailState?>(_state());
    addTearDown(state.dispose);

    await tester.pumpWidget(_host(state));
    expect(find.text('May 2025'), findsNothing);

    state.value = _state(popup: true, pixels: 600);
    await tester.pump();
    expect(find.text('May 2025'), findsOneWidget);
  });

  testWidgets('the slider steps a month without sight', (tester) async {
    final handle = tester.ensureSemantics();
    final state = ValueNotifier<MonthRailState?>(_state());
    addTearDown(state.dispose);
    final steps = <int>[];

    await tester.pumpWidget(_host(state, onStep: steps.add));

    final node = tester.getSemantics(find.bySemanticsLabel('Library position'));
    expect(node.value, 'May 2025');
    expect(node.increasedValue, isEmpty); // May is the newest loaded month
    expect(node.decreasedValue, 'Apr 2025');

    tester.semantics.decrease(
      find.semantics.byLabel('Library position'),
    );
    await tester.pump();

    expect(steps, <int>[1]);
    handle.dispose();
  });
}
