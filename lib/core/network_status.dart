import 'package:connectivity_plus/connectivity_plus.dart';

/// Whether the current connection is unmetered, for the `wifiOnly` preference.
///
/// The scheduled worker gets this from the OS (WorkManager constraints); a
/// foreground or resume pass has to ask, or it uploads over mobile data.
abstract class NetworkStatus {
  /// True when the active connection is Wi-Fi or Ethernet.
  Future<bool> isUnmetered();
}

/// [NetworkStatus] backed by `connectivity_plus`.
class ConnectivityNetworkStatus implements NetworkStatus {
  const ConnectivityNetworkStatus();

  @override
  Future<bool> isUnmetered() async {
    final results = await Connectivity().checkConnectivity();
    // Only a positively unmetered link counts. A VPN (common on Android) may
    // hide the underlying Wi-Fi and then pauses uploads — the safe direction
    // for a user who chose "Wi-Fi only".
    return results.any(
      (result) =>
          result == ConnectivityResult.wifi ||
          result == ConnectivityResult.ethernet,
    );
  }
}
