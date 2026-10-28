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

/// `840 KB/s` or `12.4 MB/s`; decimal units, one decimal below 100.
String formatSpeed(double bytesPerSecond) => '${formatBytes(bytesPerSecond)}/s';

/// `840 KB` or `12.4 MB`; decimal units, one decimal below 100.
String formatBytes(num bytes) {
  const units = <String>['B', 'KB', 'MB', 'GB', 'TB'];
  var value = bytes < 0 ? 0.0 : bytes.toDouble();
  var index = 0;
  while (value >= 999.5 && index < units.length - 1) {
    value /= 1000;
    index++;
  }
  if (index == 0) return '${value.round()} ${units[index]}';
  final text = value < 100
      ? value.toStringAsFixed(1)
      : value.toStringAsFixed(0);
  return '$text ${units[index]}';
}
