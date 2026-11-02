import 'package:flutter/material.dart';

import '../core/app_config.dart';
import 'widgets/app_background.dart';
import 'widgets/form_style.dart';

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
          child: Align(
            alignment: Alignment.topCenter,
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
                      const FieldLabel('Server address'),
                      const SizedBox(height: 6),
                      TextFormField(
                        controller: _url,
                        enabled: !_submitting,
                        style: theme.textTheme.bodyMedium,
                        keyboardType: TextInputType.url,
                        textInputAction: TextInputAction.done,
                        autocorrect: false,
                        enableSuggestions: false,
                        validator: _validateUrl,
                        autovalidateMode: AutovalidateMode.onUserInteraction,
                        onFieldSubmitted: (_) => _submit(),
                        decoration: fieldBoxDecoration(
                          context,
                          icon: Icons.dns_outlined,
                          hint: 'http://192.168.1.10:3000',
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
                        style: primaryButtonStyle(context),
                        child: _submitting
                            ? const SizedBox(
                                width: 18,
                                height: 18,
                                child: CircularProgressIndicator(
                                  strokeWidth: 2,
                                ),
                              )
                            : const Row(
                                mainAxisSize: MainAxisSize.min,
                                children: <Widget>[
                                  Text('Connect'),
                                  SizedBox(width: 8),
                                  Icon(Icons.arrow_forward_rounded, size: 18),
                                ],
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
