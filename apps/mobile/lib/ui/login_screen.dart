import 'package:flutter/material.dart';

import '../core/app_config.dart';
import 'widgets/app_background.dart';
import 'widgets/form_style.dart';
import 'widgets/status_banner.dart';

/// Muted green tick that confirms a server address is configured.
const Color _okGreen = Color(0xFF34D399);

/// Sign-in form for an existing PhotoX account.
///
/// The screen owns only form state; credentials go out through [onSignIn].
/// [busy] and [error] are controlled by the caller so retries and server
/// messages survive rebuilds.
class LoginScreen extends StatefulWidget {
  const LoginScreen({
    super.key,
    required this.onSignIn,
    this.busy = false,
    this.error,
    this.serverUrl = '',
  });

  /// Called with the trimmed email, the password exactly as typed, and the
  /// server address from the form.
  final Future<void> Function(String email, String password, String serverUrl)
  onSignIn;

  /// Disables the form and swaps the submit label while a request is running.
  final bool busy;

  /// Server-provided message shown above the fields.
  final String? error;

  /// Where the photos go; the field is prefilled from the stored address.
  final String serverUrl;

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final _formKey = GlobalKey<FormState>();
  late final _server = TextEditingController(text: widget.serverUrl);
  final _email = TextEditingController();
  final _password = TextEditingController();
  final _emailFocus = FocusNode();
  final _passwordFocus = FocusNode();

  bool _obscurePassword = true;
  bool _submitting = false;
  String? _localError;

  /// Parent error the user already started reacting to; hidden until the next
  /// submit so the form does not keep scolding while they type.
  String? _dismissedError;

  bool get _busy => widget.busy || _submitting;

  @override
  void dispose() {
    _server.dispose();
    _email.dispose();
    _password.dispose();
    _emailFocus.dispose();
    _passwordFocus.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (_busy) return;
    FocusScope.of(context).unfocus();
    if (!(_formKey.currentState?.validate() ?? false)) return;

    setState(() {
      _localError = null;
      _dismissedError = null;
      _submitting = true;
    });

    try {
      await widget.onSignIn(
        _email.text.trim(),
        _password.text,
        normalizeServerUrl(_server.text)!,
      );
    } on Object {
      if (!mounted) return;
      setState(() {
        _localError = 'Could not sign in. Check your connection and try again.';
      });
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }

  String? _validateEmail(String? value) {
    final email = value?.trim() ?? '';
    if (email.isEmpty) return 'Enter your email address.';
    if (!RegExp(r'^[^@\s]+@[^@\s]+\.[^@\s]+$').hasMatch(email)) {
      return 'Enter a valid email address.';
    }
    return null;
  }

  String? _validateServer(String? value) {
    final raw = value?.trim() ?? '';
    if (raw.isEmpty) return 'Enter your server address.';
    if (normalizeServerUrl(raw) == null) {
      return 'Use a full http:// or https:// address.';
    }
    return null;
  }

  String? _validatePassword(String? value) {
    if (value == null || value.isEmpty) return 'Enter your password.';
    return null;
  }

  String? get _errorText {
    final error = widget.error?.trim();
    if (error != null && error.isNotEmpty && error != _dismissedError) {
      return error;
    }
    return _localError;
  }

  /// Whether the address in the box parses; drives the trailing tick.
  late bool _serverValid = normalizeServerUrl(_server.text) != null;

  void _onServerChanged(String value) {
    final valid = normalizeServerUrl(value) != null;
    // Always rebuild: the plain-http warning is decided by the scheme, which
    // does not change validity.
    setState(() => _serverValid = valid);
    _clearErrorOnEdit(value);
  }

  void _clearErrorOnEdit(String _) {
    if (_errorText == null) return;
    setState(() => _dismissedError = widget.error);
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    final errorText = _errorText;
    final insecureWarning = insecureServerWarning(_server.text);

    return AppBackground(
      child: Scaffold(
        backgroundColor: Colors.transparent,
        body: SafeArea(
          child: Center(
            child: SingleChildScrollView(
              padding: const EdgeInsets.fromLTRB(24, 32, 24, 32),
              child: ConstrainedBox(
                constraints: const BoxConstraints(maxWidth: 420),
                child: AutofillGroup(
                  child: Form(
                    key: _formKey,
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: <Widget>[
                        const _BrandStrip(),
                        const SizedBox(height: 30),
                        Text(
                          'Welcome back',
                          style: theme.textTheme.headlineMedium?.copyWith(
                            fontWeight: FontWeight.w700,
                            letterSpacing: -0.6,
                          ),
                        ),
                        const SizedBox(height: 8),
                        Text(
                          'Sign in to back up the camera roll on this phone to '
                          'your PhotoX server.',
                          style: theme.textTheme.bodyMedium?.copyWith(
                            color: scheme.onSurfaceVariant,
                            height: 1.45,
                          ),
                        ),
                        const SizedBox(height: 24),
                        AnimatedSwitcher(
                          duration: const Duration(milliseconds: 180),
                          child: errorText == null
                              ? const SizedBox.shrink(
                                  key: ValueKey<String>('no-error'),
                                )
                              : Padding(
                                  key: const ValueKey<String>('error'),
                                  padding: const EdgeInsets.only(bottom: 16),
                                  child: StatusBanner(
                                    tone: StatusTone.danger,
                                    title: 'Could not sign in',
                                    message: errorText,
                                  ),
                                ),
                        ),
                        const FieldLabel('Server'),
                        const SizedBox(height: 6),
                        TextFormField(
                          controller: _server,
                          enabled: !_busy,
                          style: theme.textTheme.bodyMedium,
                          keyboardType: TextInputType.url,
                          textInputAction: TextInputAction.next,
                          autocorrect: false,
                          enableSuggestions: false,
                          validator: _validateServer,
                          autovalidateMode: AutovalidateMode.onUserInteraction,
                          onChanged: _onServerChanged,
                          onFieldSubmitted: (_) => _emailFocus.requestFocus(),
                          decoration: fieldBoxDecoration(
                            context,
                            icon: Icons.dns_outlined,
                            hint: 'http://192.168.1.10:3000',
                            trailing: _serverValid
                                ? const DecoratedBox(
                                    decoration: BoxDecoration(
                                      shape: BoxShape.circle,
                                      color: Color(0x2634D399),
                                    ),
                                    child: SizedBox.square(
                                      dimension: 22,
                                      child: Icon(
                                        Icons.check_rounded,
                                        size: 14,
                                        color: _okGreen,
                                      ),
                                    ),
                                  )
                                : null,
                          ),
                        ),
                        if (insecureWarning != null)
                          Padding(
                            padding: const EdgeInsets.only(top: 8),
                            child: Text(
                              insecureWarning,
                              style: theme.textTheme.bodySmall?.copyWith(
                                color: scheme.onSurfaceVariant,
                                height: 1.4,
                              ),
                            ),
                          ),
                        const SizedBox(height: 16),
                        const FieldLabel('Email'),
                        const SizedBox(height: 6),
                        TextFormField(
                          controller: _email,
                          focusNode: _emailFocus,
                          enabled: !_busy,
                          style: theme.textTheme.bodyMedium,
                          keyboardType: TextInputType.emailAddress,
                          textInputAction: TextInputAction.next,
                          autofillHints: const <String>[AutofillHints.email],
                          autocorrect: false,
                          onChanged: _clearErrorOnEdit,
                          validator: _validateEmail,
                          autovalidateMode: AutovalidateMode.onUserInteraction,
                          onFieldSubmitted: (_) =>
                              _passwordFocus.requestFocus(),
                          decoration: fieldBoxDecoration(
                            context,
                            icon: Icons.alternate_email_rounded,
                            trailing: const Icon(
                              Icons.badge_outlined,
                              size: 20,
                            ),
                          ),
                        ),
                        const SizedBox(height: 16),
                        const FieldLabel('Password'),
                        const SizedBox(height: 6),
                        TextFormField(
                          controller: _password,
                          focusNode: _passwordFocus,
                          enabled: !_busy,
                          style: theme.textTheme.bodyMedium,
                          obscureText: _obscurePassword,
                          textInputAction: TextInputAction.done,
                          autofillHints: const <String>[AutofillHints.password],
                          autocorrect: false,
                          enableSuggestions: false,
                          onChanged: _clearErrorOnEdit,
                          validator: _validatePassword,
                          autovalidateMode: AutovalidateMode.onUserInteraction,
                          onFieldSubmitted: (_) {
                            if (!_busy) _submit();
                          },
                          decoration: fieldBoxDecoration(
                            context,
                            icon: Icons.key_rounded,
                            trailing: IconButton(
                              tooltip: _obscurePassword
                                  ? 'Show password'
                                  : 'Hide password',
                              onPressed: _busy
                                  ? null
                                  : () => setState(
                                      () =>
                                          _obscurePassword = !_obscurePassword,
                                    ),
                              icon: Icon(
                                _obscurePassword
                                    ? Icons.visibility_outlined
                                    : Icons.visibility_off_outlined,
                                size: 20,
                              ),
                            ),
                          ),
                        ),
                        const SizedBox(height: 22),
                        _PressScale(
                          enabled: !_busy,
                          child: SizedBox(
                            width: double.infinity,
                            child: FilledButton(
                              onPressed: _busy ? null : _submit,
                              style: primaryButtonStyle(context),
                              child: AnimatedSwitcher(
                                duration: const Duration(milliseconds: 160),
                                child: _busy
                                    ? Row(
                                        key: const ValueKey<String>('busy'),
                                        mainAxisSize: MainAxisSize.min,
                                        children: <Widget>[
                                          SizedBox(
                                            width: 16,
                                            height: 16,
                                            child: CircularProgressIndicator(
                                              strokeWidth: 2,
                                              color: scheme.onPrimaryContainer,
                                            ),
                                          ),
                                          const SizedBox(width: 10),
                                          const Text('Signing in…'),
                                        ],
                                      )
                                    : Row(
                                        key: const ValueKey<String>('idle'),
                                        mainAxisSize: MainAxisSize.min,
                                        children: <Widget>[
                                          const Text('Sign in'),
                                          const SizedBox(width: 8),
                                          Icon(
                                            Icons.arrow_forward_rounded,
                                            size: 18,
                                            color: scheme.onPrimaryContainer,
                                          ),
                                        ],
                                      ),
                              ),
                            ),
                          ),
                        ),
                        const SizedBox(height: 24),
                        const _TrustNote(),
                      ],
                    ),
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

/// Top strip: app tile plus the one-line product label.
class _BrandStrip extends StatelessWidget {
  const _BrandStrip();

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;

    return Row(
      children: <Widget>[
        ExcludeSemantics(
          child: Container(
            width: 32,
            height: 32,
            decoration: BoxDecoration(
              color: scheme.surfaceContainerHigh,
              borderRadius: BorderRadius.circular(10),
            ),
            child: Icon(
              Icons.cloud_upload_rounded,
              size: 18,
              color: scheme.primary,
            ),
          ),
        ),
        const SizedBox(width: 10),
        Expanded(
          child: Text(
            'PhotoX APP',
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: theme.textTheme.labelSmall?.copyWith(
              color: scheme.onSurfaceVariant,
              fontWeight: FontWeight.w700,
              letterSpacing: 1.6,
            ),
          ),
        ),
      ],
    );
  }
}

/// Centred reassurance block under the form. Only claims this app keeps.
class _TrustNote extends StatelessWidget {
  const _TrustNote();

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;

    return Column(
      children: <Widget>[
        Row(
          mainAxisSize: MainAxisSize.min,
          children: <Widget>[
            Icon(
              Icons.shield_outlined,
              size: 14,
              color: scheme.onSurfaceVariant,
            ),
            const SizedBox(width: 6),
            Flexible(
              child: Text(
                'Your own server',
                maxLines: 2,
                textAlign: TextAlign.center,
                style: theme.textTheme.bodySmall?.copyWith(
                  color: scheme.onSurfaceVariant,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ),
          ],
        ),
        const SizedBox(height: 6),
        ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 280),
          child: Text(
            'Connects to the PhotoX server you set up. Photos are uploaded '
            'only there.',
            textAlign: TextAlign.center,
            style: theme.textTheme.bodySmall?.copyWith(
              color: scheme.outline,
              height: 1.5,
            ),
          ),
        ),
      ],
    );
  }
}

/// Gives the primary action a small press-in without replacing the button's
/// own ripple and semantics.
class _PressScale extends StatefulWidget {
  const _PressScale({required this.child, required this.enabled});

  final Widget child;
  final bool enabled;

  @override
  State<_PressScale> createState() => _PressScaleState();
}

class _PressScaleState extends State<_PressScale> {
  bool _down = false;

  void _set(bool value) {
    if (_down == value) return;
    setState(() => _down = value);
  }

  @override
  Widget build(BuildContext context) {
    return Listener(
      onPointerDown: widget.enabled ? (_) => _set(true) : null,
      onPointerUp: (_) => _set(false),
      onPointerCancel: (_) => _set(false),
      child: AnimatedScale(
        scale: _down ? 0.98 : 1,
        duration: const Duration(milliseconds: 90),
        curve: Curves.easeOut,
        child: widget.child,
      ),
    );
  }
}
