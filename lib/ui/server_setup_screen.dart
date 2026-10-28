import 'package:flutter/material.dart';

import '../core/app_config.dart';
import 'widgets/app_background.dart';

/// Returns [raw] as a usable base URL (trimmed, no trailing slash), or null
/// when it is not an absolute http(s) address.
String? normalizeServerUrl(String raw) {
  final trimmed = raw.trim();
  final uri = Uri.tryParse(trimmed);
  if (uri == null || uri.host.isEmpty) return null;
  if (!uri.isScheme('http') && !uri.isScheme('https')) return null;
  return trimmed.replaceAll(RegExp(r'/+$'), '');
}

/// First-launch form that records the PhotoX server address.
///
/// Shown whenever nothing is persisted yet; the saved value is read once at
/// startup, so the app never has to guess a host.
class ServerSetupScreen extends StatefulWidget {
  const ServerSetupScreen({super.key, required this.onSubmit});

  /// Persists the normalized URL and boots the app graph.
  final Future<void> Function(String url) onSubmit;

  @override
  State<ServerSetupScreen> createState() => _ServerSetupScreenState();
}

class _ServerSetupScreenState extends State<ServerSetupScreen> {
  final _formKey = GlobalKey<FormState>();
  final _url = TextEditingController(text: AppConfig.apiBaseUrl);

  bool _submitting = false;
  String? _error;

  @override
  void dispose() {
    _url.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (_submitting) return;
    FocusScope.of(context).unfocus();
    if (!(_formKey.currentState?.validate() ?? false)) return;

    setState(() {
      _error = null;
      _submitting = true;
    });
    try {
      await widget.onSubmit(normalizeServerUrl(_url.text)!);
    } on Object {
      if (!mounted) return;
      setState(() => _error = 'Could not save that address. Try again.');
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }

  String? _validateUrl(String? value) {
    final raw = value?.trim() ?? '';
    if (raw.isEmpty) return 'Enter your server address.';
    if (normalizeServerUrl(raw) == null) {
      return 'Use a full http:// or https:// address.';
    }
    return null;
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;

    return AppBackground(
      child: Scaffold(
        backgroundColor: Colors.transparent,
        body: SafeArea(
          child: Center(
            child: SingleChildScrollView(
              padding: const EdgeInsets.fromLTRB(24, 40, 24, 32),
              child: ConstrainedBox(
                constraints: const BoxConstraints(maxWidth: 420),
                child: Form(
                  key: _formKey,
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: <Widget>[
                      Text(
                        'Connect your server',
                        style: theme.textTheme.headlineMedium?.copyWith(
                          fontWeight: FontWeight.w700,
                          letterSpacing: -0.6,
                        ),
                      ),
                      const SizedBox(height: 8),
                      Text(
                        'PhotoX backs up this phone to a PhotoX server you '
                        'run. Enter the address it is reachable at.',
                        style: theme.textTheme.bodyMedium?.copyWith(
                          color: scheme.onSurfaceVariant,
                          height: 1.45,
                        ),
                      ),
                      const SizedBox(height: 24),
                      TextFormField(
                        controller: _url,
                        enabled: !_submitting,
                        keyboardType: TextInputType.url,
                        textInputAction: TextInputAction.done,
                        autocorrect: false,
                        enableSuggestions: false,
                        validator: _validateUrl,
                        autovalidateMode: AutovalidateMode.onUserInteraction,
                        onFieldSubmitted: (_) => _submit(),
                        decoration: InputDecoration(
                          labelText: 'Server address',
                          hintText: 'http://192.168.1.10:3000',
                          prefixIcon: const Icon(Icons.dns_outlined, size: 20),
                          filled: true,
                          fillColor: scheme.surfaceContainerHighest.withValues(
                            alpha: 0.35,
                          ),
                          contentPadding: const EdgeInsets.symmetric(
                            horizontal: 16,
                            vertical: 16,
                          ),
                          border: _border(
                            scheme.outlineVariant.withValues(alpha: 0.7),
                          ),
                          enabledBorder: _border(
                            scheme.outlineVariant.withValues(alpha: 0.7),
                          ),
                          focusedBorder: _border(scheme.primary, width: 1.6),
                          errorBorder: _border(scheme.error),
                          focusedErrorBorder: _border(scheme.error, width: 1.6),
                        ),
                      ),
                      const SizedBox(height: 8),
                      Text(
                        'On an Android emulator the host machine is '
                        'http://10.0.2.2:3000.',
                        style: theme.textTheme.bodySmall?.copyWith(
                          color: scheme.onSurfaceVariant,
                          height: 1.4,
                        ),
                      ),
                      if (_error != null) ...<Widget>[
                        const SizedBox(height: 12),
                        Text(
                          _error!,
                          style: theme.textTheme.bodySmall?.copyWith(
                            color: scheme.error,
                          ),
                        ),
                      ],
                      const SizedBox(height: 22),
                      FilledButton(
                        onPressed: _submitting ? null : _submit,
                        style: FilledButton.styleFrom(
                          minimumSize: const Size.fromHeight(54),
                          shape: RoundedRectangleBorder(
                            borderRadius: BorderRadius.circular(16),
                          ),
                          textStyle: theme.textTheme.titleMedium?.copyWith(
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                        child: _submitting
                            ? const SizedBox(
                                width: 18,
                                height: 18,
                                child: CircularProgressIndicator(
                                  strokeWidth: 2,
                                ),
                              )
                            : const Text('Connect'),
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

  OutlineInputBorder _border(Color color, {double width = 1}) {
    return OutlineInputBorder(
      borderRadius: BorderRadius.circular(14),
      borderSide: BorderSide(color: color, width: width),
    );
  }
}
