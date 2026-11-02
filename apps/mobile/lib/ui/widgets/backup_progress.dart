import 'package:flutter/material.dart';

import '../../upload/upload_queue.dart';
import 'count_format.dart';

/// Overall backup progress: the share of the whole queue that is done.
class BackupProgressPanel extends StatelessWidget {
  const BackupProgressPanel({
    super.key,
    required this.stats,
    required this.paused,
    this.animate = false,
  });

  /// Aggregate queue counts behind the bar.
  final QueueStats stats;

  /// True when the user stopped backups; the panel then says so.
  final bool paused;

  /// True while bytes are actually moving; the bar's sheen pulses only then.
  final bool animate;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    final percent = (stats.fraction * 100).round();
    final total = stats.total == 0
        ? 'Nothing queued yet.'
        : '${formatCount(stats.completed)} / ${formatCount(stats.total)} '
              '${stats.total == 1 ? 'file' : 'files'} synced';

    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: scheme.surfaceContainer,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: scheme.outlineVariant.withValues(alpha: 0.3)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Row(
            children: <Widget>[
              Container(
                width: 28,
                height: 28,
                decoration: BoxDecoration(
                  // 20% of the CTA blue behind a light-blue icon, as on the
                  // mockup; a solid tile would out-shout the bar.
                  color: scheme.primaryContainer.withValues(alpha: 0.2),
                  borderRadius: BorderRadius.circular(8),
                ),
                child: Icon(
                  Icons.backup_rounded,
                  size: 16,
                  color: scheme.primary,
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: Text(
                  'Total Backup Progress',
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: theme.textTheme.titleSmall?.copyWith(
                    color: scheme.onSurface,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ),
              const SizedBox(width: 8),
              Container(
                padding: const EdgeInsets.symmetric(
                  horizontal: 10,
                  vertical: 4,
                ),
                decoration: BoxDecoration(
                  color: scheme.primaryContainer,
                  borderRadius: BorderRadius.circular(100),
                ),
                child: Text(
                  '$percent%',
                  style: theme.textTheme.labelMedium?.copyWith(
                    color: scheme.onPrimaryContainer,
                    fontWeight: FontWeight.w700,
                    fontFeatures: const <FontFeature>[
                      FontFeature.tabularFigures(),
                    ],
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 14),
          BackupProgressTrack(
            key: const Key('backup-overall-progress'),
            value: stats.fraction,
            animate: animate,
          ),
          const SizedBox(height: 10),
          // Left: how much of the queue is done. Right: what the queue holds,
          // because a time estimate would be a guess.
          Wrap(
            spacing: 12,
            runSpacing: 4,
            alignment: WrapAlignment.spaceBetween,
            crossAxisAlignment: WrapCrossAlignment.center,
            children: <Widget>[
              Text(
                total,
                style: theme.textTheme.bodySmall?.copyWith(
                  color: scheme.onSurfaceVariant,
                ),
              ),
              Row(
                mainAxisSize: MainAxisSize.min,
                children: <Widget>[
                  Icon(
                    Icons.photo_library_outlined,
                    size: 13,
                    color: scheme.primary,
                  ),
                  const SizedBox(width: 4),
                  Flexible(
                    child: Text(
                      '${countLabel(stats.photos, 'photo')} · '
                      '${countLabel(stats.videos, 'video')}',
                      maxLines: 2,
                      style: theme.textTheme.bodySmall?.copyWith(
                        color: scheme.primary,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ),
                ],
              ),
            ],
          ),
          if (paused) ...<Widget>[
            const SizedBox(height: 12),
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Icon(
                  Icons.pause_circle_outline_rounded,
                  size: 16,
                  color: scheme.tertiary,
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    'Backups are paused. Resume when you are ready.',
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

/// The overall bar: an inset pill track with a solid fill, a soft glow and a
/// pulsing sheen across the filled part.
class BackupProgressTrack extends StatelessWidget {
  const BackupProgressTrack({
    super.key,
    required this.value,
    this.height = 12,
    this.animate = false,
  });

  /// Completed fraction, `0`..`1`.
  final double value;

  /// Track height, including the 2px inset around the fill.
  final double height;

  /// True while bytes are moving. The sheen is the only animation here, and it
  /// is stopped and reset when this goes false, so an idle dashboard schedules
  /// no frames.
  final bool animate;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final fraction = value.isNaN ? 0.0 : value.clamp(0.0, 1.0);

    return Semantics(
      label: 'Overall backup progress',
      value: '${(fraction * 100).round()} percent',
      child: Container(
        height: height,
        padding: const EdgeInsets.all(2),
        decoration: BoxDecoration(
          color: scheme.surfaceContainerHighest,
          borderRadius: BorderRadius.circular(100),
        ),
        child: TweenAnimationBuilder<double>(
          tween: Tween<double>(end: fraction),
          duration: const Duration(milliseconds: 700),
          curve: Curves.easeOut,
          builder: (context, width, _) {
            // A zero-width pill would still paint its shadow as a blob.
            if (width <= 0) return const SizedBox.shrink();
            return Align(
              alignment: Alignment.centerLeft,
              child: FractionallySizedBox(
                widthFactor: width,
                heightFactor: 1,
                child: DecoratedBox(
                  decoration: BoxDecoration(
                    color: scheme.primaryContainer,
                    borderRadius: BorderRadius.circular(100),
                    boxShadow: <BoxShadow>[
                      BoxShadow(
                        color: scheme.primary.withValues(alpha: 0.4),
                        blurRadius: 12,
                      ),
                    ],
                  ),
                  child: ClipRRect(
                    borderRadius: BorderRadius.circular(100),
                    child: _Sheen(animate: animate),
                  ),
                ),
              ),
            );
          },
        ),
      ),
    );
  }
}

/// White 20% overlay that fades back and forth while a transfer runs.
class _Sheen extends StatefulWidget {
  const _Sheen({required this.animate});

  final bool animate;

  @override
  State<_Sheen> createState() => _SheenState();
}

class _SheenState extends State<_Sheen> with SingleTickerProviderStateMixin {
  late final AnimationController _controller = AnimationController(
    vsync: this,
    duration: const Duration(seconds: 2),
  );

  @override
  void initState() {
    super.initState();
    if (widget.animate) _controller.repeat(reverse: true);
  }

  @override
  void didUpdateWidget(_Sheen oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.animate == oldWidget.animate) return;
    if (widget.animate) {
      _controller.repeat(reverse: true);
    } else {
      _controller.stop();
      _controller.value = 0;
    }
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: _controller,
      builder: (context, _) => ColoredBox(
        color: Colors.white.withValues(
          alpha: 0.2 * (1 - 0.5 * _controller.value),
        ),
      ),
    );
  }
}
