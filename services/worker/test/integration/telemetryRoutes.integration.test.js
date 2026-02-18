const jwt = require("jsonwebtoken");

const { buildApp } = require("../../src/app");
const { WorkerTelemetryStore } = require("../../src/telemetry/store");

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ||
  process.env.DATABASE_URL ||
  "postgresql://photox:photox-dev-password@127.0.0.1:5432/photox";

describe("worker telemetry routes", () => {
  const jwtAccessSecret = "worker-telemetry-test-secret";
  const nonAdminId = "11111111-1111-4111-8111-111111111111";
  const adminId = "22222222-2222-4222-8222-222222222222";
  let app;
  let telemetryStore;

  const queueStatsPoller = {
    async start() {},
    async close() {},
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
        }
      };
    }
  };

  beforeAll(async () => {
    telemetryStore = new WorkerTelemetryStore({
      queueNames: ["media.process", "media.derivatives.generate"],
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
      databaseUrl: TEST_DATABASE_URL,
      serviceName: "worker-service-test",
      jwtAccessSecret,
      telemetryStore,
      queueStatsPoller,
      mediaProcessWorker: {
        async close() {}
      },
      mediaDerivativesWorker: {
        async close() {}
      }
    });

    await app.ready();
  });

  beforeEach(async () => {
    await app.db.query("TRUNCATE TABLE users RESTART IDENTITY CASCADE");
  });

  afterAll(async () => {
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
    await app.db.query(
      "INSERT INTO users (id, email, password_hash, is_admin, is_active) VALUES ($1, $2, $3, false, true)",
      [nonAdminId, "user@example.com", "x"]
    );

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
    await app.db.query(
      "INSERT INTO users (id, email, password_hash, is_admin, is_active) VALUES ($1, $2, $3, true, true)",
      [adminId, "admin@example.com", "x"]
    );

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
});
