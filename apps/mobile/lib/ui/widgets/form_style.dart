import 'package:flutter/material.dart';

/// Corner radius shared by the first-launch screens' fields and buttons.
const double fieldRadius = 12;

/// Small uppercase caption that sits above a field box.
class FieldLabel extends StatelessWidget {
  const FieldLabel(this.text, {super.key});

  final String text;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Text(
      text.toUpperCase(),
      maxLines: 1,
      overflow: TextOverflow.ellipsis,
      style: theme.textTheme.labelSmall?.copyWith(
        color: theme.colorScheme.outline,
        fontWeight: FontWeight.w600,
        letterSpacing: 1.3,
      ),
    );
  }
}

/// Field box shared by the login and server-setup screens: a flat
/// `surfaceContainerLow` card with no border until it is focused.
///
/// The border is a state cue, not decoration: focus and errors are the only
/// times the box draws one.
InputDecoration fieldBoxDecoration(
  BuildContext context, {
  required IconData icon,
  Widget? trailing,
  String? hint,
}) {
  final theme = Theme.of(context);
  final scheme = theme.colorScheme;
  const plain = OutlineInputBorder(
    borderRadius: BorderRadius.all(Radius.circular(fieldRadius)),
    borderSide: BorderSide.none,
  );
  OutlineInputBorder line(Color color, double width) => OutlineInputBorder(
    borderRadius: const BorderRadius.all(Radius.circular(fieldRadius)),
    borderSide: BorderSide(color: color, width: width),
  );

  return InputDecoration(
    hintText: hint,
    hintStyle: theme.textTheme.bodyMedium?.copyWith(color: scheme.outline),
    prefixIcon: Icon(icon, size: 20),
    prefixIconColor: scheme.primary,
    suffixIcon: trailing,
    suffixIconColor: scheme.onSurfaceVariant,
    filled: true,
    fillColor: scheme.surfaceContainerLow,
    isDense: true,
    contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 15),
    border: plain,
    enabledBorder: plain,
    disabledBorder: plain,
    focusedBorder: line(scheme.primary, 1.5),
    errorBorder: line(scheme.error, 1.2),
    focusedErrorBorder: line(scheme.error, 1.5),
    errorStyle: theme.textTheme.bodySmall?.copyWith(color: scheme.error),
    errorMaxLines: 2,
  );
}

/// Full-width primary action for the first-launch screens.
ButtonStyle primaryButtonStyle(BuildContext context) {
  final theme = Theme.of(context);
  final scheme = theme.colorScheme;

  return FilledButton.styleFrom(
    minimumSize: const Size.fromHeight(52),
    padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 14),
    backgroundColor: scheme.primaryContainer,
    foregroundColor: scheme.onPrimaryContainer,
    // The busy label stays legible; the spinner already says it is disabled.
    disabledBackgroundColor: scheme.primaryContainer.withValues(alpha: 0.5),
    disabledForegroundColor: scheme.onPrimaryContainer,
    shape: RoundedRectangleBorder(
      borderRadius: BorderRadius.circular(fieldRadius),
    ),
    textStyle: theme.textTheme.titleSmall?.copyWith(
      fontWeight: FontWeight.w600,
    ),
  );
}
