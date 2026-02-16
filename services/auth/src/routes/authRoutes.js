const crypto = require("node:crypto");

const { ApiError, mapJwtError } = require("../errors");
const {
  createAccessToken,
  createRefreshToken,
  hashRefreshToken,
  verifyStoredRefreshTokenHash,
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

const publicUserSchema = {
  type: "object",
  required: ["id", "email", "name"],
  properties: {
    id: { type: "string", format: "uuid" },
    email: { type: "string", format: "email" },
    name: {
      anyOf: [{ type: "string", maxLength: 80 }, { type: "null" }]
    }
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
  required: ["refreshToken"],
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
      name: null
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
                name: null
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
          401: buildErrorEnvelopeSchema({
            code: "AUTH_INVALID_CREDENTIALS",
            message: "Invalid email or password"
          })
        }
      }
    },
    async (request) => {
    const body = parseOrThrow(loginSchema, request.body || {});
    const email = normalizeEmail(body.email);
    const userRow = await app.repos.users.findByEmail(email);

    // Timing attack mitigation: always perform password check
    // If user is not found, use a dummy hash to simulate work
    const dummyHash = "$2b$10$oqeg7ENm2QNJ0KDW/iKeyeWHlbNemMK/y7qOaoqTRbm6Pl8mZgKfG";
    const hashToVerify = userRow ? userRow.password_hash : dummyHash;

    const passwordMatches = await verifyPassword(body.password, hashToVerify);

    if (!userRow || !passwordMatches) {
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
          401: buildErrorEnvelopeSchema({
            code: "AUTH_TOKEN_INVALID",
            message: "Token is invalid"
          })
        }
      }
    },
    async (request) => {
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

    const isTokenValid = await verifyStoredRefreshTokenHash(body.refreshToken, session.refresh_token_hash);
    if (!isTokenValid) {
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
          401: buildErrorEnvelopeSchema({
            code: "AUTH_TOKEN_INVALID",
            message: "Token is invalid"
          })
        }
      }
    },
    async (request) => {
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
    }
  );
};
