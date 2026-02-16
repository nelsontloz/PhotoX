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
    serviceName: overrides.serviceName || process.env.SERVICE_NAME || "auth-service",
    databaseUrl:
      overrides.databaseUrl ||
      process.env.DATABASE_URL ||
      "postgresql://photox:photox-dev-password@127.0.0.1:5432/photox",
    jwtAccessSecret: overrides.jwtAccessSecret || process.env.JWT_ACCESS_SECRET || "change-me",
    jwtRefreshSecret:
      overrides.jwtRefreshSecret || process.env.JWT_REFRESH_SECRET || "change-me-too",
    accessTokenTtlSeconds:
      overrides.accessTokenTtlSeconds || parsePositiveInt(process.env.ACCESS_TOKEN_TTL_SECONDS, 3600),
    refreshTokenTtlDays:
      overrides.refreshTokenTtlDays || parsePositiveInt(process.env.REFRESH_TOKEN_TTL_DAYS, 30)
  };
}

module.exports = { loadConfig };
