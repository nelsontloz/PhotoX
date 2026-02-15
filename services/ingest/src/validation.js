const { z } = require("zod");
const { ApiError } = require("./errors");

const initUploadSchema = z.object({
  fileName: z.string().trim().min(1).max(255),
  contentType: z.string().trim().min(1).max(120),
  fileSize: z.number().int().positive(),
  checksumSha256: z.string().trim().regex(/^[a-fA-F0-9]{64}$/)
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
  initUploadSchema,
  parseOrThrow
};
