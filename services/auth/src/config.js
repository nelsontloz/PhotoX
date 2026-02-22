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
  const jwtRefreshSecret = resolveRequiredSecret({
    envName: "JWT_REFRESH_SECRET",
    overrideValue: overrides.jwtRefreshSecret
  });
  const databaseUrl = resolveRequiredSecret({
    envName: "DATABASE_URL",
    overrideValue: overrides.databaseUrl,
    defaultValue: "postgresql://photox:photox-dev-password@127.0.0.1:5432/photox"
  });

  return {
    port: overrides.port || parsePositiveInt(process.env.PORT, 3000),
    serviceName: overrides.serviceName || process.env.SERVICE_NAME || "auth-service",
    databaseUrl,
    jwtAccessSecret,
    jwtRefreshSecret,
    accessTokenTtlSeconds:
      overrides.accessTokenTtlSeconds || parsePositiveInt(process.env.ACCESS_TOKEN_TTL_SECONDS, 3600),
    refreshTokenTtlDays:
      overrides.refreshTokenTtlDays || parsePositiveInt(process.env.REFRESH_TOKEN_TTL_DAYS, 30)
  };
}

module.exports = { loadConfig };
