const jwt = require("jsonwebtoken");

const { buildApp } = require("../../src/app");

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ||
  process.env.DATABASE_URL ||
  "postgresql://photox:photox-dev-password@127.0.0.1:5432/photox";

function jsonBody(response) {
  return JSON.parse(response.body);
}

function createAccessToken({ userId, email, secret }) {
  return jwt.sign(
    {
      type: "access",
      email
    },
    secret,
    {
      subject: userId,
      expiresIn: 300
    }
  );
}

describe("upload init integration", () => {
  let app;
  const accessSecret = "ingest-integration-access-secret";

  beforeAll(async () => {
    app = buildApp({
      databaseUrl: TEST_DATABASE_URL,
      jwtAccessSecret: accessSecret,
      serviceName: "ingest-service-test",
      uploadPartSizeBytes: 1024 * 1024
    });
    await app.ready();
  });

  beforeEach(async () => {
    await app.db.query("TRUNCATE TABLE upload_parts, idempotency_keys, media, upload_sessions RESTART IDENTITY CASCADE");
  });

  afterAll(async () => {
    await app.close();
  });

  it("initializes upload session and returns metadata", async () => {
    const accessToken = createAccessToken({
      userId: "0f3c9d30-1307-4c9e-a4d7-75e84606c28d",
      email: "user@example.com",
      secret: accessSecret
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/uploads/init",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "idempotency-key": "idem-init-1"
      },
      payload: {
        fileName: "IMG_1024.jpg",
        contentType: "image/jpeg",
        fileSize: 1200,
        checksumSha256: "de4ecf4e0d0f157c8142fdb7f0e6f9f607c37d9b233830f70f7f83b4f04f9b69"
      }
    });

    expect(response.statusCode).toBe(201);
    const body = jsonBody(response);
    expect(body.uploadId).toBeTruthy();
    expect(body.partSize).toBe(1024 * 1024);
    expect(body.expiresAt).toBeTruthy();
  });

  it("replays upload init response for same idempotency key", async () => {
    const accessToken = createAccessToken({
      userId: "0f3c9d30-1307-4c9e-a4d7-75e84606c28d",
      email: "user@example.com",
      secret: accessSecret
    });

    const payload = {
      fileName: "IMG_1024.jpg",
      contentType: "image/jpeg",
      fileSize: 1200,
      checksumSha256: "de4ecf4e0d0f157c8142fdb7f0e6f9f607c37d9b233830f70f7f83b4f04f9b69"
    };

    const first = await app.inject({
      method: "POST",
      url: "/api/v1/uploads/init",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "idempotency-key": "idem-init-1"
      },
      payload
    });

    const second = await app.inject({
      method: "POST",
      url: "/api/v1/uploads/init",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "idempotency-key": "idem-init-1"
      },
      payload
    });

    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);
    expect(jsonBody(first)).toEqual(jsonBody(second));
  });

  it("rejects idempotency key reuse with different payload", async () => {
    const accessToken = createAccessToken({
      userId: "0f3c9d30-1307-4c9e-a4d7-75e84606c28d",
      email: "user@example.com",
      secret: accessSecret
    });

    await app.inject({
      method: "POST",
      url: "/api/v1/uploads/init",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "idempotency-key": "idem-init-1"
      },
      payload: {
        fileName: "IMG_1024.jpg",
        contentType: "image/jpeg",
        fileSize: 1200,
        checksumSha256: "de4ecf4e0d0f157c8142fdb7f0e6f9f607c37d9b233830f70f7f83b4f04f9b69"
      }
    });

    const conflict = await app.inject({
      method: "POST",
      url: "/api/v1/uploads/init",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "idempotency-key": "idem-init-1"
      },
      payload: {
        fileName: "IMG_1025.jpg",
        contentType: "image/jpeg",
        fileSize: 1200,
        checksumSha256: "de4ecf4e0d0f157c8142fdb7f0e6f9f607c37d9b233830f70f7f83b4f04f9b69"
      }
    });

    expect(conflict.statusCode).toBe(409);
    expect(jsonBody(conflict).error.code).toBe("IDEMPOTENCY_CONFLICT");
  });
});
