import { Injectable } from '@nestjs/common';

// ponytail: in-process counters + latency histograms, no prom-client — enough for the SLOs this
// service has, and it keeps the dependency list unchanged. Upgrade path: prom-client (or an OTel
// exporter) when you need multi-process aggregation, native histograms or exemplars; this class
// then becomes a thin adapter and the route/status labels stay the same.
const LATENCY_BUCKETS_MS = [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000];

interface RequestCounter {
  method: string;
  route: string;
  status: number;
  total: number;
}

interface Histogram {
  buckets: number[];
  count: number;
  sum: number;
}

interface DurationEntry {
  method: string;
  route: string;
  histogram: Histogram;
}

function escapeLabel(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
}

function labels(entry: { method: string; route: string; status?: number }): string {
  const status = entry.status === undefined ? '' : `,status="${entry.status}"`;
  return `method="${escapeLabel(entry.method)}",route="${escapeLabel(entry.route)}"${status}`;
}

@Injectable()
export class MetricsService {
  private readonly startedAt = Date.now();
  private readonly requests = new Map<string, RequestCounter>();
  private readonly durations = new Map<string, DurationEntry>();

  observeRequest(method: string, route: string, status: number, durationMs: number): void {
    const requestKey = `${method} ${route} ${status}`;
    const counter = this.requests.get(requestKey);
    if (counter) counter.total += 1;
    else this.requests.set(requestKey, { method, route, status, total: 1 });

    const durationKey = `${method} ${route}`;
    let entry = this.durations.get(durationKey);
    if (!entry) {
      entry = {
        method,
        route,
        histogram: { buckets: Array<number>(LATENCY_BUCKETS_MS.length).fill(0), count: 0, sum: 0 },
      };
      this.durations.set(durationKey, entry);
    }
    const { histogram } = entry;
    for (let i = 0; i < LATENCY_BUCKETS_MS.length; i += 1) {
      const bound = LATENCY_BUCKETS_MS[i];
      if (bound !== undefined && durationMs <= bound)
        histogram.buckets[i] = (histogram.buckets[i] ?? 0) + 1;
    }
    histogram.count += 1;
    histogram.sum += durationMs;
  }

  /** Prometheus text exposition (version 0.0.4). Labels are route templates, not raw paths. */
  render(): string {
    const lines: string[] = [
      '# HELP photox_http_requests_total Completed HTTP requests by method, route and status.',
      '# TYPE photox_http_requests_total counter',
    ];
    for (const counter of [...this.requests.values()].sort((a, b) =>
      `${a.method}${a.route}${a.status}`.localeCompare(`${b.method}${b.route}${b.status}`),
    )) {
      lines.push(`photox_http_requests_total{${labels(counter)}} ${counter.total}`);
    }

    lines.push(
      '# HELP photox_http_request_duration_ms Request duration in milliseconds.',
      '# TYPE photox_http_request_duration_ms histogram',
    );
    for (const entry of [...this.durations.values()].sort((a, b) =>
      `${a.method}${a.route}`.localeCompare(`${b.method}${b.route}`),
    )) {
      const { histogram } = entry;
      for (let i = 0; i < LATENCY_BUCKETS_MS.length; i += 1) {
        const bound = LATENCY_BUCKETS_MS[i];
        if (bound === undefined) continue;
        lines.push(
          `photox_http_request_duration_ms_bucket{${labels(entry)},le="${bound}"} ${histogram.buckets[i] ?? 0}`,
        );
      }
      lines.push(
        `photox_http_request_duration_ms_bucket{${labels(entry)},le="+Inf"} ${histogram.count}`,
        `photox_http_request_duration_ms_sum{${labels(entry)}} ${histogram.sum}`,
        `photox_http_request_duration_ms_count{${labels(entry)}} ${histogram.count}`,
      );
    }

    lines.push(
      '# HELP photox_process_uptime_seconds Seconds since the core process started.',
      '# TYPE photox_process_uptime_seconds gauge',
      `photox_process_uptime_seconds ${(Date.now() - this.startedAt) / 1000}`,
      '# HELP photox_process_resident_memory_bytes Resident memory of the core process.',
      '# TYPE photox_process_resident_memory_bytes gauge',
      `photox_process_resident_memory_bytes ${process.memoryUsage().rss}`,
    );
    return `${lines.join('\n')}\n`;
  }
}
