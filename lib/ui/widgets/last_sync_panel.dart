import 'package:flutter/material.dart';

import '../../media/photo_observer.dart';
import '../../sync/sync_coordinator.dart';
import 'count_format.dart';
import 'panel.dart';

/// Plain-language summary of the most recent sync pass.
///
/// Line one covers the scan, the following lines cover outcomes and what is
/// still waiting. No timestamps or identifiers, because neither helps here.
class LastSyncPanel extends StatelessWidget {
  const LastSyncPanel({super.key, required this.report});

  /// Summary of the most recent pass, or null before the first one.
  final SyncReport? report;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    final current = report;
    final lines = current == null ? const <String>[] : _summaryLines(current);

    return Panel(
      padding: const EdgeInsets.fromLTRB(16, 14, 16, 14),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Row(
            children: <Widget>[
              Icon(
                Icons.history_rounded,
                size: 15,
                color: scheme.onSurfaceVariant,
              ),
              const SizedBox(width: 6),
              Expanded(
                child: Text(
                  'LAST SYNC',
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: theme.textTheme.labelSmall?.copyWith(
                    color: scheme.onSurfaceVariant,
                    fontWeight: FontWeight.w700,
                    letterSpacing: 1.3,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 8),
          if (current == null)
            Text(
              'No sync yet. Start a backup to check the camera roll.',
              style: theme.textTheme.bodyMedium?.copyWith(
                color: scheme.onSurfaceVariant,
                height: 1.4,
              ),
            )
          else
            for (var index = 0; index < lines.length; index++)
              Padding(
                padding: EdgeInsets.only(
                  bottom: index == lines.length - 1 ? 0 : 4,
                ),
                child: Text(
                  lines[index],
                  style:
                      (index == 0
                              ? theme.textTheme.bodyMedium
                              : theme.textTheme.bodySmall)
                          ?.copyWith(
                            color: index == 0
                                ? scheme.onSurface
                                : scheme.onSurfaceVariant,
                            height: 1.4,
                          ),
                ),
              ),
        ],
      ),
    );
  }

  List<String> _summaryLines(SyncReport report) {
    final lines = <String>[];
    final blocked =
        report.permission == PhotoPermission.denied ||
        report.permission == PhotoPermission.restricted ||
        report.permission == PhotoPermission.notDetermined;

    if (blocked) {
      lines.add('Photo access stopped this sync.');
    } else {
      final checked = report.scanned == 0
          ? 'Checked the camera roll.'
          : 'Checked ${countLabel(report.scanned, 'item')}.';
      final added = report.enqueued > 0
          ? ' Found ${countLabel(report.enqueued, 'new item')}.'
          : '';
      lines.add('$checked$added');

      final outcomes = <String>[];
      if (report.uploaded > 0) {
        outcomes.add('Uploaded ${countLabel(report.uploaded, 'item')}.');
      }
      if (report.duplicates > 0) {
        outcomes.add(
          '${countLabel(report.duplicates, 'item')} '
          '${report.duplicates == 1 ? 'was' : 'were'} already on the server.',
        );
      }
      if (report.failed > 0) {
        outcomes.add('${countLabel(report.failed, 'item')} could not upload.');
      }
      if (report.skipped > 0) {
        outcomes.add(
          '${countLabel(report.skipped, 'item')} skipped because the server '
          'is out of storage.',
        );
      }
      if (outcomes.isEmpty) {
        outcomes.add(
          report.enqueued > 0
              ? 'Nothing needed uploading.'
              : 'Nothing new to upload.',
        );
      }
      lines.add(outcomes.join(' '));

      if (report.remaining > 0) {
        lines.add('${countLabel(report.remaining, 'item')} still waiting.');
      }
      if (report.permission == PhotoPermission.limited) {
        lines.add('Only selected photos were checked.');
      }
    }

    if (report.authRequired) {
      lines.add('Stopped early: sign in again to continue.');
    }
    if (report.error != null && report.error!.trim().isNotEmpty) {
      lines.add('The check did not finish.');
    }
    return lines;
  }
}
