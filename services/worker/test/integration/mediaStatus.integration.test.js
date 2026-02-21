const crypto = require("node:crypto");

const { buildApp } = require("../../src/app");

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ||
  process.env.DATABASE_URL ||
  "postgresql://photox:photox-dev-password@127.0.0.1:5432/photox";

describe("worker media status integration", () => {
  let app;

  beforeAll(async () => {
    app = buildApp({
      databaseUrl: TEST_DATABASE_URL,
      serviceName: "worker-service-test",
      jwtAccessSecret: "worker-test-secret",
      queueStatsPoller: {
        async start() {},
        async close() {},
        getSnapshot() {
          return {};
        }
      },
      mediaProcessWorker: {
        async close() {}
      },
      mediaDerivativesWorker: {
        async close() {}
      },
      mediaCleanupWorker: {
        async close() {}
      }
    });
    await app.ready();
  });

  beforeEach(async () => {
    await app.db.query("TRUNCATE TABLE media_flags, media_metadata, media RESTART IDENTITY CASCADE");
  });

  afterAll(async () => {
    await app.close();
  });

  it("updates media status from processing to ready", async () => {
    const mediaId = crypto.randomUUID();
    await app.db.query(
      `
        INSERT INTO media (id, owner_id, relative_path, mime_type, status, checksum_sha256)
        VALUES ($1, $2, $3, $4, 'processing', $5)
      `,
      [
        mediaId,
        crypto.randomUUID(),
        `owner/2026/02/${mediaId}.jpg`,
        "image/jpeg",
        crypto.randomUUID().replaceAll("-", "")
      ]
    );

    const updated = await app.repos.media.setStatus(mediaId, "ready");
    expect(updated).toBeTruthy();
    expect(updated.status).toBe("ready");
  });

  it("updates media status from processing to failed", async () => {
    const mediaId = crypto.randomUUID();
    await app.db.query(
      `
        INSERT INTO media (id, owner_id, relative_path, mime_type, status, checksum_sha256)
        VALUES ($1, $2, $3, $4, 'processing', $5)
      `,
      [
        mediaId,
        crypto.randomUUID(),
        `owner/2026/02/${mediaId}.mp4`,
        "video/mp4",
        crypto.randomUUID().replaceAll("-", "")
      ]
    );

    const updated = await app.repos.media.setStatus(mediaId, "failed");
    expect(updated).toBeTruthy();
    expect(updated.status).toBe("failed");
  });
});
