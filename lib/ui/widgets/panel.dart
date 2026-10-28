import 'package:flutter/material.dart';

/// A low-contrast surface used for grouped content on the dark theme.
class Panel extends StatelessWidget {
  const Panel({
    super.key,
    required this.child,
    this.padding = const EdgeInsets.all(16),
  });

  /// Content laid out inside the panel.
  final Widget child;

  /// Inner spacing; the border and radius stay constant.
  final EdgeInsetsGeometry padding;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;

    return Material(
      color: scheme.surfaceContainer,
      clipBehavior: Clip.antiAlias,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(12),
        side: BorderSide(color: scheme.outlineVariant.withValues(alpha: 0.3)),
      ),
      child: Padding(padding: padding, child: child),
    );
  }
}
