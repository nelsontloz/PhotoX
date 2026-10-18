import 'package:flutter/material.dart';

import 'ui/home_screen.dart';

/// Root widget of the PhotoX mobile app; dark Material 3 by default.
class PhotoXApp extends StatelessWidget {
  const PhotoXApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'PhotoX',
      debugShowCheckedModeBanner: false,
      themeMode: ThemeMode.dark,
      darkTheme: ThemeData(
        useMaterial3: true,
        colorScheme: ColorScheme.fromSeed(
          seedColor: const Color(0xFF4C6FFF),
          brightness: Brightness.dark,
        ),
      ),
      home: const HomeScreen(),
    );
  }
}
