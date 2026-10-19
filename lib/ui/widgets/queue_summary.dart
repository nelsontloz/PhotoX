import 'package:flutter/material.dart';

import '../../upload/upload_queue.dart';
import 'count_format.dart';
import 'panel.dart';

/// Queue counts for the home screen: uploaded, duplicate, waiting, failed.
///
/// Renders two columns on phones and four on wider layouts, and explains the
/// duplicate count the first time it is non-zero.
class QueueSummary extends StatelessWidget {
  const QueueSummary({super.key, required this.stats});

  /// Aggregate queue counts.
  final QueueStats stats;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    final total =
        stats.pending + stats.uploaded + stats.duplicate + stats.failed;

    return Panel(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Text(
            'Backup queue',
            style: theme.textTheme.titleMedium?.copyWith(
              fontWeight: FontWeight.w600,
            ),
          ),
          const SizedBox(height: 16),
          LayoutBuilder(
            builder: (context, constraints) {
              final columns = constraints.maxWidth >= 440 ? 4 : 2;
              const gap = 12.0;
              final cellWidth =
                  (constraints.maxWidth - gap * (columns - 1)) / columns;
              final cells = <Widget>[
                _StatCell(
                  label: 'Uploaded',
                  value: stats.uploaded,
                  color: scheme.primary,
                ),
                _StatCell(
                  label: 'Already backed up',
                  value: stats.duplicate,
                  color: scheme.secondary,
                ),
                _StatCell(
                  label: 'Waiting',
                  value: stats.pending,
                  color: scheme.onSurfaceVariant,
                ),
                _StatCell(
                  label: 'Failed',
                  value: stats.failed,
                  color: scheme.error,
                ),
              ];

              return Wrap(
                spacing: gap,
                runSpacing: 16,
                children: <Widget>[
                  for (final cell in cells)
                    SizedBox(width: cellWidth, child: cell),
                ],
              );
            },
          ),
          if (total == 0) ...<Widget>[
            const SizedBox(height: 16),
            Text(
              'Nothing queued yet. New camera roll items show up after a sync.',
              style: theme.textTheme.bodySmall?.copyWith(
                color: scheme.onSurfaceVariant,
                height: 1.4,
              ),
            ),
          ] else if (stats.duplicate > 0) ...<Widget>[
            const SizedBox(height: 14),
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Icon(
                  Icons.info_outline_rounded,
                  size: 15,
                  color: scheme.onSurfaceVariant,
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    'Already backed up means the server had the same file, so '
                    'it was skipped.',
                    style: theme.textTheme.bodySmall?.copyWith(
                      color: scheme.onSurfaceVariant,
                      height: 1.35,
                    ),
                  ),
                ),
              ],
            ),
          ],
        ],
      ),
    );
  }
}

class _StatCell extends StatelessWidget {
  const _StatCell({
    required this.label,
    required this.value,
    required this.color,
  });

  final String label;
  final int value;
  final Color color;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final formatted = formatCount(value);

    return Semantics(
      container: true,
      label: '$label: $formatted',
      child: ExcludeSemantics(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            FittedBox(
              fit: BoxFit.scaleDown,
              alignment: Alignment.centerLeft,
              child: Text(
                formatted,
                maxLines: 1,
                style: theme.textTheme.headlineSmall?.copyWith(
                  color: color,
                  fontWeight: FontWeight.w700,
                  letterSpacing: -0.5,
                  fontFeatures: const <FontFeature>[
                    FontFeature.tabularFigures(),
                  ],
                ),
              ),
            ),
            const SizedBox(height: 4),
            Text(
              label,
              style: theme.textTheme.bodySmall?.copyWith(
                color: theme.colorScheme.onSurfaceVariant,
                height: 1.3,
              ),
            ),
          ],
        ),
      ),
    );
  }
}
