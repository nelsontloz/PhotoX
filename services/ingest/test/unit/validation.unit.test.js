const { z } = require("zod");
const { parseOrThrow } = require("../../src/validation");
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
});
