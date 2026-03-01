function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}

function parseBoolean(value, fallback) {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["1", "true", "yes", "on"].includes(normalized)) {
      return true;
    }
    if (["0", "false", "no", "off"].includes(normalized)) {
      return false;
    }
  }

  return fallback;
}

const WEAK_SECRET_VALUES = new Set(["change-me", "change-me-too"]);

function resolveRequiredSecret({ envName, overrideValue }) {
  const candidate = overrideValue !== undefined ? overrideValue : process.env[envName];

  if (typeof candidate !== "string" || candidate.trim().length === 0) {
    throw new Error(`${envName} is required`);
  }

  if (process.env.NODE_ENV === "production" && WEAK_SECRET_VALUES.has(candidate.trim().toLowerCase())) {
    throw new Error(`${envName} must not use insecure placeholder values in production`);
  }

  return candidate;
}

function loadConfig(overrides = {}) {
  const jwtAccessSecret = resolveRequiredSecret({
    envName: "JWT_ACCESS_SECRET",
    overrideValue: overrides.jwtAccessSecret
  });

  return {
    port: overrides.port || parsePositiveInt(process.env.PORT, 3000),
    serviceName: overrides.serviceName || process.env.SERVICE_NAME || "worker-service",
    databaseUrl:
      overrides.databaseUrl ||
      process.env.DATABASE_URL ||
      "postgresql://photox:photox-dev-password@127.0.0.1:5432/photox",
    rabbitmqUrl: overrides.rabbitmqUrl || process.env.RABBITMQ_URL || "amqp://127.0.0.1:5672",
    rabbitmqExchangeName:
      overrides.rabbitmqExchangeName || process.env.RABBITMQ_EXCHANGE_NAME || "photox.media",
    rabbitmqQueuePrefix:
      overrides.rabbitmqQueuePrefix || process.env.RABBITMQ_QUEUE_PREFIX || "worker",
    uploadOriginalsPath:
      overrides.uploadOriginalsPath || process.env.UPLOAD_ORIGINALS_PATH || "/data/photox/originals",
    uploadDerivedPath: overrides.uploadDerivedPath || process.env.UPLOAD_DERIVED_PATH || "/data/photox/derived",
    mediaDerivativesQueueName:
      overrides.mediaDerivativesQueueName ||
      process.env.MEDIA_DERIVATIVES_QUEUE_NAME ||
      "media.derivatives.generate",
    mediaProcessQueueName:
      overrides.mediaProcessQueueName ||
      process.env.MEDIA_PROCESS_QUEUE_NAME ||
      "media.process",
    mediaCleanupQueueName:
      overrides.mediaCleanupQueueName ||
      process.env.MEDIA_CLEANUP_QUEUE_NAME ||
      "media.cleanup",
    mediaOrphanSweepQueueName:
      overrides.mediaOrphanSweepQueueName ||
      process.env.MEDIA_ORPHAN_SWEEP_QUEUE_NAME ||
      "media.orphan.sweep",
    orphanSweepEnabled: parseBoolean(
      overrides.orphanSweepEnabled !== undefined ? overrides.orphanSweepEnabled : process.env.ORPHAN_SWEEP_ENABLED,
      true
    ),
    orphanSweepDefaultDryRun: parseBoolean(
      overrides.orphanSweepDefaultDryRun !== undefined
        ? overrides.orphanSweepDefaultDryRun
        : process.env.ORPHAN_SWEEP_DEFAULT_DRY_RUN,
      true
    ),
    orphanSweepIntervalMs: parsePositiveInt(
      overrides.orphanSweepIntervalMs !== undefined ? overrides.orphanSweepIntervalMs : process.env.ORPHAN_SWEEP_INTERVAL_MS,
      6 * 60 * 60 * 1000
    ),
    orphanSweepGraceMs: parsePositiveInt(
      overrides.orphanSweepGraceMs !== undefined ? overrides.orphanSweepGraceMs : process.env.ORPHAN_SWEEP_GRACE_MS,
      6 * 60 * 60 * 1000
    ),
    orphanSweepBatchSize: parsePositiveInt(
      overrides.orphanSweepBatchSize !== undefined ? overrides.orphanSweepBatchSize : process.env.ORPHAN_SWEEP_BATCH_SIZE,
      1000
    ),
    jwtAccessSecret
  };
}

module.exports = {
  loadConfig
};
