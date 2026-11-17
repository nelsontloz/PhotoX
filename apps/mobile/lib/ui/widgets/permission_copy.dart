import 'package:flutter/material.dart';

import '../../media/photo_observer.dart';
import 'status_banner.dart';

/// Headline, message, action label, icon and severity for one photo grant.
typedef PermissionCopy = ({
  String title,
  String message,
  String action,
  IconData icon,
  StatusTone tone,
});

/// The one place that phrases a photo-library grant.
///
/// The library grid, the albums tab and the backup dashboard all explain the
/// same refusal, so the words live here; each screen decides what wraps them
/// (a full-screen state, a banner above a grid) and whether it shows [action].
///
/// [PhotoPermission.authorized] carries an empty title: there is nothing to
/// explain, and the screens that draw a grant never read it.
PermissionCopy permissionCopy(PhotoPermission permission) =>
    switch (permission) {
      PhotoPermission.authorized => (
        title: '',
        message: '',
        action: '',
        icon: Icons.photo_library_outlined,
        tone: StatusTone.info,
      ),
      // `limited` reads the library, so only the dashboard mentions it.
      PhotoPermission.limited => (
        title: 'Limited photo access',
        message:
            'Only the photos you selected can be backed up. Add more in your '
            'device settings.',
        action: '',
        icon: Icons.photo_library_outlined,
        tone: StatusTone.warning,
      ),
      PhotoPermission.notDetermined => (
        title: 'Photo access not set up',
        message:
            'PhotoX needs to read this device\'s photo library to back it up. '
            'Nothing is uploaded until you allow access.',
        action: 'Allow photo access',
        icon: Icons.photo_library_outlined,
        tone: StatusTone.warning,
      ),
      PhotoPermission.denied => (
        title: 'Photo access is off',
        message: 'Allow photo access in your device settings, then try again.',
        action: 'Try again',
        icon: Icons.block_rounded,
        tone: StatusTone.danger,
      ),
      PhotoPermission.restricted => (
        title: 'Photo access is restricted',
        message:
            'Device restrictions are blocking access to your photos. Change '
            'that in your device settings, then try again.',
        action: 'Try again',
        icon: Icons.block_rounded,
        tone: StatusTone.danger,
      ),
    };
