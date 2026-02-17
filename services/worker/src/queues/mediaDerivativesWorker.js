const { Worker } = require("bullmq");

const { generateDerivativesForMedia } = require("../media/derivatives");

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

function createMediaDerivativesProcessor({ originalsRoot, derivedRoot, logger }) {
  return async (job) => {
    const { mediaId, relativePath } = job.data || {};
    if (!mediaId || !relativePath) {
      throw new Error("Invalid derivatives job payload: mediaId and relativePath are required");
    }

    const derivatives = await generateDerivativesForMedia({
      originalsRoot,
      derivedRoot,
      mediaId,
      relativePath
    });

    logger.info(
      {
        queueName: job.queueName,
        jobId: job.id,
        mediaId,
        derivativeCount: derivatives.length
      },
      "generated media derivatives"
    );

    return {
      mediaId,
      derivatives
    };
  };
}

function createMediaDerivativesWorker({ queueName, redisUrl, originalsRoot, derivedRoot, logger }) {
  const worker = new Worker(
    queueName,
    createMediaDerivativesProcessor({ originalsRoot, derivedRoot, logger }),
    {
      connection: redisConnectionFromUrl(redisUrl),
      concurrency: 2
    }
  );

  worker.on("failed", (job, err) => {
    logger.error(
      {
        queueName,
        jobId: job?.id,
        mediaId: job?.data?.mediaId,
        err
      },
      "media derivatives job failed"
    );
  });

  return worker;
}

module.exports = {
  createMediaDerivativesProcessor,
  createMediaDerivativesWorker
};
