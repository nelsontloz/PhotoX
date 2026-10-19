import 'package:flutter/material.dart';

import 'widgets/app_background.dart';
import 'widgets/status_banner.dart';

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
  });

  /// Called with the trimmed email and the password exactly as typed.
  final Future<void> Function(String email, String password) onSignIn;

  /// Disables the form and swaps the submit label while a request is running.
  final bool busy;

  /// Server-provided message shown above the fields.
  final String? error;

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final _formKey = GlobalKey<FormState>();
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
      await widget.onSignIn(_email.text.trim(), _password.text);
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

  void _clearErrorOnEdit(String _) {
    if (_errorText == null) return;
    setState(() => _dismissedError = widget.error);
  }

  InputDecoration _decoration(
    BuildContext context, {
    required String label,
    required IconData icon,
  }) {
    final scheme = Theme.of(context).colorScheme;

    OutlineInputBorder border(Color color, {double width = 1}) {
      return OutlineInputBorder(
        borderRadius: BorderRadius.circular(14),
        borderSide: BorderSide(color: color, width: width),
      );
    }

    return InputDecoration(
      labelText: label,
      prefixIcon: Icon(icon, size: 20),
      filled: true,
      fillColor: scheme.surfaceContainerHighest.withValues(alpha: 0.35),
      contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 16),
      border: border(scheme.outlineVariant.withValues(alpha: 0.7)),
      enabledBorder: border(scheme.outlineVariant.withValues(alpha: 0.7)),
      focusedBorder: border(scheme.primary, width: 1.6),
      errorBorder: border(scheme.error),
      focusedErrorBorder: border(scheme.error, width: 1.6),
    );
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    final errorText = _errorText;

    return AppBackground(
      child: Scaffold(
        backgroundColor: Colors.transparent,
        body: SafeArea(
          child: Center(
            child: SingleChildScrollView(
              padding: const EdgeInsets.fromLTRB(24, 40, 24, 32),
              child: ConstrainedBox(
                constraints: const BoxConstraints(maxWidth: 420),
                child: AutofillGroup(
                  child: Form(
                    key: _formKey,
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: <Widget>[
                        const _BrandHeader(),
                        const SizedBox(height: 44),
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
                        TextFormField(
                          controller: _email,
                          focusNode: _emailFocus,
                          enabled: !_busy,
                          keyboardType: TextInputType.emailAddress,
                          textInputAction: TextInputAction.next,
                          autofillHints: const <String>[AutofillHints.email],
                          autocorrect: false,
                          onChanged: _clearErrorOnEdit,
                          validator: _validateEmail,
                          autovalidateMode: AutovalidateMode.onUserInteraction,
                          onFieldSubmitted: (_) =>
                              _passwordFocus.requestFocus(),
                          decoration: _decoration(
                            context,
                            label: 'Email',
                            icon: Icons.alternate_email_rounded,
                          ),
                        ),
                        const SizedBox(height: 14),
                        TextFormField(
                          controller: _password,
                          focusNode: _passwordFocus,
                          enabled: !_busy,
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
                          decoration:
                              _decoration(
                                context,
                                label: 'Password',
                                icon: Icons.lock_outline_rounded,
                              ).copyWith(
                                suffixIcon: IconButton(
                                  tooltip: _obscurePassword
                                      ? 'Show password'
                                      : 'Hide password',
                                  onPressed: _busy
                                      ? null
                                      : () => setState(
                                          () => _obscurePassword =
                                              !_obscurePassword,
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
                        SizedBox(
                          width: double.infinity,
                          child: FilledButton(
                            onPressed: _busy ? null : _submit,
                            style: FilledButton.styleFrom(
                              minimumSize: const Size.fromHeight(54),
                              padding: const EdgeInsets.symmetric(
                                horizontal: 20,
                                vertical: 14,
                              ),
                              shape: RoundedRectangleBorder(
                                borderRadius: BorderRadius.circular(16),
                              ),
                              textStyle: theme.textTheme.titleMedium?.copyWith(
                                fontWeight: FontWeight.w600,
                              ),
                            ),
                            child: AnimatedSwitcher(
                              duration: const Duration(milliseconds: 160),
                              child: _busy
                                  ? Row(
                                      key: const ValueKey<String>('busy'),
                                      mainAxisSize: MainAxisSize.min,
                                      children: <Widget>[
                                        SizedBox(
                                          width: 18,
                                          height: 18,
                                          child: CircularProgressIndicator(
                                            strokeWidth: 2,
                                            color: scheme.onSurface.withValues(
                                              alpha: 0.7,
                                            ),
                                          ),
                                        ),
                                        const SizedBox(width: 10),
                                        const Text('Signing in…'),
                                      ],
                                    )
                                  : const Text(
                                      'Sign in',
                                      key: ValueKey<String>('idle'),
                                    ),
                            ),
                          ),
                        ),
                        const SizedBox(height: 20),
                        const _ServerNote(),
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

class _BrandHeader extends StatelessWidget {
  const _BrandHeader();

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;

    return Row(
      children: <Widget>[
        ExcludeSemantics(
          child: Container(
            width: 44,
            height: 44,
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(13),
              gradient: LinearGradient(
                begin: Alignment.topLeft,
                end: Alignment.bottomRight,
                colors: <Color>[scheme.primary, scheme.tertiary],
              ),
            ),
            child: Icon(
              Icons.cloud_upload_rounded,
              size: 23,
              color: scheme.onPrimary,
            ),
          ),
        ),
        const SizedBox(width: 13),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              Text(
                'PhotoX',
                style: theme.textTheme.titleLarge?.copyWith(
                  fontWeight: FontWeight.w700,
                  letterSpacing: -0.3,
                ),
              ),
              Text(
                'Camera roll backup',
                style: theme.textTheme.bodySmall?.copyWith(
                  color: scheme.onSurfaceVariant,
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }
}

class _ServerNote extends StatelessWidget {
  const _ServerNote();

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;

    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: scheme.surfaceContainerLow.withValues(alpha: 0.7),
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: scheme.outlineVariant.withValues(alpha: 0.4)),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Icon(Icons.dns_outlined, size: 18, color: scheme.onSurfaceVariant),
          const SizedBox(width: 10),
          Expanded(
            child: Text(
              'Connects to the PhotoX server you set up. Photos are uploaded '
              'only there.',
              style: theme.textTheme.bodySmall?.copyWith(
                color: scheme.onSurfaceVariant,
                height: 1.4,
              ),
            ),
          ),
        ],
      ),
    );
  }
}
