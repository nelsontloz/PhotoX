const Fastify = require("fastify");
const swagger = require("@fastify/swagger");
const swaggerUi = require("@fastify/swagger-ui");
const crypto = require("node:crypto");

const { loadConfig } = require("./config");
const { createPool, runMigrations } = require("./db");
const { requireAdminAuth } = require("./auth/guard");
const { ApiError, toErrorBody } = require("./errors");
const { buildMediaRepo } = require("./repos/mediaRepo");
const { buildUsersRepo } = require("./repos/usersRepo");
const {
  createMediaCleanupWorker,
  createMediaDerivativesWorker,
  createMediaOrphanSweepWorker,
  createMediaProcessWorker
} = require("./queues/mediaDerivativesWorker");
const { createJobQueueAdapter } = require("./queues/jobQueueAdapter");
const { buildMetricsText } = require("./telemetry/metrics");
const { QueueStatsPoller } = require("./telemetry/queueStatsPoller");
const { WorkerTelemetryStore } = require("./telemetry/store");
const { buildMediaOrphanSweepMessage } = require("./contracts/mediaOrphanSweepMessage");
const { DERIVED_SCOPE, ORIGINALS_SCOPE } = require("./orphanSweep/processor");
const { OrphanSweepScheduler } = require("./orphanSweep/scheduler");
const {
  DEFAULT_VIDEO_ENCODING_PROFILE,
  PROFILE_KEY,
  normalizeVideoEncodingProfile
} = require("./videoEncoding/profile");

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

async function enqueueOrphanSweepJobs({
  queue,
  requestId,
  trigger,
  scopes,
  dryRun,
  graceMs,
  batchSize,
  logger
}) {
  let queuedCount = 0;

  for (const scope of scopes) {
    try {
      await queue.add(
        "media.orphan.sweep",
        buildMediaOrphanSweepMessage({
          scope,
          dryRun,
          requestedAt: new Date(),
          requestId,
          graceMs,
          batchSize
        }),
        {
          jobId: `media-orphan-sweep-${scope}-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`,
          attempts: 5,
          backoff: {
            type: "exponential",
            delay: 3000
          }
        }
      );
      queuedCount += 1;
    } catch (err) {
      logger.warn({ err, scope, requestId, trigger }, "failed to enqueue orphan sweep job");
    }
  }

  return queuedCount;
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
  const queueNames = [
    config.mediaProcessQueueName,
    config.mediaDerivativesQueueName,
    config.mediaCleanupQueueName,
    config.mediaOrphanSweepQueueName
  ];

  const mediaOrphanSweepQueue =
    overrides.mediaOrphanSweepQueue ||
    createJobQueueAdapter({
      queueName: config.mediaOrphanSweepQueueName,
      rabbitmqUrl: config.rabbitmqUrl,
      rabbitmqExchangeName: config.rabbitmqExchangeName,
      rabbitmqQueuePrefix: config.rabbitmqQueuePrefix,
      logger: app.log
    });
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
      rabbitmqUrl: config.rabbitmqUrl,
      exchangeName: config.rabbitmqExchangeName,
      queuePrefix: config.rabbitmqQueuePrefix,
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
    mediaProcess: overrides.mediaProcessWorker || null,
    mediaCleanup: overrides.mediaCleanupWorker || null,
    mediaOrphanSweep: overrides.mediaOrphanSweepWorker || null
  });
  app.decorate("queues", {
    mediaOrphanSweep: mediaOrphanSweepQueue
  });
  app.decorate("schedulers", {
    orphanSweep: overrides.orphanSweepScheduler || null
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
        },
        {
          name: "Settings",
          description: "Administrative worker settings"
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
      "/api/v1/worker/settings/video-encoding",
      {
        preHandler: adminGuard,
        schema: {
          tags: ["Settings"],
          summary: "Get default video encoding profile",
          description: "Returns the default video encoding profile used by playback derivative generation.",
          security: [{ bearerAuth: [] }],
          response: {
            200: {
              type: "object",
              required: ["profile"],
              properties: {
                profile: {
                  type: "object",
                  required: [
                    "codec",
                    "resolution",
                    "bitrateKbps",
                    "frameRate",
                    "audioCodec",
                    "audioBitrateKbps",
                    "preset",
                    "outputFormat"
                  ],
                  properties: {
                    codec: { type: "string" },
                    resolution: { type: "string", example: "1280x720" },
                    bitrateKbps: { type: "integer", minimum: 64 },
                    frameRate: { type: "integer", minimum: 1 },
                    audioCodec: { type: "string" },
                    audioBitrateKbps: { type: "integer", minimum: 32 },
                    preset: { type: "string", enum: ["fast", "balanced", "quality"] },
                    outputFormat: { type: "string", enum: ["webm", "mp4"] }
                  },
                  additionalProperties: false
                }
              },
              additionalProperties: false,
              example: {
                profile: {
                  codec: "libvpx-vp9",
                  resolution: "1280x720",
                  bitrateKbps: 1800,
                  frameRate: 30,
                  audioCodec: "libopus",
                  audioBitrateKbps: 96,
                  preset: "balanced",
                  outputFormat: "webm"
                }
              }
            },
            401: buildErrorEnvelopeSchema({
              code: "AUTH_TOKEN_INVALID",
              message: "Token is invalid"
            }),
            403: buildErrorEnvelopeSchema({
              code: "AUTH_FORBIDDEN",
              message: "Admin access is required"
            })
          }
        }
      },
      async () => {
        const stored = await instance.repos.media.getVideoEncodingProfile(PROFILE_KEY);
        return {
          profile: normalizeVideoEncodingProfile(stored?.profile_json || DEFAULT_VIDEO_ENCODING_PROFILE)
        };
      }
    );

    instance.put(
      "/api/v1/worker/settings/video-encoding",
      {
        preHandler: adminGuard,
        schema: {
          tags: ["Settings"],
          summary: "Save default video encoding profile",
          description:
            "Creates or updates the default video encoding profile used by playback derivative generation jobs.",
          security: [{ bearerAuth: [] }],
          body: {
            type: "object",
            required: ["profile"],
            properties: {
              profile: {
                type: "object",
                required: [
                  "codec",
                  "resolution",
                  "bitrateKbps",
                  "frameRate",
                  "audioCodec",
                  "audioBitrateKbps",
                  "preset",
                  "outputFormat"
                ],
                properties: {
                  codec: { type: "string", minLength: 1 },
                  resolution: { type: "string", minLength: 3, maxLength: 32 },
                  bitrateKbps: { type: "integer", minimum: 64 },
                  frameRate: { type: "integer", minimum: 1, maximum: 120 },
                  audioCodec: { type: "string", minLength: 1 },
                  audioBitrateKbps: { type: "integer", minimum: 32, maximum: 512 },
                  preset: { type: "string", enum: ["fast", "balanced", "quality"] },
                  outputFormat: { type: "string", enum: ["webm", "mp4"] }
                },
                additionalProperties: false
              }
            },
            additionalProperties: false,
            example: {
              profile: {
                codec: "libvpx-vp9",
                resolution: "1920x1080",
                bitrateKbps: 2800,
                frameRate: 30,
                audioCodec: "libopus",
                audioBitrateKbps: 128,
                preset: "quality",
                outputFormat: "webm"
              }
            }
          },
          response: {
            200: {
              type: "object",
              required: ["profile"],
              properties: {
                profile: {
                  type: "object",
                  required: [
                    "codec",
                    "resolution",
                    "bitrateKbps",
                    "frameRate",
                    "audioCodec",
                    "audioBitrateKbps",
                    "preset",
                    "outputFormat"
                  ],
                  properties: {
                    codec: { type: "string" },
                    resolution: { type: "string" },
                    bitrateKbps: { type: "integer" },
                    frameRate: { type: "integer" },
                    audioCodec: { type: "string" },
                    audioBitrateKbps: { type: "integer" },
                    preset: { type: "string", enum: ["fast", "balanced", "quality"] },
                    outputFormat: { type: "string", enum: ["webm", "mp4"] }
                  },
                  additionalProperties: false
                }
              },
              additionalProperties: false
            },
            400: buildErrorEnvelopeSchema({
              code: "VALIDATION_ERROR",
              message: "Request validation failed"
            }),
            401: buildErrorEnvelopeSchema({
              code: "AUTH_TOKEN_INVALID",
              message: "Token is invalid"
            }),
            403: buildErrorEnvelopeSchema({
              code: "AUTH_FORBIDDEN",
              message: "Admin access is required"
            })
          }
        }
      },
      async (request) => {
        try {
          const profile = normalizeVideoEncodingProfile(request.body?.profile || {});
          await instance.repos.media.upsertVideoEncodingProfile({
            profileKey: PROFILE_KEY,
            profileJson: profile,
            updatedBy: request.userAuth.userId
          });

          return { profile };
        } catch (err) {
          throw new ApiError(400, "VALIDATION_ERROR", "Request validation failed", {
            issues: [
              {
                path: ["profile"],
                message: err.message
              }
            ]
          });
        }
      }
    );

    instance.post(
      "/api/v1/worker/orphan-sweep/run",
      {
        preHandler: adminGuard,
        schema: {
          tags: ["Worker"],
          summary: "Queue orphan-file sweep jobs",
          description:
            "Queues orphan-file sweep jobs for originals and/or derived storage. Default behavior follows configured dry-run and grace period values.",
          security: [{ bearerAuth: [] }],
          body: {
            type: "object",
            properties: {
              scope: {
                type: "string",
                enum: [ORIGINALS_SCOPE, DERIVED_SCOPE]
              },
              dryRun: { type: "boolean" },
              graceMs: { type: "integer", minimum: 1 },
              batchSize: { type: "integer", minimum: 1 }
            },
            additionalProperties: false,
            example: {
              scope: "originals",
              dryRun: true,
              graceMs: 21600000,
              batchSize: 1000
            }
          },
          response: {
            202: {
              type: "object",
              required: ["status", "requestId", "queuedCount", "scopes", "dryRun", "graceMs", "batchSize"],
              properties: {
                status: { type: "string", enum: ["queued"] },
                requestId: { type: "string" },
                queuedCount: { type: "integer", minimum: 0 },
                scopes: {
                  type: "array",
                  items: { type: "string", enum: [ORIGINALS_SCOPE, DERIVED_SCOPE] }
                },
                dryRun: { type: "boolean" },
                graceMs: { type: "integer" },
                batchSize: { type: "integer" }
              },
              additionalProperties: false
            },
            401: buildErrorEnvelopeSchema({
              code: "AUTH_TOKEN_INVALID",
              message: "Token is invalid"
            }),
            403: buildErrorEnvelopeSchema({
              code: "AUTH_FORBIDDEN",
              message: "Admin access is required"
            })
          }
        }
      },
      async (request, reply) => {
        const scopes = request.body?.scope ? [request.body.scope] : [ORIGINALS_SCOPE, DERIVED_SCOPE];
        const dryRun = request.body?.dryRun ?? config.orphanSweepDefaultDryRun;
        const graceMs = request.body?.graceMs ?? config.orphanSweepGraceMs;
        const batchSize = request.body?.batchSize ?? config.orphanSweepBatchSize;
        const requestId = request.id;

        const queuedCount = await enqueueOrphanSweepJobs({
          queue: instance.queues.mediaOrphanSweep,
          requestId,
          trigger: "manual",
          scopes,
          dryRun,
          graceMs,
          batchSize,
          logger: request.log
        });

        return reply.code(202).send({
          status: "queued",
          requestId,
          queuedCount,
          scopes,
          dryRun,
          graceMs,
          batchSize
        });
      }
    );

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
    if (!overrides.skipMigrations) {
      await runMigrations(db);
    }

    await app.telemetry.queueStatsPoller.start();

    if (!app.workers.mediaProcess) {
      app.workers.mediaProcess = createMediaProcessWorker({
        queueName: config.mediaProcessQueueName,
        rabbitmqUrl: config.rabbitmqUrl,
        rabbitmqExchangeName: config.rabbitmqExchangeName,
        rabbitmqQueuePrefix: config.rabbitmqQueuePrefix,
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
        rabbitmqUrl: config.rabbitmqUrl,
        rabbitmqExchangeName: config.rabbitmqExchangeName,
        rabbitmqQueuePrefix: config.rabbitmqQueuePrefix,
        originalsRoot: config.uploadOriginalsPath,
        derivedRoot: config.uploadDerivedPath,
        mediaRepo: app.repos.media,
        logger: app.log,
        telemetry: app.telemetry.store
      });
    }

    if (!app.workers.mediaCleanup) {
      app.workers.mediaCleanup = createMediaCleanupWorker({
        queueName: config.mediaCleanupQueueName,
        rabbitmqUrl: config.rabbitmqUrl,
        rabbitmqExchangeName: config.rabbitmqExchangeName,
        rabbitmqQueuePrefix: config.rabbitmqQueuePrefix,
        originalsRoot: config.uploadOriginalsPath,
        derivedRoot: config.uploadDerivedPath,
        mediaRepo: app.repos.media,
        logger: app.log,
        telemetry: app.telemetry.store
      });
    }

    if (!app.workers.mediaOrphanSweep) {
      app.workers.mediaOrphanSweep = createMediaOrphanSweepWorker({
        queueName: config.mediaOrphanSweepQueueName,
        rabbitmqUrl: config.rabbitmqUrl,
        rabbitmqExchangeName: config.rabbitmqExchangeName,
        rabbitmqQueuePrefix: config.rabbitmqQueuePrefix,
        originalsRoot: config.uploadOriginalsPath,
        derivedRoot: config.uploadDerivedPath,
        mediaRepo: app.repos.media,
        logger: app.log,
        telemetry: app.telemetry.store
      });
    }

    if (typeof app.workers.mediaProcess?.start === "function") {
      await app.workers.mediaProcess.start();
    }

    if (typeof app.workers.mediaDerivatives?.start === "function") {
      await app.workers.mediaDerivatives.start();
    }

    if (typeof app.workers.mediaCleanup?.start === "function") {
      await app.workers.mediaCleanup.start();
    }

    if (typeof app.workers.mediaOrphanSweep?.start === "function") {
      await app.workers.mediaOrphanSweep.start();
    }

    if (!app.schedulers.orphanSweep && config.orphanSweepEnabled) {
      app.schedulers.orphanSweep = new OrphanSweepScheduler({
        enabled: true,
        intervalMs: config.orphanSweepIntervalMs,
        logger: app.log,
        run: async ({ trigger, requestedAt }) => {
          const requestId = `scheduler-${requestedAt.getTime()}`;
          await enqueueOrphanSweepJobs({
            queue: app.queues.mediaOrphanSweep,
            requestId,
            trigger,
            scopes: [ORIGINALS_SCOPE, DERIVED_SCOPE],
            dryRun: config.orphanSweepDefaultDryRun,
            graceMs: config.orphanSweepGraceMs,
            batchSize: config.orphanSweepBatchSize,
            logger: app.log
          });
        }
      });
    }

    if (typeof app.schedulers.orphanSweep?.start === "function") {
      await app.schedulers.orphanSweep.start();
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

    if (!overrides.mediaCleanupWorker && app.workers.mediaCleanup) {
      await app.workers.mediaCleanup.close();
    }

    if (!overrides.mediaOrphanSweepWorker && app.workers.mediaOrphanSweep) {
      await app.workers.mediaOrphanSweep.close();
    }

    if (!overrides.orphanSweepScheduler && app.schedulers.orphanSweep) {
      await app.schedulers.orphanSweep.close();
    }

    if (!overrides.mediaOrphanSweepQueue && app.queues.mediaOrphanSweep) {
      await app.queues.mediaOrphanSweep.close();
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
