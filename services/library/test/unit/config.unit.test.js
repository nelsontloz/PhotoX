const { loadConfig } = require("../../src/config");

const originalNodeEnv = process.env.NODE_ENV;
const originalJwtAccessSecret = process.env.JWT_ACCESS_SECRET;

function restoreVar(name, value) {
  if (value === undefined) {
    delete process.env[name];
    return;
  }

  process.env[name] = value;
}

describe("library config", () => {
  beforeEach(() => {
    delete process.env.JWT_ACCESS_SECRET;
    process.env.NODE_ENV = "test";
  });

  afterEach(() => {
    restoreVar("NODE_ENV", originalNodeEnv);
    restoreVar("JWT_ACCESS_SECRET", originalJwtAccessSecret);
  });

  it("throws when JWT access secret is missing", () => {
    expect(() => loadConfig()).toThrow("JWT_ACCESS_SECRET is required");
  });

  it("accepts explicit override secret", () => {
    const config = loadConfig({
      jwtAccessSecret: "override-access-secret"
    });

    expect(config.jwtAccessSecret).toBe("override-access-secret");
  });

  it("rejects weak placeholder secret in production", () => {
    process.env.NODE_ENV = "production";
    process.env.JWT_ACCESS_SECRET = "change-me";

    expect(() => loadConfig()).toThrow(
      "JWT_ACCESS_SECRET must not use insecure placeholder values in production"
    );
  });

  it("allows placeholder secret outside production", () => {
    process.env.NODE_ENV = "development";
    process.env.JWT_ACCESS_SECRET = "change-me";

    const config = loadConfig();

    expect(config.jwtAccessSecret).toBe("change-me");
  });

  it("rejects short secrets in production", () => {
    process.env.NODE_ENV = "production";
    process.env.JWT_ACCESS_SECRET = "short-secret";

    expect(() => loadConfig()).toThrow("JWT_ACCESS_SECRET must be at least 32 characters in production");
  });
});
