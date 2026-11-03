import 'package:flutter/material.dart';

/// Scope pill: which albums the backup reads.
class ScopePill extends StatelessWidget {
  const ScopePill({
    super.key,
    required this.label,
    this.padding = const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
  });

  final String label;

  /// Inner spacing; the pill's colours and radius stay constant.
  final EdgeInsetsGeometry padding;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;

    return Semantics(
      container: true,
      label: 'Backup scope: $label',
      child: ExcludeSemantics(
        child: Container(
          padding: padding,
          decoration: BoxDecoration(
            color: scheme.surfaceContainer,
            borderRadius: BorderRadius.circular(100),
            border: Border.all(
              color: scheme.outlineVariant.withValues(alpha: 0.5),
            ),
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: <Widget>[
              DecoratedBox(
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  color: scheme.primary,
                ),
                child: const SizedBox.square(dimension: 6),
              ),
              const SizedBox(width: 6),
              Flexible(
                child: Text(
                  label,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: theme.textTheme.labelMedium?.copyWith(
                    color: scheme.onSurfaceVariant,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
