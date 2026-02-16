const { loadConfig } = require("../../src/config");

const originalNodeEnv = process.env.NODE_ENV;
const originalJwtAccessSecret = process.env.JWT_ACCESS_SECRET;
const originalJwtRefreshSecret = process.env.JWT_REFRESH_SECRET;

function restoreVar(name, value) {
  if (value === undefined) {
    delete process.env[name];
    return;
  }

  process.env[name] = value;
}

describe("auth config", () => {
  beforeEach(() => {
    delete process.env.JWT_ACCESS_SECRET;
    delete process.env.JWT_REFRESH_SECRET;
    process.env.NODE_ENV = "test";
  });

  afterEach(() => {
    restoreVar("NODE_ENV", originalNodeEnv);
    restoreVar("JWT_ACCESS_SECRET", originalJwtAccessSecret);
    restoreVar("JWT_REFRESH_SECRET", originalJwtRefreshSecret);
  });

  it("throws when JWT access secret is missing", () => {
    process.env.JWT_REFRESH_SECRET = "refresh-secret";

    expect(() => loadConfig()).toThrow("JWT_ACCESS_SECRET is required");
  });

  it("throws when JWT refresh secret is missing", () => {
    process.env.JWT_ACCESS_SECRET = "access-secret";

    expect(() => loadConfig()).toThrow("JWT_REFRESH_SECRET is required");
  });

  it("accepts explicit override secrets", () => {
    const config = loadConfig({
      jwtAccessSecret: "override-access-secret",
      jwtRefreshSecret: "override-refresh-secret"
    });

    expect(config.jwtAccessSecret).toBe("override-access-secret");
    expect(config.jwtRefreshSecret).toBe("override-refresh-secret");
  });

  it("rejects weak placeholder secrets in production", () => {
    process.env.NODE_ENV = "production";
    process.env.JWT_ACCESS_SECRET = "change-me";
    process.env.JWT_REFRESH_SECRET = "change-me-too";

    expect(() => loadConfig()).toThrow(
      "JWT_ACCESS_SECRET must not use insecure placeholder values in production"
    );
  });

  it("allows placeholder secrets outside production", () => {
    process.env.NODE_ENV = "development";
    process.env.JWT_ACCESS_SECRET = "change-me";
    process.env.JWT_REFRESH_SECRET = "change-me-too";

    const config = loadConfig();

    expect(config.jwtAccessSecret).toBe("change-me");
    expect(config.jwtRefreshSecret).toBe("change-me-too");
  });
});
