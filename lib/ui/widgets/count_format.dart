/// Number wording shared by the home screen summaries.
library;

/// Adds thousands separators without pulling in a formatting package.
String formatCount(int value) {
  final digits = value.toString();
  final buffer = StringBuffer();
  for (var index = 0; index < digits.length; index++) {
    if (index > 0 && (digits.length - index) % 3 == 0) buffer.write(',');
    buffer.write(digits[index]);
  }
  return buffer.toString();
}

/// `1 item` / `12 items`; [singular] stays a plural-safe noun (for example
/// `new item`).
String countLabel(int value, String singular) {
  final formatted = formatCount(value);
  return '$formatted ${value == 1 ? singular : '${singular}s'}';
}
