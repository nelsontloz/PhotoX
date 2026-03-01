const crypto = require("node:crypto");

const { ApiError, mapJwtError } = require("../errors");
const {
  createAccessToken,
  createRefreshToken,
  DUMMY_REFRESH_TOKEN_HASH,
  hashRefreshToken,
  verifyRefreshTokenHash,
  verifyRefreshToken,
  verifyRefreshTokenIgnoringExpiration
} = require("../auth/tokens");
const {
  DUMMY_PASSWORD_HASH,
  hashPassword,
  normalizeEmail,
  validatePassword,
  verifyPassword
} = require("../auth/password");
const { parseCookieHeader } = require("../auth/guard");
const { loginSchema, parseOrThrow, refreshSchema, registerSchema } = require("../validation");

function isSecureCookieRequest(request) {
  if (process.env.NODE_ENV === "production") {
    return true;
  }

  const forwardedProto = request.headers["x-forwarded-proto"];
  if (typeof forwardedProto === "string") {
    return forwardedProto.toLowerCase().includes("https");
  }

  return request.protocol === "https";
}

function appendSetCookie(reply, cookieValue) {
  const current = reply.getHeader("Set-Cookie");
  if (!current) {
    reply.header("Set-Cookie", [cookieValue]);
    return;
  }

  if (Array.isArray(current)) {
    reply.header("Set-Cookie", [...current, cookieValue]);
    return;
  }

  reply.header("Set-Cookie", [current, cookieValue]);
}

function buildCookie(name, value, options = {}) {
  const segments = [`${name}=${encodeURIComponent(value)}`];
  segments.push("Path=/");

  if (options.httpOnly) {
    segments.push("HttpOnly");
  }

  if (options.sameSite) {
    segments.push(`SameSite=${options.sameSite}`);
  }

  if (options.secure) {
    segments.push("Secure");
  }

  if (typeof options.maxAge === "number") {
    segments.push(`Max-Age=${Math.max(0, Math.floor(options.maxAge))}`);
  }

  return segments.join("; ");
}

function issueSessionCookies({ request, reply, accessToken, refreshToken, accessTtlSeconds, refreshTtlSeconds }) {
  const secure = isSecureCookieRequest(request);
  const csrfToken = crypto.randomBytes(24).toString("hex");

  appendSetCookie(
    reply,
    buildCookie("access_token", accessToken, {
      httpOnly: true,
      sameSite: "Strict",
      secure,
      maxAge: accessTtlSeconds
    })
  );

  appendSetCookie(
    reply,
    buildCookie("refresh_token", refreshToken, {
      httpOnly: true,
      sameSite: "Strict",
      secure,
      maxAge: refreshTtlSeconds
    })
  );

  appendSetCookie(
    reply,
    buildCookie("csrf_token", csrfToken, {
      httpOnly: false,
      sameSite: "Strict",
      secure,
      maxAge: refreshTtlSeconds
    })
  );
}

function clearSessionCookies(request, reply) {
  const secure = isSecureCookieRequest(request);
  appendSetCookie(
    reply,
    buildCookie("access_token", "", {
      httpOnly: true,
      sameSite: "Strict",
      secure,
      maxAge: 0
    })
  );
  appendSetCookie(
    reply,
    buildCookie("refresh_token", "", {
      httpOnly: true,
      sameSite: "Strict",
      secure,
      maxAge: 0
    })
  );
  appendSetCookie(
    reply,
    buildCookie("csrf_token", "", {
      httpOnly: false,
      sameSite: "Strict",
      secure,
      maxAge: 0
    })
  );
}

function readRefreshTokenFromRequest(request, body) {
  const explicitToken = typeof body?.refreshToken === "string" ? body.refreshToken : null;
  if (explicitToken) {
    return {
      refreshToken: explicitToken,
      fromCookie: false
    };
  }

  const cookies = parseCookieHeader(request.headers.cookie);
  const cookieToken = typeof cookies.refresh_token === "string" && cookies.refresh_token ? cookies.refresh_token : null;
  return {
    refreshToken: cookieToken,
    fromCookie: Boolean(cookieToken),
    csrfCookie: cookies.csrf_token
  };
}

function assertCsrfForCookieRefresh(request, csrfCookie) {
  const csrfHeader = request.headers["x-csrf-token"];
  if (!csrfCookie || typeof csrfHeader !== "string" || csrfHeader.length === 0 || csrfHeader !== csrfCookie) {
    throw new ApiError(403, "AUTH_CSRF_INVALID", "CSRF token is missing or invalid");
  }
}

function buildAuthPayload({ accessToken, refreshToken, accessTokenTtlSeconds, user }) {
  return {
    accessToken,
    refreshToken,
    expiresIn: accessTokenTtlSeconds,
    user
  };
}

const publicUserSchema = {
  type: "object",
  required: ["id", "email", "name", "isAdmin", "isActive"],
  properties: {
    id: { type: "string", format: "uuid" },
    email: { type: "string", format: "email" },
    name: {
      anyOf: [{ type: "string", maxLength: 80 }, { type: "null" }]
    },
    isAdmin: { type: "boolean" },
    isActive: { type: "boolean" }
  },
  additionalProperties: false
};

const registerBodySchema = {
  type: "object",
  required: ["email", "password"],
  properties: {
    email: { type: "string", format: "email" },
    password: { type: "string", minLength: 8 },
    name: { type: "string", minLength: 1, maxLength: 80 }
  },
  additionalProperties: false,
  example: {
    email: "user@example.com",
    password: "super-secret-password",
    name: "Alex Doe"
  }
};

const loginBodySchema = {
  type: "object",
  required: ["email", "password"],
  properties: {
    email: { type: "string", format: "email" },
    password: { type: "string", minLength: 1 }
  },
  additionalProperties: false,
  example: {
    email: "user@example.com",
    password: "super-secret-password"
  }
};

const refreshBodySchema = {
  type: "object",
  properties: {
    refreshToken: { type: "string", minLength: 1 }
  },
  additionalProperties: false,
  example: {
    refreshToken:
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.example-refresh-payload.example-signature"
  }
};

const authPayloadSchema = {
  type: "object",
  required: ["accessToken", "refreshToken", "expiresIn", "user"],
  properties: {
    accessToken: { type: "string" },
    refreshToken: { type: "string" },
    expiresIn: { type: "integer", minimum: 1 },
    user: publicUserSchema
  },
  additionalProperties: false,
  example: {
    accessToken:
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.example-access-payload.example-signature",
    refreshToken:
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.example-refresh-payload.example-signature",
    expiresIn: 3600,
    user: {
      id: "0f3c9d30-1307-4c9e-a4d7-75e84606c28d",
      email: "user@example.com",
      name: null,
      isAdmin: false,
      isActive: true
    }
  }
};

function buildErrorEnvelopeSchema({ code, message, details = {} }) {
  return {
    type: "object",
    required: ["error", "requestId"],
    properties: {
      error: {
        type: "object",
        required: ["code", "message", "details"],
        properties: {
          code: { type: "string" },
          message: { type: "string" },
          details: {
            type: "object",
            additionalProperties: true
          }
        },
        additionalProperties: false
      },
      requestId: { type: "string" }
    },
    additionalProperties: false,
    example: {
      error: {
        code,
        message,
        details
      },
      requestId: "req-4xYdA1GspM9n"
    }
  };
}

module.exports = async function authRoutes(app) {
  app.post(
    "/api/v1/auth/register",
    {
      schema: {
        tags: ["Auth"],
        summary: "Register user",
        description: "Create a new account using email and password credentials.",
        body: registerBodySchema,
        response: {
          201: {
            type: "object",
            required: ["user"],
            properties: {
              user: publicUserSchema
            },
            additionalProperties: false,
            example: {
              user: {
                id: "0f3c9d30-1307-4c9e-a4d7-75e84606c28d",
                email: "user@example.com",
                name: null,
                isAdmin: false,
                isActive: true
              }
            }
          },
          400: buildErrorEnvelopeSchema({
            code: "VALIDATION_ERROR",
            message: "Request validation failed",
            details: {
              issues: [
                {
                  path: ["password"],
                  message: "String must contain at least 8 character(s)"
                }
              ]
            }
          }),
          409: buildErrorEnvelopeSchema({
            code: "CONFLICT_EMAIL_EXISTS",
            message: "Email is already registered"
          })
        }
      }
    },
    async (request, reply) => {
      const body = parseOrThrow(registerSchema, request.body || {});
      const email = normalizeEmail(body.email);
      const passwordStatus = validatePassword(body.password);

      if (!passwordStatus.ok) {
        throw new ApiError(400, "VALIDATION_ERROR", passwordStatus.reason);
      }

      const existingUser = await app.repos.users.findByEmail(email);
      if (existingUser) {
        throw new ApiError(409, "CONFLICT_EMAIL_EXISTS", "Email is already registered");
      }

      const passwordHash = await hashPassword(body.password);
      const id = crypto.randomUUID();

      try {
        const userRow = await app.repos.users.createUserForRegistration({ id, email, passwordHash });
        reply.code(201).send({ user: app.repos.users.toPublicUser(userRow) });
      } catch (err) {
        if (err && err.code === "23505") {
          throw new ApiError(409, "CONFLICT_EMAIL_EXISTS", "Email is already registered");
        }
        throw err;
      }
    }
  );

  app.post(
    "/api/v1/auth/login",
    {
      schema: {
        tags: ["Auth"],
        summary: "Login user",
        description: "Validate credentials and return access plus refresh tokens.",
        body: loginBodySchema,
        response: {
          200: authPayloadSchema,
          403: buildErrorEnvelopeSchema({
            code: "AUTH_ACCOUNT_DISABLED",
            message: "Account is disabled"
          }),
          401: buildErrorEnvelopeSchema({
            code: "AUTH_INVALID_CREDENTIALS",
            message: "Invalid email or password"
          })
        }
      }
    },
    async (request, reply) => {
      const body = parseOrThrow(loginSchema, request.body || {});
      const email = normalizeEmail(body.email);
      const userRow = await app.repos.users.findByEmail(email);

      if (!userRow) {
        await verifyPassword(body.password, DUMMY_PASSWORD_HASH);
        throw new ApiError(401, "AUTH_INVALID_CREDENTIALS", "Invalid email or password");
      }

      if (!userRow.is_active) {
        throw new ApiError(403, "AUTH_ACCOUNT_DISABLED", "Account is disabled");
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

      const refreshTokenHash = await hashRefreshToken(refreshToken);
      await app.repos.sessions.createSession({
        id: sessionId,
        userId: userRow.id,
        refreshTokenHash,
        expiresAt: refreshExpiresAt
      });

      const accessToken = createAccessToken({
        user: { id: userRow.id, email: userRow.email },
        secret: app.config.jwtAccessSecret,
        expiresInSeconds: app.config.accessTokenTtlSeconds
      });

      issueSessionCookies({
        request,
        reply,
        accessToken,
        refreshToken,
        accessTtlSeconds: app.config.accessTokenTtlSeconds,
        refreshTtlSeconds: app.config.refreshTokenTtlDays * 24 * 60 * 60
      });

      return buildAuthPayload({
        accessToken,
        refreshToken,
        accessTokenTtlSeconds: app.config.accessTokenTtlSeconds,
        user: app.repos.users.toPublicUser(userRow)
      });
    }
  );

  app.post(
    "/api/v1/auth/refresh",
    {
      schema: {
        tags: ["Auth"],
        summary: "Refresh token pair",
        description: "Rotate refresh token and issue a new access token.",
        body: refreshBodySchema,
        response: {
          200: authPayloadSchema,
          403: buildErrorEnvelopeSchema({
            code: "AUTH_FORBIDDEN",
            message: "Request is forbidden"
          }),
          401: buildErrorEnvelopeSchema({
            code: "AUTH_TOKEN_INVALID",
            message: "Token is invalid"
          })
        }
      }
    },
    async (request, reply) => {
      const body = parseOrThrow(refreshSchema, request.body || {});
      const tokenSource = readRefreshTokenFromRequest(request, body);
      if (!tokenSource.refreshToken) {
        throw new ApiError(401, "AUTH_TOKEN_INVALID", "Token is invalid");
      }
      if (tokenSource.fromCookie) {
        assertCsrfForCookieRefresh(request, tokenSource.csrfCookie);
      }

      let payload;
      try {
        payload = verifyRefreshToken(tokenSource.refreshToken, app.config.jwtRefreshSecret);
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

      const isTokenValid = await verifyRefreshTokenHash(tokenSource.refreshToken, session.refresh_token_hash);
      if (!isTokenValid) {
        throw new ApiError(401, "AUTH_TOKEN_INVALID", "Token is invalid");
      }

      const userRow = await app.repos.users.findById(payload.sub);
      if (!userRow) {
        await verifyRefreshTokenHash(tokenSource.refreshToken, DUMMY_REFRESH_TOKEN_HASH);
        throw new ApiError(401, "AUTH_TOKEN_INVALID", "Token is invalid");
      }

      if (!userRow.is_active) {
        await app.repos.sessions.revokeById(session.id);
        throw new ApiError(403, "AUTH_ACCOUNT_DISABLED", "Account is disabled");
      }

      const { refreshToken, refreshExpiresAt } = createRefreshToken({
        userId: userRow.id,
        sessionId: session.id,
        secret: app.config.jwtRefreshSecret,
        expiresInDays: app.config.refreshTokenTtlDays
      });

      const newRefreshTokenHash = await hashRefreshToken(refreshToken);
      await app.repos.sessions.rotateSessionToken({
        id: session.id,
        refreshTokenHash: newRefreshTokenHash,
        expiresAt: refreshExpiresAt
      });

      const accessToken = createAccessToken({
        user: { id: userRow.id, email: userRow.email },
        secret: app.config.jwtAccessSecret,
        expiresInSeconds: app.config.accessTokenTtlSeconds
      });

      issueSessionCookies({
        request,
        reply,
        accessToken,
        refreshToken,
        accessTtlSeconds: app.config.accessTokenTtlSeconds,
        refreshTtlSeconds: app.config.refreshTokenTtlDays * 24 * 60 * 60
      });

      return buildAuthPayload({
        accessToken,
        refreshToken,
        accessTokenTtlSeconds: app.config.accessTokenTtlSeconds,
        user: app.repos.users.toPublicUser(userRow)
      });
    }
  );

  app.post(
    "/api/v1/auth/logout",
    {
      schema: {
        tags: ["Auth"],
        summary: "Logout session",
        description: "Revoke the session associated with the provided refresh token.",
        body: refreshBodySchema,
        response: {
          200: {
            type: "object",
            required: ["success"],
            properties: {
              success: { type: "boolean" }
            },
            additionalProperties: false,
            example: {
              success: true
            }
          },
          403: buildErrorEnvelopeSchema({
            code: "AUTH_CSRF_INVALID",
            message: "CSRF token is missing or invalid"
          }),
          401: buildErrorEnvelopeSchema({
            code: "AUTH_TOKEN_INVALID",
            message: "Token is invalid"
          })
        }
      }
    },
    async (request, reply) => {
      const body = parseOrThrow(refreshSchema, request.body || {});
      const tokenSource = readRefreshTokenFromRequest(request, body);

      if (!tokenSource.refreshToken) {
        throw new ApiError(401, "AUTH_TOKEN_INVALID", "Token is invalid");
      }

      if (tokenSource.fromCookie) {
        assertCsrfForCookieRefresh(request, tokenSource.csrfCookie);
      }

      let payload;
      try {
        payload = verifyRefreshTokenIgnoringExpiration(tokenSource.refreshToken, app.config.jwtRefreshSecret);
      } catch (err) {
        throw mapJwtError(err);
      }

      if (!payload.sid) {
        throw new ApiError(401, "AUTH_TOKEN_INVALID", "Token is invalid");
      }

      await app.repos.sessions.revokeById(payload.sid);
      clearSessionCookies(request, reply);
      return { success: true };
    }
  );
};
