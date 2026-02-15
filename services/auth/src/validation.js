const { z } = require("zod");
const { ApiError } = require("./errors");

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  name: z.string().trim().min(1).max(80).optional()
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1)
});

const refreshSchema = z.object({
  refreshToken: z.string().min(1)
});

function parseOrThrow(schema, payload) {
  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    throw new ApiError(400, "VALIDATION_ERROR", "Request validation failed", {
      issues: parsed.error.issues
    });
  }
  return parsed.data;
}

module.exports = {
  loginSchema,
  parseOrThrow,
  refreshSchema,
  registerSchema
};
