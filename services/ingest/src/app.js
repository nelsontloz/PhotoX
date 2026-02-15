const Fastify = require("fastify");
const swagger = require("@fastify/swagger");
const swaggerUi = require("@fastify/swagger-ui");
const { Queue } = require("bullmq");

const { loadConfig } = require("./config");
const { createPool, runMigrations } = require("./db");
const { ApiError, toErrorBody } = require("./errors");
const { buildUploadSessionsRepo } = require("./repos/uploadSessionsRepo");
const { buildIdempotencyRepo } = require("./repos/idempotencyRepo");
const { buildUploadPartsRepo } = require("./repos/uploadPartsRepo");
const { buildMediaRepo } = require("./repos/mediaRepo");
const openapiRoute = require("./routes/openapiRoute");
const uploadsRoutes = require("./routes/uploadsRoutes");

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
  const config = loadConfig(overrides);
  const app = Fastify({
    logger: true,
    bodyLimit: config.uploadBodyLimitBytes,
    ajv: {
      plugins: [
        (ajv) => {
          ajv.addKeyword("example");
        }
      ]
    }
  });
  const db = overrides.db || createPool(config.databaseUrl);
  const queue =
    overrides.mediaProcessQueue ||
    new Queue(config.mediaProcessQueueName, {
      connection: redisConnectionFromUrl(config.redisUrl)
    });

  app.decorate("config", config);
  app.decorate("db", db);
  app.decorate("queues", {
    mediaProcess: queue
  });
  app.decorate("repos", {
    uploadSessions: buildUploadSessionsRepo(db),
    uploadParts: buildUploadPartsRepo(db),
    media: buildMediaRepo(db),
    idempotency: buildIdempotencyRepo(db)
  });

  app.addContentTypeParser(
    "application/octet-stream",
    {
      parseAs: "buffer"
    },
    function parseOctetStream(_request, body, done) {
      done(null, body);
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
        title: "PhotoX Ingest Service API",
        description: "Chunked upload lifecycle endpoints.",
        version: "1.0.0"
      },
      tags: [
        {
          name: "Uploads",
          description: "Initialize and manage chunked uploads"
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
    routePrefix: "/api/v1/uploads/docs"
  });

  app.register(openapiRoute);
  app.register(uploadsRoutes);

  app.addHook("onReady", async () => {
    await runMigrations(db);
  });

  app.addHook("onClose", async () => {
    if (!overrides.mediaProcessQueue) {
      await queue.close();
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

    if (err && err.code === "FST_ERR_CTP_BODY_TOO_LARGE") {
      reply
        .code(413)
        .send(toErrorBody(new ApiError(413, "PAYLOAD_TOO_LARGE", "Request body is too large"), request.id));
      return;
    }

    if (err && err.validation) {
      reply
        .code(400)
        .send(
          toErrorBody(
            new ApiError(400, "VALIDATION_ERROR", "Request validation failed", { issues: err.validation }),
            request.id
          )
        );
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
