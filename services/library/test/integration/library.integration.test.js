const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const jwt = require("jsonwebtoken");
const sharp = require("sharp");

const { buildApp } = require("../../src/app");
const mockPool = require("../contracts/mockPool");

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
  const queuedCleanupJobs = [];
  const accessSecret = "library-integration-access-secret";
  const ownerId = "0f3c9d30-1307-4c9e-a4d7-75e84606c28d";
  const testOriginalsRoot = path.join(os.tmpdir(), "photox-library-originals-tests");
  const testDerivedRoot = path.join(os.tmpdir(), "photox-library-derived-tests");

  beforeAll(async () => {
    app = buildApp({
      db: mockPool,
      jwtAccessSecret: accessSecret,
      serviceName: "library-service-test",
      uploadOriginalsPath: testOriginalsRoot,
      uploadDerivedPath: testDerivedRoot,
      mediaDerivativesQueue: {
        async add(name, payload, options) {
          queuedDerivativeJobs.push([name, payload, options]);
          return { id: options?.jobId || crypto.randomUUID() };
        },
        async close() { }
      },
      mediaCleanupQueue: {
        async add(name, payload, options) {
          queuedCleanupJobs.push([name, payload, options]);
          return { id: options?.jobId || crypto.randomUUID() };
        },
        async close() { }
      }
    });
    await app.ready();
  });

  beforeEach(async () => {
    queuedDerivativeJobs.length = 0;
    queuedCleanupJobs.length = 0;
    mockPool.reset();
    await fs.rm(testOriginalsRoot, { recursive: true, force: true });
    await fs.rm(testDerivedRoot, { recursive: true, force: true });
    await fs.mkdir(testOriginalsRoot, { recursive: true });
    await fs.mkdir(testDerivedRoot, { recursive: true });
  });

  afterAll(async () => {
    mockPool.reset();
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
    mockPool.seedMedia({
      id,
      owner_id: rowOwnerId,
      relative_path: relativePath,
      mime_type: mimeType,
      status: "ready",
      checksum_sha256: crypto.randomUUID().replaceAll("-", ""),
      taken_at: takenAt || null,
      uploaded_at: createdAt,
      created_at: createdAt,
      width: width || null,
      height: height || null,
      exif_json: exif || null,
      location_json: location || null,
      favorite: Boolean(favorite),
      archived: Boolean(archived),
      hidden: Boolean(hidden),
      deleted_soft: Boolean(deletedSoft)
    });
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
    expect(firstBody.items[0].metadata).toBeUndefined();
    expect(firstBody.items[0].metadataPreview).toBeDefined();
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

  it("soft deletes media and persists soft-delete flags", async () => {
    const token = createAccessToken({
      userId: ownerId,
      email: "soft-delete-flags@example.com",
      secret: accessSecret
    });
    const mediaId = "5c0a4d87-5d5e-4d21-a11b-427edea1f346";

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
    expect(jsonBody(remove)).toEqual({
      mediaId,
      status: "deleted"
    });

    expect(queuedCleanupJobs).toHaveLength(1);
    expect(queuedCleanupJobs[0][0]).toBe("media.cleanup");
    expect(queuedCleanupJobs[0][1]).toMatchObject({
      mediaId,
      ownerId
    });

    const trashAfterDelete = await app.inject({
      method: "GET",
      url: "/api/v1/library/trash?limit=10",
      headers: {
        authorization: `Bearer ${token}`
      }
    });

    expect(trashAfterDelete.statusCode).toBe(200);
    const trashedItem = jsonBody(trashAfterDelete).items.find((item) => item.id === mediaId);
    expect(trashedItem).toBeDefined();
    expect(trashedItem.flags.deletedSoft).toBe(true);
    expect(typeof trashedItem.deletedAt).toBe("string");
    expect(trashedItem.deletedAt).not.toBeNull();
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
    expect(queuedCleanupJobs).toHaveLength(1);
    expect(queuedCleanupJobs[0][0]).toBe("media.cleanup");
    expect(queuedCleanupJobs[0][1]).toMatchObject({
      mediaId,
      ownerId
    });

    const emptyTimeline = await app.inject({
      method: "GET",
      url: "/api/v1/library/timeline",
      headers: {
        authorization: `Bearer ${token}`
      }
    });
    expect(emptyTimeline.statusCode).toBe(200);
    expect(jsonBody(emptyTimeline).items).toHaveLength(0);

    const trashAfterDelete = await app.inject({
      method: "GET",
      url: "/api/v1/library/trash?limit=10",
      headers: {
        authorization: `Bearer ${token}`
      }
    });
    expect(trashAfterDelete.statusCode).toBe(200);
    expect(jsonBody(trashAfterDelete).items.map((item) => item.id)).toContain(mediaId);

    const restore = await app.inject({
      method: "POST",
      url: `/api/v1/media/${mediaId}/restore`,
      headers: {
        authorization: `Bearer ${token}`
      }
    });
    expect(restore.statusCode).toBe(200);

    const trashAfterRestore = await app.inject({
      method: "GET",
      url: "/api/v1/library/trash?limit=10",
      headers: {
        authorization: `Bearer ${token}`
      }
    });
    expect(trashAfterRestore.statusCode).toBe(200);
    expect(jsonBody(trashAfterRestore).items.map((item) => item.id)).not.toContain(mediaId);

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

  it("lists trashed media and supports empty trash queueing", async () => {
    const token = createAccessToken({
      userId: ownerId,
      email: "trash@example.com",
      secret: accessSecret
    });
    const trashedMediaId = "2ec0f4b8-60e7-48d8-a220-3248f8218af6";
    const activeMediaId = "4ec85cf4-cef3-41c8-95b9-b9761b773f9f";

    await insertMedia({
      id: trashedMediaId,
      ownerId,
      relativePath: `${ownerId}/2026/02/${trashedMediaId}.jpg`,
      mimeType: "image/jpeg",
      createdAt: "2026-02-16T08:00:00.000Z",
      deletedSoft: true
    });

    await insertMedia({
      id: activeMediaId,
      ownerId,
      relativePath: `${ownerId}/2026/02/${activeMediaId}.jpg`,
      mimeType: "image/jpeg",
      createdAt: "2026-02-17T08:00:00.000Z",
      deletedSoft: false
    });

    mockPool.setDeletedSoftAt(trashedMediaId, "2026-02-20T12:00:00.000Z");

    const trashResponse = await app.inject({
      method: "GET",
      url: "/api/v1/library/trash?limit=10",
      headers: {
        authorization: `Bearer ${token}`
      }
    });

    expect(trashResponse.statusCode).toBe(200);
    const trashBody = jsonBody(trashResponse);
    expect(trashBody.items).toHaveLength(1);
    expect(trashBody.items[0].id).toBe(trashedMediaId);
    expect(trashBody.items[0].flags.deletedSoft).toBe(true);
    expect(trashBody.items[0].deletedAt).toBe("2026-02-20T12:00:00.000Z");

    const emptyTrashResponse = await app.inject({
      method: "DELETE",
      url: "/api/v1/library/trash",
      headers: {
        authorization: `Bearer ${token}`
      }
    });

    expect(emptyTrashResponse.statusCode).toBe(200);
    expect(jsonBody(emptyTrashResponse)).toEqual({
      status: "queued",
      queuedCount: 1
    });
    expect(queuedCleanupJobs.some((job) => job[1]?.mediaId === trashedMediaId)).toBe(true);
  });

  it("serves trashed media preview from existing derivatives only", async () => {
    const token = createAccessToken({
      userId: ownerId,
      email: "trash-preview@example.com",
      secret: accessSecret
    });
    const trashedMediaId = "c13c890f-3db0-46a9-98dd-b6e2459c8e06";
    const activeMediaId = "e8d913a5-c86a-48a8-bd65-6f81376cb88f";

    await insertMedia({
      id: trashedMediaId,
      ownerId,
      relativePath: `${ownerId}/2026/02/${trashedMediaId}.jpg`,
      mimeType: "image/jpeg",
      createdAt: "2026-02-16T08:00:00.000Z",
      deletedSoft: true
    });

    await insertMedia({
      id: activeMediaId,
      ownerId,
      relativePath: `${ownerId}/2026/02/${activeMediaId}.jpg`,
      mimeType: "image/jpeg",
      createdAt: "2026-02-16T08:00:00.000Z",
      deletedSoft: false
    });

    const trashedDerivativePath = path.join(testDerivedRoot, ownerId, "2026", "02", `${trashedMediaId}-thumb.webp`);
    await fs.mkdir(path.dirname(trashedDerivativePath), { recursive: true });
    await sharp({
      create: {
        width: 320,
        height: 320,
        channels: 3,
        background: {
          r: 85,
          g: 85,
          b: 85
        }
      }
    })
      .webp()
      .toFile(trashedDerivativePath);

    const previewResponse = await app.inject({
      method: "GET",
      url: `/api/v1/library/trash/${trashedMediaId}/preview?variant=thumb`,
      headers: {
        authorization: `Bearer ${token}`
      }
    });

    expect(previewResponse.statusCode).toBe(200);
    expect(previewResponse.headers["content-type"]).toContain("image/webp");
    expect(previewResponse.rawPayload.length).toBeGreaterThan(0);

    const activePreviewResponse = await app.inject({
      method: "GET",
      url: `/api/v1/library/trash/${activeMediaId}/preview?variant=thumb`,
      headers: {
        authorization: `Bearer ${token}`
      }
    });
    expect(activePreviewResponse.statusCode).toBe(404);
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
