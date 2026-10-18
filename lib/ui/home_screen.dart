import 'package:flutter/material.dart';

import 'settings_screen.dart';

/// Placeholder home screen; shows queue status only, no upload logic.
class HomeScreen extends StatelessWidget {
  const HomeScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('PhotoX')),
      body: Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            const Text('Queue: 0'),
            const SizedBox(height: 8),
            const Text('Skeleton only — no upload logic yet.'),
            const SizedBox(height: 16),
            FilledButton(
              onPressed: () => Navigator.of(context).push(
                MaterialPageRoute<void>(builder: (_) => const SettingsScreen()),
              ),
              child: const Text('Settings'),
            ),
          ],
        ),
      ),
    );
  }
}
