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
    serviceName: overrides.serviceName || process.env.SERVICE_NAME || "library-service",
    databaseUrl:
      overrides.databaseUrl ||
      process.env.DATABASE_URL ||
      "postgresql://photox:photox-dev-password@127.0.0.1:5432/photox",
    jwtAccessSecret: overrides.jwtAccessSecret || process.env.JWT_ACCESS_SECRET || "change-me",
    uploadOriginalsPath:
      overrides.uploadOriginalsPath || process.env.UPLOAD_ORIGINALS_PATH || "/data/photox/originals",
    uploadDerivedPath:
      overrides.uploadDerivedPath || process.env.UPLOAD_DERIVED_PATH || "/data/photox/derived",
    timelineDefaultLimit:
      overrides.timelineDefaultLimit || parsePositiveInt(process.env.TIMELINE_DEFAULT_LIMIT, 24),
    timelineMaxLimit: overrides.timelineMaxLimit || parsePositiveInt(process.env.TIMELINE_MAX_LIMIT, 100)
  };
}

module.exports = {
  loadConfig
};
