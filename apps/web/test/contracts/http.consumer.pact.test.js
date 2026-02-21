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
      .given("a user with email 'new-user@example.com' does not exist")
      .uponReceiving("a request to register a new user")
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
      .given("a user exists with email 'new-user@example.com' and password 'super-secret-password'")
      .uponReceiving("a request to login with valid credentials")
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
      .given("a valid session exists for user '11111111-1111-4111-8111-111111111111'")
      .uponReceiving("a request to refresh access tokens")
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
      .given("a user is logged in as admin with ID '22222222-2222-4222-8222-222222222222'")
      .uponReceiving("a request to get current user details")
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
      .given("a valid session exists to be terminated")
      .uponReceiving("a request to logout and terminate session")
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
      .given("there are managed users in the system")
      .uponReceiving("a request to list all users from an admin account")
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
      .given("there are at least 100 managed users in the system")
      .uponReceiving("a request to list users with specific pagination limits")
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
      .given("administrator is logged in and 'managed@example.com' does not exist")
      .uponReceiving("a request to create a new managed user")
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
      .given("administrator is logged in and 'managed-admin@example.com' does not exist")
      .uponReceiving("a request to create a new managed admin user")
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
      .given("a managed user exists with ID '33333333-3333-4333-8333-333333333333'")
      .uponReceiving("a request to update a managed user's administrative status")
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
      .given("an inactive managed user exists with ID '33333333-3333-4333-8333-333333333333'")
      .uponReceiving("a request to reactivate a managed user account")
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
      .given("a managed user exists to have their password reset")
      .uponReceiving("a request to reset a managed user's password")
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
      .given("a managed user exists to be disabled")
      .uponReceiving("a request to disable a managed user account")
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
      .given("a user is ready to upload a new 3.8MB JPEG file")
      .uponReceiving("a request to initialize a multi-part upload")
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
      .given("an active upload session '44444444-4444-4444-8444-444444444444' exists")
      .uponReceiving("a request to upload the first part of the file")
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
      .given("an upload '44444444-4444-4444-8444-444444444444' is currently in the 'uploading' state")
      .uponReceiving("a request to retrieve the current status of the upload")
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
      .given("all parts of the upload '44444444-4444-4444-8444-444444444444' have been successfully stored")
      .uponReceiving("a request to complete and finalize the upload")
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
      .given("an upload '44444444-4444-4444-8444-444444444444' exists and can be cancelled")
      .uponReceiving("a request to abort the upload session")
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
      .given("there are media items in the user's library")
      .uponReceiving("a request for the media timeline")
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
      .given("there are media items matching the search criteria 'beach'")
      .uponReceiving("a filtered request for the media timeline")
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
      .given("a media item exists with ID '55555555-5555-4555-8555-555555555555'")
      .uponReceiving("a request for detailed media information")
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
      .given("a media item exists to have its flags updated")
      .uponReceiving("a request to toggle media favorite status")
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
      .given("a thumbnail variant exists for media '55555555-5555-4555-8555-555555555555'")
      .uponReceiving("a request for the thumbnail variant bytes")
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
      .given("a small variant exists for media '55555555-5555-4555-8555-555555555555'")
      .uponReceiving("a request for the small variant bytes")
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
      .given("a playback variant exists for video '55555555-5555-4555-8555-555555555555'")
      .uponReceiving("a request for the video playback bytes")
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
      .given("a media item exists to be soft-deleted")
      .uponReceiving("a request to soft-delete a media item")
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
      .given("a soft-deleted media item exists to be restored")
      .uponReceiving("a request to restore a soft-deleted media item")
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
      })
      .given("there are soft-deleted media items in trash")
      .uponReceiving("a request to list trash media")
      .withRequest({
        method: "GET",
        path: "/api/v1/library/trash",
        query: {
          limit: "24"
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
            mimeType: like("image/jpeg"),
            deletedAt: regex(TIMESTAMP_REGEX, "2026-02-18T12:00:00.000Z"),
            flags: {
              favorite: like(false),
              archived: like(false),
              hidden: like(false),
              deletedSoft: like(true)
            }
          }),
          nextCursor: null
        }
      })
      .given("a trashed thumbnail variant exists for media '55555555-5555-4555-8555-555555555555'")
      .uponReceiving("a request for trashed media preview bytes")
      .withRequest({
        method: "GET",
        path: `/api/v1/library/trash/${MEDIA_ID}/preview`,
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
      .given("there are soft-deleted media items to purge")
      .uponReceiving("a request to empty trash")
      .withRequest({
        method: "DELETE",
        path: "/api/v1/library/trash",
        headers: {
          Authorization: `Bearer ${accessToken}`
        }
      })
      .willRespondWith({
        status: 200,
        headers: { "Content-Type": "application/json; charset=utf-8" },
        body: {
          status: like("queued"),
          queuedCount: like(1)
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
      await jsonRequest(mockserver.url, "/api/v1/library/trash?limit=24", {
        method: "GET",
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      const trashPreview = await fetch(
        `${mockserver.url}/api/v1/library/trash/${MEDIA_ID}/preview?variant=thumb`,
        {
          method: "GET",
          headers: { Authorization: `Bearer ${accessToken}` }
        }
      );
      expect(trashPreview.status).toBe(200);
      await jsonRequest(mockserver.url, "/api/v1/library/trash", {
        method: "DELETE",
        headers: { Authorization: `Bearer ${accessToken}` }
      });
    });
  });

  it("worker-service telemetry interactions", async () => {
    const accessToken = createAccessToken({ userId: ADMIN_ID, email: "admin@example.com" });
    const provider = buildProvider("worker-service");

    provider
      .uponReceiving("a request for a snapshot of worker telemetry data")
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
      .uponReceiving("a request to stream real-time worker telemetry events")
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

  it("album-sharing-service interactions", async () => {
    const accessToken = createAccessToken({ userId: USER_ID, email: "user@example.com" });
    const provider = buildProvider("album-sharing-service");
    const ALBUM_ID = "alb_11111111111111111111111111111111";

    provider
      .given("a user exists and is ready to create an album")
      .uponReceiving("a request to create a new album")
      .withRequest({
        method: "POST",
        path: "/api/v1/albums",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json"
        },
        body: {
          title: "Summer Vacation 2026"
        }
      })
      .willRespondWith({
        status: 200,
        headers: { "Content-Type": "application/json; charset=utf-8" },
        body: {
          id: regex("^alb_[0-9a-f]{32}$", ALBUM_ID),
          ownerId: regex(UUID_REGEX, USER_ID),
          title: like("Summer Vacation 2026"),
          createdAt: regex(TIMESTAMP_REGEX, "2026-02-18T12:00:00.000Z"),
          updatedAt: regex(TIMESTAMP_REGEX, "2026-02-18T12:00:00.000Z"),
          mediaCount: like(0)
        }
      })
      .given("the user has created albums")
      .uponReceiving("a request to list albums")
      .withRequest({
        method: "GET",
        path: "/api/v1/albums",
        query: {
          limit: "50"
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
            id: regex("^alb_[0-9a-f]{32}$", ALBUM_ID),
            ownerId: regex(UUID_REGEX, USER_ID),
            title: like("Summer Vacation 2026"),
            createdAt: regex(TIMESTAMP_REGEX, "2026-02-18T12:00:00.000Z"),
            updatedAt: regex(TIMESTAMP_REGEX, "2026-02-18T12:00:00.000Z"),
            mediaCount: like(1),
            sampleMediaIds: like([MEDIA_ID])
          })
        }
      })
      .given("an album 'alb_11111111111111111111111111111111' exists for the user")
      .uponReceiving("a request to get album details")
      .withRequest({
        method: "GET",
        path: `/api/v1/albums/${ALBUM_ID}`,
        headers: {
          Authorization: `Bearer ${accessToken}`
        }
      })
      .willRespondWith({
        status: 200,
        headers: { "Content-Type": "application/json; charset=utf-8" },
        body: {
          id: regex("^alb_[0-9a-f]{32}$", ALBUM_ID),
          ownerId: regex(UUID_REGEX, USER_ID),
          title: like("Summer Vacation 2026"),
          createdAt: regex(TIMESTAMP_REGEX, "2026-02-18T12:00:00.000Z"),
          updatedAt: regex(TIMESTAMP_REGEX, "2026-02-18T12:00:00.000Z"),
          mediaCount: like(1)
        }
      })
      .given("an album 'alb_11111111111111111111111111111111' exists for the user and media '55555555-5555-4555-8555-555555555555' is owned by the user")
      .uponReceiving("a request to add media to the album")
      .withRequest({
        method: "POST",
        path: `/api/v1/albums/${ALBUM_ID}/items`,
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json"
        },
        body: {
          mediaId: MEDIA_ID
        }
      })
      .willRespondWith({
        status: 200,
        headers: { "Content-Type": "application/json; charset=utf-8" },
        body: {
          albumId: like(ALBUM_ID),
          mediaId: like(MEDIA_ID)
        }
      })
      .given("an album 'alb_11111111111111111111111111111111' exists with items inside")
      .uponReceiving("a request to list items in an album")
      .withRequest({
        method: "GET",
        path: `/api/v1/albums/${ALBUM_ID}/items`,
        headers: {
          Authorization: `Bearer ${accessToken}`
        }
      })
      .willRespondWith({
        status: 200,
        headers: { "Content-Type": "application/json; charset=utf-8" },
        body: {
          items: eachLike({
            mediaId: regex(UUID_REGEX, MEDIA_ID),
            addedAt: regex(TIMESTAMP_REGEX, "2026-02-18T12:00:00.000Z"),
            mimeType: like("video/mp4")
          })
        }
      })
      .given("an album 'alb_11111111111111111111111111111111' exists for the user and contains media '55555555-5555-4555-8555-555555555555'")
      .uponReceiving("a request to remove media from the album")
      .withRequest({
        method: "DELETE",
        path: `/api/v1/albums/${ALBUM_ID}/items/${MEDIA_ID}`,
        headers: {
          Authorization: `Bearer ${accessToken}`
        }
      })
      .willRespondWith({
        status: 200,
        headers: { "Content-Type": "application/json; charset=utf-8" },
        body: {
          albumId: like(ALBUM_ID),
          mediaId: like(MEDIA_ID)
        }
      });

    await provider.executeTest(async (mockserver) => {
      await jsonRequest(mockserver.url, "/api/v1/albums", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ title: "Summer Vacation 2026" })
      });
      await jsonRequest(mockserver.url, "/api/v1/albums?limit=50", {
        method: "GET",
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      await jsonRequest(mockserver.url, `/api/v1/albums/${ALBUM_ID}/items`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ mediaId: MEDIA_ID })
      });
      await jsonRequest(mockserver.url, `/api/v1/albums/${ALBUM_ID}/items`, {
        method: "GET",
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      await jsonRequest(mockserver.url, `/api/v1/albums/${ALBUM_ID}`, {
        method: "GET",
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      await jsonRequest(mockserver.url, `/api/v1/albums/${ALBUM_ID}/items/${MEDIA_ID}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${accessToken}` }
      });
    });
  });
});
