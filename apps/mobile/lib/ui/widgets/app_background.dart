import 'package:flutter/material.dart';

/// Shared backdrop for every screen: a quiet top-down tint plus one soft glow.
///
/// Kept deliberately subtle so the dark Material 3 surfaces stay the focus.
class AppBackground extends StatelessWidget {
  const AppBackground({super.key, required this.child});

  /// Usually a [Scaffold] with a transparent background.
  final Widget child;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final tintedTop = Color.alphaBlend(
      scheme.primary.withValues(alpha: 0.07),
      scheme.surface,
    );

    return Stack(
      fit: StackFit.expand,
      children: <Widget>[
        DecoratedBox(
          decoration: BoxDecoration(
            gradient: LinearGradient(
              begin: Alignment.topCenter,
              end: Alignment.bottomCenter,
              colors: <Color>[tintedTop, scheme.surface],
              stops: const <double>[0, 0.55],
            ),
          ),
        ),
        Positioned(
          top: -160,
          right: -120,
          child: IgnorePointer(
            child: Container(
              width: 340,
              height: 340,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                gradient: RadialGradient(
                  colors: <Color>[
                    scheme.primary.withValues(alpha: 0.16),
                    scheme.primary.withValues(alpha: 0),
                  ],
                ),
              ),
            ),
          ),
        ),
        child,
      ],
    );
  }
}
