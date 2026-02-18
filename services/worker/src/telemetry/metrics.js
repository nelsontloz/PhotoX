const HISTOGRAM_BUCKETS_MS = [50, 100, 250, 500, 1000, 2500, 5000, 10000, 30000, 60000];

function toSafeLabel(value) {
  return String(value).replaceAll('"', '\\"');
}

function buildDurationHistogramLines(observations) {
  const lines = [];

  for (const entry of observations) {
    const countsByBucket = new Map();
    for (const bucket of HISTOGRAM_BUCKETS_MS) {
      countsByBucket.set(bucket, 0);
    }

    let sum = 0;
    for (const value of entry.values) {
      sum += value;
      for (const bucket of HISTOGRAM_BUCKETS_MS) {
        if (value <= bucket) {
          countsByBucket.set(bucket, countsByBucket.get(bucket) + 1);
        }
      }
    }

    const queueLabel = toSafeLabel(entry.queue);
    const outcomeLabel = toSafeLabel(entry.outcome);
    for (const bucket of HISTOGRAM_BUCKETS_MS) {
      lines.push(
        `worker_job_duration_ms_bucket{queue="${queueLabel}",outcome="${outcomeLabel}",le="${bucket}"} ${countsByBucket.get(bucket)}`
      );
    }
    lines.push(`worker_job_duration_ms_bucket{queue="${queueLabel}",outcome="${outcomeLabel}",le="+Inf"} ${entry.values.length}`);
    lines.push(`worker_job_duration_ms_sum{queue="${queueLabel}",outcome="${outcomeLabel}"} ${sum}`);
    lines.push(`worker_job_duration_ms_count{queue="${queueLabel}",outcome="${outcomeLabel}"} ${entry.values.length}`);
  }

  return lines;
}

function buildMetricsText({ serviceName, queueCounts, telemetryStore }) {
  const lines = [];
  lines.push(`service_up{service="${toSafeLabel(serviceName)}"} 1`);

  const snapshot = telemetryStore.getSnapshot({ queueCounts });
  const queueNames = Object.keys(snapshot.queueCounts || {});

  for (const queueName of queueNames) {
    const queueLabel = toSafeLabel(queueName);
    const counts = snapshot.queueCounts[queueName] || {};
    const counters = snapshot.counters[queueName] || {};

    lines.push(`worker_jobs_started_total{queue="${queueLabel}"} ${Number(counters.started || 0)}`);
    lines.push(`worker_jobs_completed_total{queue="${queueLabel}"} ${Number(counters.completed || 0)}`);
    lines.push(`worker_jobs_failed_total{queue="${queueLabel}"} ${Number(counters.failed || 0)}`);

    lines.push(`worker_jobs_active{queue="${queueLabel}"} ${Number(counts.active || 0)}`);

    for (const state of ["waiting", "active", "completed", "failed", "delayed"]) {
      lines.push(`worker_queue_depth{queue="${queueLabel}",state="${state}"} ${Number(counts[state] || 0)}`);
    }
  }

  lines.push(...buildDurationHistogramLines(telemetryStore.getDurationObservations()));

  return `${lines.join("\n")}\n`;
}

module.exports = {
  buildMetricsText
};
