import 'package:flutter/material.dart';

/// Small uppercase heading that separates settings groups.
class SectionLabel extends StatelessWidget {
  const SectionLabel(this.label, {super.key});

  /// Plain-language group name, for example `Backup`.
  final String label;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Padding(
      padding: const EdgeInsets.fromLTRB(4, 26, 4, 8),
      child: Text(
        label.toUpperCase(),
        style: theme.textTheme.labelSmall?.copyWith(
          color: theme.colorScheme.onSurfaceVariant,
          fontWeight: FontWeight.w600,
          letterSpacing: 1.2,
        ),
      ),
    );
  }
}
