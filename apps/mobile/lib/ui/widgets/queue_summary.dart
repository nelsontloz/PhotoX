import 'package:flutter/material.dart';

import '../../upload/upload_queue.dart';
import 'count_format.dart';

/// The three queue counts that matter at a glance: uploaded, remaining,
/// skipped.
///
/// Laid out as a fixed three-column grid, so the wording stays short and each
/// cell scales down instead of wrapping: the row keeps its shape at large text
/// sizes. A retry for the failed rows sits under the grid, not inside the
/// Skipped card, so the three numbers stay level at any text size.
class QueueSummary extends StatefulWidget {
  const QueueSummary({super.key, required this.stats, this.onRetryFailed});

  /// Aggregate queue counts.
  final QueueStats stats;

  /// Queues the failed rows again and starts a pass; absent means the host
  /// screen offers no retry, so the button is hidden rather than dead.
  final Future<void> Function()? onRetryFailed;

  @override
  State<QueueSummary> createState() => _QueueSummaryState();
}

class _QueueSummaryState extends State<QueueSummary> {
  /// True while the retry pass runs, so a double tap cannot start two.
  bool _retrying = false;

  Future<void> _retry() async {
    final retry = widget.onRetryFailed;
    if (_retrying || retry == null) return;
    setState(() => _retrying = true);
    try {
      await retry();
    } finally {
      if (mounted) setState(() => _retrying = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    final stats = widget.stats;
    final failed = stats.failed;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        // IntrinsicHeight keeps the three cards level even when one sublabel
        // is longer than the others.
        IntrinsicHeight(
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: <Widget>[
              Expanded(
                child: _MetricCard(
                  label: 'Uploaded',
                  value: stats.uploaded,
                  detail: stats.uploaded == 1 ? 'file safe' : 'files safe',
                  icon: Icons.cloud_done_rounded,
                  accent: scheme.primary,
                  glow: true,
                  semanticsLabel:
                      'Uploaded: ${formatCount(stats.uploaded)} files safe',
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: _MetricCard(
                  label: 'Remaining',
                  value: stats.pending,
                  detail: 'in queue',
                  icon: Icons.hourglass_bottom_rounded,
                  accent: scheme.tertiary,
                  glow: true,
                  semanticsLabel:
                      'Remaining: ${formatCount(stats.pending)} in queue',
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: _MetricCard(
                  label: 'Skipped',
                  value: stats.duplicate,
                  detail: failed > 0
                      ? countLabel(failed, 'error')
                      : 'no errors',
                  icon: Icons.rule_rounded,
                  accent: failed > 0 ? scheme.error : scheme.outline,
                  semanticsLabel: failed > 0
                      ? 'Skipped: ${formatCount(stats.duplicate)}, '
                            '${countLabel(failed, 'error')}'
                      : 'Skipped: ${formatCount(stats.duplicate)}, no errors',
                ),
              ),
            ],
          ),
        ),
        if (failed > 0 && widget.onRetryFailed != null) ...<Widget>[
          const SizedBox(height: 10),
          Align(
            alignment: Alignment.centerLeft,
            child: _RetryFailedButton(
              failed: failed,
              busy: _retrying,
              onPressed: _retry,
            ),
          ),
        ],
        if (stats.duplicate > 0) ...<Widget>[
          const SizedBox(height: 10),
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              Icon(
                Icons.info_outline_rounded,
                size: 14,
                color: scheme.onSurfaceVariant,
              ),
              const SizedBox(width: 6),
              Expanded(
                child: Text(
                  'Skipped means the server already had the same file.',
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
    );
  }
}

/// Bordered pill under the grid: re-queues the failed rows.
///
/// Disabled while a retry runs; the spinner replaces the icon rather than the
/// whole pill, so the row keeps its size.
class _RetryFailedButton extends StatelessWidget {
  const _RetryFailedButton({
    required this.failed,
    required this.busy,
    required this.onPressed,
  });

  /// Failed rows the button would queue again.
  final int failed;

  final bool busy;
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    final label = 'Retry ${countLabel(failed, 'failed item')}';

    return Semantics(
      button: true,
      enabled: !busy,
      label: label,
      child: Tooltip(
        message: label,
        child: Material(
          color: scheme.surfaceContainerHigh,
          clipBehavior: Clip.antiAlias,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(100),
            side: BorderSide(color: scheme.primary.withValues(alpha: 0.35)),
          ),
          child: InkWell(
            onTap: busy ? null : onPressed,
            child: ConstrainedBox(
              // 40dp minimum tap target, even at the smallest text size.
              constraints: const BoxConstraints(minHeight: 40, minWidth: 40),
              child: Padding(
                padding: const EdgeInsets.symmetric(
                  horizontal: 14,
                  vertical: 8,
                ),
                child: ExcludeSemantics(
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: <Widget>[
                      if (busy)
                        SizedBox.square(
                          dimension: 14,
                          child: CircularProgressIndicator(
                            strokeWidth: 2,
                            color: scheme.primary,
                          ),
                        )
                      else
                        Icon(
                          Icons.refresh_rounded,
                          size: 16,
                          color: scheme.primary,
                        ),
                      const SizedBox(width: 6),
                      Flexible(
                        child: Text(
                          'RETRY FAILED',
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: theme.textTheme.labelSmall?.copyWith(
                            color: scheme.primary,
                            fontWeight: FontWeight.w700,
                            letterSpacing: 1.1,
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// One cell of the metric grid: uppercase label, big count, coloured sublabel.
class _MetricCard extends StatelessWidget {
  const _MetricCard({
    required this.label,
    required this.value,
    required this.detail,
    required this.icon,
    required this.accent,
    required this.semanticsLabel,
    this.glow = false,
  });

  final String label;
  final int value;
  final String detail;
  final IconData icon;
  final Color accent;
  final String semanticsLabel;

  /// Soft blurred blob in the top-right corner, as on the mockup's first two
  /// cards.
  final bool glow;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;

    return Semantics(
      container: true,
      label: semanticsLabel,
      child: ExcludeSemantics(
        child: DecoratedBox(
          decoration: BoxDecoration(
            color: scheme.surfaceContainerLow,
            borderRadius: BorderRadius.circular(12),
            border: Border.all(
              color: scheme.outlineVariant.withValues(alpha: 0.32),
            ),
          ),
          child: ClipRRect(
            borderRadius: BorderRadius.circular(12),
            child: Stack(
              // The card fills the grid row so the numbers line up.
              fit: StackFit.passthrough,
              children: <Widget>[
                if (glow)
                  Positioned(
                    top: -24,
                    right: -24,
                    child: IgnorePointer(
                      child: Container(
                        width: 64,
                        height: 64,
                        decoration: BoxDecoration(
                          shape: BoxShape.circle,
                          gradient: RadialGradient(
                            colors: <Color>[
                              accent.withValues(alpha: 0.34),
                              accent.withValues(alpha: 0),
                            ],
                          ),
                        ),
                      ),
                    ),
                  ),
                Padding(
                  padding: const EdgeInsets.all(12),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: <Widget>[
                      Row(
                        children: <Widget>[
                          Expanded(
                            child: FittedBox(
                              fit: BoxFit.scaleDown,
                              alignment: Alignment.centerLeft,
                              child: Text(
                                label.toUpperCase(),
                                maxLines: 1,
                                style: theme.textTheme.labelSmall?.copyWith(
                                  color: scheme.onSurfaceVariant,
                                  fontWeight: FontWeight.w700,
                                  letterSpacing: 1.1,
                                ),
                              ),
                            ),
                          ),
                          const SizedBox(width: 4),
                          Icon(icon, size: 14, color: accent),
                        ],
                      ),
                      const SizedBox(height: 10),
                      FittedBox(
                        fit: BoxFit.scaleDown,
                        alignment: Alignment.centerLeft,
                        child: Text(
                          formatCount(value),
                          maxLines: 1,
                          style: theme.textTheme.headlineSmall?.copyWith(
                            color: scheme.onSurface,
                            fontWeight: FontWeight.w700,
                            letterSpacing: -0.6,
                            height: 1.1,
                            fontFeatures: const <FontFeature>[
                              FontFeature.tabularFigures(),
                            ],
                          ),
                        ),
                      ),
                      const SizedBox(height: 2),
                      FittedBox(
                        fit: BoxFit.scaleDown,
                        alignment: Alignment.centerLeft,
                        child: Text(
                          detail,
                          maxLines: 1,
                          style: theme.textTheme.labelSmall?.copyWith(
                            color: accent,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
