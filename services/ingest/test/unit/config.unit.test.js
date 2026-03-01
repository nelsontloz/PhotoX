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

describe("ingest config", () => {
  beforeEach(() => {
    delete process.env.JWT_ACCESS_SECRET;
    process.env.NODE_ENV = "test";
  });

  afterEach(() => {
    restoreVar("NODE_ENV", originalNodeEnv);
    restoreVar("JWT_ACCESS_SECRET", originalJwtAccessSecret);
  });

  it("throws when upload body limit is lower than part size", () => {
    expect(() =>
      loadConfig({
        jwtAccessSecret: "unit-test-secret",
        uploadPartSizeBytes: 10,
        uploadBodyLimitBytes: 9
      })
    ).toThrow("UPLOAD_BODY_LIMIT_BYTES must be greater than or equal to UPLOAD_PART_SIZE_BYTES");
  });

  it("accepts equal upload body limit and part size", () => {
    const config = loadConfig({
      jwtAccessSecret: "unit-test-secret",
      uploadPartSizeBytes: 10,
      uploadBodyLimitBytes: 10
    });

    expect(config.uploadPartSizeBytes).toBe(10);
    expect(config.uploadBodyLimitBytes).toBe(10);
  });

  it("throws when JWT access secret is missing", () => {
    expect(() => loadConfig()).toThrow("JWT_ACCESS_SECRET is required");
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
