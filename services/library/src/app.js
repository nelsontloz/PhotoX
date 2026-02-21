const Fastify = require("fastify");
const swagger = require("@fastify/swagger");
const swaggerUi = require("@fastify/swagger-ui");
const { Queue } = require("bullmq");

const { loadConfig } = require("./config");
const { createPool, runMigrations } = require("./db");
const { ApiError, toErrorBody } = require("./errors");
const { buildLibraryRepo } = require("./repos/libraryRepo");
const openapiRoute = require("./routes/openapiRoute");
const libraryRoutes = require("./routes/libraryRoutes");

function redisConnectionFromUrl(redisUrl) {
  const parsed = new URL(redisUrl);
  const dbNumber = Number.parseInt(parsed.pathname.replace("/", ""), 10);

  return {
    host: parsed.hostname,
    port: Number.parseInt(parsed.port || "6379", 10),
    username: parsed.username || undefined,
    password: parsed.password || undefined,
    db: Number.isNaN(dbNumber) ? 0 : dbNumber
  };
}

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
  const mediaDerivativesQueue =
    overrides.mediaDerivativesQueue ||
    new Queue(config.mediaDerivativesQueueName, {
      connection: redisConnectionFromUrl(config.redisUrl)
    });
  const mediaCleanupQueue =
    overrides.mediaCleanupQueue ||
    new Queue(config.mediaCleanupQueueName, {
      connection: redisConnectionFromUrl(config.redisUrl)
    });

  app.decorate("config", config);
  app.decorate("db", db);
  app.decorate("repos", {
    library: buildLibraryRepo(db)
  });
  app.decorate("queues", {
    mediaDerivatives: mediaDerivativesQueue,
    mediaCleanup: mediaCleanupQueue
  });

  app.addContentTypeParser(
    "*",
    {
      parseAs: "string"
    },
    function parseUnknownContentType(_request, body, done) {
      if (body == null) {
        done(null, undefined);
        return;
      }

      const textBody = typeof body === "string" ? body.trim() : String(body);

      if (textBody.length === 0 || textBody === "null") {
        done(null, undefined);
        return;
      }

      try {
        done(null, JSON.parse(textBody));
      } catch {
        done(null, textBody);
      }
    }
  );

  app.get("/health", async () => ({ status: "ok", service: config.serviceName }));

  app.get("/metrics", async (_, reply) => {
    reply.type("text/plain; version=0.0.4");
    return `service_up{service="${config.serviceName}"} 1\n`;
  });

  app.register(swagger, {
    openapi: {
      info: {
        title: "PhotoX Library Service API",
        description: "Timeline reads, media detail, flags, soft delete, and restore endpoints.",
        version: "1.0.0"
      },
      tags: [
        {
          name: "Library",
          description: "Timeline listing endpoint"
        },
        {
          name: "Media",
          description: "Media detail and media state operations"
        }
      ],
      components: {
        securitySchemes: {
          bearerAuth: {
            type: "http",
            scheme: "bearer",
            bearerFormat: "JWT"
          }
        }
      }
    }
  });

  app.register(swaggerUi, {
    routePrefix: "/api/v1/library/docs"
  });

  app.register(openapiRoute);
  app.register(libraryRoutes);

  app.addHook("onReady", async () => {
    await runMigrations(db);
  });

  app.addHook("onClose", async () => {
    if (!overrides.mediaDerivativesQueue) {
      await mediaDerivativesQueue.close();
    }

    if (!overrides.mediaCleanupQueue) {
      await mediaCleanupQueue.close();
    }

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
