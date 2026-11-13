import { MetricsService } from './metrics.service';

describe('MetricsService', () => {
  it('exposes counters, cumulative buckets and totals in Prometheus text form', () => {
    const metrics = new MetricsService();

    metrics.observeRequest('GET', '/api/v1/assets', 200, 12);
    metrics.observeRequest('GET', '/api/v1/assets', 500, 700);

    const text = metrics.render();

    expect(text).toContain(
      'photox_http_requests_total{method="GET",route="/api/v1/assets",status="200"} 1',
    );
    expect(text).toContain(
      'photox_http_requests_total{method="GET",route="/api/v1/assets",status="500"} 1',
    );
    // 12ms lands in the 25 bucket; both requests land in the +Inf bucket
    expect(text).toContain(
      'photox_http_request_duration_ms_bucket{method="GET",route="/api/v1/assets",le="25"} 1',
    );
    expect(text).toContain(
      'photox_http_request_duration_ms_bucket{method="GET",route="/api/v1/assets",le="+Inf"} 2',
    );
    expect(text).toContain(
      'photox_http_request_duration_ms_count{method="GET",route="/api/v1/assets"} 2',
    );
    expect(text).toContain(
      'photox_http_request_duration_ms_sum{method="GET",route="/api/v1/assets"} 712',
    );
  });

  it('escapes label values so a crafted route cannot break the exposition format', () => {
    const metrics = new MetricsService();
    metrics.observeRequest('GET', '/a"b\\c', 200, 1);

    expect(metrics.render()).toContain('route="/a\\"b\\\\c"');
  });
});
