import 'package:flutter/material.dart';

/// Severity of a [StatusBanner]; only the accent color changes.
enum StatusTone { info, warning, danger }

/// Inline callout for permission, session, and sync messages.
///
/// The body keeps normal surface text colors so long messages stay legible;
/// the tone only tints the icon, border, and background.
class StatusBanner extends StatelessWidget {
  const StatusBanner({
    super.key,
    required this.title,
    required this.message,
    this.tone = StatusTone.info,
    this.icon,
    this.action,
  });

  /// Short headline, for example `Photo access is off`.
  final String title;

  /// One or two plain sentences explaining what the user can do.
  final String message;

  /// Drives the accent and surface tint.
  final StatusTone tone;

  /// Overrides the default icon for the tone.
  final IconData? icon;

  /// Optional trailing action, usually a text button.
  final Widget? action;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    final accent = switch (tone) {
      StatusTone.info => scheme.primary,
      StatusTone.warning => scheme.tertiary,
      StatusTone.danger => scheme.error,
    };
    final resolvedIcon =
        icon ??
        switch (tone) {
          StatusTone.info => Icons.info_outline_rounded,
          StatusTone.warning => Icons.warning_amber_rounded,
          StatusTone.danger => Icons.error_outline_rounded,
        };

    return Semantics(
      container: true,
      liveRegion: true,
      child: DecoratedBox(
        decoration: BoxDecoration(
          color: Color.alphaBlend(
            accent.withValues(alpha: 0.09),
            scheme.surfaceContainerLow,
          ),
          borderRadius: BorderRadius.circular(16),
          border: Border.all(color: accent.withValues(alpha: 0.32)),
        ),
        child: Padding(
          padding: const EdgeInsets.fromLTRB(16, 14, 16, 14),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              Icon(resolvedIcon, size: 20, color: accent),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: <Widget>[
                    Text(
                      title,
                      style: theme.textTheme.titleSmall?.copyWith(
                        color: scheme.onSurface,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                    const SizedBox(height: 3),
                    Text(
                      message,
                      style: theme.textTheme.bodySmall?.copyWith(
                        color: scheme.onSurfaceVariant,
                        height: 1.4,
                      ),
                    ),
                    if (action != null) ...<Widget>[
                      const SizedBox(height: 6),
                      action!,
                    ],
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
