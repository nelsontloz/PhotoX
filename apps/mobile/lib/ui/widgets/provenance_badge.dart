import 'package:flutter/material.dart';

import '../../library/library_item.dart';

/// Corner mark on a library tile saying where those bytes live.
///
/// Same geometry as `StatusBadge` (it took the badge slot, not a new corner):
/// 22 dp, bottom-right, so the merge adds no new furniture to the tile. The
/// two on-device marks are the glyphs the grid already used for "backed up"
/// and "not backed up", so a not-backed-up tile looks exactly as it did before
/// the server half existed; the online-only cloud is the one new shape, and it
/// is the only mark without a disc behind it, so the three stay apart in
/// greyscale.
class ProvenanceBadge extends StatelessWidget {
  const ProvenanceBadge({super.key, required this.provenance});

  final Provenance provenance;

  /// Diameter of the mark; the grid picks the placement.
  static const double size = 22;

  /// Screen-reader words for [provenance]; the tile folds them into its own
  /// label, so this is the one place the wording lives.
  static String labelFor(Provenance provenance) => switch (provenance) {
    Provenance.both => 'Backed up',
    Provenance.deviceOnly => 'Not backed up',
    Provenance.onlineOnly => 'Online only',
  };

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    const scrim = Color(0x8C000000);

    final (
      String label,
      IconData icon,
      double iconSize,
      Color foreground,
    ) = switch (provenance) {
      Provenance.both => (
        labelFor(provenance),
        Icons.check_rounded,
        14,
        scheme.primary,
      ),
      Provenance.deviceOnly => (
        labelFor(provenance),
        Icons.circle_outlined,
        9,
        scheme.onSurface.withValues(alpha: 0.6),
      ),
      Provenance.onlineOnly => (
        labelFor(provenance),
        Icons.cloud_outlined,
        15,
        scheme.onSurfaceVariant,
      ),
    };

    final glyph = Icon(
      icon,
      size: iconSize,
      color: foreground,
      // The cloud sits straight on the photo, so it carries its own shadow;
      // the other two keep the scrim disc that reads on a white sky.
      shadows: provenance == Provenance.onlineOnly
          ? const <Shadow>[Shadow(blurRadius: 3, color: Colors.black54)]
          : null,
    );

    return Semantics(
      container: true,
      label: label,
      child: ExcludeSemantics(
        child: SizedBox.square(
          dimension: size,
          child: provenance == Provenance.onlineOnly
              ? Center(child: glyph)
              : DecoratedBox(
                  decoration: const BoxDecoration(
                    shape: BoxShape.circle,
                    color: scrim,
                  ),
                  child: Center(child: glyph),
                ),
        ),
      ),
    );
  }
}
