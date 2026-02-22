const Fastify = require("fastify");
const swagger = require("@fastify/swagger");
const swaggerUi = require("@fastify/swagger-ui");

const { loadConfig } = require("./config");
const { createPool, runMigrations } = require("./db");
const { buildUsersRepo } = require("./repos/usersRepo");
const { buildSessionsRepo } = require("./repos/sessionsRepo");
const { ApiError, toErrorBody } = require("./errors");
const authRoutes = require("./routes/authRoutes");
const adminRoutes = require("./routes/adminRoutes");
const meRoute = require("./routes/meRoute");
const openapiRoute = require("./routes/openapiRoute");

function buildApp(overrides = {}) {
  const app = Fastify({
    logger: true,
    ajv: {
      plugins: [
        (ajv) => {
          ajv.addKeyword("example");
        }
      ]
    }
  });
  const config = loadConfig(overrides);
  const db = overrides.db || createPool(config.databaseUrl);

  app.decorate("config", config);
  app.decorate("db", db);
  app.decorate("repos", {
    users: buildUsersRepo(db),
    sessions: buildSessionsRepo(db)
  });

  app.get("/health", async () => ({ status: "ok", service: config.serviceName }));

  app.get("/metrics", async (_, reply) => {
    reply.type("text/plain; version=0.0.4");
    return `service_up{service="${config.serviceName}"} 1\n`;
  });

  app.register(swagger, {
    openapi: {
      info: {
        title: "PhotoX Auth Service API",
        description:
          "Authentication endpoints for account registration, login, token refresh, logout, and current-user lookup.",
        version: "1.0.0"
      },
      tags: [
        {
          name: "Auth",
          description: "Registration, login, refresh, and logout flows"
        },
        {
          name: "Me",
          description: "Current user endpoint protected by bearer token"
        },
        {
          name: "Admin",
          description: "Administrative user management operations"
        }
      ],
      components: {
        securitySchemes: {
          bearerAuth: {
            type: "http",
            scheme: "bearer",
            bearerFormat: "JWT"
          }
        },
        schemas: {
          PublicUser: {
            type: "object",
            required: ["id", "email", "name", "isAdmin", "isActive"],
            properties: {
              id: { type: "string", format: "uuid" },
              email: { type: "string", format: "email" },
              name: { type: "string", nullable: true, maxLength: 80 },
              isAdmin: { type: "boolean" },
              isActive: { type: "boolean" }
            },
            example: {
              id: "0f3c9d30-1307-4c9e-a4d7-75e84606c28d",
              email: "user@example.com",
              name: null,
              isAdmin: false,
              isActive: true
            }
          },
          AuthTokenPair: {
            type: "object",
            required: ["accessToken", "refreshToken", "expiresIn", "user"],
            properties: {
              accessToken: { type: "string" },
              refreshToken: { type: "string" },
              expiresIn: { type: "integer", minimum: 1 },
              user: { $ref: "#/components/schemas/PublicUser" }
            },
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
          },
          ErrorEnvelope: {
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
                }
              },
              requestId: { type: "string" }
            },
            example: {
              error: {
                code: "AUTH_INVALID_CREDENTIALS",
                message: "Invalid email or password",
                details: {}
              },
              requestId: "req-4xYdA1GspM9n"
            }
          }
        }
      }
    }
  });

  app.register(swaggerUi, {
    routePrefix: "/api/v1/auth/docs"
  });

  app.register(openapiRoute);
  app.register(authRoutes);
  app.register(adminRoutes);
  app.register(meRoute);

  app.addHook("onRequest", async (request, reply) => {
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("X-Frame-Options", "DENY");
    reply.header("X-XSS-Protection", "1; mode=block");
    if (process.env.NODE_ENV === "production") {
      reply.header("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    }
  });

  app.addHook("onReady", async () => {
    await runMigrations(db);
  });

  app.addHook("onClose", async () => {
    if (!overrides.db) {
      await db.end();
    }
  });

  app.setErrorHandler((err, request, reply) => {
    if (err instanceof ApiError) {
      reply.code(err.statusCode).send(toErrorBody(err, request.id));
      return;
    }

    request.log.error(err);
    reply
      .code(500)
      .send(toErrorBody(new ApiError(500, "INTERNAL_ERROR", "Internal server error"), request.id));
  });

  return app;
}

module.exports = {
  buildApp
};
