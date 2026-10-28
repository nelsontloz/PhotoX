import 'dart:typed_data';

import 'package:flutter/material.dart';

import '../../sync/transfer_progress.dart';
import '../../upload/upload_queue.dart';
import 'count_format.dart';
import 'panel.dart';
import 'uploading_file_row.dart';

/// Overall backup progress, photo/video counts, and the live upload speed.
class BackupProgressPanel extends StatelessWidget {
  const BackupProgressPanel({
    super.key,
    required this.stats,
    required this.progress,
    required this.paused,
    this.thumbnail,
  });

  /// Aggregate queue counts behind the overall bar.
  final QueueStats stats;

  /// Live state of the asset currently in flight.
  final TransferProgress progress;

  /// True when the user stopped backups; the panel then reads as paused.
  final bool paused;

  /// Loads thumbnail bytes for a library id; null keeps a neutral icon.
  final Future<Uint8List?> Function(String localId)? thumbnail;

  @override
  Widget build(BuildContext context) {
    // Listen locally so byte ticks rebuild just this card even if the caller
    // only rebuilds on queue changes.
    return AnimatedBuilder(
      animation: progress,
      builder: (context, _) => _buildPanel(context),
    );
  }

  Widget _buildPanel(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    final percent = (stats.fraction * 100).round();
    final allDone = stats.total > 0 && stats.completed >= stats.total;
    // Zero until a full sample window exists, so an idle card never shows
    // "0 B/s" as if the link had stalled.
    final speed =
        paused || !progress.active || progress.speedBytesPerSecond <= 0
        ? null
        : progress.speedBytesPerSecond;

    return Panel(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Row(
            children: <Widget>[
              Expanded(
                child: Text(
                  'Backed up',
                  style: theme.textTheme.titleMedium?.copyWith(
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ),
              if (allDone) ...<Widget>[
                Icon(
                  Icons.check_circle_rounded,
                  size: 20,
                  color: scheme.primary,
                ),
                const SizedBox(width: 6),
              ],
              Text(
                '$percent%',
                style: theme.textTheme.headlineSmall?.copyWith(
                  fontWeight: FontWeight.w700,
                  letterSpacing: -0.5,
                  fontFeatures: const <FontFeature>[
                    FontFeature.tabularFigures(),
                  ],
                ),
              ),
            ],
          ),
          if (speed != null) ...<Widget>[
            const SizedBox(height: 2),
            Row(
              mainAxisAlignment: MainAxisAlignment.end,
              children: <Widget>[
                Icon(
                  Icons.arrow_upward_rounded,
                  size: 14,
                  color: scheme.primary,
                ),
                const SizedBox(width: 4),
                Text(
                  formatSpeed(speed),
                  style: theme.textTheme.bodySmall?.copyWith(
                    color: scheme.primary,
                    height: 1.35,
                    fontFeatures: const <FontFeature>[
                      FontFeature.tabularFigures(),
                    ],
                  ),
                ),
              ],
            ),
          ],
          const SizedBox(height: 3),
          Text(
            'Photos ${formatCount(stats.photos)} · '
            'Videos ${formatCount(stats.videos)}',
            style: theme.textTheme.bodySmall?.copyWith(
              color: scheme.onSurfaceVariant,
              height: 1.35,
            ),
          ),
          const SizedBox(height: 12),
          Container(
            height: 1,
            color: scheme.outlineVariant.withValues(alpha: 0.3),
          ),
          const SizedBox(height: 12),
          // "This file" sits directly above "all files" so the panel reads
          // top-down; the row keeps its slot whether or not a transfer runs.
          UploadingFileRow(progress: progress, thumbnail: thumbnail),
          const SizedBox(height: 14),
          ClipRRect(
            borderRadius: BorderRadius.circular(10),
            child: LinearProgressIndicator(
              key: const Key('backup-overall-progress'),
              value: stats.fraction,
              minHeight: 10,
              color: scheme.primary,
              backgroundColor: scheme.surfaceContainerHighest,
              semanticsLabel: 'Overall backup progress',
            ),
          ),
          const SizedBox(height: 10),
          Text(
            stats.total == 0
                ? 'Waiting for the first sync.'
                : '${formatCount(stats.completed)} of '
                      '${formatCount(stats.total)} backed up',
            style: theme.textTheme.bodySmall?.copyWith(
              color: scheme.onSurfaceVariant,
            ),
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

/// `840 KB/s` or `12.4 MB/s`; decimal units, one decimal below 100.
String formatSpeed(double bytesPerSecond) => '${formatBytes(bytesPerSecond)}/s';
