function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}

function loadConfig(overrides = {}) {
  return {
    port: overrides.port || parsePositiveInt(process.env.PORT, 3000),
    serviceName: overrides.serviceName || process.env.SERVICE_NAME || "ingest-service",
    databaseUrl:
      overrides.databaseUrl ||
      process.env.DATABASE_URL ||
      "postgresql://photox:photox-dev-password@127.0.0.1:5432/photox",
    redisUrl: overrides.redisUrl || process.env.REDIS_URL || "redis://127.0.0.1:6379",
    jwtAccessSecret: overrides.jwtAccessSecret || process.env.JWT_ACCESS_SECRET || "change-me",
    uploadOriginalsPath:
      overrides.uploadOriginalsPath || process.env.UPLOAD_ORIGINALS_PATH || "/data/photox/originals",
    uploadDerivedPath:
      overrides.uploadDerivedPath || process.env.UPLOAD_DERIVED_PATH || "/data/photox/derived",
    uploadPartSizeBytes:
      overrides.uploadPartSizeBytes || parsePositiveInt(process.env.UPLOAD_PART_SIZE_BYTES, 5 * 1024 * 1024),
    uploadBodyLimitBytes:
      overrides.uploadBodyLimitBytes ||
      parsePositiveInt(process.env.UPLOAD_BODY_LIMIT_BYTES, 8 * 1024 * 1024),
    uploadTtlSeconds:
      overrides.uploadTtlSeconds || parsePositiveInt(process.env.UPLOAD_TTL_SECONDS, 24 * 60 * 60),
    mediaProcessQueueName:
      overrides.mediaProcessQueueName || process.env.MEDIA_PROCESS_QUEUE_NAME || "media.process"
  };
}

module.exports = {
  loadConfig
};
