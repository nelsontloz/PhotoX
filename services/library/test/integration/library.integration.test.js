const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const jwt = require("jsonwebtoken");
const sharp = require("sharp");

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

describe("library integration", () => {
  let app;
  const queuedDerivativeJobs = [];
  const accessSecret = "library-integration-access-secret";
  const ownerId = "0f3c9d30-1307-4c9e-a4d7-75e84606c28d";
  const testOriginalsRoot = path.join(os.tmpdir(), "photox-library-originals-tests");
  const testDerivedRoot = path.join(os.tmpdir(), "photox-library-derived-tests");

  beforeAll(async () => {
    app = buildApp({
      databaseUrl: TEST_DATABASE_URL,
      jwtAccessSecret: accessSecret,
      serviceName: "library-service-test",
      uploadOriginalsPath: testOriginalsRoot,
      uploadDerivedPath: testDerivedRoot,
      mediaDerivativesQueue: {
        async add(name, payload, options) {
          queuedDerivativeJobs.push([name, payload, options]);
          return { id: options?.jobId || crypto.randomUUID() };
        },
        async close() {}
      }
    });
    await app.ready();
  });

  beforeEach(async () => {
    queuedDerivativeJobs.length = 0;
    await app.db.query("TRUNCATE TABLE media_flags, media_metadata, media RESTART IDENTITY CASCADE");
    await fs.rm(testOriginalsRoot, { recursive: true, force: true });
    await fs.rm(testDerivedRoot, { recursive: true, force: true });
    await fs.mkdir(testOriginalsRoot, { recursive: true });
    await fs.mkdir(testDerivedRoot, { recursive: true });
  });

  afterAll(async () => {
    await app.close();
    await fs.rm(testOriginalsRoot, { recursive: true, force: true });
    await fs.rm(testDerivedRoot, { recursive: true, force: true });
  });

  async function insertMedia({
    id,
    ownerId: rowOwnerId,
    relativePath,
    mimeType,
    createdAt,
    takenAt,
    width,
    height,
    exif,
    location,
    favorite,
    archived,
    hidden,
    deletedSoft
  }) {
    await app.db.query(
      `
        INSERT INTO media (id, owner_id, relative_path, mime_type, status, checksum_sha256, created_at, updated_at)
        VALUES ($1, $2, $3, $4, 'ready', $5, $6, $6)
      `,
      [id, rowOwnerId, relativePath, mimeType, crypto.randomUUID().replaceAll("-", ""), createdAt]
    );

    await app.db.query(
      `
        INSERT INTO media_metadata (media_id, taken_at, uploaded_at, width, height, exif_json, location_json)
        VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb)
      `,
      [id, takenAt || null, createdAt, width || null, height || null, exif ? JSON.stringify(exif) : null, location ? JSON.stringify(location) : null]
    );

    await app.db.query(
      `
        INSERT INTO media_flags (media_id, favorite, archived, hidden, deleted_soft)
        VALUES ($1, $2, $3, $4, $5)
      `,
      [id, Boolean(favorite), Boolean(archived), Boolean(hidden), Boolean(deletedSoft)]
    );
  }

  it("returns timeline pages with stable cursor pagination", async () => {
    const token = createAccessToken({
      userId: ownerId,
      email: "timeline@example.com",
      secret: accessSecret
    });

    const mediaA = "f8e57c4f-b4d7-4f3b-8f4c-ffde26f96d43";
    const mediaB = "95f60990-f2f0-4bd4-b056-523f8f6f8808";
    const mediaC = "2d2b9166-2e5f-4ee5-8e84-6af7dfe4d095";

    await insertMedia({
      id: mediaA,
      ownerId,
      relativePath: `${ownerId}/2026/02/${mediaA}.jpg`,
      mimeType: "image/jpeg",
      createdAt: "2026-02-16T10:00:00.000Z",
      takenAt: "2026-02-16T10:00:00.000Z"
    });
    await insertMedia({
      id: mediaB,
      ownerId,
      relativePath: `${ownerId}/2026/02/${mediaB}.jpg`,
      mimeType: "image/jpeg",
      createdAt: "2026-02-15T10:00:00.000Z",
      takenAt: "2026-02-15T10:00:00.000Z"
    });
    await insertMedia({
      id: mediaC,
      ownerId,
      relativePath: `${ownerId}/2026/02/${mediaC}.jpg`,
      mimeType: "image/jpeg",
      createdAt: "2026-02-14T10:00:00.000Z",
      takenAt: "2026-02-14T10:00:00.000Z"
    });

    const firstPage = await app.inject({
      method: "GET",
      url: "/api/v1/library/timeline?limit=2",
      headers: {
        authorization: `Bearer ${token}`
      }
    });

    expect(firstPage.statusCode).toBe(200);
    const firstBody = jsonBody(firstPage);
    expect(firstBody.items).toHaveLength(2);
    expect(firstBody.items[0].id).toBe(mediaA);
    expect(firstBody.items[1].id).toBe(mediaB);
    expect(typeof firstBody.nextCursor).toBe("string");

    const secondPage = await app.inject({
      method: "GET",
      url: `/api/v1/library/timeline?limit=2&cursor=${encodeURIComponent(firstBody.nextCursor)}`,
      headers: {
        authorization: `Bearer ${token}`
      }
    });

    expect(secondPage.statusCode).toBe(200);
    const secondBody = jsonBody(secondPage);
    expect(secondBody.items).toHaveLength(1);
    expect(secondBody.items[0].id).toBe(mediaC);
    expect(secondBody.nextCursor).toBeNull();
  });

  it("updates media flags and takenAt", async () => {
    const token = createAccessToken({
      userId: ownerId,
      email: "patch@example.com",
      secret: accessSecret
    });
    const mediaId = "ee3b6a50-1311-4a37-a022-a23eb0de89f4";

    await insertMedia({
      id: mediaId,
      ownerId,
      relativePath: `${ownerId}/2026/02/${mediaId}.jpg`,
      mimeType: "image/jpeg",
      createdAt: "2026-02-16T08:00:00.000Z",
      favorite: false,
      archived: false,
      hidden: false
    });

    const patch = await app.inject({
      method: "PATCH",
      url: `/api/v1/media/${mediaId}`,
      headers: {
        authorization: `Bearer ${token}`
      },
      payload: {
        favorite: true,
        takenAt: "2026-02-10T09:30:00.000Z"
      }
    });

    expect(patch.statusCode).toBe(200);
    const patchBody = jsonBody(patch);
    expect(patchBody.media.flags.favorite).toBe(true);
    expect(patchBody.media.takenAt).toBe("2026-02-10T09:30:00.000Z");
  });

  it("soft deletes and restores media affecting timeline results", async () => {
    const token = createAccessToken({
      userId: ownerId,
      email: "delete@example.com",
      secret: accessSecret
    });
    const mediaId = "98e460c1-df4c-4d6e-b4dc-8f24ed3e7dd8";

    await insertMedia({
      id: mediaId,
      ownerId,
      relativePath: `${ownerId}/2026/02/${mediaId}.jpg`,
      mimeType: "image/jpeg",
      createdAt: "2026-02-16T08:00:00.000Z"
    });

    const remove = await app.inject({
      method: "DELETE",
      url: `/api/v1/media/${mediaId}`,
      headers: {
        authorization: `Bearer ${token}`
      }
    });
    expect(remove.statusCode).toBe(200);

    const emptyTimeline = await app.inject({
      method: "GET",
      url: "/api/v1/library/timeline",
      headers: {
        authorization: `Bearer ${token}`
      }
    });
    expect(emptyTimeline.statusCode).toBe(200);
    expect(jsonBody(emptyTimeline).items).toHaveLength(0);

    const restore = await app.inject({
      method: "POST",
      url: `/api/v1/media/${mediaId}/restore`,
      headers: {
        authorization: `Bearer ${token}`
      }
    });
    expect(restore.statusCode).toBe(200);

    const timelineAfterRestore = await app.inject({
      method: "GET",
      url: "/api/v1/library/timeline",
      headers: {
        authorization: `Bearer ${token}`
      }
    });
    expect(timelineAfterRestore.statusCode).toBe(200);
    expect(jsonBody(timelineAfterRestore).items[0].id).toBe(mediaId);
  });

  it("returns media content, queues missing derivatives, and serves generated derivative", async () => {
    const token = createAccessToken({
      userId: ownerId,
      email: "content@example.com",
      secret: accessSecret
    });
    const mediaId = "1f2ef07f-7c81-4662-93a3-fccce979c0ff";
    const relativePath = `${ownerId}/2026/02/${mediaId}.jpg`;

    await insertMedia({
      id: mediaId,
      ownerId,
      relativePath,
      mimeType: "image/jpeg",
      createdAt: "2026-02-16T08:00:00.000Z"
    });

    const originalAbsolutePath = path.join(testOriginalsRoot, ...relativePath.split("/"));
    await fs.mkdir(path.dirname(originalAbsolutePath), { recursive: true });
    await sharp({
      create: {
        width: 900,
        height: 600,
        channels: 3,
        background: {
          r: 45,
          g: 120,
          b: 180
        }
      }
    })
      .jpeg()
      .toFile(originalAbsolutePath);

    const thumbResponse = await app.inject({
      method: "GET",
      url: `/api/v1/media/${mediaId}/content?variant=thumb`,
      headers: {
        authorization: `Bearer ${token}`
      }
    });

    expect(thumbResponse.statusCode).toBe(200);
    expect(thumbResponse.headers["content-type"]).toContain("image/jpeg");
    expect(thumbResponse.rawPayload.length).toBeGreaterThan(0);
    expect(queuedDerivativeJobs).toHaveLength(1);
    expect(queuedDerivativeJobs[0][0]).toBe("media.derivatives.generate");
    expect(queuedDerivativeJobs[0][1]).toMatchObject({
      mediaId,
      ownerId,
      relativePath
    });

    const derivativeAbsolutePath = path.join(testDerivedRoot, ownerId, "2026", "02", `${mediaId}-thumb.webp`);
    await fs.mkdir(path.dirname(derivativeAbsolutePath), { recursive: true });
    await sharp({
      create: {
        width: 320,
        height: 320,
        channels: 3,
        background: {
          r: 40,
          g: 40,
          b: 40
        }
      }
    })
      .webp()
      .toFile(derivativeAbsolutePath);

    const thumbReadyResponse = await app.inject({
      method: "GET",
      url: `/api/v1/media/${mediaId}/content?variant=thumb`,
      headers: {
        authorization: `Bearer ${token}`
      }
    });

    expect(thumbReadyResponse.statusCode).toBe(200);
    expect(thumbReadyResponse.headers["content-type"]).toContain("image/webp");

    const originalResponse = await app.inject({
      method: "GET",
      url: `/api/v1/media/${mediaId}/content?variant=original`,
      headers: {
        authorization: `Bearer ${token}`
      }
    });

    expect(originalResponse.statusCode).toBe(200);
    expect(originalResponse.headers["content-type"]).toContain("image/jpeg");
  });

  it("serves playback variant for videos when playback derivative exists", async () => {
    const token = createAccessToken({
      userId: ownerId,
      email: "playback-ready@example.com",
      secret: accessSecret
    });
    const mediaId = "f545f299-b83c-4053-a6d0-e30615db6e9f";
    const relativePath = `${ownerId}/2026/02/${mediaId}.mp4`;

    await insertMedia({
      id: mediaId,
      ownerId,
      relativePath,
      mimeType: "video/mp4",
      createdAt: "2026-02-16T08:00:00.000Z"
    });

    const playbackAbsolutePath = path.join(
      testDerivedRoot,
      ownerId,
      "2026",
      "02",
      `${mediaId}-playback.webm`
    );
    const playbackBytes = Buffer.from("video-playback-test-bytes", "utf8");
    await fs.mkdir(path.dirname(playbackAbsolutePath), { recursive: true });
    await fs.writeFile(playbackAbsolutePath, playbackBytes);

    const response = await app.inject({
      method: "GET",
      url: `/api/v1/media/${mediaId}/content?variant=playback`,
      headers: {
        authorization: `Bearer ${token}`
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("video/webm");
    expect(response.rawPayload.equals(playbackBytes)).toBe(true);
    expect(queuedDerivativeJobs).toHaveLength(0);
  });

  it("returns retriable error and enqueues job when playback derivative is missing", async () => {
    const token = createAccessToken({
      userId: ownerId,
      email: "playback-missing@example.com",
      secret: accessSecret
    });
    const mediaId = "4ed2b69e-cf6f-431d-947d-75c356f6fa7a";
    const relativePath = `${ownerId}/2026/02/${mediaId}.mp4`;

    await insertMedia({
      id: mediaId,
      ownerId,
      relativePath,
      mimeType: "video/mp4",
      createdAt: "2026-02-16T08:00:00.000Z"
    });

    const response = await app.inject({
      method: "GET",
      url: `/api/v1/media/${mediaId}/content?variant=playback`,
      headers: {
        authorization: `Bearer ${token}`
      }
    });

    expect(response.statusCode).toBe(503);
    const body = jsonBody(response);
    expect(body.error.code).toBe("PLAYBACK_DERIVATIVE_NOT_READY");
    expect(body.error.message).toBe("Playback derivative is not ready; retry later");
    expect(body.error.details).toMatchObject({
      mediaId,
      variant: "playback",
      retriable: true,
      queued: true
    });

    expect(queuedDerivativeJobs).toHaveLength(1);
    expect(queuedDerivativeJobs[0][0]).toBe("media.derivatives.generate");
    expect(queuedDerivativeJobs[0][1]).toMatchObject({
      mediaId,
      ownerId,
      relativePath
    });
  });

  it("returns validation error for playback variant on non-video media", async () => {
    const token = createAccessToken({
      userId: ownerId,
      email: "playback-invalid@example.com",
      secret: accessSecret
    });
    const mediaId = "1464a610-30ff-4150-b0f8-a3807f0f0496";

    await insertMedia({
      id: mediaId,
      ownerId,
      relativePath: `${ownerId}/2026/02/${mediaId}.jpg`,
      mimeType: "image/jpeg",
      createdAt: "2026-02-16T08:00:00.000Z"
    });

    const response = await app.inject({
      method: "GET",
      url: `/api/v1/media/${mediaId}/content?variant=playback`,
      headers: {
        authorization: `Bearer ${token}`
      }
    });

    expect(response.statusCode).toBe(400);
    const body = jsonBody(response);
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.message).toBe("Request validation failed");
    expect(body.error.details.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: ["variant"],
          message: "playback variant is only supported for video media"
        })
      ])
    );
    expect(queuedDerivativeJobs).toHaveLength(0);
  });

  it("returns media detail endpoint payload", async () => {
    const token = createAccessToken({
      userId: ownerId,
      email: "detail@example.com",
      secret: accessSecret
    });
    const mediaId = "e8464f45-ac3b-467d-8d27-ff6f66f6d761";

    await insertMedia({
      id: mediaId,
      ownerId,
      relativePath: `${ownerId}/2026/02/${mediaId}.jpg`,
      mimeType: "image/jpeg",
      createdAt: "2026-02-16T08:00:00.000Z",
      width: 1920,
      height: 1080,
      exif: {
        image: {
          make: "Canon",
          model: "EOS"
        }
      },
      location: {
        lat: 37.7749,
        lon: -122.4194
      },
      favorite: true,
      archived: false,
      hidden: false
    });

    const detail = await app.inject({
      method: "GET",
      url: `/api/v1/media/${mediaId}`,
      headers: {
        authorization: `Bearer ${token}`
      }
    });

    expect(detail.statusCode).toBe(200);
    const detailBody = jsonBody(detail);
    expect(detailBody.media.id).toBe(mediaId);
    expect(detailBody.media.ownerId).toBe(ownerId);
    expect(detailBody.media.metadataPreview).toEqual({
      durationSec: null,
      codec: null,
      fps: null,
      width: 1920,
      height: 1080
    });
    expect(detailBody.media.metadata.image).toEqual({
      make: "Canon",
      model: "EOS"
    });
    expect(detailBody.media.metadata.location).toEqual({
      lat: 37.7749,
      lon: -122.4194
    });
    expect(detailBody.media.flags.favorite).toBe(true);
  });

  it("exposes OpenAPI and Swagger UI endpoints", async () => {
    const openapi = await app.inject({
      method: "GET",
      url: "/api/v1/library/openapi.json"
    });

    expect(openapi.statusCode).toBe(200);
    const spec = jsonBody(openapi);
    expect(spec.openapi).toBeTruthy();

    const timelineGet = spec.paths["/api/v1/library/timeline"].get;
    expect(timelineGet.summary).toBeTruthy();
    expect(timelineGet.description).toBeTruthy();
    expect(timelineGet.security[0].bearerAuth).toEqual([]);

    const mediaDetailGet = spec.paths["/api/v1/media/{mediaId}"].get;
    expect(mediaDetailGet.summary).toBeTruthy();
    expect(mediaDetailGet.description).toBeTruthy();

    const docs = await app.inject({
      method: "GET",
      url: "/api/v1/library/docs"
    });

    expect(docs.statusCode).toBe(200);
    expect(docs.headers["content-type"]).toContain("text/html");
  });
});
