import 'package:flutter_test/flutter_test.dart';
import 'package:photox_mobile/app.dart';

void main() {
  testWidgets('PhotoXApp shows the PhotoX app bar', (tester) async {
    await tester.pumpWidget(const PhotoXApp());

    expect(find.text('PhotoX'), findsOneWidget);
  });
}
