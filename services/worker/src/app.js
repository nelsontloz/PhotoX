const Fastify = require("fastify");
const swagger = require("@fastify/swagger");
const swaggerUi = require("@fastify/swagger-ui");

const { loadConfig } = require("./config");
const { createPool } = require("./db");
const { requireAdminAuth } = require("./auth/guard");
const { ApiError, toErrorBody } = require("./errors");
const { buildMediaRepo } = require("./repos/mediaRepo");
const { buildUsersRepo } = require("./repos/usersRepo");
const { createMediaDerivativesWorker, createMediaProcessWorker } = require("./queues/mediaDerivativesWorker");
const { buildMetricsText } = require("./telemetry/metrics");
const { QueueStatsPoller } = require("./telemetry/queueStatsPoller");
const { WorkerTelemetryStore } = require("./telemetry/store");

const HEARTBEAT_INTERVAL_MS = 10_000;
const STATE_SYNC_INTERVAL_MS = 30_000;

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

function sseFrame(event, payload) {
  return `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
}

function buildApp(overrides = {}) {
  const config = loadConfig(overrides);
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
  const db = overrides.db || createPool(config.databaseUrl);
  const queueNames = [config.mediaProcessQueueName, config.mediaDerivativesQueueName];
  const telemetryStore =
    overrides.telemetryStore ||
    new WorkerTelemetryStore({
      queueNames,
      eventLimitPerQueue: overrides.telemetryEventLimitPerQueue || 500,
      eventTtlMs: overrides.telemetryEventTtlMs || 15 * 60 * 1000
    });
  const queueStatsPoller =
    overrides.queueStatsPoller ||
    new QueueStatsPoller({
      queueNames,
      redisUrl: config.redisUrl,
      logger: app.log,
      intervalMs: overrides.telemetryQueuePollMs || 5000
    });

  app.decorate("config", config);
  app.decorate("db", db);
  app.decorate("repos", {
    media: buildMediaRepo(db),
    users: buildUsersRepo(db)
  });
  app.decorate("telemetry", {
    store: telemetryStore,
    queueStatsPoller
  });
  app.decorate("workers", {
    mediaDerivatives: overrides.mediaDerivativesWorker || null,
    mediaProcess: overrides.mediaProcessWorker || null
  });

  app.register(swagger, {
    hideUntagged: false,
    openapi: {
      info: {
        title: "PhotoX Worker Service API",
        description: "Worker control plane, telemetry, and metrics for media processing jobs.",
        version: "1.0.0"
      },
      tags: [
        {
          name: "Worker",
          description: "Worker control-plane operations"
        },
        {
          name: "Telemetry",
          description: "Worker telemetry snapshot and stream"
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
    routePrefix: "/api/v1/worker/docs"
  });

  app.register(async function workerRoutes(instance) {
    instance.get("/health", async () => ({ status: "ok", service: config.serviceName }));

    instance.get("/metrics", async (_, reply) => {
      reply.type("text/plain; version=0.0.4");
      return buildMetricsText({
        serviceName: config.serviceName,
        queueCounts: instance.telemetry.queueStatsPoller.getSnapshot(),
        telemetryStore: instance.telemetry.store
      });
    });

    instance.get("/api/v1/worker/openapi.json", async () => instance.swagger());

    const adminGuard = requireAdminAuth(config, instance.repos.users);

    instance.get(
      "/api/v1/worker/telemetry/snapshot",
      {
        preHandler: adminGuard,
        schema: {
          tags: ["Telemetry"],
          summary: "Get worker telemetry snapshot",
          description: "Returns queue counts, worker health, in-flight jobs, recent failures, and recent events.",
          security: [{ bearerAuth: [] }],
          response: {
            200: {
              type: "object",
              required: [
                "schemaVersion",
                "generatedAt",
                "queueCounts",
                "counters",
                "rates",
                "workerHealth",
                "inFlightJobs",
                "recentFailures",
                "recentEvents"
              ],
              properties: {
                schemaVersion: { type: "string" },
                generatedAt: { type: "string", format: "date-time" },
                queueCounts: { type: "object", additionalProperties: true },
                counters: { type: "object", additionalProperties: true },
                rates: { type: "object", additionalProperties: true },
                workerHealth: { type: "object", additionalProperties: true },
                inFlightJobs: { type: "array", items: { type: "object", additionalProperties: true } },
                recentFailures: { type: "object", additionalProperties: true },
                recentEvents: { type: "array", items: { type: "object", additionalProperties: true } }
              },
              additionalProperties: false
            },
            403: buildErrorEnvelopeSchema({
              code: "AUTH_FORBIDDEN",
              message: "Admin access is required"
            })
          }
        }
      },
      async () => {
        return instance.telemetry.store.getSnapshot({
          queueCounts: instance.telemetry.queueStatsPoller.getSnapshot()
        });
      }
    );

    instance.get(
      "/api/v1/worker/telemetry/stream",
      {
        preHandler: adminGuard,
        schema: {
          tags: ["Telemetry"],
          summary: "Stream worker telemetry events",
          description: "Server-sent events stream with heartbeat, lifecycle deltas, and periodic state sync events.",
          security: [{ bearerAuth: [] }],
          produces: ["text/event-stream"],
          response: {
            200: {
              type: "string",
              example: 'event: heartbeat\\ndata: {"schemaVersion":"2026-02-telemetry-v1","at":"2026-02-18T00:00:00.000Z"}\\n\\n'
            }
          }
        }
      },
      async (request, reply) => {
        reply.raw.setHeader("Content-Type", "text/event-stream");
        reply.raw.setHeader("Cache-Control", "no-cache");
        reply.raw.setHeader("Connection", "keep-alive");
        reply.raw.flushHeaders?.();

        const writeSafe = (eventName, payload) => {
          if (reply.raw.writableEnded || reply.raw.destroyed) {
            return;
          }
          reply.raw.write(sseFrame(eventName, payload));
        };

        writeSafe("state_sync", {
          schemaVersion: instance.telemetry.store.schemaVersion,
          state: instance.telemetry.store.getSnapshot({
            queueCounts: instance.telemetry.queueStatsPoller.getSnapshot()
          })
        });

        if (request.headers["x-pact-test-sse-once"] === "1") {
          reply.raw.end();
          return reply;
        }

        const unsubscribe = instance.telemetry.store.subscribe((eventName, payload) => {
          writeSafe(eventName, payload);
        });

        const heartbeatTimer = setInterval(() => {
          writeSafe("heartbeat", {
            schemaVersion: instance.telemetry.store.schemaVersion,
            at: new Date().toISOString()
          });
        }, HEARTBEAT_INTERVAL_MS);

        const syncTimer = setInterval(() => {
          writeSafe("state_sync", {
            schemaVersion: instance.telemetry.store.schemaVersion,
            state: instance.telemetry.store.getSnapshot({
              queueCounts: instance.telemetry.queueStatsPoller.getSnapshot()
            })
          });
        }, STATE_SYNC_INTERVAL_MS);

        const cleanup = () => {
          clearInterval(heartbeatTimer);
          clearInterval(syncTimer);
          unsubscribe();
        };

        request.raw.once("close", cleanup);
        request.raw.once("error", cleanup);
        return reply;
      }
    );
  });

  app.addHook("onReady", async () => {
    await app.telemetry.queueStatsPoller.start();

    if (!app.workers.mediaProcess) {
      app.workers.mediaProcess = createMediaProcessWorker({
        queueName: config.mediaProcessQueueName,
        redisUrl: config.redisUrl,
        originalsRoot: config.uploadOriginalsPath,
        derivedRoot: config.uploadDerivedPath,
        mediaRepo: app.repos.media,
        logger: app.log,
        telemetry: app.telemetry.store
      });
    }

    if (!app.workers.mediaDerivatives) {
      app.workers.mediaDerivatives = createMediaDerivativesWorker({
        queueName: config.mediaDerivativesQueueName,
        redisUrl: config.redisUrl,
        originalsRoot: config.uploadOriginalsPath,
        derivedRoot: config.uploadDerivedPath,
        mediaRepo: app.repos.media,
        logger: app.log,
        telemetry: app.telemetry.store
      });
    }
  });

  app.addHook("onClose", async () => {
    if (!overrides.queueStatsPoller) {
      await queueStatsPoller.close();
    }

    if (!overrides.mediaProcessWorker && app.workers.mediaProcess) {
      await app.workers.mediaProcess.close();
    }

    if (!overrides.mediaDerivativesWorker && app.workers.mediaDerivatives) {
      await app.workers.mediaDerivatives.close();
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
