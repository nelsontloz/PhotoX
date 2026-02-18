const { WorkerTelemetryStore } = require("../../src/telemetry/store");

describe("worker telemetry store", () => {
  it("enforces per-queue event retention bounds", () => {
    const store = new WorkerTelemetryStore({
      queueNames: ["media.process"],
      eventLimitPerQueue: 3,
      eventTtlMs: 60_000,
      now: () => Date.parse("2026-02-18T00:00:00.000Z")
    });

    store.recordEvent({ queue: "media.process", event: "active", jobId: "j1" });
    store.recordEvent({ queue: "media.process", event: "completed", jobId: "j1" });
    store.recordEvent({ queue: "media.process", event: "active", jobId: "j2" });
    store.recordEvent({ queue: "media.process", event: "failed", jobId: "j2" });

    const snapshot = store.getSnapshot({
      queueCounts: {
        "media.process": {
          waiting: 0,
          active: 0,
          completed: 1,
          failed: 1,
          delayed: 0
        }
      }
    });

    const queueEvents = snapshot.recentEvents.filter((event) => event.queue === "media.process");
    expect(queueEvents).toHaveLength(3);
  });

  it("computes counters and moving rates", () => {
    let nowMs = Date.parse("2026-02-18T00:00:00.000Z");
    const store = new WorkerTelemetryStore({
      queueNames: ["media.derivatives.generate"],
      now: () => nowMs
    });

    store.recordEvent({ queue: "media.derivatives.generate", event: "active", jobId: "j1" });
    store.recordEvent({ queue: "media.derivatives.generate", event: "completed", jobId: "j1", durationMs: 200 });
    nowMs += 30_000;
    store.recordEvent({ queue: "media.derivatives.generate", event: "active", jobId: "j2" });
    store.recordEvent({ queue: "media.derivatives.generate", event: "failed", jobId: "j2", durationMs: 1000 });

    const snapshot = store.getSnapshot({
      queueCounts: {
        "media.derivatives.generate": {
          waiting: 2,
          active: 1,
          completed: 10,
          failed: 3,
          delayed: 1
        }
      }
    });

    expect(snapshot.counters["media.derivatives.generate"]).toEqual({
      started: 2,
      completed: 1,
      failed: 1
    });
    expect(snapshot.rates["media.derivatives.generate"].startedPerMinute1m).toBe(2);
    expect(snapshot.rates["media.derivatives.generate"].failedPerMinute1m).toBe(1);
    expect(snapshot.inFlightJobs).toHaveLength(0);
    expect(snapshot.recentFailures["media.derivatives.generate"]).toHaveLength(1);
  });
});
