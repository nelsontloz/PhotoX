const DEFAULT_EVENT_LIMIT = 500;
const DEFAULT_EVENT_TTL_MS = 15 * 60 * 1000;
const DEFAULT_FAILURE_LIMIT = 50;
const RATE_WINDOW_1M_MS = 60 * 1000;
const RATE_WINDOW_5M_MS = 5 * 60 * 1000;

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function ensureQueueMap(map, queueName, factory) {
  if (!map.has(queueName)) {
    map.set(queueName, factory());
  }

  return map.get(queueName);
}

class WorkerTelemetryStore {
  constructor({ queueNames = [], eventLimitPerQueue = DEFAULT_EVENT_LIMIT, eventTtlMs = DEFAULT_EVENT_TTL_MS, now = Date.now } = {}) {
    this.queueNames = queueNames;
    this.eventLimitPerQueue = eventLimitPerQueue;
    this.eventTtlMs = eventTtlMs;
    this.now = now;
    this.schemaVersion = "2026-02-telemetry-v1";

    this.eventsByQueue = new Map();
    this.failuresByQueue = new Map();
    this.activeJobsByQueue = new Map();
    this.observers = new Set();

    this.counters = new Map();
    this.rateEvents = new Map();
    this.durationObservations = new Map();
    this.workerHealth = new Map();

    for (const queueName of queueNames) {
      this.counters.set(queueName, {
        started: 0,
        completed: 0,
        failed: 0
      });
      this.rateEvents.set(queueName, {
        started: [],
        completed: [],
        failed: []
      });
      this.workerHealth.set(queueName, {
        online: true,
        lastErrorAt: null
      });
    }
  }

  subscribe(listener) {
    this.observers.add(listener);
    return () => {
      this.observers.delete(listener);
    };
  }

  publish(eventName, payload) {
    for (const observer of this.observers) {
      observer(eventName, payload);
    }
  }

  markWorkerError(queueName, err) {
    const health = ensureQueueMap(this.workerHealth, queueName, () => ({ online: true, lastErrorAt: null }));
    health.online = false;
    health.lastErrorAt = new Date(this.now()).toISOString();

    this.recordEvent({
      queue: queueName,
      event: "error",
      errorClass: err?.name || "Error",
      failureCode: err?.code || null
    });
  }

  recordEvent({
    queue,
    event,
    jobId = null,
    mediaId = null,
    attempts = null,
    durationMs = null,
    failureCode = null,
    errorClass = null,
    timestamp = null
  }) {
    const occurredAt = timestamp || new Date(this.now()).toISOString();
    const normalizedAttempts = attempts === null || attempts === undefined ? null : toNumber(attempts, 0);
    const normalizedDuration = durationMs === null || durationMs === undefined ? null : toNumber(durationMs, null);

    const entry = {
      event,
      queue,
      jobId: jobId || null,
      mediaId: mediaId || null,
      attempts: normalizedAttempts,
      durationMs: normalizedDuration,
      failureCode: failureCode || null,
      errorClass: errorClass || null,
      occurredAt
    };

    const queueEvents = ensureQueueMap(this.eventsByQueue, queue, () => []);
    queueEvents.push(entry);
    while (queueEvents.length > this.eventLimitPerQueue) {
      queueEvents.shift();
    }

    const queueHealth = ensureQueueMap(this.workerHealth, queue, () => ({ online: true, lastErrorAt: null }));
    if (event !== "error") {
      queueHealth.online = true;
    }

    const counters = ensureQueueMap(this.counters, queue, () => ({ started: 0, completed: 0, failed: 0 }));
    const rates = ensureQueueMap(this.rateEvents, queue, () => ({ started: [], completed: [], failed: [] }));
    const activeJobs = ensureQueueMap(this.activeJobsByQueue, queue, () => new Map());

    if (event === "active") {
      counters.started += 1;
      rates.started.push(occurredAt);
      if (jobId) {
        activeJobs.set(String(jobId), {
          queue,
          jobId: String(jobId),
          mediaId: mediaId || null,
          attempts: normalizedAttempts,
          startedAt: occurredAt
        });
      }
    }

    if (event === "completed") {
      counters.completed += 1;
      rates.completed.push(occurredAt);
      if (jobId) {
        activeJobs.delete(String(jobId));
      }
      if (Number.isFinite(normalizedDuration) && normalizedDuration >= 0) {
        this.observeDuration(queue, "completed", normalizedDuration);
      }
    }

    if (event === "failed") {
      counters.failed += 1;
      rates.failed.push(occurredAt);
      if (jobId) {
        activeJobs.delete(String(jobId));
      }
      if (Number.isFinite(normalizedDuration) && normalizedDuration >= 0) {
        this.observeDuration(queue, "failed", normalizedDuration);
      }
      const failures = ensureQueueMap(this.failuresByQueue, queue, () => []);
      failures.push(entry);
      while (failures.length > DEFAULT_FAILURE_LIMIT) {
        failures.shift();
      }
    }

    if (event === "stalled" && jobId) {
      activeJobs.delete(String(jobId));
    }

    this.cleanup();

    this.publish("event", {
      schemaVersion: this.schemaVersion,
      event: entry
    });
  }

  observeDuration(queueName, outcome, durationMs) {
    const key = `${queueName}:${outcome}`;
    if (!this.durationObservations.has(key)) {
      this.durationObservations.set(key, []);
    }

    const collection = this.durationObservations.get(key);
    collection.push({ durationMs, observedAt: this.now() });
    while (collection.length > 2000) {
      collection.shift();
    }
  }

  cleanup() {
    const threshold = this.now() - this.eventTtlMs;
    for (const [, events] of this.eventsByQueue.entries()) {
      while (events.length > 0 && new Date(events[0].occurredAt).getTime() < threshold) {
        events.shift();
      }
    }

    for (const [, failures] of this.failuresByQueue.entries()) {
      while (failures.length > 0 && new Date(failures[0].occurredAt).getTime() < threshold) {
        failures.shift();
      }
    }

    const rateThreshold = this.now() - RATE_WINDOW_5M_MS;
    for (const rateSet of this.rateEvents.values()) {
      for (const key of ["started", "completed", "failed"]) {
        while (rateSet[key].length > 0 && new Date(rateSet[key][0]).getTime() < rateThreshold) {
          rateSet[key].shift();
        }
      }
    }

    for (const [, observations] of this.durationObservations.entries()) {
      while (observations.length > 0 && observations[0].observedAt < rateThreshold) {
        observations.shift();
      }
    }
  }

  calculateRates(queueName) {
    const rates = ensureQueueMap(this.rateEvents, queueName, () => ({ started: [], completed: [], failed: [] }));
    const now = this.now();
    const boundary1m = now - RATE_WINDOW_1M_MS;
    const boundary5m = now - RATE_WINDOW_5M_MS;

    const countWithin = (timestamps, boundaryMs) =>
      timestamps.reduce((count, timestamp) => count + (new Date(timestamp).getTime() >= boundaryMs ? 1 : 0), 0);

    return {
      startedPerMinute1m: countWithin(rates.started, boundary1m),
      completedPerMinute1m: countWithin(rates.completed, boundary1m),
      failedPerMinute1m: countWithin(rates.failed, boundary1m),
      startedPerMinute5m: Math.round((countWithin(rates.started, boundary5m) / 5) * 100) / 100,
      completedPerMinute5m: Math.round((countWithin(rates.completed, boundary5m) / 5) * 100) / 100,
      failedPerMinute5m: Math.round((countWithin(rates.failed, boundary5m) / 5) * 100) / 100
    };
  }

  getDurationObservations() {
    const result = [];
    for (const [key, observations] of this.durationObservations.entries()) {
      const [queue, outcome] = key.split(":");
      result.push({
        queue,
        outcome,
        values: observations.map((entry) => entry.durationMs)
      });
    }
    return result;
  }

  getSnapshot({ queueCounts = {} } = {}) {
    this.cleanup();

    const queueNames = new Set([...this.queueNames, ...Array.from(this.eventsByQueue.keys()), ...Object.keys(queueCounts)]);
    const queueList = Array.from(queueNames).sort();
    const rates = {};
    const counters = {};
    const recentFailures = {};

    for (const queueName of queueList) {
      rates[queueName] = this.calculateRates(queueName);
      counters[queueName] = ensureQueueMap(this.counters, queueName, () => ({ started: 0, completed: 0, failed: 0 }));
      recentFailures[queueName] = [...ensureQueueMap(this.failuresByQueue, queueName, () => [])].reverse().slice(0, 10);
    }

    const activeJobs = [];
    for (const activeMap of this.activeJobsByQueue.values()) {
      activeJobs.push(...Array.from(activeMap.values()));
    }

    const recentEvents = [];
    for (const events of this.eventsByQueue.values()) {
      recentEvents.push(...events);
    }

    recentEvents.sort((a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime());

    return {
      schemaVersion: this.schemaVersion,
      generatedAt: new Date(this.now()).toISOString(),
      queueCounts,
      counters,
      rates,
      workerHealth: Object.fromEntries(this.workerHealth.entries()),
      inFlightJobs: activeJobs,
      recentFailures,
      recentEvents: recentEvents.slice(0, 120)
    };
  }
}

module.exports = {
  WorkerTelemetryStore,
  DEFAULT_EVENT_LIMIT,
  DEFAULT_EVENT_TTL_MS
};
