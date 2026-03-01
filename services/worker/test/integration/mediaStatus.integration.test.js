const crypto = require("node:crypto");

const { buildApp } = require("../../src/app");
const mockPool = require("../helpers/mockPool");

describe("worker media status integration", () => {
  let app;

  beforeAll(async () => {
    app = buildApp({
      db: mockPool,
      serviceName: "worker-service-test",
      jwtAccessSecret: "worker-test-secret",
      orphanSweepEnabled: false,
      queueStatsPoller: {
        async start() { },
        async close() { },
        getSnapshot() {
          return {};
        }
      },
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
      }
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

  it("updates media status from processing to ready", async () => {
    const mediaId = crypto.randomUUID();
    mockPool.seedMedia({
      id: mediaId,
      owner_id: crypto.randomUUID(),
      relative_path: `owner/2026/02/${mediaId}.jpg`,
      mime_type: "image/jpeg",
      status: "processing",
      checksum_sha256: crypto.randomUUID().replaceAll("-", "")
    });

    const updated = await app.repos.media.setStatus(mediaId, "ready");
    expect(updated).toBeTruthy();
    expect(updated.status).toBe("ready");
  });

  it("updates media status from processing to failed", async () => {
    const mediaId = crypto.randomUUID();
    mockPool.seedMedia({
      id: mediaId,
      owner_id: crypto.randomUUID(),
      relative_path: `owner/2026/02/${mediaId}.mp4`,
      mime_type: "video/mp4",
      status: "processing",
      checksum_sha256: crypto.randomUUID().replaceAll("-", "")
    });

    const updated = await app.repos.media.setStatus(mediaId, "failed");
    expect(updated).toBeTruthy();
    expect(updated.status).toBe("failed");
  });
});
