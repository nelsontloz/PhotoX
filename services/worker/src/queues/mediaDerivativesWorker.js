const { Worker } = require("bullmq");

const { generateDerivativesForMedia } = require("../media/derivatives");
const { extractMediaMetadata } = require("../media/metadata");
const { resolveAbsolutePath } = require("../media/paths");

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

    let hasLock = false;
    try {
      if (mediaRepo?.acquireProcessingLock) {
        await mediaRepo.acquireProcessingLock(mediaId);
        hasLock = true;
      }

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

      const derivatives = await generateDerivativesForMedia({
        originalsRoot,
        derivedRoot,
        mediaId,
        relativePath,
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
      if (hasLock) {
        try {
          await mediaRepo.releaseProcessingLock(mediaId);
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

function createMediaDerivativesWorker({ queueName, redisUrl, originalsRoot, derivedRoot, logger, mediaRepo, telemetry }) {
  const worker = new Worker(queueName, createMediaDerivativesProcessor({ originalsRoot, derivedRoot, logger, mediaRepo }), {
    connection: redisConnectionFromUrl(redisUrl),
    concurrency: 2
  });

  worker.on("active", (job) => {
    telemetry?.recordEvent({
      queue: queueName,
      event: "active",
      jobId: job?.id,
      mediaId: job?.data?.mediaId,
      attempts: job?.attemptsMade
    });
  });

  worker.on("completed", (job) => {
    const processedOn = Number(job?.processedOn || 0);
    const finishedOn = Number(job?.finishedOn || Date.now());
    const durationMs = processedOn > 0 && finishedOn >= processedOn ? finishedOn - processedOn : null;

    logger.info(
      {
        queueName,
        event: "completed",
        jobId: job?.id,
        mediaId: job?.data?.mediaId,
        durationMs,
        attempts: Number(job?.attemptsMade || 0)
      },
      "worker job completed"
    );

    telemetry?.recordEvent({
      queue: queueName,
      event: "completed",
      jobId: job?.id,
      mediaId: job?.data?.mediaId,
      attempts: job?.attemptsMade,
      durationMs
    });
  });

  worker.on("failed", (job, err) => {
    const processedOn = Number(job?.processedOn || 0);
    const finishedOn = Date.now();
    const durationMs = processedOn > 0 && finishedOn >= processedOn ? finishedOn - processedOn : null;

    logger.error(
      {
        queueName,
        event: "failed",
        jobId: job?.id,
        mediaId: job?.data?.mediaId,
        durationMs,
        attempts: Number(job?.attemptsMade || 0),
        err
      },
      "media derivatives job failed"
    );

    telemetry?.recordEvent({
      queue: queueName,
      event: "failed",
      jobId: job?.id,
      mediaId: job?.data?.mediaId,
      attempts: job?.attemptsMade,
      durationMs,
      failureCode: err?.code || null,
      errorClass: err?.name || "Error"
    });

    persistFailedStatusOnTerminalFailure({ job, mediaRepo, logger, queueName });
  });

  worker.on("stalled", (jobId) => {
    logger.warn(
      {
        queueName,
        event: "stalled",
        jobId
      },
      "worker job stalled"
    );

    telemetry?.recordEvent({
      queue: queueName,
      event: "stalled",
      jobId
    });
  });

  worker.on("error", (err) => {
    logger.error(
      {
        queueName,
        event: "error",
        err
      },
      "worker internal error"
    );

    telemetry?.markWorkerError(queueName, err);
  });

  return worker;
}

function createMediaProcessWorker({ queueName, redisUrl, originalsRoot, derivedRoot, logger, mediaRepo, telemetry }) {
  return createMediaDerivativesWorker({
    queueName,
    redisUrl,
    originalsRoot,
    derivedRoot,
    logger,
    mediaRepo,
    telemetry
  });
}

module.exports = {
  isTerminalFailure,
  persistFailedStatusOnTerminalFailure,
  createMediaDerivativesProcessor,
  createMediaDerivativesWorker,
  createMediaProcessWorker
};
