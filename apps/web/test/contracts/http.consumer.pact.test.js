import jwt from "jsonwebtoken";
import { PactV3, MatchersV3 } from "@pact-foundation/pact";

const { like, regex, eachLike } = MatchersV3;

const PACT_DIR = new URL("../../pacts", import.meta.url).pathname;
const ACCESS_SECRET = "pact-access-secret";
const REFRESH_SECRET = "pact-refresh-secret";
const FAR_FUTURE_UNIX = 4102444800;

const USER_ID = "11111111-1111-4111-8111-111111111111";
const ADMIN_ID = "22222222-2222-4222-8222-222222222222";
const TARGET_USER_ID = "33333333-3333-4333-8333-333333333333";
const UPLOAD_ID = "44444444-4444-4444-8444-444444444444";
const MEDIA_ID = "55555555-5555-4555-8555-555555555555";

const UUID_REGEX = "^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$";
const TIMESTAMP_REGEX = "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d{3})?Z$";
const SHA256_REGEX = "^[a-f0-9]{64}$";

function createAccessToken({ userId, email }) {
  return jwt.sign({ type: "access", email, exp: FAR_FUTURE_UNIX }, ACCESS_SECRET, {
    subject: userId,
    noTimestamp: true
  });
}

function createRefreshToken({ userId, sessionId }) {
  return jwt.sign({ type: "refresh", sid: sessionId, exp: FAR_FUTURE_UNIX }, REFRESH_SECRET, {
    subject: userId,
    noTimestamp: true
  });
}

function buildProvider(provider) {
  return new PactV3({
    consumer: "photox-web-app",
    provider,
    dir: PACT_DIR
  });
}

async function jsonRequest(baseUrl, path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, options);
  const body = await response.text();
  let payload = null;
  if (body) {
    payload = JSON.parse(body);
  }
  return { response, payload };
}

describe("web http consumer pacts", () => {
  it("auth-service interactions", async () => {
    const accessToken = createAccessToken({ userId: ADMIN_ID, email: "admin@example.com" });
    const refreshToken = createRefreshToken({ userId: USER_ID, sessionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" });

    const provider = buildProvider("auth-service");
    provider
      .given("register a user")
      .uponReceiving("register a user")
      .withRequest({
        method: "POST",
        path: "/api/v1/auth/register",
        headers: { "Content-Type": "application/json" },
        body: {
          email: "new-user@example.com",
          password: "super-secret-password"
        }
      })
      .willRespondWith({
        status: 201,
        headers: { "Content-Type": "application/json; charset=utf-8" },
        body: {
          user: {
            id: regex(UUID_REGEX, USER_ID),
            email: like("new-user@example.com"),
            name: null,
            isAdmin: like(false),
            isActive: like(true)
          }
        }
      })
      .given("login a user")
      .uponReceiving("login a user")
      .withRequest({
        method: "POST",
        path: "/api/v1/auth/login",
        headers: { "Content-Type": "application/json" },
        body: {
          email: "new-user@example.com",
          password: "super-secret-password"
        }
      })
      .willRespondWith({
        status: 200,
        headers: { "Content-Type": "application/json; charset=utf-8" },
        body: {
          accessToken: like(accessToken),
          refreshToken: like(refreshToken),
          expiresIn: like(3600),
          user: {
            id: regex(UUID_REGEX, USER_ID),
            email: like("new-user@example.com"),
            name: null,
            isAdmin: like(false),
            isActive: like(true)
          }
        }
      })
      .given("refresh auth tokens")
      .uponReceiving("refresh auth tokens")
      .withRequest({
        method: "POST",
        path: "/api/v1/auth/refresh",
        headers: { "Content-Type": "application/json" },
        body: {
          refreshToken
        }
      })
      .willRespondWith({
        status: 200,
        headers: { "Content-Type": "application/json; charset=utf-8" },
        body: {
          accessToken: like(accessToken),
          refreshToken: like(refreshToken),
          expiresIn: like(3600),
          user: {
            id: regex(UUID_REGEX, USER_ID),
            email: like("new-user@example.com"),
            name: null,
            isAdmin: like(false),
            isActive: like(true)
          }
        }
      })
      .given("read current user")
      .uponReceiving("read current user")
      .withRequest({
        method: "GET",
        path: "/api/v1/me",
        headers: {
          Authorization: `Bearer ${accessToken}`
        }
      })
      .willRespondWith({
        status: 200,
        headers: { "Content-Type": "application/json; charset=utf-8" },
        body: {
          user: {
            id: regex(UUID_REGEX, ADMIN_ID),
            email: like("admin@example.com"),
            name: null,
            isAdmin: like(true),
            isActive: like(true)
          }
        }
      })
      .given("logout a user")
      .uponReceiving("logout a user")
      .withRequest({
        method: "POST",
        path: "/api/v1/auth/logout",
        headers: { "Content-Type": "application/json" },
        body: {
          refreshToken
        }
      })
      .willRespondWith({
        status: 200,
        headers: { "Content-Type": "application/json; charset=utf-8" },
        body: {
          success: like(true)
        }
      })
      .given("list admin users")
      .uponReceiving("list admin users")
      .withRequest({
        method: "GET",
        path: "/api/v1/admin/users",
        headers: {
          Authorization: `Bearer ${accessToken}`
        }
      })
      .willRespondWith({
        status: 200,
        headers: { "Content-Type": "application/json; charset=utf-8" },
        body: {
          items: eachLike({
            user: {
              id: regex(UUID_REGEX, TARGET_USER_ID),
              email: like("managed@example.com"),
              name: null,
              isAdmin: like(false),
              isActive: like(true)
            },
            uploadCount: like(0)
          }),
          totalUsers: like(1),
          limit: like(25),
          offset: like(0)
        }
      })
      .given("list admin users paginated")
      .uponReceiving("list admin users paginated")
      .withRequest({
        method: "GET",
        path: "/api/v1/admin/users",
        query: {
          limit: "100",
          offset: "0"
        },
        headers: {
          Authorization: `Bearer ${accessToken}`
        }
      })
      .willRespondWith({
        status: 200,
        headers: { "Content-Type": "application/json; charset=utf-8" },
        body: {
          items: eachLike({
            user: {
              id: regex(UUID_REGEX, TARGET_USER_ID),
              email: like("managed@example.com"),
              name: null,
              isAdmin: like(false),
              isActive: like(true)
            },
            uploadCount: like(0)
          }),
          totalUsers: like(1),
          limit: like(100),
          offset: like(0)
        }
      })
      .given("create admin-managed user")
      .uponReceiving("create admin-managed user")
      .withRequest({
        method: "POST",
        path: "/api/v1/admin/users",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json"
        },
        body: {
          email: "managed@example.com",
          password: "super-secret-password"
        }
      })
      .willRespondWith({
        status: 201,
        headers: { "Content-Type": "application/json; charset=utf-8" },
        body: {
          user: {
            id: regex(UUID_REGEX, TARGET_USER_ID),
            email: like("managed@example.com"),
            name: null,
            isAdmin: like(false),
            isActive: like(true)
          }
        }
      })
      .given("create admin-managed admin user")
      .uponReceiving("create admin-managed admin user")
      .withRequest({
        method: "POST",
        path: "/api/v1/admin/users",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json"
        },
        body: {
          email: "managed-admin@example.com",
          password: "super-secret-password",
          isAdmin: true
        }
      })
      .willRespondWith({
        status: 201,
        headers: { "Content-Type": "application/json; charset=utf-8" },
        body: {
          user: {
            id: regex(UUID_REGEX, TARGET_USER_ID),
            email: like("managed-admin@example.com"),
            name: null,
            isAdmin: like(true),
            isActive: like(true)
          }
        }
      })
      .given("update admin-managed user")
      .uponReceiving("update admin-managed user")
      .withRequest({
        method: "PATCH",
        path: `/api/v1/admin/users/${TARGET_USER_ID}`,
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json"
        },
        body: {
          isAdmin: true
        }
      })
      .willRespondWith({
        status: 200,
        headers: { "Content-Type": "application/json; charset=utf-8" },
        body: {
          user: {
            id: regex(UUID_REGEX, TARGET_USER_ID),
            email: like("managed@example.com"),
            name: null,
            isAdmin: like(true),
            isActive: like(true)
          }
        }
      })
      .given("reactivate managed user")
      .uponReceiving("reactivate managed user")
      .withRequest({
        method: "PATCH",
        path: `/api/v1/admin/users/${TARGET_USER_ID}`,
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json"
        },
        body: {
          isActive: true
        }
      })
      .willRespondWith({
        status: 200,
        headers: { "Content-Type": "application/json; charset=utf-8" },
        body: {
          user: {
            id: regex(UUID_REGEX, TARGET_USER_ID),
            email: like("managed@example.com"),
            name: null,
            isAdmin: like(false),
            isActive: like(true)
          }
        }
      })
      .given("reset managed user password")
      .uponReceiving("reset managed user password")
      .withRequest({
        method: "POST",
        path: `/api/v1/admin/users/${TARGET_USER_ID}/reset-password`,
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json"
        },
        body: {
          password: "next-super-secret-password"
        }
      })
      .willRespondWith({
        status: 200,
        headers: { "Content-Type": "application/json; charset=utf-8" },
        body: {
          success: like(true)
        }
      })
      .given("disable managed user")
      .uponReceiving("disable managed user")
      .withRequest({
        method: "DELETE",
        path: `/api/v1/admin/users/${TARGET_USER_ID}`,
        headers: {
          Authorization: `Bearer ${accessToken}`
        }
      })
      .willRespondWith({
        status: 200,
        headers: { "Content-Type": "application/json; charset=utf-8" },
        body: {
          success: like(true)
        }
      });

    await provider.executeTest(async (mockserver) => {
      await jsonRequest(mockserver.url, "/api/v1/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "new-user@example.com", password: "super-secret-password" })
      });
      await jsonRequest(mockserver.url, "/api/v1/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "new-user@example.com", password: "super-secret-password" })
      });
      await jsonRequest(mockserver.url, "/api/v1/auth/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refreshToken })
      });
      await jsonRequest(mockserver.url, "/api/v1/me", {
        method: "GET",
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      await jsonRequest(mockserver.url, "/api/v1/auth/logout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refreshToken })
      });
      await jsonRequest(mockserver.url, "/api/v1/admin/users", {
        method: "GET",
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      await jsonRequest(mockserver.url, "/api/v1/admin/users?limit=100&offset=0", {
        method: "GET",
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      await jsonRequest(mockserver.url, "/api/v1/admin/users", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ email: "managed@example.com", password: "super-secret-password" })
      });
      await jsonRequest(mockserver.url, "/api/v1/admin/users", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          email: "managed-admin@example.com",
          password: "super-secret-password",
          isAdmin: true
        })
      });
      await jsonRequest(mockserver.url, `/api/v1/admin/users/${TARGET_USER_ID}`, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ isAdmin: true })
      });
      await jsonRequest(mockserver.url, `/api/v1/admin/users/${TARGET_USER_ID}`, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ isActive: true })
      });
      await jsonRequest(mockserver.url, `/api/v1/admin/users/${TARGET_USER_ID}/reset-password`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ password: "next-super-secret-password" })
      });
      await jsonRequest(mockserver.url, `/api/v1/admin/users/${TARGET_USER_ID}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${accessToken}` }
      });
    });
  });

  it("ingest-service interactions", async () => {
    const accessToken = createAccessToken({ userId: USER_ID, email: "new-user@example.com" });
    const provider = buildProvider("ingest-service");

    provider
      .given("initialize upload")
      .uponReceiving("initialize upload")
      .withRequest({
        method: "POST",
        path: "/api/v1/uploads/init",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Idempotency-Key": "init-abc123",
          "Content-Type": "application/json"
        },
        body: {
          fileName: "IMG_1024.jpg",
          contentType: "image/jpeg",
          fileSize: 3811212,
          checksumSha256: "de4ecf4e0d0f157c8142fdb7f0e6f9f607c37d9b233830f70f7f83b4f04f9b69"
        }
      })
      .willRespondWith({
        status: 201,
        headers: { "Content-Type": "application/json; charset=utf-8" },
        body: {
          uploadId: regex(UUID_REGEX, UPLOAD_ID),
          partSize: like(5242880),
          expiresAt: regex(TIMESTAMP_REGEX, "2026-02-18T12:00:00.000Z")
        }
      })
      .given("upload part bytes")
      .uponReceiving("upload part bytes")
      .withRequest({
        method: "POST",
        path: `/api/v1/uploads/${UPLOAD_ID}/part`,
        query: { partNumber: "1" },
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/octet-stream"
        },
        body: "chunk-data"
      })
      .willRespondWith({
        status: 200,
        headers: { "Content-Type": "application/json; charset=utf-8" },
        body: {
          uploadId: regex(UUID_REGEX, UPLOAD_ID),
          partNumber: like(1),
          bytesStored: like(10),
          checksumSha256: regex(SHA256_REGEX, "de4ecf4e0d0f157c8142fdb7f0e6f9f607c37d9b233830f70f7f83b4f04f9b69")
        }
      })
      .given("read upload status")
      .uponReceiving("read upload status")
      .withRequest({
        method: "GET",
        path: `/api/v1/uploads/${UPLOAD_ID}`,
        headers: {
          Authorization: `Bearer ${accessToken}`
        }
      })
      .willRespondWith({
        status: 200,
        headers: { "Content-Type": "application/json; charset=utf-8" },
        body: {
          uploadId: regex(UUID_REGEX, UPLOAD_ID),
          status: like("uploading"),
          fileSize: like(3811212),
          partSize: like(5242880),
          uploadedBytes: like(10),
          uploadedParts: eachLike(1),
          expiresAt: regex(TIMESTAMP_REGEX, "2026-02-18T12:00:00.000Z")
        }
      })
      .given("complete upload")
      .uponReceiving("complete upload")
      .withRequest({
        method: "POST",
        path: `/api/v1/uploads/${UPLOAD_ID}/complete`,
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Idempotency-Key": "complete-abc123",
          "Content-Type": "application/json"
        },
        body: {
          checksumSha256: "de4ecf4e0d0f157c8142fdb7f0e6f9f607c37d9b233830f70f7f83b4f04f9b69"
        }
      })
      .willRespondWith({
        status: 200,
        headers: { "Content-Type": "application/json; charset=utf-8" },
        body: {
          mediaId: regex(UUID_REGEX, MEDIA_ID),
          status: like("processing"),
          deduplicated: like(false)
        }
      })
      .given("abort upload")
      .uponReceiving("abort upload")
      .withRequest({
        method: "POST",
        path: `/api/v1/uploads/${UPLOAD_ID}/abort`,
        headers: {
          Authorization: `Bearer ${accessToken}`
        }
      })
      .willRespondWith({
        status: 200,
        headers: { "Content-Type": "application/json; charset=utf-8" },
        body: {
          uploadId: regex(UUID_REGEX, UPLOAD_ID),
          status: like("aborted")
        }
      });

    await provider.executeTest(async (mockserver) => {
      await jsonRequest(mockserver.url, "/api/v1/uploads/init", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Idempotency-Key": "init-abc123",
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          fileName: "IMG_1024.jpg",
          contentType: "image/jpeg",
          fileSize: 3811212,
          checksumSha256: "de4ecf4e0d0f157c8142fdb7f0e6f9f607c37d9b233830f70f7f83b4f04f9b69"
        })
      });
      await jsonRequest(mockserver.url, `/api/v1/uploads/${UPLOAD_ID}/part?partNumber=1`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/octet-stream"
        },
        body: "chunk-data"
      });
      await jsonRequest(mockserver.url, `/api/v1/uploads/${UPLOAD_ID}`, {
        method: "GET",
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      await jsonRequest(mockserver.url, `/api/v1/uploads/${UPLOAD_ID}/complete`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Idempotency-Key": "complete-abc123",
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ checksumSha256: "de4ecf4e0d0f157c8142fdb7f0e6f9f607c37d9b233830f70f7f83b4f04f9b69" })
      });
      await jsonRequest(mockserver.url, `/api/v1/uploads/${UPLOAD_ID}/abort`, {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}` }
      });
    });
  });

  it("library-service interactions", async () => {
    const accessToken = createAccessToken({ userId: USER_ID, email: "new-user@example.com" });
    const provider = buildProvider("library-service");

    provider
      .given("read timeline page")
      .uponReceiving("read timeline page")
      .withRequest({
        method: "GET",
        path: "/api/v1/library/timeline",
        headers: {
          Authorization: `Bearer ${accessToken}`
        }
      })
      .willRespondWith({
        status: 200,
        headers: { "Content-Type": "application/json; charset=utf-8" },
        body: {
          items: eachLike({
            id: regex(UUID_REGEX, MEDIA_ID),
            ownerId: regex(UUID_REGEX, USER_ID),
            takenAt: regex(TIMESTAMP_REGEX, "2026-02-18T12:00:00.000Z"),
            uploadedAt: regex(TIMESTAMP_REGEX, "2026-02-18T12:00:00.000Z"),
            mimeType: like("image/jpeg"),
            flags: {
              favorite: like(false),
              archived: like(false),
              hidden: like(false),
              deletedSoft: like(false)
            }
          }),
          nextCursor: null
        }
      })
      .given("read timeline page with filters")
      .uponReceiving("read timeline page with filters")
      .withRequest({
        method: "GET",
        path: "/api/v1/library/timeline",
        query: {
          limit: "18",
          from: "2026-02-01T00:00:00.000Z",
          to: "2026-02-28T23:59:59.999Z",
          favorite: "true",
          q: "beach"
        },
        headers: {
          Authorization: `Bearer ${accessToken}`
        }
      })
      .willRespondWith({
        status: 200,
        headers: { "Content-Type": "application/json; charset=utf-8" },
        body: {
          items: eachLike({
            id: regex(UUID_REGEX, MEDIA_ID),
            ownerId: regex(UUID_REGEX, USER_ID),
            takenAt: regex(TIMESTAMP_REGEX, "2026-02-18T12:00:00.000Z"),
            uploadedAt: regex(TIMESTAMP_REGEX, "2026-02-18T12:00:00.000Z"),
            mimeType: like("image/jpeg"),
            flags: {
              favorite: like(true),
              archived: like(false),
              hidden: like(false),
              deletedSoft: like(false)
            }
          }),
          nextCursor: null
        }
      })
      .given("read media detail")
      .uponReceiving("read media detail")
      .withRequest({
        method: "GET",
        path: `/api/v1/media/${MEDIA_ID}`,
        headers: {
          Authorization: `Bearer ${accessToken}`
        }
      })
      .willRespondWith({
        status: 200,
        headers: { "Content-Type": "application/json; charset=utf-8" },
        body: {
          media: {
            id: regex(UUID_REGEX, MEDIA_ID),
            ownerId: regex(UUID_REGEX, USER_ID),
            mimeType: like("image/jpeg"),
            flags: {
              favorite: like(false),
              archived: like(false),
              hidden: like(false),
              deletedSoft: like(false)
            }
          }
        }
      })
      .given("patch media flags")
      .uponReceiving("patch media flags")
      .withRequest({
        method: "PATCH",
        path: `/api/v1/media/${MEDIA_ID}`,
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json"
        },
        body: {
          favorite: true
        }
      })
      .willRespondWith({
        status: 200,
        headers: { "Content-Type": "application/json; charset=utf-8" },
        body: {
          media: {
            id: regex(UUID_REGEX, MEDIA_ID),
            ownerId: regex(UUID_REGEX, USER_ID),
            mimeType: like("image/jpeg"),
            flags: {
              favorite: like(true),
              archived: like(false),
              hidden: like(false),
              deletedSoft: like(false)
            }
          }
        }
      })
      .given("read media bytes")
      .uponReceiving("read media bytes")
      .withRequest({
        method: "GET",
        path: `/api/v1/media/${MEDIA_ID}/content`,
        query: {
          variant: "thumb"
        },
        headers: {
          Authorization: `Bearer ${accessToken}`
        }
      })
      .willRespondWith({
        status: 200,
        headers: {
          "Content-Type": "image/webp"
        }
      })
      .given("read media bytes small")
      .uponReceiving("read media bytes small")
      .withRequest({
        method: "GET",
        path: `/api/v1/media/${MEDIA_ID}/content`,
        query: {
          variant: "small"
        },
        headers: {
          Authorization: `Bearer ${accessToken}`
        }
      })
      .willRespondWith({
        status: 200,
        headers: {
          "Content-Type": "image/webp"
        }
      })
      .given("read media playback bytes")
      .uponReceiving("read media playback bytes")
      .withRequest({
        method: "GET",
        path: `/api/v1/media/${MEDIA_ID}/content`,
        query: {
          variant: "playback"
        },
        headers: {
          Authorization: `Bearer ${accessToken}`
        }
      })
      .willRespondWith({
        status: 200,
        headers: {
          "Content-Type": "video/webm"
        }
      })
      .given("soft-delete media")
      .uponReceiving("soft-delete media")
      .withRequest({
        method: "DELETE",
        path: `/api/v1/media/${MEDIA_ID}`,
        headers: {
          Authorization: `Bearer ${accessToken}`
        }
      })
      .willRespondWith({
        status: 200,
        headers: { "Content-Type": "application/json; charset=utf-8" },
        body: {
          mediaId: regex(UUID_REGEX, MEDIA_ID),
          status: like("deleted")
        }
      })
      .given("restore soft-deleted media")
      .uponReceiving("restore soft-deleted media")
      .withRequest({
        method: "POST",
        path: `/api/v1/media/${MEDIA_ID}/restore`,
        headers: {
          Authorization: `Bearer ${accessToken}`
        }
      })
      .willRespondWith({
        status: 200,
        headers: { "Content-Type": "application/json; charset=utf-8" },
        body: {
          mediaId: regex(UUID_REGEX, MEDIA_ID),
          status: like("active")
        }
      });

    await provider.executeTest(async (mockserver) => {
      await jsonRequest(mockserver.url, "/api/v1/library/timeline", {
        method: "GET",
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      await jsonRequest(
        mockserver.url,
        "/api/v1/library/timeline?limit=18&from=2026-02-01T00%3A00%3A00.000Z&to=2026-02-28T23%3A59%3A59.999Z&favorite=true&q=beach",
        {
          method: "GET",
          headers: { Authorization: `Bearer ${accessToken}` }
        }
      );
      await jsonRequest(mockserver.url, `/api/v1/media/${MEDIA_ID}`, {
        method: "GET",
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      await jsonRequest(mockserver.url, `/api/v1/media/${MEDIA_ID}`, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ favorite: true })
      });
      const content = await fetch(`${mockserver.url}/api/v1/media/${MEDIA_ID}/content?variant=thumb`, {
        method: "GET",
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      expect(content.status).toBe(200);
      const smallContent = await fetch(`${mockserver.url}/api/v1/media/${MEDIA_ID}/content?variant=small`, {
        method: "GET",
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      expect(smallContent.status).toBe(200);
      const playbackContent = await fetch(`${mockserver.url}/api/v1/media/${MEDIA_ID}/content?variant=playback`, {
        method: "GET",
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      expect(playbackContent.status).toBe(200);
      await jsonRequest(mockserver.url, `/api/v1/media/${MEDIA_ID}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      await jsonRequest(mockserver.url, `/api/v1/media/${MEDIA_ID}/restore`, {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}` }
      });
    });
  });

  it("worker-service telemetry interactions", async () => {
    const accessToken = createAccessToken({ userId: ADMIN_ID, email: "admin@example.com" });
    const provider = buildProvider("worker-service");

    provider
      .uponReceiving("read telemetry snapshot")
      .withRequest({
        method: "GET",
        path: "/api/v1/worker/telemetry/snapshot",
        headers: {
          Authorization: `Bearer ${accessToken}`
        }
      })
      .willRespondWith({
        status: 200,
        headers: { "Content-Type": "application/json; charset=utf-8" },
        body: {
          schemaVersion: like("2026-02-telemetry-v1"),
          generatedAt: regex(TIMESTAMP_REGEX, "2026-02-18T12:00:00.000Z"),
          queueCounts: like({}),
          counters: like({}),
          rates: like({}),
          workerHealth: like({}),
          inFlightJobs: like([]),
          recentFailures: like({}),
          recentEvents: like([])
        }
      })
      .uponReceiving("stream telemetry events")
      .withRequest({
        method: "GET",
        path: "/api/v1/worker/telemetry/stream",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "text/event-stream",
          "x-pact-test-sse-once": "1"
        }
      })
      .willRespondWith({
        status: 200,
        headers: {
          "Content-Type": "text/event-stream"
        }
      });

    await provider.executeTest(async (mockserver) => {
      await jsonRequest(mockserver.url, "/api/v1/worker/telemetry/snapshot", {
        method: "GET",
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      const stream = await fetch(`${mockserver.url}/api/v1/worker/telemetry/stream`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "text/event-stream",
          "x-pact-test-sse-once": "1"
        }
      });
      expect(stream.status).toBe(200);
      await stream.text();
    });
  });
});
