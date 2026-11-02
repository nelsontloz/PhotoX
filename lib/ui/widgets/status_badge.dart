import 'package:flutter/material.dart';

import '../../library/backup_status.dart';

/// Corner mark on a library tile saying what the backup knows about those bytes.
///
/// Every state gets its own glyph as well as its own tint, so the six states
/// stay tellable apart without colour vision. The mark sits on a dark disc, so
/// it reads on a white sky as well as on a night shot, and it is small enough
/// to leave the photo itself unobscured.
class StatusBadge extends StatelessWidget {
  const StatusBadge({super.key, required this.status, this.fraction});

  /// What the queue (or the live transfer) says about this asset.
  final BackupStatus status;

  /// Uploaded fraction `0`..`1` for [BackupStatus.uploading]; null draws an
  /// indeterminate ring, which is what "hashing, bytes not moving yet" is.
  final double? fraction;

  /// Diameter of the mark; the grid picks the placement.
  static const double size = 22;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final style = _styleFor(scheme);

    return Semantics(
      container: true,
      label: style.label,
      child: ExcludeSemantics(
        child: SizedBox.square(
          dimension: size,
          child: DecoratedBox(
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              color: style.background,
            ),
            child: Center(
              child: status == BackupStatus.uploading
                  ? Padding(
                      padding: const EdgeInsets.all(3.5),
                      child: CircularProgressIndicator(
                        // Null while preparing: no byte count to report yet.
                        value: fraction,
                        strokeWidth: 2.2,
                        color: style.foreground,
                        backgroundColor: style.foreground.withValues(
                          alpha: 0.3,
                        ),
                      ),
                    )
                  : Icon(
                      style.icon,
                      size: style.iconSize,
                      color: style.foreground,
                    ),
            ),
          ),
        ),
      ),
    );
  }

  _BadgeStyle _styleFor(ColorScheme scheme) {
    const scrim = Color(0x8C000000);
    switch (status) {
      case BackupStatus.backedUp:
        return _BadgeStyle(
          label: 'Backed up',
          background: scrim,
          foreground: scheme.primary,
          icon: Icons.check_rounded,
        );
      case BackupStatus.uploading:
        return _BadgeStyle(
          label: _uploadingLabel,
          background: scrim,
          foreground: scheme.primary,
          icon: Icons.arrow_upward_rounded,
        );
      case BackupStatus.queued:
        return _BadgeStyle(
          label: 'Waiting to back up',
          background: scrim,
          foreground: scheme.tertiary,
          icon: Icons.schedule_rounded,
        );
      case BackupStatus.failed:
        return _BadgeStyle(
          label: 'Backup failed',
          background: scheme.error,
          foreground: scheme.onError,
          icon: Icons.priority_high_rounded,
        );
      case BackupStatus.excluded:
        return _BadgeStyle(
          label: 'Not in backup scope',
          background: const Color(0x59000000),
          foreground: scheme.onSurfaceVariant.withValues(alpha: 0.75),
          icon: Icons.do_not_disturb_alt_rounded,
        );
      case BackupStatus.unknown:
        return _BadgeStyle(
          label: 'Not backed up',
          background: scrim,
          foreground: scheme.onSurface.withValues(alpha: 0.6),
          icon: Icons.circle_outlined,
          iconSize: 9,
        );
    }
  }

  String get _uploadingLabel {
    final value = fraction;
    if (value == null) return 'Uploading';
    final percent = (value * 100).clamp(0, 100).round();
    return 'Uploading $percent%';
  }
}

/// One badge's look; the label doubles as the screen-reader text.
class _BadgeStyle {
  const _BadgeStyle({
    required this.label,
    required this.background,
    required this.foreground,
    required this.icon,
    this.iconSize = 14,
  });

  final String label;
  final Color background;
  final Color foreground;
  final IconData icon;
  final double iconSize;
}
