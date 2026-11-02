import 'dart:math';

import 'package:flutter_test/flutter_test.dart';
import 'package:photox_mobile/upload/retry_policy.dart';

void main() {
  group('RetryPolicy.delayFor', () {
    test('grows exponentially from the configured base without jitter', () {
      final policy = RetryPolicy(jitter: 0);
      expect(policy.delayFor(1), const Duration(seconds: 2));
      expect(policy.delayFor(2), const Duration(seconds: 4));
      expect(policy.delayFor(3), const Duration(seconds: 8));
      expect(policy.delayFor(4), const Duration(seconds: 16));
    });

    test('treats non-positive attempts as the first attempt', () {
      final policy = RetryPolicy(jitter: 0);
      expect(policy.delayFor(0), const Duration(seconds: 2));
      expect(policy.delayFor(-3), const Duration(seconds: 2));
    });

    test('caps long backoffs at 15 minutes', () {
      final policy = RetryPolicy(jitter: 0);
      expect(policy.delayFor(20), const Duration(minutes: 15));
      expect(policy.delayFor(200), const Duration(minutes: 15));
    });

    test('adds at most the configured jitter fraction', () {
      final policy = RetryPolicy(jitter: 0.2, random: Random(7));
      for (var attempt = 1; attempt <= 6; attempt++) {
        final base =
            const Duration(seconds: 2).inMilliseconds * pow(2, attempt - 1);
        final delay = policy.delayFor(attempt).inMilliseconds;
        expect(delay, greaterThanOrEqualTo(base.toInt()));
        expect(delay, lessThanOrEqualTo((base * 1.2).round()));
      }
    });

    test('is deterministic when a Random with a seed is injected', () {
      final first = RetryPolicy(jitter: 0.2, random: Random(42));
      final second = RetryPolicy(jitter: 0.2, random: Random(42));
      for (var attempt = 1; attempt <= 8; attempt++) {
        expect(first.delayFor(attempt), second.delayFor(attempt));
      }
    });

    test('honors retryAfter exactly, ignoring backoff', () {
      final policy = RetryPolicy(random: Random(1));
      expect(
        policy.delayFor(9, retryAfter: const Duration(seconds: 90)),
        const Duration(seconds: 90),
      );
      expect(policy.delayFor(1, retryAfter: Duration.zero), Duration.zero);
    });

    test('clamps a negative retryAfter to zero', () {
      final policy = RetryPolicy();
      expect(
        policy.delayFor(1, retryAfter: const Duration(seconds: -5)),
        Duration.zero,
      );
    });
  });
}
