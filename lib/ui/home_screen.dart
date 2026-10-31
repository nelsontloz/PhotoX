import 'dart:typed_data';

import 'package:flutter/material.dart';

import '../media/photo_observer.dart';
import '../sync/sync_coordinator.dart';
import '../sync/transfer_progress.dart';
import '../upload/upload_queue.dart';
import 'widgets/app_background.dart';
import 'widgets/backup_progress.dart';
import 'widgets/count_format.dart';
import 'widgets/last_sync_panel.dart';
import 'widgets/panel.dart';
import 'widgets/queue_summary.dart';
import 'widgets/sign_out_dialog.dart';
import 'widgets/status_banner.dart';
import 'widgets/uploading_file_row.dart';

/// Backup dashboard: live progress, queue counts, access state, and the last
/// pass summary.
///
/// Every value and action is supplied by the caller so widgets never touch
/// services directly.
class HomeScreen extends StatelessWidget {
  const HomeScreen({
    super.key,
    required this.stats,
    required this.progress,
    required this.permission,
    required this.syncing,
    this.discovering = false,
    required this.paused,
    required this.authRequired,
    required this.lastReport,
    required this.error,
    required this.onSyncNow,
    required this.onRetryFailed,
    required this.onPause,
    required this.onResume,
    required this.onOpenSettings,
    required this.onSignOut,
    this.thumbnail,
    this.albumCount = 1,
    this.uploadAllFolders = false,
  });

  /// Aggregate queue counts.
  final QueueStats stats;

  /// Live progress of the asset currently in flight.
  final TransferProgress progress;

  /// Current photo-library permission.
  final PhotoPermission permission;

  /// True while a sync pass is running.
  final bool syncing;

  /// True while that pass is scanning the library; the queue counts still
  /// describe the previous scope until the scan ends.
  final bool discovering;

  /// True when the user has stopped backups; the primary action resumes them.
  final bool paused;

  /// True when the stored session can no longer be used.
  final bool authRequired;

  /// Summary of the most recent pass, or null before the first one.
  final SyncReport? lastReport;

  /// Last unexpected sync error, already phrased for the user.
  final String? error;

  /// Starts a sync pass, including the permission prompt when needed.
  final Future<void> Function() onSyncNow;

  /// Requeues failed and quota-skipped assets, then syncs.
  final Future<void> Function() onRetryFailed;

  /// Stops backups after the asset currently in flight.
  final Future<void> Function() onPause;

  /// Clears the pause and starts a pass immediately.
  final Future<void> Function() onResume;

  /// Opens the settings screen.
  final VoidCallback onOpenSettings;

  /// Signs out of the current account.
  final Future<void> Function() onSignOut;

  /// Loads thumbnail bytes for a library id shown in the upload row; when it
  /// is absent or returns null the row keeps a neutral icon.
  final Future<Uint8List?> Function(String localId)? thumbnail;

  /// Albums in the saved backup scope; `0` means the default camera album.
  final int albumCount;

  /// True when every album is backed up, whatever [albumCount] says.
  final bool uploadAllFolders;

  /// One line naming how much of the library is in scope.
  String get _scopeLabel {
    if (uploadAllFolders) return 'All albums';
    return albumCount > 1 ? '${formatCount(albumCount)} albums' : '1 album';
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    final banners = <Widget>[];

    if (authRequired) {
      banners.add(
        StatusBanner(
          tone: StatusTone.danger,
          icon: Icons.lock_outline_rounded,
          title: 'Sign in needed',
          message:
              'Your session has ended. Sign out, then sign in again to keep '
              'backing up.',
          action: TextButton(
            onPressed: () => _confirmSignOut(context),
            style: TextButton.styleFrom(
              foregroundColor: scheme.error,
              padding: EdgeInsets.zero,
              minimumSize: const Size(0, 40),
              tapTargetSize: MaterialTapTargetSize.shrinkWrap,
            ),
            child: const Text('Sign out'),
          ),
        ),
      );
    }

    final permissionBanner = _permissionBanner(context);
    if (permissionBanner != null) banners.add(permissionBanner);

    // A finished pass held by `wifiOnly`. Paused wins, and a running pass has
    // its own status, so a stale hold from the previous report stays hidden.
    final wifiHold = !paused && !syncing && lastReport?.waitingForWifi == true;
    if (wifiHold) {
      banners.add(
        StatusBanner(
          tone: StatusTone.warning,
          icon: Icons.wifi_off_rounded,
          title: 'Wi-Fi only is on',
          message:
              'Uploads wait until Wi-Fi is available. New photos stay queued '
              'on this phone.',
          action: TextButton(
            onPressed: onOpenSettings,
            style: TextButton.styleFrom(
              padding: EdgeInsets.zero,
              minimumSize: const Size(0, 40),
              tapTargetSize: MaterialTapTargetSize.shrinkWrap,
            ),
            child: const Text('Change in Settings'),
          ),
        ),
      );
    }

    final errorText = error?.trim();
    // The auth banner already explains a 401; a second red banner would just
    // repeat it. Other errors still surface here.
    if (!authRequired && errorText != null && errorText.isNotEmpty) {
      banners.add(
        StatusBanner(
          tone: StatusTone.danger,
          icon: Icons.cloud_off_rounded,
          title: 'Sync problem',
          message: errorText,
        ),
      );
    }

    return AppBackground(
      child: Scaffold(
        backgroundColor: Colors.transparent,
        appBar: AppBar(
          titleSpacing: 20,
          title: Row(
            children: <Widget>[
              Container(
                width: 34,
                height: 34,
                decoration: BoxDecoration(
                  color: scheme.primaryContainer,
                  borderRadius: BorderRadius.circular(10),
                ),
                child: Icon(
                  Icons.backup_rounded,
                  size: 18,
                  color: scheme.onPrimaryContainer,
                ),
              ),
              const SizedBox(width: 10),
              Flexible(
                child: Text(
                  'PhotoX',
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: theme.textTheme.titleLarge?.copyWith(
                    color: scheme.onSurface,
                    fontWeight: FontWeight.w700,
                    letterSpacing: -0.3,
                  ),
                ),
              ),
            ],
          ),
          actions: <Widget>[
            IconButton(
              tooltip: 'Sync now',
              onPressed: syncing ? null : () => onSyncNow(),
              icon: const Icon(Icons.sync_rounded),
            ),
            // The avatar is the account door: signing out is the one account
            // action this screen has, and it always asks first.
            Padding(
              padding: const EdgeInsets.only(right: 20),
              child: Tooltip(
                message: 'Sign out',
                child: InkResponse(
                  onTap: syncing ? null : () => _confirmSignOut(context),
                  radius: 20,
                  child: CircleAvatar(
                    radius: 16,
                    backgroundColor: scheme.primary,
                    child: Icon(
                      Icons.person_rounded,
                      size: 18,
                      color: scheme.onPrimary,
                    ),
                  ),
                ),
              ),
            ),
          ],
        ),
        body: SafeArea(
          top: false,
          bottom: false,
          child: SingleChildScrollView(
            padding: const EdgeInsets.fromLTRB(20, 0, 20, 24),
            child: Center(
              child: ConstrainedBox(
                constraints: const BoxConstraints(maxWidth: 680),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: <Widget>[
                    _buildSubBar(context),
                    const SizedBox(height: 18),
                    for (final banner in banners) ...<Widget>[
                      banner,
                      const SizedBox(height: 10),
                    ],
                    if (discovering)
                      const _DiscoveryPanel()
                    else ...[
                      QueueSummary(stats: stats, onRetryFailed: onRetryFailed),
                      const SizedBox(height: 12),
                      BackupProgressPanel(
                        stats: stats,
                        paused: paused,
                        animate: progress.active && !paused,
                      ),
                      const SizedBox(height: 12),
                      UploadingFileRow(
                        progress: progress,
                        waiting: stats.pending,
                        paused: paused,
                        thumbnail: thumbnail,
                      ),
                    ],
                    const SizedBox(height: 12),
                    LastSyncPanel(report: lastReport),
                  ],
                ),
              ),
            ),
          ),
        ),
        bottomNavigationBar: _BackupBar(
          syncing: syncing,
          paused: paused,
          onSyncNow: onSyncNow,
          onPause: onPause,
          onResume: onResume,
          onOpenSettings: onOpenSettings,
        ),
      ),
    );
  }

  /// Screen title, the two state pills, and the settings shortcut.
  Widget _buildSubBar(BuildContext context) {
    final theme = Theme.of(context);

    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              Text(
                'Backup Status',
                style: theme.textTheme.headlineSmall?.copyWith(
                  color: theme.colorScheme.onSurface,
                  fontWeight: FontWeight.w700,
                  letterSpacing: -0.5,
                  height: 1.15,
                ),
              ),
              const SizedBox(height: 8),
              Wrap(
                spacing: 8,
                runSpacing: 8,
                children: <Widget>[
                  _StatusPill(
                    status: _statusFor(
                      syncing: syncing,
                      discovering: discovering,
                      paused: paused,
                      waitingForWifi: lastReport?.waitingForWifi == true,
                      authRequired: authRequired,
                      permission: permission,
                      stats: stats,
                      error: error?.trim(),
                    ),
                  ),
                  _ScopePill(label: _scopeLabel),
                ],
              ),
            ],
          ),
        ),
        const SizedBox(width: 12),
        _SquareButton(
          tooltip: 'Settings',
          icon: Icons.tune_rounded,
          onPressed: onOpenSettings,
        ),
      ],
    );
  }

  Widget? _permissionBanner(BuildContext context) {
    switch (permission) {
      case PhotoPermission.authorized:
        return null;
      case PhotoPermission.limited:
        return const StatusBanner(
          tone: StatusTone.warning,
          icon: Icons.photo_library_outlined,
          title: 'Limited photo access',
          message:
              'Only the photos you selected can be backed up. Add more in '
              'your device settings.',
        );
      case PhotoPermission.notDetermined:
        // A running pass is the first proof that access works, so the banner
        // must not claim it is missing while photos are already uploading.
        if (syncing) return null;
        return const StatusBanner(
          tone: StatusTone.warning,
          icon: Icons.photo_library_outlined,
          title: 'Photo access not set up',
          message: 'Tap the button below to let PhotoX read your camera roll.',
        );
      case PhotoPermission.denied:
        return const StatusBanner(
          tone: StatusTone.danger,
          icon: Icons.block_rounded,
          title: 'Photo access is off',
          message: 'Allow photo access in your device settings, then start a backup.',
        );
      case PhotoPermission.restricted:
        return const StatusBanner(
          tone: StatusTone.danger,
          icon: Icons.block_rounded,
          title: 'Photo access is restricted',
          message:
              'Device restrictions are blocking access. Change that in your '
              'device settings, then start a backup.',
        );
    }
  }

  Future<void> _confirmSignOut(BuildContext context) async {
    final confirmed = await confirmSignOut(context);
    if (!confirmed || !context.mounted) return;

    try {
      await onSignOut();
    } on Object {
      if (!context.mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Could not sign out. Try again.')),
      );
    }
  }
}

/// Stands in for the counts while discovery runs: the queue still describes
/// the previous folder scope until the scan has queued the new one.
class _DiscoveryPanel extends StatelessWidget {
  const _DiscoveryPanel();

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;

    return Panel(
      key: const Key('discovery-progress'),
      child: Row(
        children: <Widget>[
          SizedBox.square(
            dimension: 20,
            child: CircularProgressIndicator(
              strokeWidth: 2,
              color: scheme.primary,
              semanticsLabel: 'Reading your library',
            ),
          ),
          const SizedBox(width: 14),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Text(
                  'Reading your library…',
                  style: theme.textTheme.titleSmall?.copyWith(
                    color: scheme.onSurface,
                    fontWeight: FontWeight.w600,
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  'Counting the photos in your backup folders. The numbers '
                  'appear when it finishes.',
                  style: theme.textTheme.bodySmall?.copyWith(
                    color: scheme.onSurfaceVariant,
                    height: 1.35,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

enum _StatusTone { neutral, active, warning, danger }

class _StatusInfo {
  const _StatusInfo(this.label, this.icon, this.tone);

  final String label;
  final IconData icon;
  final _StatusTone tone;
}

_StatusInfo _statusFor({
  required bool syncing,
  required bool discovering,
  required bool paused,
  required bool waitingForWifi,
  required bool authRequired,
  required PhotoPermission permission,
  required QueueStats stats,
  required String? error,
}) {
  // Paused outranks everything: the user stopped backups on purpose, and a
  // pass that is finishing the asset in flight is still "pausing".
  if (paused) {
    return _StatusInfo(
      syncing ? 'Pausing' : 'Paused',
      Icons.pause_rounded,
      _StatusTone.neutral,
    );
  }
  if (discovering) {
    return const _StatusInfo(
      'Scanning',
      Icons.search_rounded,
      _StatusTone.active,
    );
  }
  if (syncing) {
    return const _StatusInfo('Syncing', Icons.sync_rounded, _StatusTone.active);
  }
  if (authRequired) {
    return const _StatusInfo(
      'Sign in needed',
      Icons.lock_outline_rounded,
      _StatusTone.danger,
    );
  }
  if (permission == PhotoPermission.denied ||
      permission == PhotoPermission.restricted) {
    return const _StatusInfo(
      'No access',
      Icons.block_rounded,
      _StatusTone.danger,
    );
  }
  if (permission == PhotoPermission.notDetermined) {
    return const _StatusInfo(
      'Access not set',
      Icons.photo_library_outlined,
      _StatusTone.warning,
    );
  }
  if ((error != null && error.isNotEmpty) || stats.failed > 0) {
    return const _StatusInfo(
      'Needs attention',
      Icons.error_outline_rounded,
      _StatusTone.danger,
    );
  }
  if (waitingForWifi) {
    return const _StatusInfo(
      'Waiting for Wi-Fi',
      Icons.wifi_off_rounded,
      _StatusTone.warning,
    );
  }
  if (permission == PhotoPermission.limited) {
    return const _StatusInfo(
      'Limited access',
      Icons.photo_library_outlined,
      _StatusTone.warning,
    );
  }
  if (stats.pending > 0) {
    return const _StatusInfo(
      'Waiting',
      Icons.schedule_rounded,
      _StatusTone.neutral,
    );
  }
  return const _StatusInfo(
    'Up to date',
    Icons.check_circle_outline_rounded,
    _StatusTone.active,
  );
}

class _StatusPill extends StatelessWidget {
  const _StatusPill({required this.status});

  final _StatusInfo status;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    final (Color foreground, Color background) = switch (status.tone) {
      _StatusTone.active => (
        scheme.onPrimaryContainer,
        scheme.primaryContainer,
      ),
      _StatusTone.warning => (
        scheme.onTertiaryContainer,
        scheme.tertiaryContainer,
      ),
      _StatusTone.danger => (scheme.onErrorContainer, scheme.errorContainer),
      _StatusTone.neutral => (
        scheme.onSurfaceVariant,
        scheme.surfaceContainerHighest,
      ),
    };

    return Semantics(
      container: true,
      label: 'Backup status: ${status.label}',
      child: ExcludeSemantics(
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 11, vertical: 6),
          decoration: BoxDecoration(
            color: background,
            borderRadius: BorderRadius.circular(100),
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: <Widget>[
              Icon(status.icon, size: 15, color: foreground),
              const SizedBox(width: 6),
              Flexible(
                child: Text(
                  status.label,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: theme.textTheme.labelMedium?.copyWith(
                    color: foreground,
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

/// How many albums the pass reads, next to the live status.
class _ScopePill extends StatelessWidget {
  const _ScopePill({required this.label});

  final String label;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;

    return Semantics(
      container: true,
      label: 'Backup scope: $label',
      child: ExcludeSemantics(
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 11, vertical: 6),
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

/// Square icon shortcut used next to the screen title.
class _SquareButton extends StatelessWidget {
  const _SquareButton({
    required this.tooltip,
    required this.icon,
    required this.onPressed,
  });

  final String tooltip;
  final IconData icon;
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;

    return Tooltip(
      message: tooltip,
      child: Material(
        color: scheme.surfaceContainer,
        clipBehavior: Clip.antiAlias,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(10),
          side: BorderSide(
            color: scheme.outlineVariant.withValues(alpha: 0.45),
          ),
        ),
        child: InkWell(
          onTap: onPressed,
          child: SizedBox.square(
            dimension: 40,
            child: Icon(icon, size: 20, color: scheme.onSurfaceVariant),
          ),
        ),
      ),
    );
  }
}

/// What the bottom bar's primary button does, derived from app state.
enum _BackupMode { idle, syncing, paused }

class _BackupBar extends StatelessWidget {
  const _BackupBar({
    required this.syncing,
    required this.paused,
    required this.onSyncNow,
    required this.onPause,
    required this.onResume,
    required this.onOpenSettings,
  });

  final bool syncing;
  final bool paused;
  final Future<void> Function() onSyncNow;
  final Future<void> Function() onPause;
  final Future<void> Function() onResume;
  final VoidCallback onOpenSettings;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    // Paused outranks syncing: the user asked to stop, and Resume must stay
    // reachable while the asset in flight finishes.
    final mode = paused
        ? _BackupMode.paused
        : syncing
        ? _BackupMode.syncing
        : _BackupMode.idle;
    final (
      IconData icon,
      String label,
      Future<void> Function() action,
    ) = switch (mode) {
      _BackupMode.idle => (Icons.sync_rounded, 'Sync now', onSyncNow),
      _BackupMode.syncing => (Icons.pause_rounded, 'Pause', onPause),
      _BackupMode.paused => (
        Icons.play_arrow_rounded,
        'Resume backup',
        onResume,
      ),
    };

    return DecoratedBox(
      decoration: BoxDecoration(
        color: scheme.surface,
        border: Border(
          top: BorderSide(color: scheme.outlineVariant.withValues(alpha: 0.35)),
        ),
      ),
      child: SafeArea(
        top: false,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(20, 12, 20, 12),
          child: Center(
            heightFactor: 1,
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 680),
              child: Row(
                children: <Widget>[
                  Expanded(
                    child: _BarButton(
                      icon: icon,
                      label: label,
                      foreground: scheme.primary,
                      onPressed: action,
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: _BarButton(
                      icon: Icons.tune_rounded,
                      label: 'Settings',
                      foreground: scheme.onSurfaceVariant,
                      onPressed: onOpenSettings,
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// Half-width bottom action: icon plus a label that shrinks, never truncates.
class _BarButton extends StatelessWidget {
  const _BarButton({
    required this.icon,
    required this.label,
    required this.foreground,
    required this.onPressed,
  });

  final IconData icon;
  final String label;
  final Color foreground;
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;

    return Material(
      color: scheme.surfaceContainer,
      clipBehavior: Clip.antiAlias,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(12),
        side: BorderSide(color: scheme.outlineVariant.withValues(alpha: 0.45)),
      ),
      child: InkWell(
        onTap: onPressed,
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 12),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: <Widget>[
              Icon(icon, size: 18, color: foreground),
              const SizedBox(width: 8),
              Flexible(
                child: FittedBox(
                  fit: BoxFit.scaleDown,
                  child: Text(
                    label,
                    maxLines: 1,
                    style: theme.textTheme.labelLarge?.copyWith(
                      color: foreground,
                      fontWeight: FontWeight.w600,
                    ),
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
