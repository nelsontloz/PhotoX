const { loadConfig } = require("../../src/config");

describe("ingest config", () => {
  it("throws when upload body limit is lower than part size", () => {
    expect(() =>
      loadConfig({
        uploadPartSizeBytes: 10,
        uploadBodyLimitBytes: 9
      })
    ).toThrow("UPLOAD_BODY_LIMIT_BYTES must be greater than or equal to UPLOAD_PART_SIZE_BYTES");
  });

  it("accepts equal upload body limit and part size", () => {
    const config = loadConfig({
      uploadPartSizeBytes: 10,
      uploadBodyLimitBytes: 10
    });

    expect(config.uploadPartSizeBytes).toBe(10);
    expect(config.uploadBodyLimitBytes).toBe(10);
  });
});
