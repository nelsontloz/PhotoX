function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}

const WEAK_SECRET_VALUES = new Set(["change-me", "change-me-too"]);
const MIN_PRODUCTION_SECRET_LENGTH = 32;

function resolveRequiredSecret({ envName, overrideValue }) {
  const candidate = overrideValue !== undefined ? overrideValue : process.env[envName];

  if (typeof candidate !== "string" || candidate.trim().length === 0) {
    throw new Error(`${envName} is required`);
  }

  if (process.env.NODE_ENV === "production") {
    const normalized = candidate.trim();
    if (WEAK_SECRET_VALUES.has(normalized.toLowerCase())) {
      throw new Error(`${envName} must not use insecure placeholder values in production`);
    }

    if (normalized.length < MIN_PRODUCTION_SECRET_LENGTH) {
      throw new Error(
        `${envName} must be at least ${MIN_PRODUCTION_SECRET_LENGTH} characters in production`
      );
    }
  }

  return candidate;
}

function loadConfig(overrides = {}) {
  const uploadPartSizeBytes =
    overrides.uploadPartSizeBytes || parsePositiveInt(process.env.UPLOAD_PART_SIZE_BYTES, 5 * 1024 * 1024);
  const uploadBodyLimitBytes =
    overrides.uploadBodyLimitBytes ||
    parsePositiveInt(process.env.UPLOAD_BODY_LIMIT_BYTES, 8 * 1024 * 1024);

  if (uploadBodyLimitBytes < uploadPartSizeBytes) {
    throw new Error("UPLOAD_BODY_LIMIT_BYTES must be greater than or equal to UPLOAD_PART_SIZE_BYTES");
  }

  const jwtAccessSecret = resolveRequiredSecret({
    envName: "JWT_ACCESS_SECRET",
    overrideValue: overrides.jwtAccessSecret
  });

  return {
    port: overrides.port || parsePositiveInt(process.env.PORT, 3000),
    serviceName: overrides.serviceName || process.env.SERVICE_NAME || "ingest-service",
    databaseUrl:
      overrides.databaseUrl ||
      process.env.DATABASE_URL ||
      "postgresql://photox:photox-dev-password@127.0.0.1:5432/photox",
    redisUrl: overrides.redisUrl || process.env.REDIS_URL || "redis://127.0.0.1:6379",
    rabbitmqUrl: overrides.rabbitmqUrl || process.env.RABBITMQ_URL || "amqp://127.0.0.1:5672",
    rabbitmqExchangeName:
      overrides.rabbitmqExchangeName || process.env.RABBITMQ_EXCHANGE_NAME || "photox.media",
    rabbitmqQueuePrefix:
      overrides.rabbitmqQueuePrefix || process.env.RABBITMQ_QUEUE_PREFIX || "worker",
    jwtAccessSecret,
    uploadOriginalsPath:
      overrides.uploadOriginalsPath || process.env.UPLOAD_ORIGINALS_PATH || "/data/photox/originals",
    uploadDerivedPath:
      overrides.uploadDerivedPath || process.env.UPLOAD_DERIVED_PATH || "/data/photox/derived",
    uploadPartSizeBytes,
    uploadBodyLimitBytes,
    uploadTtlSeconds:
      overrides.uploadTtlSeconds || parsePositiveInt(process.env.UPLOAD_TTL_SECONDS, 24 * 60 * 60),
    mediaProcessQueueName:
      overrides.mediaProcessQueueName || process.env.MEDIA_PROCESS_QUEUE_NAME || "media.process"
  };
}

module.exports = {
  loadConfig
};
