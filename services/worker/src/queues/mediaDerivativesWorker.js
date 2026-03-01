const fs = require("node:fs/promises");
const amqplib = require("amqplib");

const { generateDerivativesForMedia } = require("../media/derivatives");
const { extractMediaMetadata } = require("../media/metadata");
const { buildDerivativeRelativePath, resolveAbsolutePath } = require("../media/paths");
const { PROFILE_KEY, resolvePlaybackProfile } = require("../videoEncoding/profile");

const DEFAULT_LOCK_RETRY_ATTEMPTS = 5;
const DEFAULT_LOCK_RETRY_DELAY_MS = 200;

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class ProcessingLockUnavailableError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "ProcessingLockUnavailableError";
    this.code = "PROCESSING_LOCK_UNAVAILABLE";
    this.retriable = true;
    this.details = details;
  }
}

async function acquireProcessingLockWithRetry({ mediaRepo, mediaId, logger, queueName, jobId, retryAttempts, retryDelayMs }) {
  if (!mediaRepo?.acquireProcessingLock) {
    return null;
  }

  const maxAttempts = Number.isInteger(retryAttempts) && retryAttempts > 0 ? retryAttempts : DEFAULT_LOCK_RETRY_ATTEMPTS;
  const baseDelayMs = Number.isInteger(retryDelayMs) && retryDelayMs > 0 ? retryDelayMs : DEFAULT_LOCK_RETRY_DELAY_MS;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const lockHandle = await mediaRepo.acquireProcessingLock(mediaId, { tryOnly: true });
    if (lockHandle?.acquired) {
      return lockHandle;
    }

    if (attempt < maxAttempts) {
      const backoffMs = baseDelayMs * attempt;
      logger.warn(
        {
          queueName,
          jobId,
          mediaId,
          attempt,
          maxAttempts,
          backoffMs
        },
        "processing lock busy; retrying"
      );
      await delay(backoffMs);
    }
  }

  throw new ProcessingLockUnavailableError("Unable to acquire media processing lock after retries", {
    mediaId,
    attempts: maxAttempts
  });
}

function isTerminalFailure(job) {
  if (!job) {
    return false;
  }

  const attempts = Number(job.opts?.attempts || 1);
  const attemptsMade = Number(job.attemptsMade || 0);
  return attemptsMade >= attempts;
}

async function persistFailedStatusOnTerminalFailure({ job, mediaRepo, logger, queueName }) {
  if (!mediaRepo || !isTerminalFailure(job) || !job?.data?.mediaId) {
    return;
  }

  try {
    await mediaRepo.setFailedIfProcessing(job.data.mediaId);
  } catch (statusErr) {
    logger.error(
      {
        queueName,
        jobId: job?.id,
        mediaId: job?.data?.mediaId,
        err: statusErr
      },
      "failed to persist terminal media status"
    );
  }
}

function createMediaDerivativesProcessor({ originalsRoot, derivedRoot, logger, commandRunner, mediaRepo }) {
  return async (job) => {
    const { mediaId, relativePath } = job.data || {};
    if (!mediaId || !relativePath) {
      throw new Error("Invalid derivatives job payload: mediaId and relativePath are required");
    }

    let lockHandle = null;
    try {
      lockHandle = await acquireProcessingLockWithRetry({
        mediaRepo,
        mediaId,
        logger,
        queueName: job.queueName,
        jobId: job.id,
        retryAttempts: job.data?.lockRetryAttempts,
        retryDelayMs: job.data?.lockRetryDelayMs
      });

      const sourceMedia = mediaRepo ? await mediaRepo.findById(mediaId) : null;
      const mimeType = sourceMedia?.mime_type;
      const uploadedAt = sourceMedia?.created_at || new Date().toISOString();

      if (mediaRepo) {
        try {
          const metadata = await extractMediaMetadata({
            sourceAbsolutePath: resolveAbsolutePath(originalsRoot, relativePath),
            mimeType,
            uploadedAt,
            commandRunner
          });

          await mediaRepo.upsertMetadata({
            mediaId,
            takenAt: metadata.takenAt,
            uploadedAt,
            width: metadata.width,
            height: metadata.height,
            location: metadata.location,
            exif: metadata.exif
          });
        } catch (metadataError) {
          logger.warn(
            {
              queueName: job.queueName,
              jobId: job.id,
              mediaId,
              err: metadataError
            },
            "metadata extraction failed; continuing derivative processing"
          );
        }
      }

      let savedProfile = null;
      if (mediaRepo?.getVideoEncodingProfile) {
        const profileRow = await mediaRepo.getVideoEncodingProfile(PROFILE_KEY);
        savedProfile = profileRow?.profile_json || null;
      }

      const playbackProfile = resolvePlaybackProfile({
        savedProfile,
        overrideProfile: job.data?.videoEncodingProfileOverride || null
      });

      const derivatives = await generateDerivativesForMedia({
        originalsRoot,
        derivedRoot,
        mediaId,
        relativePath,
        playbackProfile,
        commandRunner
      });

      logger.info(
        {
          queueName: job.queueName,
          jobId: job.id,
          mediaId,
          derivativeCount: derivatives.length,
          derivativeVariants: derivatives.map((derivative) => derivative.variant)
        },
        "generated media derivatives"
      );

      if (mediaRepo?.setReadyIfProcessing) {
        await mediaRepo.setReadyIfProcessing(mediaId);
      } else if (mediaRepo?.setStatus) {
        await mediaRepo.setStatus(mediaId, "ready");
      }

      return {
        mediaId,
        derivatives
      };
    } finally {
      if (lockHandle) {
        try {
          await mediaRepo.releaseProcessingLock(lockHandle);
        } catch (unlockErr) {
          logger.warn(
            {
              queueName: job.queueName,
              jobId: job.id,
              mediaId,
              err: unlockErr
            },
            "failed to release media processing lock"
          );
        }
      }
    }
  };
}

async function removeFileIfPresent(absolutePath) {
  try {
    await fs.unlink(absolutePath);
    return true;
  } catch (err) {
    if (err && err.code === "ENOENT") {
      return false;
    }

    throw err;
  }
}

function createMediaCleanupProcessor({ originalsRoot, derivedRoot, logger, mediaRepo }) {
  return async (job) => {
    const { mediaId, ownerId } = job.data || {};
    if (!mediaId || !ownerId) {
      throw new Error("Invalid cleanup job payload: mediaId and ownerId are required");
    }

    let lockHandle = null;
    try {
      lockHandle = await acquireProcessingLockWithRetry({
        mediaRepo,
        mediaId,
        logger,
        queueName: job.queueName,
        jobId: job.id,
        retryAttempts: job.data?.lockRetryAttempts,
        retryDelayMs: job.data?.lockRetryDelayMs
      });

      const target = await mediaRepo.findCleanupCandidate(mediaId, ownerId);
      if (!target) {
        return {
          mediaId,
          status: "missing"
        };
      }

      if (!target.deleted_soft) {
        return {
          mediaId,
          status: "restored-skip"
        };
      }

      const originalAbsolutePath = resolveAbsolutePath(originalsRoot, target.relative_path);
      const candidatePaths = [
        originalAbsolutePath,
        resolveAbsolutePath(derivedRoot, buildDerivativeRelativePath(target.relative_path, mediaId, "thumb")),
        resolveAbsolutePath(derivedRoot, buildDerivativeRelativePath(target.relative_path, mediaId, "small")),
        resolveAbsolutePath(
          derivedRoot,
          buildDerivativeRelativePath(target.relative_path, mediaId, "playback", "webm")
        ),
        resolveAbsolutePath(
          derivedRoot,
          buildDerivativeRelativePath(target.relative_path, mediaId, "playback", "mp4")
        )
      ];

      for (const candidatePath of candidatePaths) {
        await removeFileIfPresent(candidatePath);
      }

      const deletion = await mediaRepo.hardDeleteMediaGraphIfStillSoftDeleted(mediaId, ownerId);
      if (!deletion.deleted) {
        return {
          mediaId,
          status: "restored-race-skip"
        };
      }

      return {
        mediaId,
        status: "deleted"
      };
    } finally {
      if (lockHandle) {
        try {
          await mediaRepo.releaseProcessingLock(lockHandle);
        } catch (unlockErr) {
          logger.warn(
            {
              queueName: job.queueName,
              jobId: job.id,
              mediaId,
              err: unlockErr
            },
            "failed to release media cleanup lock"
          );
        }
      }
    }
  };
}

function createMediaDerivativesWorker({
  queueName,
  rabbitmqUrl,
  rabbitmqExchangeName = "photox.media",
  rabbitmqQueuePrefix = "worker",
  originalsRoot,
  derivedRoot,
  logger,
  mediaRepo,
  telemetry
}) {
  return createRabbitWorker({
    queueName,
    rabbitmqUrl,
    exchangeName: rabbitmqExchangeName,
    queuePrefix: rabbitmqQueuePrefix,
    processor: createMediaDerivativesProcessor({ originalsRoot, derivedRoot, logger, mediaRepo }),
    logger,
    telemetry,
    mediaRepo,
    onFailureLogMessage: "media derivatives job failed",
    persistFailedStatus: true
  });
}

function buildRabbitRetryDelayMs({ attemptsMade, baseDelayMs }) {
  const safeAttempts = Number.isInteger(attemptsMade) && attemptsMade > 0 ? attemptsMade : 1;
  const safeBaseDelay = Number.isInteger(baseDelayMs) && baseDelayMs > 0 ? baseDelayMs : 3000;
  return safeBaseDelay * 2 ** Math.max(0, safeAttempts - 1);
}

function createRabbitWorker({
  queueName,
  rabbitmqUrl,
  exchangeName,
  queuePrefix,
  processor,
  logger,
  telemetry,
  mediaRepo,
  onFailureLogMessage,
  persistFailedStatus = false
}) {
  const mainQueueName = `${queuePrefix}.${queueName}`;
  const retryQueueName = `${mainQueueName}.retry`;
  const dlqQueueName = `${mainQueueName}.dlq`;

  let connection = null;
  let channel = null;
  let consumerTag = null;
  let started = false;

  async function ensureReady() {
    if (started) {
      return;
    }

    connection = await amqplib.connect(rabbitmqUrl);
    channel = await connection.createConfirmChannel();

    await channel.assertExchange(exchangeName, "topic", { durable: true });
    await channel.assertQueue(mainQueueName, { durable: true });
    await channel.assertQueue(retryQueueName, {
      durable: true,
      arguments: {
        "x-dead-letter-exchange": exchangeName,
        "x-dead-letter-routing-key": queueName
      }
    });
    await channel.assertQueue(dlqQueueName, { durable: true });
    await channel.bindQueue(mainQueueName, exchangeName, queueName);

    await channel.prefetch(2);
    const consumeResult = await channel.consume(mainQueueName, async (message) => {
      if (!message) {
        return;
      }

      const payloadText = message.content.toString("utf8");
      const payload = JSON.parse(payloadText || "{}");
      const attemptsMade = Number(message.properties?.headers?.attemptsMade || 0);
      const maxAttempts = Number(message.properties?.headers?.maxAttempts || 5);
      const backoffDelay = Number(message.properties?.headers?.backoffDelay || 3000);
      const receivedAt = Date.now();

      const job = {
        id: message.properties?.messageId || null,
        queueName,
        data: payload,
        attemptsMade,
        opts: {
          attempts: maxAttempts
        },
        processedOn: receivedAt,
        finishedOn: null
      };

      telemetry?.recordEvent({
        queue: queueName,
        event: "active",
        jobId: job.id,
        mediaId: payload?.mediaId,
        attempts: attemptsMade
      });

      try {
        await processor(job);
        job.finishedOn = Date.now();

        telemetry?.recordEvent({
          queue: queueName,
          event: "completed",
          jobId: job.id,
          mediaId: payload?.mediaId,
          attempts: attemptsMade,
          durationMs: job.finishedOn - receivedAt
        });

        channel.ack(message);
      } catch (err) {
        job.finishedOn = Date.now();

        logger.error(
          {
            queueName,
            event: "failed",
            jobId: job.id,
            mediaId: payload?.mediaId,
            attempts: attemptsMade,
            err
          },
          onFailureLogMessage
        );

        telemetry?.recordEvent({
          queue: queueName,
          event: "failed",
          jobId: job.id,
          mediaId: payload?.mediaId,
          attempts: attemptsMade,
          durationMs: job.finishedOn - receivedAt,
          failureCode: err?.code || null,
          errorClass: err?.name || "Error"
        });

        const nextAttemptsMade = attemptsMade + 1;
        const terminalFailure = nextAttemptsMade >= maxAttempts;

        if (persistFailedStatus) {
          await persistFailedStatusOnTerminalFailure({
            job: {
              ...job,
              attemptsMade: nextAttemptsMade,
              opts: {
                attempts: maxAttempts
              }
            },
            mediaRepo,
            logger,
            queueName
          });
        }

        const targetQueueName = terminalFailure ? dlqQueueName : retryQueueName;
        const publishOptions = {
          persistent: true,
          contentType: "application/json",
          messageId: job.id || undefined,
          headers: {
            attemptsMade: nextAttemptsMade,
            maxAttempts,
            backoffDelay
          }
        };

        if (!terminalFailure) {
          publishOptions.expiration = String(
            buildRabbitRetryDelayMs({
              attemptsMade: nextAttemptsMade,
              baseDelayMs: backoffDelay
            })
          );
        }

        channel.sendToQueue(targetQueueName, Buffer.from(JSON.stringify(payload)), publishOptions);
        await channel.waitForConfirms();
        channel.ack(message);
      }
    });

    consumerTag = consumeResult.consumerTag;
    started = true;
  }

  return {
    async close() {
      if (channel && consumerTag) {
        await channel.cancel(consumerTag);
      }

      if (channel) {
        await channel.close();
      }

      if (connection) {
        await connection.close();
      }

      consumerTag = null;
      channel = null;
      connection = null;
      started = false;
    },
    async start() {
      await ensureReady();
    }
  };
}

function createMediaProcessWorker({
  queueName,
  rabbitmqUrl,
  rabbitmqExchangeName = "photox.media",
  rabbitmqQueuePrefix = "worker",
  originalsRoot,
  derivedRoot,
  logger,
  mediaRepo,
  telemetry
}) {
  return createRabbitWorker({
    queueName,
    rabbitmqUrl,
    exchangeName: rabbitmqExchangeName,
    queuePrefix: rabbitmqQueuePrefix,
    processor: createMediaDerivativesProcessor({ originalsRoot, derivedRoot, logger, mediaRepo }),
    logger,
    telemetry,
    mediaRepo,
    onFailureLogMessage: "media process job failed",
    persistFailedStatus: true,
    originalsRoot,
    derivedRoot
  });
}

function createMediaCleanupWorker({
  queueName,
  rabbitmqUrl,
  rabbitmqExchangeName = "photox.media",
  rabbitmqQueuePrefix = "worker",
  originalsRoot,
  derivedRoot,
  logger,
  mediaRepo,
  telemetry
}) {
  return createRabbitWorker({
    queueName,
    rabbitmqUrl,
    exchangeName: rabbitmqExchangeName,
    queuePrefix: rabbitmqQueuePrefix,
    processor: createMediaCleanupProcessor({ originalsRoot, derivedRoot, logger, mediaRepo }),
    logger,
    telemetry,
    mediaRepo,
    onFailureLogMessage: "media cleanup job failed",
    persistFailedStatus: false
  });
}

module.exports = {
  isTerminalFailure,
  persistFailedStatusOnTerminalFailure,
  ProcessingLockUnavailableError,
  acquireProcessingLockWithRetry,
  createMediaCleanupProcessor,
  createMediaCleanupWorker,
  createMediaDerivativesProcessor,
  createMediaDerivativesWorker,
  createMediaProcessWorker
};
