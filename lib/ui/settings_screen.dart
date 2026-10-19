import 'package:flutter/material.dart';

import '../settings/settings_store.dart';
import 'widgets/app_background.dart';
import 'widgets/section_label.dart';
import 'widgets/sign_out_dialog.dart';

/// Backup preferences, saved as soon as a switch changes.
///
/// The screen keeps a local copy so switches respond instantly; a failed save
/// restores the previous values and reports it with a snack bar.
class SettingsScreen extends StatefulWidget {
  const SettingsScreen({
    super.key,
    required this.settings,
    required this.onSave,
    required this.onSignOut,
    this.busy = false,
  });

  /// Current persisted preferences.
  final AppSettings settings;

  /// Persists the full settings object after any change.
  final Future<void> Function(AppSettings settings) onSave;

  /// Clears the current session after confirmation.
  final Future<void> Function() onSignOut;

  /// True while the caller is loading or writing preferences.
  final bool busy;

  @override
  State<SettingsScreen> createState() => _SettingsScreenState();
}

class _SettingsScreenState extends State<SettingsScreen> {
  late AppSettings _settings;
  bool _saving = false;

  bool get _busy => widget.busy || _saving;

  @override
  void initState() {
    super.initState();
    _settings = widget.settings;
  }

  @override
  void didUpdateWidget(covariant SettingsScreen oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (!_saving && oldWidget.settings != widget.settings) {
      _settings = widget.settings;
    }
  }

  Future<void> _apply(AppSettings next) async {
    if (_busy) return;
    final previous = _settings;

    setState(() {
      _settings = next;
      _saving = true;
    });

    try {
      await widget.onSave(next);
    } on Object {
      if (!mounted) return;
      setState(() => _settings = previous);
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Could not save that change. Try again.')),
      );
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  Future<void> _requestSignOut() async {
    final confirmed = await confirmSignOut(context);
    if (!confirmed || !mounted) return;

    try {
      await widget.onSignOut();
    } on Object {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Could not sign out. Try again.')),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;

    return AppBackground(
      child: Scaffold(
        backgroundColor: Colors.transparent,
        appBar: AppBar(
          backgroundColor: Colors.transparent,
          surfaceTintColor: Colors.transparent,
          elevation: 0,
          scrolledUnderElevation: 0,
          title: const Text('Settings'),
          titleTextStyle: theme.textTheme.titleLarge?.copyWith(
            color: scheme.onSurface,
            fontWeight: FontWeight.w700,
            letterSpacing: -0.3,
          ),
        ),
        body: SafeArea(
          top: false,
          child: Column(
            children: <Widget>[
              if (_busy)
                const LinearProgressIndicator(
                  minHeight: 2,
                  semanticsLabel: 'Saving settings',
                ),
              Expanded(
                child: Center(
                  child: ConstrainedBox(
                    constraints: const BoxConstraints(maxWidth: 680),
                    child: ListView(
                      padding: const EdgeInsets.fromLTRB(20, 8, 20, 32),
                      children: <Widget>[
                        Text(
                          'Choose when PhotoX backs up your camera roll.',
                          style: theme.textTheme.bodyMedium?.copyWith(
                            color: scheme.onSurfaceVariant,
                            height: 1.4,
                          ),
                        ),
                        const SectionLabel('Backup'),
                        _SettingsCard(
                          children: <Widget>[
                            SwitchListTile(
                              contentPadding: const EdgeInsets.fromLTRB(
                                16,
                                6,
                                16,
                                6,
                              ),
                              secondary: const Icon(Icons.wifi_rounded),
                              title: const Text('Wi-Fi only'),
                              subtitle: Text(
                                _settings.wifiOnly
                                    ? 'Uploads wait for Wi-Fi.'
                                    : 'Uploads can use mobile data.',
                              ),
                              value: _settings.wifiOnly,
                              onChanged: _busy
                                  ? null
                                  : (value) => _apply(
                                      _settings.copyWith(wifiOnly: value),
                                    ),
                            ),
                            _divider(scheme),
                            SwitchListTile(
                              contentPadding: const EdgeInsets.fromLTRB(
                                16,
                                6,
                                16,
                                6,
                              ),
                              secondary: const Icon(Icons.bolt_rounded),
                              title: const Text('Charging only'),
                              subtitle: Text(
                                _settings.chargingOnly
                                    ? 'Backups wait until the phone is charging.'
                                    : 'Backups can run on battery.',
                              ),
                              value: _settings.chargingOnly,
                              onChanged: _busy
                                  ? null
                                  : (value) => _apply(
                                      _settings.copyWith(chargingOnly: value),
                                    ),
                            ),
                            _divider(scheme),
                            SwitchListTile(
                              contentPadding: const EdgeInsets.fromLTRB(
                                16,
                                6,
                                16,
                                6,
                              ),
                              secondary: const Icon(Icons.videocam_outlined),
                              title: const Text('Include videos'),
                              subtitle: Text(
                                _settings.includeVideos
                                    ? 'Videos are backed up with your photos.'
                                    : 'Only photos are backed up.',
                              ),
                              value: _settings.includeVideos,
                              onChanged: _busy
                                  ? null
                                  : (value) => _apply(
                                      _settings.copyWith(includeVideos: value),
                                    ),
                            ),
                            _divider(scheme),
                            SwitchListTile(
                              contentPadding: const EdgeInsets.fromLTRB(
                                16,
                                6,
                                16,
                                6,
                              ),
                              secondary: const Icon(Icons.history_rounded),
                              title: const Text('Backfill'),
                              subtitle: Text(
                                _settings.backfill
                                    ? 'Include photos taken before PhotoX was '
                                          'installed.'
                                    : 'Start with new photos from now on.',
                              ),
                              value: _settings.backfill,
                              onChanged: _busy
                                  ? null
                                  : (value) => _apply(
                                      _settings.copyWith(backfill: value),
                                    ),
                            ),
                          ],
                        ),
                        const SectionLabel('Notifications'),
                        _SettingsCard(
                          children: <Widget>[
                            SwitchListTile(
                              contentPadding: const EdgeInsets.fromLTRB(
                                16,
                                6,
                                16,
                                6,
                              ),
                              secondary: const Icon(
                                Icons.notifications_none_rounded,
                              ),
                              title: const Text('Upload notifications'),
                              subtitle: Text(
                                _settings.notificationsEnabled
                                    ? 'Show backup progress while running.'
                                    : 'No progress notifications.',
                              ),
                              value: _settings.notificationsEnabled,
                              onChanged: _busy
                                  ? null
                                  : (value) => _apply(
                                      _settings.copyWith(
                                        notificationsEnabled: value,
                                      ),
                                    ),
                            ),
                          ],
                        ),
                        const SectionLabel('Source'),
                        _SettingsCard(
                          children: <Widget>[
                            ListTile(
                              contentPadding: const EdgeInsets.fromLTRB(
                                16,
                                6,
                                16,
                                6,
                              ),
                              leading: const Icon(Icons.photo_library_outlined),
                              title: const Text('Camera roll'),
                              subtitle: const Text(
                                'Reads the whole library. This is the only '
                                'source for now.',
                              ),
                              trailing: Text(
                                'Read only',
                                style: theme.textTheme.labelSmall?.copyWith(
                                  color: scheme.onSurfaceVariant,
                                ),
                              ),
                            ),
                          ],
                        ),
                        const SectionLabel('Account'),
                        OutlinedButton.icon(
                          onPressed: _busy ? null : _requestSignOut,
                          icon: const Icon(Icons.logout_rounded, size: 19),
                          label: const Text('Sign out'),
                          style: OutlinedButton.styleFrom(
                            foregroundColor: scheme.error,
                            minimumSize: const Size.fromHeight(50),
                            side: BorderSide(
                              color: scheme.error.withValues(alpha: 0.4),
                            ),
                            shape: RoundedRectangleBorder(
                              borderRadius: BorderRadius.circular(14),
                            ),
                          ),
                        ),
                        const SizedBox(height: 10),
                        Text(
                          'Backups stop until you sign in again. Queued photos '
                          'stay on this phone.',
                          textAlign: TextAlign.center,
                          style: theme.textTheme.bodySmall?.copyWith(
                            color: scheme.onSurfaceVariant,
                            height: 1.4,
                          ),
                        ),
                      ],
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

  Widget _divider(ColorScheme scheme) {
    return Divider(
      height: 1,
      thickness: 1,
      indent: 16,
      endIndent: 16,
      color: scheme.outlineVariant.withValues(alpha: 0.3),
    );
  }
}

class _SettingsCard extends StatelessWidget {
  const _SettingsCard({required this.children});

  final List<Widget> children;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;

    return Material(
      color: scheme.surfaceContainerLow,
      clipBehavior: Clip.antiAlias,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(20),
        side: BorderSide(color: scheme.outlineVariant.withValues(alpha: 0.45)),
      ),
      child: Column(children: children),
    );
  }
}
