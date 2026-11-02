import 'package:flutter/material.dart';

/// Asks before signing out. Returns true only when the user confirms.
///
/// The queue is local, so the copy promises that queued photos stay on the
/// phone rather than implying they are lost.
Future<bool> confirmSignOut(BuildContext context) async {
  final confirmed = await showDialog<bool>(
    context: context,
    builder: (dialogContext) {
      final scheme = Theme.of(dialogContext).colorScheme;
      return AlertDialog(
        title: const Text('Sign out?'),
        content: const Text(
          'Backups stop until you sign in again. Photos waiting in the queue '
          'stay on this phone.',
        ),
        actions: <Widget>[
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.of(dialogContext).pop(true),
            style: FilledButton.styleFrom(
              backgroundColor: scheme.errorContainer,
              foregroundColor: scheme.onErrorContainer,
            ),
            child: const Text('Sign out'),
          ),
        ],
      );
    },
  );
  return confirmed ?? false;
}
