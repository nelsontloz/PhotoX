import 'package:flutter/material.dart';

/// Placeholder settings screen; the switches do not persist anything yet.
class SettingsScreen extends StatelessWidget {
  const SettingsScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Settings')),
      body: ListView(
        children: [
          SwitchListTile(
            title: const Text('Wi-Fi only'),
            value: true,
            onChanged: (_) {},
          ),
          SwitchListTile(
            title: const Text('Charging only'),
            value: false,
            onChanged: (_) {},
          ),
          // TODO(spec §3.7): album selection, minimum delay, and progress
          // notification settings.
        ],
      ),
    );
  }
}
