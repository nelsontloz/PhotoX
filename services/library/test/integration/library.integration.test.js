const crypto = require("node:crypto");

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

describe("library integration", () => {
  let app;
  const accessSecret = "library-integration-access-secret";
  const ownerId = "0f3c9d30-1307-4c9e-a4d7-75e84606c28d";

  beforeAll(async () => {
    app = buildApp({
      databaseUrl: TEST_DATABASE_URL,
      jwtAccessSecret: accessSecret,
      serviceName: "library-service-test"
    });
    await app.ready();
  });

  beforeEach(async () => {
    await app.db.query("TRUNCATE TABLE media_flags, media_metadata, media RESTART IDENTITY CASCADE");
  });

  afterAll(async () => {
    await app.close();
  });

  async function insertMedia({
    id,
    ownerId: rowOwnerId,
    relativePath,
    mimeType,
    createdAt,
    takenAt,
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
        INSERT INTO media_metadata (media_id, taken_at, uploaded_at)
        VALUES ($1, $2, $3)
      `,
      [id, takenAt || null, createdAt]
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
});
