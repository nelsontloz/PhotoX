const crypto = require("node:crypto");

const { ApiError, mapJwtError } = require("../errors");
const {
  createAccessToken,
  createRefreshToken,
  hashToken,
  verifyRefreshToken,
  verifyRefreshTokenIgnoringExpiration
} = require("../auth/tokens");
const {
  hashPassword,
  normalizeEmail,
  validatePassword,
  verifyPassword
} = require("../auth/password");
const { loginSchema, parseOrThrow, refreshSchema, registerSchema } = require("../validation");

function buildAuthPayload({ accessToken, refreshToken, accessTokenTtlSeconds, user }) {
  return {
    accessToken,
    refreshToken,
    expiresIn: accessTokenTtlSeconds,
    user
  };
}

module.exports = async function authRoutes(app) {
  app.post("/api/v1/auth/register", async (request, reply) => {
    const body = parseOrThrow(registerSchema, request.body || {});
    const email = normalizeEmail(body.email);
    const passwordStatus = validatePassword(body.password);

    if (!passwordStatus.ok) {
      throw new ApiError(400, "VALIDATION_ERROR", passwordStatus.reason);
    }

    const passwordHash = await hashPassword(body.password, app.config.bcryptRounds);
    const id = crypto.randomUUID();

    try {
      const userRow = await app.repos.users.createUser({ id, email, passwordHash });
      reply.code(201).send({ user: app.repos.users.toPublicUser(userRow) });
    } catch (err) {
      if (err && err.code === "23505") {
        throw new ApiError(409, "CONFLICT_EMAIL_EXISTS", "Email is already registered");
      }
      throw err;
    }
  });

  app.post("/api/v1/auth/login", async (request) => {
    const body = parseOrThrow(loginSchema, request.body || {});
    const email = normalizeEmail(body.email);
    const userRow = await app.repos.users.findByEmail(email);

    if (!userRow) {
      throw new ApiError(401, "AUTH_INVALID_CREDENTIALS", "Invalid email or password");
    }

    const passwordMatches = await verifyPassword(body.password, userRow.password_hash);
    if (!passwordMatches) {
      throw new ApiError(401, "AUTH_INVALID_CREDENTIALS", "Invalid email or password");
    }

    const sessionId = crypto.randomUUID();
    const { refreshToken, refreshExpiresAt } = createRefreshToken({
      userId: userRow.id,
      sessionId,
      secret: app.config.jwtRefreshSecret,
      expiresInDays: app.config.refreshTokenTtlDays
    });

    await app.repos.sessions.createSession({
      id: sessionId,
      userId: userRow.id,
      refreshTokenHash: hashToken(refreshToken),
      expiresAt: refreshExpiresAt
    });

    const accessToken = createAccessToken({
      user: { id: userRow.id, email: userRow.email },
      secret: app.config.jwtAccessSecret,
      expiresInSeconds: app.config.accessTokenTtlSeconds
    });

    return buildAuthPayload({
      accessToken,
      refreshToken,
      accessTokenTtlSeconds: app.config.accessTokenTtlSeconds,
      user: app.repos.users.toPublicUser(userRow)
    });
  });

  app.post("/api/v1/auth/refresh", async (request) => {
    const body = parseOrThrow(refreshSchema, request.body || {});

    let payload;
    try {
      payload = verifyRefreshToken(body.refreshToken, app.config.jwtRefreshSecret);
    } catch (err) {
      throw mapJwtError(err);
    }

    if (payload.type !== "refresh" || !payload.sid || !payload.sub) {
      throw new ApiError(401, "AUTH_TOKEN_INVALID", "Token is invalid");
    }

    const session = await app.repos.sessions.findById(payload.sid);
    if (!session || session.user_id !== payload.sub || session.revoked_at) {
      throw new ApiError(401, "AUTH_SESSION_REVOKED", "Session is not active");
    }

    if (new Date(session.expires_at).getTime() <= Date.now()) {
      await app.repos.sessions.revokeById(session.id);
      throw new ApiError(401, "AUTH_TOKEN_EXPIRED", "Token has expired");
    }

    if (session.refresh_token_hash !== hashToken(body.refreshToken)) {
      throw new ApiError(401, "AUTH_TOKEN_INVALID", "Token is invalid");
    }

    const userRow = await app.repos.users.findById(payload.sub);
    if (!userRow) {
      throw new ApiError(401, "AUTH_TOKEN_INVALID", "Token is invalid");
    }

    const { refreshToken, refreshExpiresAt } = createRefreshToken({
      userId: userRow.id,
      sessionId: session.id,
      secret: app.config.jwtRefreshSecret,
      expiresInDays: app.config.refreshTokenTtlDays
    });

    await app.repos.sessions.rotateSessionToken({
      id: session.id,
      refreshTokenHash: hashToken(refreshToken),
      expiresAt: refreshExpiresAt
    });

    const accessToken = createAccessToken({
      user: { id: userRow.id, email: userRow.email },
      secret: app.config.jwtAccessSecret,
      expiresInSeconds: app.config.accessTokenTtlSeconds
    });

    return buildAuthPayload({
      accessToken,
      refreshToken,
      accessTokenTtlSeconds: app.config.accessTokenTtlSeconds,
      user: app.repos.users.toPublicUser(userRow)
    });
  });

  app.post("/api/v1/auth/logout", async (request) => {
    const body = parseOrThrow(refreshSchema, request.body || {});

    let payload;
    try {
      payload = verifyRefreshTokenIgnoringExpiration(body.refreshToken, app.config.jwtRefreshSecret);
    } catch (err) {
      throw mapJwtError(err);
    }

    if (!payload.sid) {
      throw new ApiError(401, "AUTH_TOKEN_INVALID", "Token is invalid");
    }

    await app.repos.sessions.revokeById(payload.sid);
    return { success: true };
  });
};
