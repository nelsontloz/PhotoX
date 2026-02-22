function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}

const WEAK_SECRET_VALUES = new Set(["change-me", "change-me-too"]);

function resolveRequiredSecret({ envName, overrideValue, defaultValue }) {
  const candidate = overrideValue !== undefined ? overrideValue : process.env[envName];

  if (typeof candidate !== "string" || candidate.trim().length === 0) {
    if (defaultValue !== undefined && process.env.NODE_ENV !== "production") {
      return defaultValue;
    }
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
  const databaseUrl = resolveRequiredSecret({
    envName: "DATABASE_URL",
    overrideValue: overrides.databaseUrl,
    defaultValue: "postgresql://photox:photox-dev-password@127.0.0.1:5432/photox"
  });
  const redisUrl = resolveRequiredSecret({
    envName: "REDIS_URL",
    overrideValue: overrides.redisUrl,
    defaultValue: "redis://127.0.0.1:6379"
  });

  return {
    port: overrides.port || parsePositiveInt(process.env.PORT, 3000),
    serviceName: overrides.serviceName || process.env.SERVICE_NAME || "library-service",
    databaseUrl,
    redisUrl,
    jwtAccessSecret,
    uploadOriginalsPath:
      overrides.uploadOriginalsPath || process.env.UPLOAD_ORIGINALS_PATH || "/data/photox/originals",
    uploadDerivedPath:
      overrides.uploadDerivedPath || process.env.UPLOAD_DERIVED_PATH || "/data/photox/derived",
    timelineDefaultLimit:
      overrides.timelineDefaultLimit || parsePositiveInt(process.env.TIMELINE_DEFAULT_LIMIT, 24),
    timelineMaxLimit: overrides.timelineMaxLimit || parsePositiveInt(process.env.TIMELINE_MAX_LIMIT, 100),
    mediaDerivativesQueueName:
      overrides.mediaDerivativesQueueName ||
      process.env.MEDIA_DERIVATIVES_QUEUE_NAME ||
      "media.derivatives.generate",
    mediaCleanupQueueName:
      overrides.mediaCleanupQueueName ||
      process.env.MEDIA_CLEANUP_QUEUE_NAME ||
      "media.cleanup"
  };
}

module.exports = {
  loadConfig
};
