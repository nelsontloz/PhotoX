const crypto = require("node:crypto");

const { buildApp } = require("../../src/app");
const { createRefreshToken } = require("../../src/auth/tokens");

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ||
  process.env.DATABASE_URL ||
  "postgresql://photox:photox-dev-password@127.0.0.1:5432/photox";

function jsonBody(response) {
  return JSON.parse(response.body);
}

describe("auth integration", () => {
  let app;

  beforeAll(async () => {
    app = buildApp({
      databaseUrl: TEST_DATABASE_URL,
      jwtAccessSecret: "integration-access-secret",
      jwtRefreshSecret: "integration-refresh-secret",
      accessTokenTtlSeconds: 120,
      refreshTokenTtlDays: 1,
      bcryptRounds: 4,
      serviceName: "auth-service-test"
    });
    await app.ready();
  });

  beforeEach(async () => {
    await app.db.query("TRUNCATE TABLE sessions, users RESTART IDENTITY CASCADE");
  });

  afterAll(async () => {
    await app.close();
  });

  it("registers user and rejects duplicates", async () => {
    const first = await app.inject({
      method: "POST",
      url: "/api/v1/auth/register",
      payload: {
        email: "user@example.com",
        password: "super-secret-password"
      }
    });

    expect(first.statusCode).toBe(201);
    expect(jsonBody(first).user.email).toBe("user@example.com");

    const duplicate = await app.inject({
      method: "POST",
      url: "/api/v1/auth/register",
      payload: {
        email: "user@example.com",
        password: "super-secret-password"
      }
    });

    expect(duplicate.statusCode).toBe(409);
    expect(jsonBody(duplicate).error.code).toBe("CONFLICT_EMAIL_EXISTS");
  });

  it("logs in and returns token pair", async () => {
    await app.inject({
      method: "POST",
      url: "/api/v1/auth/register",
      payload: {
        email: "login@example.com",
        password: "super-secret-password"
      }
    });

    const login = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: {
        email: "login@example.com",
        password: "super-secret-password"
      }
    });

    expect(login.statusCode).toBe(200);
    const body = jsonBody(login);
    expect(body.accessToken).toBeTruthy();
    expect(body.refreshToken).toBeTruthy();
    expect(body.user.email).toBe("login@example.com");
  });

  it("rejects invalid password login", async () => {
    await app.inject({
      method: "POST",
      url: "/api/v1/auth/register",
      payload: {
        email: "bad-login@example.com",
        password: "super-secret-password"
      }
    });

    const login = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: {
        email: "bad-login@example.com",
        password: "wrong"
      }
    });

    expect(login.statusCode).toBe(401);
    expect(jsonBody(login).error.code).toBe("AUTH_INVALID_CREDENTIALS");
  });

  it("refreshes token and rotates refresh hash", async () => {
    await app.inject({
      method: "POST",
      url: "/api/v1/auth/register",
      payload: {
        email: "refresh@example.com",
        password: "super-secret-password"
      }
    });

    const login = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: {
        email: "refresh@example.com",
        password: "super-secret-password"
      }
    });

    const loginBody = jsonBody(login);
    const refresh = await app.inject({
      method: "POST",
      url: "/api/v1/auth/refresh",
      payload: {
        refreshToken: loginBody.refreshToken
      }
    });

    expect(refresh.statusCode).toBe(200);
    const refreshBody = jsonBody(refresh);
    expect(refreshBody.refreshToken).toBeTruthy();
    expect(refreshBody.accessToken).toBeTruthy();
    expect(refreshBody.refreshToken).not.toBe(loginBody.refreshToken);
  });

  it("accepts legacy sha256 refresh token hashes and migrates them on refresh", async () => {
    await app.inject({
      method: "POST",
      url: "/api/v1/auth/register",
      payload: {
        email: "legacy-refresh@example.com",
        password: "super-secret-password"
      }
    });

    const userResult = await app.db.query("SELECT id FROM users WHERE email = $1 LIMIT 1", [
      "legacy-refresh@example.com"
    ]);
    const userId = userResult.rows[0].id;
    const sessionId = crypto.randomUUID();
    const { refreshToken, refreshExpiresAt } = createRefreshToken({
      userId,
      sessionId,
      secret: "integration-refresh-secret",
      expiresInDays: 1
    });
    const legacyHash = crypto.createHash("sha256").update(refreshToken).digest("hex");

    await app.db.query(
      "INSERT INTO sessions (id, user_id, refresh_token_hash, expires_at) VALUES ($1, $2, $3, $4)",
      [sessionId, userId, legacyHash, refreshExpiresAt]
    );

    const refresh = await app.inject({
      method: "POST",
      url: "/api/v1/auth/refresh",
      payload: {
        refreshToken
      }
    });

    expect(refresh.statusCode).toBe(200);
    const updatedSession = await app.db.query("SELECT refresh_token_hash FROM sessions WHERE id = $1", [
      sessionId
    ]);
    expect(updatedSession.rows[0].refresh_token_hash).not.toBe(legacyHash);
    expect(updatedSession.rows[0].refresh_token_hash.startsWith("$2")).toBe(true);
  });

  it("revokes session on logout and blocks refresh", async () => {
    await app.inject({
      method: "POST",
      url: "/api/v1/auth/register",
      payload: {
        email: "logout@example.com",
        password: "super-secret-password"
      }
    });

    const login = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: {
        email: "logout@example.com",
        password: "super-secret-password"
      }
    });

    const tokenPair = jsonBody(login);
    const logout = await app.inject({
      method: "POST",
      url: "/api/v1/auth/logout",
      payload: {
        refreshToken: tokenPair.refreshToken
      }
    });

    expect(logout.statusCode).toBe(200);

    const refreshAfterLogout = await app.inject({
      method: "POST",
      url: "/api/v1/auth/refresh",
      payload: {
        refreshToken: tokenPair.refreshToken
      }
    });

    expect(refreshAfterLogout.statusCode).toBe(401);
    expect(jsonBody(refreshAfterLogout).error.code).toBe("AUTH_SESSION_REVOKED");
  });

  it("returns current user on /me when access token is valid", async () => {
    await app.inject({
      method: "POST",
      url: "/api/v1/auth/register",
      payload: {
        email: "me@example.com",
        password: "super-secret-password"
      }
    });

    const login = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: {
        email: "me@example.com",
        password: "super-secret-password"
      }
    });

    const me = await app.inject({
      method: "GET",
      url: "/api/v1/me",
      headers: {
        authorization: `Bearer ${jsonBody(login).accessToken}`
      }
    });

    expect(me.statusCode).toBe(200);
    expect(jsonBody(me).user.email).toBe("me@example.com");
  });

  it("rejects /me without token", async () => {
    const me = await app.inject({
      method: "GET",
      url: "/api/v1/me"
    });

    expect(me.statusCode).toBe(401);
    expect(jsonBody(me).error.code).toBe("AUTH_TOKEN_INVALID");
  });

  it("exposes OpenAPI and Swagger UI endpoints", async () => {
    const openapi = await app.inject({
      method: "GET",
      url: "/api/v1/auth/openapi.json"
    });

    expect(openapi.statusCode).toBe(200);
    const spec = jsonBody(openapi);
    expect(spec.openapi).toBeTruthy();

    const registerPost = spec.paths["/api/v1/auth/register"].post;
    expect(registerPost.summary).toBeTruthy();
    expect(registerPost.description).toBeTruthy();
    expect(registerPost.requestBody).toBeTruthy();
    expect(registerPost.requestBody.content["application/json"].schema.example).toBeTruthy();

    const loginPost = spec.paths["/api/v1/auth/login"].post;
    expect(loginPost.requestBody.content["application/json"].schema.example).toBeTruthy();

    const refreshPost = spec.paths["/api/v1/auth/refresh"].post;
    expect(refreshPost.requestBody.content["application/json"].schema.example).toBeTruthy();

    const meGet = spec.paths["/api/v1/me"].get;
    expect(meGet.security).toBeTruthy();
    expect(meGet.security[0].bearerAuth).toEqual([]);
    expect(meGet.responses["200"].content["application/json"].schema.example).toBeTruthy();

    const docs = await app.inject({
      method: "GET",
      url: "/api/v1/auth/docs"
    });

    expect(docs.statusCode).toBe(200);
    expect(docs.headers["content-type"]).toContain("text/html");
  });
});
