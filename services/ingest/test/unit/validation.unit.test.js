const { z } = require("zod");
const { initUploadSchema, parseOrThrow } = require("../../src/validation");
const { ApiError } = require("../../src/errors");

describe("validation helpers", () => {
  const schema = z.object({
    name: z.string().min(1),
    age: z.number().int().positive()
  });

  it("parses valid input correctly", () => {
    const input = { name: "Test User", age: 30 };
    const result = parseOrThrow(schema, input);
    expect(result).toEqual(input);
  });

  it("throws ApiError for invalid input", () => {
    const input = { name: "", age: -5 };
    let error;
    try {
      parseOrThrow(schema, input);
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(ApiError);
    expect(error.statusCode).toBe(400);
    expect(error.code).toBe("VALIDATION_ERROR");
    expect(error.details.issues).toBeDefined();
    expect(error.details.issues.length).toBeGreaterThan(0);
  });

  it("applies schema transformations", () => {
    const transformSchema = z.string().transform((val) => val.length);
    const result = parseOrThrow(transformSchema, "hello");
    expect(result).toBe(5);
  });

  it("accepts supported file extension/content type pairs", () => {
    const parsed = parseOrThrow(initUploadSchema, {
      fileName: "clip.mp4",
      contentType: "video/mp4",
      fileSize: 42,
      checksumSha256: "de4ecf4e0d0f157c8142fdb7f0e6f9f607c37d9b233830f70f7f83b4f04f9b69"
    });

    expect(parsed.contentType).toBe("video/mp4");
  });

  it("rejects unsupported or mismatched file extension/content type pairs", () => {
    expect(() =>
      parseOrThrow(initUploadSchema, {
        fileName: "clip.jpg",
        contentType: "video/mp4",
        fileSize: 42,
        checksumSha256: "de4ecf4e0d0f157c8142fdb7f0e6f9f607c37d9b233830f70f7f83b4f04f9b69"
      })
    ).toThrow(ApiError);
  });
});
