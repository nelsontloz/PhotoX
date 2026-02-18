const Fastify = require("fastify");
const swagger = require("@fastify/swagger");
const swaggerUi = require("@fastify/swagger-ui");

const { loadConfig } = require("./config");
const { createPool } = require("./db");
const { buildMediaRepo } = require("./repos/mediaRepo");
const { createMediaDerivativesWorker } = require("./queues/mediaDerivativesWorker");

function buildApp(overrides = {}) {
  const config = loadConfig(overrides);
  const app = Fastify({ logger: true });
  const db = overrides.db || createPool(config.databaseUrl);

  app.decorate("config", config);
  app.decorate("db", db);
  app.decorate("repos", {
    media: buildMediaRepo(db)
  });
  app.decorate("workers", {
    mediaDerivatives: overrides.mediaDerivativesWorker || null
  });

  app.register(swagger, {
    openapi: {
      info: {
        title: "PhotoX Worker Service API",
        description: "Worker control plane for media processing jobs.",
        version: "1.0.0"
      }
    }
  });

  app.register(swaggerUi, {
    routePrefix: "/api/v1/worker/docs"
  });

  app.get("/health", async () => ({ status: "ok", service: config.serviceName }));

  app.get("/metrics", async (_, reply) => {
    reply.type("text/plain; version=0.0.4");
    return `service_up{service="${config.serviceName}"} 1\n`;
  });

  app.get("/api/v1/worker/openapi.json", async () => app.swagger());

  app.addHook("onReady", async () => {
    if (!app.workers.mediaDerivatives) {
      app.workers.mediaDerivatives = createMediaDerivativesWorker({
        queueName: config.mediaDerivativesQueueName,
        redisUrl: config.redisUrl,
        originalsRoot: config.uploadOriginalsPath,
        derivedRoot: config.uploadDerivedPath,
        mediaRepo: app.repos.media,
        logger: app.log
      });
    }
  });

  app.addHook("onClose", async () => {
    if (!overrides.mediaDerivativesWorker && app.workers.mediaDerivatives) {
      await app.workers.mediaDerivatives.close();
    }

    if (!overrides.db) {
      await db.end();
    }
  });

  return app;
}

module.exports = {
  buildApp
};
