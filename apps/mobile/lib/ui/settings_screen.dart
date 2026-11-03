import 'package:flutter/material.dart';

import '../media/photo_observer.dart';
import '../settings/settings_store.dart';
import 'albums_screen.dart' show confirmScopeNarrowing;
import 'widgets/app_background.dart';
import 'widgets/count_format.dart';
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
    required this.onLoadFolders,
    required this.onSignOut,
    this.busy = false,
  });

  /// Current persisted preferences.
  final AppSettings settings;

  /// Persists the full settings object after any change.
  final Future<void> Function(AppSettings settings) onSave;

  /// Lists the albums the device exposes.
  ///
  /// Only called when the written scope names albums or the user opens the
  /// picker, because it can take a while on the first call.
  final Future<List<MediaFolder>> Function() onLoadFolders;

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

  /// Albums behind [AppSettings.uploadFolderIds]; null until loaded.
  List<MediaFolder>? _folders;
  bool _loadingFolders = false;
  bool _folderError = false;
  bool _showFolders = false;

  bool get _busy => widget.busy || _saving;

  @override
  void initState() {
    super.initState();
    _settings = widget.settings;
    // The summary names the chosen albums, so an existing selection needs the
    // list even before the picker is opened. The default scope ("camera
    // folder") opens with no library call at all.
    if (_settings.uploadFolderIds.isNotEmpty) _loadFolders();
  }

  @override
  void didUpdateWidget(covariant SettingsScreen oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (!_saving && oldWidget.settings != widget.settings) {
      _settings = widget.settings;
      // Preferences can arrive after the first build; a saved selection still
      // needs the album names for the summary.
      if (_settings.uploadFolderIds.isNotEmpty && _folders == null) {
        _loadFolders();
      }
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

  Future<void> _loadFolders() async {
    if (_loadingFolders) return;
    setState(() {
      _loadingFolders = true;
      _folderError = false;
    });

    try {
      final folders = await widget.onLoadFolders();
      if (!mounted) return;
      setState(() => _folders = folders);
    } on Object {
      if (!mounted) return;
      setState(() => _folderError = true);
    } finally {
      if (mounted) setState(() => _loadingFolders = false);
    }
  }

  void _toggleFolderPicker() {
    setState(() => _showFolders = !_showFolders);
    if (_showFolders && !_settings.uploadAllFolders && _folders == null) {
      _loadFolders();
    }
  }

  Future<void> _setAllFolders(bool value) async {
    // Turning the switch off drops every album but the camera one, which also
    // drops queued work: the same warning the Albums tab gives.
    if (!value) {
      final confirmed = await confirmScopeNarrowing(
        context,
        title: 'Stop backing up every album?',
        action: 'Back up fewer albums',
      );
      if (!confirmed || !mounted) return;
    }
    // The whole library wins over stored ids, so drop them rather than leave a
    // selection that would reappear when the switch goes off.
    await _apply(
      value
          ? _settings.copyWith(
              uploadAllFolders: true,
              uploadFolderIds: const <String>[],
            )
          : _settings.copyWith(uploadAllFolders: false),
    );
    if (!value && _showFolders && _folders == null) await _loadFolders();
  }

  Future<void> _setFolderSelected(MediaFolder folder, bool selected) async {
    if (!selected) {
      final confirmed = await confirmScopeNarrowing(
        context,
        title: 'Remove “${folder.name}” from backup?',
        action: 'Remove',
      );
      if (!confirmed || !mounted) return;
    }
    final ids = <String>[..._settings.uploadFolderIds]..remove(folder.id);
    if (selected) ids.add(folder.id);
    return _apply(
      _settings.copyWith(uploadFolderIds: ids, uploadAllFolders: false),
    );
  }

  /// One line naming the scope the backup pass will use.
  String get _scopeSummary {
    if (_settings.uploadAllFolders) return 'All folders';
    final ids = _settings.uploadFolderIds;
    if (ids.isEmpty) return 'Camera folder';

    final names = _chosenNames;
    if (names.isEmpty) return countLabel(ids.length, 'folder');
    return '${countLabel(names.length, 'folder')}: ${names.join(', ')}';
  }

  String get _scopeDetail {
    if (_settings.uploadAllFolders) {
      return 'Every album in your library is backed up.';
    }
    if (_settings.uploadFolderIds.isEmpty) {
      return 'Your camera album is backed up by default.';
    }
    return 'Only the folders you picked are backed up.';
  }

  /// Names of the chosen albums the loaded list still contains.
  List<String> get _chosenNames {
    final folders = _folders;
    if (folders == null) return const <String>[];
    final byId = <String, String>{
      for (final folder in folders) folder.id: folder.name,
    };
    return <String>[
      for (final id in _settings.uploadFolderIds)
        if (byId[id] != null) byId[id]!,
    ];
  }

  /// Pickable albums below the switch, split into dividers by [build].
  List<Widget> _folderRows() {
    if (_settings.uploadAllFolders) {
      return <Widget>[
        _folderNote(
          Icons.done_all_rounded,
          'Every album is included.',
          'Turn off All folders to back up only some albums.',
        ),
      ];
    }

    final rows = <Widget>[
      // An empty selection is not "nothing": it means the camera album.
      if (_settings.uploadFolderIds.isEmpty)
        _folderNote(
          Icons.info_outline_rounded,
          'Nothing picked, so the camera folder is used.',
          'Pick an album to back up only that one.',
        ),
    ];

    if (_loadingFolders) {
      rows.add(
        ListTile(
          key: const Key('folders-loading'),
          contentPadding: const EdgeInsets.fromLTRB(16, 4, 16, 4),
          leading: const SizedBox(
            width: 20,
            height: 20,
            child: CircularProgressIndicator(strokeWidth: 2),
          ),
          title: const Text('Reading your albums…'),
        ),
      );
    } else if (_folderError) {
      rows.add(
        ListTile(
          key: const Key('folders-error'),
          contentPadding: const EdgeInsets.fromLTRB(16, 4, 16, 4),
          leading: const Icon(Icons.cloud_off_rounded),
          title: const Text('Could not read your albums.'),
          subtitle: const Text('Your backup folders are unchanged.'),
          trailing: TextButton(
            onPressed: _busy ? null : _loadFolders,
            child: const Text('Retry'),
          ),
        ),
      );
    } else if (_folders?.isEmpty ?? false) {
      rows.add(
        _folderNote(
          Icons.folder_off_outlined,
          'No albums found.',
          'Backups fall back to the camera folder.',
        ),
      );
    } else {
      rows.addAll(<Widget>[
        for (final folder in _folders ?? const <MediaFolder>[])
          CheckboxListTile(
            contentPadding: const EdgeInsets.fromLTRB(16, 2, 16, 2),
            title: Text(
              folder.name,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
            ),
            subtitle: Text(
              folder.isCamera
                  ? 'Camera album · ${countLabel(folder.assetCount, 'item')}'
                  : countLabel(folder.assetCount, 'item'),
            ),
            value: _settings.uploadFolderIds.contains(folder.id),
            onChanged: _busy
                ? null
                : (value) => _setFolderSelected(folder, value ?? false),
          ),
      ]);
    }
    return rows;
  }

  Widget _folderNote(IconData icon, String title, String subtitle) {
    return ListTile(
      contentPadding: const EdgeInsets.fromLTRB(16, 4, 16, 4),
      leading: Icon(icon),
      title: Text(title),
      subtitle: Text(subtitle),
    );
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
                          'Choose what PhotoX backs up and when.',
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
                          ],
                        ),
                        const SectionLabel('Folders'),
                        _SettingsCard(
                          children: <Widget>[
                            ListTile(
                              key: const Key('folder-scope-picker'),
                              contentPadding: const EdgeInsets.fromLTRB(
                                16,
                                6,
                                16,
                                6,
                              ),
                              leading: const Icon(Icons.folder_copy_outlined),
                              title: Text(
                                _scopeSummary,
                                key: const Key('folder-scope-summary'),
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                              ),
                              subtitle: Text(_scopeDetail),
                              trailing: Icon(
                                _showFolders
                                    ? Icons.expand_less_rounded
                                    : Icons.expand_more_rounded,
                              ),
                              onTap: _toggleFolderPicker,
                            ),
                            _divider(scheme),
                            SwitchListTile(
                              contentPadding: const EdgeInsets.fromLTRB(
                                16,
                                6,
                                16,
                                6,
                              ),
                              secondary: const Icon(Icons.select_all_rounded),
                              title: const Text('All folders'),
                              subtitle: Text(
                                _settings.uploadAllFolders
                                    ? 'Every album, including new ones.'
                                    : 'Back up every album in your library.',
                              ),
                              value: _settings.uploadAllFolders,
                              onChanged: _busy ? null : _setAllFolders,
                            ),
                            if (_showFolders) ...[
                              _divider(scheme),
                              for (final (index, row)
                                  in _folderRows().indexed) ...[
                                if (index > 0) _divider(scheme),
                                row,
                              ],
                            ],
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
                                'PhotoX only reads your library. Nothing is '
                                'edited or deleted.',
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
