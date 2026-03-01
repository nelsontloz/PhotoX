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
  const jwtAccessSecret = resolveRequiredSecret({
    envName: "JWT_ACCESS_SECRET",
    overrideValue: overrides.jwtAccessSecret
  });
  const jwtRefreshSecret = resolveRequiredSecret({
    envName: "JWT_REFRESH_SECRET",
    overrideValue: overrides.jwtRefreshSecret
  });

  return {
    port: overrides.port || parsePositiveInt(process.env.PORT, 3000),
    serviceName: overrides.serviceName || process.env.SERVICE_NAME || "auth-service",
    databaseUrl:
      overrides.databaseUrl ||
      process.env.DATABASE_URL ||
      "postgresql://photox:photox-dev-password@127.0.0.1:5432/photox",
    jwtAccessSecret,
    jwtRefreshSecret,
    accessTokenTtlSeconds:
      overrides.accessTokenTtlSeconds || parsePositiveInt(process.env.ACCESS_TOKEN_TTL_SECONDS, 3600),
    refreshTokenTtlDays:
      overrides.refreshTokenTtlDays || parsePositiveInt(process.env.REFRESH_TOKEN_TTL_DAYS, 30)
  };
}

module.exports = { loadConfig };
