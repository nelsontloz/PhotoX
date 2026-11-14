import 'package:flutter/material.dart';

/// One rounded chip: an icon (or dot), a one-line label and a tone.
///
/// The shared body behind the backup-scope, status and album chips; each caller
/// keeps its own colours, label and size.
class Pill extends StatelessWidget {
  const Pill({
    super.key,
    required this.label,
    required this.foreground,
    required this.background,
    this.icon,
    this.dotColor,
    this.border,
    this.semanticsLabel,
    this.padding = const EdgeInsets.symmetric(horizontal: 11, vertical: 6),
    this.iconSize = 15,
    this.gap = 6,
    this.textStyle,
  });

  final String label;
  final Color foreground;
  final Color background;

  /// Leading glyph; null draws a [dotColor] dot instead.
  final IconData? icon;

  /// Dot colour when [icon] is null; defaults to [foreground].
  final Color? dotColor;

  final BoxBorder? border;

  /// Whole-pill description; the label is hidden from semantics when set.
  final String? semanticsLabel;

  final EdgeInsetsGeometry padding;
  final double iconSize;
  final double gap;

  /// Label style; defaults to the muted `labelMedium` the chips use.
  final TextStyle? textStyle;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final content = Container(
      padding: padding,
      decoration: BoxDecoration(
        color: background,
        borderRadius: BorderRadius.circular(100),
        border: border,
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          if (icon case final glyph?)
            Icon(glyph, size: iconSize, color: foreground)
          else
            DecoratedBox(
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                color: dotColor ?? foreground,
              ),
              child: const SizedBox.square(dimension: 6),
            ),
          SizedBox(width: gap),
          Flexible(
            child: Text(
              label,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style:
                  textStyle ??
                  theme.textTheme.labelMedium?.copyWith(
                    color: foreground,
                    fontWeight: FontWeight.w600,
                  ),
            ),
          ),
        ],
      ),
    );

    final semantics = semanticsLabel;
    if (semantics == null) return content;
    return Semantics(
      container: true,
      label: semantics,
      child: ExcludeSemantics(child: content),
    );
  }
}
