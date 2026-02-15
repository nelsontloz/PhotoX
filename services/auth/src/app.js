const Fastify = require("fastify");
const swagger = require("@fastify/swagger");
const swaggerUi = require("@fastify/swagger-ui");

const { loadConfig } = require("./config");
const { createPool, runMigrations } = require("./db");
const { buildUsersRepo } = require("./repos/usersRepo");
const { buildSessionsRepo } = require("./repos/sessionsRepo");
const { ApiError, toErrorBody } = require("./errors");
const authRoutes = require("./routes/authRoutes");
const meRoute = require("./routes/meRoute");
const openapiRoute = require("./routes/openapiRoute");

function buildApp(overrides = {}) {
  const app = Fastify({ logger: true });
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
        version: "1.0.0"
      }
    }
  });

  app.register(swaggerUi, {
    routePrefix: "/api/v1/auth/docs"
  });

  app.register(openapiRoute);
  app.register(authRoutes);
  app.register(meRoute);

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
