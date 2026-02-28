const Fastify = require("fastify");
const swagger = require("@fastify/swagger");
const swaggerUi = require("@fastify/swagger-ui");

const { loadConfig } = require("./config");
const { createPool, runMigrations } = require("./db");
const { ApiError, toErrorBody } = require("./errors");
const { buildUploadSessionsRepo } = require("./repos/uploadSessionsRepo");
const { buildIdempotencyRepo } = require("./repos/idempotencyRepo");
const { buildUploadPartsRepo } = require("./repos/uploadPartsRepo");
const { buildMediaRepo } = require("./repos/mediaRepo");
const { createJobQueueAdapter } = require("./queues/jobQueueAdapter");
const openapiRoute = require("./routes/openapiRoute");
const uploadsRoutes = require("./routes/uploadsRoutes");

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
    createJobQueueAdapter({
      queueName: config.mediaProcessQueueName,
      rabbitmqUrl: config.rabbitmqUrl,
      rabbitmqExchangeName: config.rabbitmqExchangeName,
      rabbitmqQueuePrefix: config.rabbitmqQueuePrefix,
      logger: app.log
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
    function parseOctetStream(_request, payload, done) {
      done(null, payload);
    }
  );

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
