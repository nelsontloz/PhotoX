const { buildApp } = require("../../src/app");

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
    expect(jsonBody(first).user.isAdmin).toBe(true);
    expect(jsonBody(first).user.isActive).toBe(true);

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
    expect(body.user.isAdmin).toBe(true);
    expect(body.user.isActive).toBe(true);
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

  it("rejects legacy refresh token hashes after argon2 cutover", async () => {
    await app.inject({
      method: "POST",
      url: "/api/v1/auth/register",
      payload: {
        email: "legacy-refresh@example.com",
        password: "super-secret-password"
      }
    });

    const login = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: {
        email: "legacy-refresh@example.com",
        password: "super-secret-password"
      }
    });

    const loginBody = jsonBody(login);
    const userResult = await app.db.query("SELECT id FROM users WHERE email = $1 LIMIT 1", [
      "legacy-refresh@example.com"
    ]);
    const userId = userResult.rows[0].id;

    await app.db.query(
      "UPDATE sessions SET refresh_token_hash = $1 WHERE user_id = $2",
      ["f".repeat(64), userId]
    );

    const refresh = await app.inject({
      method: "POST",
      url: "/api/v1/auth/refresh",
      payload: {
        refreshToken: loginBody.refreshToken
      }
    });

    expect(refresh.statusCode).toBe(401);
    expect(jsonBody(refresh).error.code).toBe("AUTH_TOKEN_INVALID");
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
    expect(jsonBody(me).user.isAdmin).toBe(true);
    expect(jsonBody(me).user.isActive).toBe(true);
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

    const adminUsersGet = spec.paths["/api/v1/admin/users"].get;
    expect(adminUsersGet.summary).toBeTruthy();
    expect(adminUsersGet.security[0].bearerAuth).toEqual([]);

    const adminUsersPost = spec.paths["/api/v1/admin/users"].post;
    expect(adminUsersPost.requestBody.content["application/json"].schema.example).toBeTruthy();

    const docs = await app.inject({
      method: "GET",
      url: "/api/v1/auth/docs"
    });

    expect(docs.statusCode).toBe(200);
    expect(docs.headers["content-type"]).toContain("text/html");
  });

  it("sets only first registered user as admin", async () => {
    const first = await app.inject({
      method: "POST",
      url: "/api/v1/auth/register",
      payload: {
        email: "first-admin@example.com",
        password: "super-secret-password"
      }
    });

    const second = await app.inject({
      method: "POST",
      url: "/api/v1/auth/register",
      payload: {
        email: "second-user@example.com",
        password: "super-secret-password"
      }
    });

    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);
    expect(jsonBody(first).user.isAdmin).toBe(true);
    expect(jsonBody(second).user.isAdmin).toBe(false);
  });

  it("blocks non-admin users from admin endpoints", async () => {
    await app.inject({
      method: "POST",
      url: "/api/v1/auth/register",
      payload: {
        email: "first-admin@example.com",
        password: "super-secret-password"
      }
    });

    await app.inject({
      method: "POST",
      url: "/api/v1/auth/register",
      payload: {
        email: "non-admin@example.com",
        password: "super-secret-password"
      }
    });

    const login = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: {
        email: "non-admin@example.com",
        password: "super-secret-password"
      }
    });

    const listUsers = await app.inject({
      method: "GET",
      url: "/api/v1/admin/users",
      headers: {
        authorization: `Bearer ${jsonBody(login).accessToken}`
      }
    });

    expect(listUsers.statusCode).toBe(403);
    expect(jsonBody(listUsers).error.code).toBe("AUTH_FORBIDDEN");
  });

  it("allows admin to promote user and blocks self-demotion", async () => {
    await app.inject({
      method: "POST",
      url: "/api/v1/auth/register",
      payload: {
        email: "first-admin@example.com",
        password: "super-secret-password"
      }
    });

    const userRegister = await app.inject({
      method: "POST",
      url: "/api/v1/auth/register",
      payload: {
        email: "promote-me@example.com",
        password: "super-secret-password"
      }
    });

    const adminLogin = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: {
        email: "first-admin@example.com",
        password: "super-secret-password"
      }
    });

    const promoted = await app.inject({
      method: "PATCH",
      url: `/api/v1/admin/users/${jsonBody(userRegister).user.id}`,
      headers: {
        authorization: `Bearer ${jsonBody(adminLogin).accessToken}`
      },
      payload: {
        isAdmin: true
      }
    });

    expect(promoted.statusCode).toBe(200);
    expect(jsonBody(promoted).user.isAdmin).toBe(true);

    const selfDemote = await app.inject({
      method: "PATCH",
      url: `/api/v1/admin/users/${jsonBody(adminLogin).user.id}`,
      headers: {
        authorization: `Bearer ${jsonBody(adminLogin).accessToken}`
      },
      payload: {
        isAdmin: false
      }
    });

    expect(selfDemote.statusCode).toBe(400);
    expect(jsonBody(selfDemote).error.code).toBe("ADMIN_SELF_DEMOTE_FORBIDDEN");
  });

  it("prevents admin self-disable", async () => {
    const registerAdmin = await app.inject({
      method: "POST",
      url: "/api/v1/auth/register",
      payload: {
        email: "first-admin@example.com",
        password: "super-secret-password"
      }
    });

    const adminLogin = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: {
        email: "first-admin@example.com",
        password: "super-secret-password"
      }
    });

    const disableAdmin = await app.inject({
      method: "DELETE",
      url: `/api/v1/admin/users/${jsonBody(registerAdmin).user.id}`,
      headers: {
        authorization: `Bearer ${jsonBody(adminLogin).accessToken}`
      }
    });

    expect(disableAdmin.statusCode).toBe(400);
    expect(jsonBody(disableAdmin).error.code).toBe("ADMIN_SELF_DISABLE_FORBIDDEN");
  });

  it("disables user account and blocks subsequent login", async () => {
    await app.inject({
      method: "POST",
      url: "/api/v1/auth/register",
      payload: {
        email: "first-admin@example.com",
        password: "super-secret-password"
      }
    });

    const target = await app.inject({
      method: "POST",
      url: "/api/v1/auth/register",
      payload: {
        email: "disable-me@example.com",
        password: "super-secret-password"
      }
    });

    const adminLogin = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: {
        email: "first-admin@example.com",
        password: "super-secret-password"
      }
    });

    const disable = await app.inject({
      method: "DELETE",
      url: `/api/v1/admin/users/${jsonBody(target).user.id}`,
      headers: {
        authorization: `Bearer ${jsonBody(adminLogin).accessToken}`
      }
    });

    expect(disable.statusCode).toBe(200);

    const loginDisabled = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: {
        email: "disable-me@example.com",
        password: "super-secret-password"
      }
    });

    expect(loginDisabled.statusCode).toBe(403);
    expect(jsonBody(loginDisabled).error.code).toBe("AUTH_ACCOUNT_DISABLED");
  });
});
