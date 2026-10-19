import 'dart:math';

/// Exponential backoff with bounded jitter for retryable upload failures.
///
/// The policy never retries on its own: callers persist `nextAttemptAt` before
/// returning, so a killed process resumes with the same schedule.
class RetryPolicy {
  RetryPolicy({
    this.baseDelay = const Duration(seconds: 2),
    this.multiplier = 2,
    this.jitter = 0.2,
    this.maxDelay = const Duration(minutes: 15),
    Random? random,
  }) : _random = random ?? Random();

  /// Delay after the first failed attempt.
  final Duration baseDelay;

  /// Growth factor applied once per additional attempt.
  final double multiplier;

  /// Fraction of random extra delay, `0.2` means up to 20% on top.
  final double jitter;

  /// Hard upper bound on a computed delay.
  final Duration maxDelay;

  final Random _random;

  /// Returns how long to wait before attempt number [attempt] (1-based).
  ///
  /// A server-provided [retryAfter] is honored exactly instead of the computed
  /// backoff, clamped to a non-negative duration. Computed delays grow as
  /// `baseDelay * multiplier^(attempt - 1)`, gain up to [jitter] random extra
  /// and are clamped to [maxDelay]. With [jitter] set to zero the result is
  /// fully deterministic.
  Duration delayFor(int attempt, {Duration? retryAfter}) {
    if (retryAfter != null) {
      return retryAfter.isNegative ? Duration.zero : retryAfter;
    }

    final exponent = attempt <= 1 ? 0 : attempt - 1;
    // Cap the exponent before pow() so a corrupt attempt count cannot create
    // an infinite double; the resulting delay is clamped below anyway.
    final safeExponent = exponent > 64 ? 64 : exponent;
    final baseMs = baseDelay.inMilliseconds.toDouble();
    final rawMs = baseMs * pow(multiplier, safeExponent);
    final jitteredMs = rawMs * (1 + _nextJitterFraction());
    final cappedMs = min(jitteredMs, maxDelay.inMilliseconds.toDouble());
    return Duration(milliseconds: cappedMs.round());
  }

  double _nextJitterFraction() {
    if (jitter <= 0) return 0;
    return _random.nextDouble() * jitter;
  }
}
