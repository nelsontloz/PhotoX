import 'dart:typed_data';

import 'package:flutter/material.dart';

import '../media/photo_observer.dart';
import '../sync/sync_coordinator.dart';
import '../sync/transfer_progress.dart';
import '../upload/upload_queue.dart';
import 'widgets/app_background.dart';
import 'widgets/backup_progress.dart';
import 'widgets/last_sync_panel.dart';
import 'widgets/queue_summary.dart';
import 'widgets/sign_out_dialog.dart';
import 'widgets/status_banner.dart';

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
    required this.paused,
    required this.authRequired,
    required this.lastReport,
    required this.error,
    required this.onSyncNow,
    required this.onPause,
    required this.onResume,
    required this.onOpenSettings,
    required this.onSignOut,
    this.thumbnail,
  });

  /// Aggregate queue counts.
  final QueueStats stats;

  /// Live progress of the asset currently in flight.
  final TransferProgress progress;

  /// Current photo-library permission.
  final PhotoPermission permission;

  /// True while a sync pass is running.
  final bool syncing;

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
          backgroundColor: Colors.transparent,
          surfaceTintColor: Colors.transparent,
          elevation: 0,
          scrolledUnderElevation: 0,
          titleSpacing: 20,
          title: const Text('PhotoX'),
          titleTextStyle: theme.textTheme.titleLarge?.copyWith(
            color: scheme.onSurface,
            fontWeight: FontWeight.w700,
            letterSpacing: -0.3,
          ),
          actions: <Widget>[
            IconButton(
              tooltip: 'Settings',
              onPressed: onOpenSettings,
              icon: const Icon(Icons.settings_outlined),
            ),
            const SizedBox(width: 8),
          ],
        ),
        body: SafeArea(
          top: false,
          bottom: false,
          child: SingleChildScrollView(
            padding: const EdgeInsets.fromLTRB(20, 4, 20, 28),
            child: Center(
              child: ConstrainedBox(
                constraints: const BoxConstraints(maxWidth: 680),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: <Widget>[
                    Align(
                      alignment: Alignment.centerLeft,
                      child: _StatusPill(
                        status: _statusFor(
                          syncing: syncing,
                          paused: paused,
                          waitingForWifi: lastReport?.waitingForWifi == true,
                          authRequired: authRequired,
                          permission: permission,
                          stats: stats,
                          error: errorText,
                        ),
                      ),
                    ),
                    const SizedBox(height: 14),
                    Text(
                      'Camera roll',
                      style: theme.textTheme.headlineSmall?.copyWith(
                        fontWeight: FontWeight.w700,
                        letterSpacing: -0.4,
                      ),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      'Backs up your photos and videos to your PhotoX server.',
                      style: theme.textTheme.bodyMedium?.copyWith(
                        color: scheme.onSurfaceVariant,
                        height: 1.4,
                      ),
                    ),
                    const SizedBox(height: 20),
                    for (final banner in banners) ...<Widget>[
                      banner,
                      const SizedBox(height: 12),
                    ],
                    BackupProgressPanel(
                      stats: stats,
                      progress: progress,
                      paused: paused,
                      thumbnail: thumbnail,
                    ),
                    const SizedBox(height: 16),
                    QueueSummary(stats: stats),
                    const SizedBox(height: 16),
                    LastSyncPanel(report: lastReport),
                    const SizedBox(height: 8),
                    Align(
                      alignment: Alignment.center,
                      child: TextButton.icon(
                        onPressed: syncing
                            ? null
                            : () => _confirmSignOut(context),
                        icon: const Icon(Icons.logout_rounded, size: 18),
                        label: const Text('Sign out'),
                        style: TextButton.styleFrom(
                          foregroundColor: scheme.onSurfaceVariant,
                        ),
                      ),
                    ),
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
        ),
      ),
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

enum _StatusTone { neutral, active, warning, danger }

class _StatusInfo {
  const _StatusInfo(this.label, this.icon, this.tone);

  final String label;
  final IconData icon;
  final _StatusTone tone;
}

_StatusInfo _statusFor({
  required bool syncing,
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

/// What the bottom bar's single button does, derived from app state.
enum _BackupMode { idle, syncing, paused }

class _BackupBar extends StatelessWidget {
  const _BackupBar({
    required this.syncing,
    required this.paused,
    required this.onSyncNow,
    required this.onPause,
    required this.onResume,
  });

  final bool syncing;
  final bool paused;
  final Future<void> Function() onSyncNow;
  final Future<void> Function() onPause;
  final Future<void> Function() onResume;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
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
    // Stopping is a calmer action than starting, so it gets the tonal fill.
    final tonal = mode == _BackupMode.syncing;

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
              child: SizedBox(
                width: double.infinity,
                child: FilledButton.icon(
                  onPressed: action,
                  style: FilledButton.styleFrom(
                    minimumSize: const Size.fromHeight(54),
                    padding: const EdgeInsets.symmetric(
                      horizontal: 20,
                      vertical: 14,
                    ),
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(16),
                    ),
                    backgroundColor: tonal ? scheme.secondaryContainer : null,
                    foregroundColor: tonal ? scheme.onSecondaryContainer : null,
                    textStyle: theme.textTheme.titleMedium?.copyWith(
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                  icon: Icon(icon, size: 21),
                  label: Text(label),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
