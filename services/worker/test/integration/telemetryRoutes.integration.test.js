const jwt = require("jsonwebtoken");

const { buildApp } = require("../../src/app");
const { WorkerTelemetryStore } = require("../../src/telemetry/store");
const mockPool = require("../helpers/mockPool");

describe("worker telemetry routes", () => {
  const jwtAccessSecret = "worker-telemetry-test-secret";
  const nonAdminId = "11111111-1111-4111-8111-111111111111";
  const adminId = "22222222-2222-4222-8222-222222222222";
  let app;
  let telemetryStore;
  let mediaOrphanSweepQueue;

  const queueStatsPoller = {
    async start() { },
    async close() { },
    getSnapshot() {
      return {
        "media.process": {
          waiting: 2,
          active: 1,
          completed: 7,
          failed: 1,
          delayed: 3
        },
        "media.derivatives.generate": {
          waiting: 0,
          active: 0,
          completed: 11,
          failed: 0,
          delayed: 0
        },
        "media.cleanup": {
          waiting: 0,
          active: 0,
          completed: 0,
          failed: 0,
          delayed: 0
        }
      };
    }
  };

  beforeAll(async () => {
    mediaOrphanSweepQueue = {
      add: vi.fn().mockResolvedValue({ id: "orphan-job-1" }),
      close: vi.fn().mockResolvedValue(undefined)
    };

    telemetryStore = new WorkerTelemetryStore({
      queueNames: ["media.process", "media.derivatives.generate", "media.cleanup"],
      eventLimitPerQueue: 500,
      eventTtlMs: 15 * 60 * 1000
    });
    telemetryStore.recordEvent({
      queue: "media.process",
      event: "active",
      jobId: "job-1",
      mediaId: "media-1"
    });
    telemetryStore.recordEvent({
      queue: "media.process",
      event: "failed",
      jobId: "job-1",
      mediaId: "media-1",
      durationMs: 1000,
      errorClass: "Error"
    });

    app = buildApp({
      db: mockPool,
      serviceName: "worker-service-test",
      jwtAccessSecret,
      telemetryStore,
      queueStatsPoller,
      mediaProcessWorker: {
        async close() { }
      },
      mediaDerivativesWorker: {
        async close() { }
      },
      mediaCleanupWorker: {
        async close() { }
      },
      mediaOrphanSweepWorker: {
        async close() { }
      },
      mediaOrphanSweepQueue,
      orphanSweepEnabled: false
    });

    await app.ready();
  });

  beforeEach(async () => {
    mockPool.reset();
  });

  afterAll(async () => {
    mockPool.reset();
    await app.close();
  });

  function adminToken(userId = adminId) {
    return jwt.sign({ type: "access", email: "admin@example.com" }, jwtAccessSecret, {
      subject: userId,
      expiresIn: 3600
    });
  }

  it("returns 401 when token is missing", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/worker/telemetry/snapshot"
    });

    expect(response.statusCode).toBe(401);
  });

  it("returns 403 for non-admin user", async () => {
    mockPool.seedUser({
      id: nonAdminId,
      email: "user@example.com",
      password_hash: "x",
      is_admin: false,
      is_active: true
    });

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/worker/telemetry/snapshot",
      headers: {
        authorization: `Bearer ${adminToken(nonAdminId)}`
      }
    });

    expect(response.statusCode).toBe(403);
  });

  it("returns telemetry snapshot for admin user", async () => {
    mockPool.seedUser({
      id: adminId,
      email: "admin@example.com",
      password_hash: "x",
      is_admin: true,
      is_active: true
    });

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/worker/telemetry/snapshot",
      headers: {
        authorization: `Bearer ${adminToken(adminId)}`
      }
    });

    expect(response.statusCode).toBe(200);
    const payload = response.json();
    expect(payload.schemaVersion).toBe("2026-02-telemetry-v1");
    expect(payload.queueCounts["media.process"].waiting).toBe(2);
    expect(Array.isArray(payload.recentEvents)).toBe(true);
  });

  it("returns default video encoding profile for admin user", async () => {
    mockPool.seedUser({
      id: adminId,
      email: "admin@example.com",
      password_hash: "x",
      is_admin: true,
      is_active: true
    });

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/worker/settings/video-encoding",
      headers: {
        authorization: `Bearer ${adminToken(adminId)}`
      }
    });

    expect(response.statusCode).toBe(200);
    const payload = response.json();
    expect(payload.profile.outputFormat).toBe("webm");
    expect(payload.profile.codec).toBe("libvpx-vp9");
  });

  it("saves video encoding profile for admin user", async () => {
    mockPool.seedUser({
      id: adminId,
      email: "admin@example.com",
      password_hash: "x",
      is_admin: true,
      is_active: true
    });

    const saveResponse = await app.inject({
      method: "PUT",
      url: "/api/v1/worker/settings/video-encoding",
      headers: {
        authorization: `Bearer ${adminToken(adminId)}`
      },
      payload: {
        profile: {
          codec: "libx264",
          resolution: "1920x1080",
          bitrateKbps: 2500,
          frameRate: 30,
          audioCodec: "aac",
          audioBitrateKbps: 128,
          preset: "balanced",
          outputFormat: "mp4"
        }
      }
    });

    expect(saveResponse.statusCode).toBe(200);
    expect(saveResponse.json().profile.outputFormat).toBe("mp4");

    const getResponse = await app.inject({
      method: "GET",
      url: "/api/v1/worker/settings/video-encoding",
      headers: {
        authorization: `Bearer ${adminToken(adminId)}`
      }
    });

    expect(getResponse.statusCode).toBe(200);
    expect(getResponse.json().profile.codec).toBe("libx264");
  });

  it("rejects invalid video encoding profile payload", async () => {
    mockPool.seedUser({
      id: adminId,
      email: "admin@example.com",
      password_hash: "x",
      is_admin: true,
      is_active: true
    });

    const response = await app.inject({
      method: "PUT",
      url: "/api/v1/worker/settings/video-encoding",
      headers: {
        authorization: `Bearer ${adminToken(adminId)}`
      },
      payload: {
        profile: {
          codec: "libvpx-vp9",
          resolution: "invalid",
          bitrateKbps: 2500,
          frameRate: 30,
          audioCodec: "libopus",
          audioBitrateKbps: 128,
          preset: "balanced",
          outputFormat: "webm"
        }
      }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("VALIDATION_ERROR");
  });

  it("queues manual orphan sweep for admin user", async () => {
    mockPool.seedUser({
      id: adminId,
      email: "admin@example.com",
      password_hash: "x",
      is_admin: true,
      is_active: true
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/worker/orphan-sweep/run",
      headers: {
        authorization: `Bearer ${adminToken(adminId)}`
      },
      payload: {
        scope: "derived",
        dryRun: true,
        graceMs: 1000,
        batchSize: 10
      }
    });

    expect(response.statusCode).toBe(202);
    const payload = response.json();
    expect(payload.status).toBe("queued");
    expect(payload.scopes).toEqual(["derived"]);
    expect(payload.queuedCount).toBe(1);
    expect(mediaOrphanSweepQueue.add).toHaveBeenCalledTimes(1);
  });
});
