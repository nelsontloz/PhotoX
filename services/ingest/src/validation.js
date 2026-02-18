const { z } = require("zod");
const { ApiError } = require("./errors");
const {
  isSupportedDeclaredMediaType,
  normalizeContentType
} = require("./upload/mediaTypePolicy");

const initUploadSchema = z.object({
  fileName: z.string().trim().min(1).max(255),
  contentType: z.string().trim().min(1).max(120).transform(normalizeContentType),
  fileSize: z.number().int().positive(),
  checksumSha256: z.string().trim().regex(/^[a-fA-F0-9]{64}$/)
}).superRefine((value, ctx) => {
  if (
    !isSupportedDeclaredMediaType({
      fileName: value.fileName,
      contentType: value.contentType
    })
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["contentType"],
      message: "Unsupported or mismatched media type for file extension"
    });
  }
});

const uploadPathParamsSchema = z.object({
  uploadId: z.string().uuid()
});

const uploadPartQuerySchema = z.object({
  partNumber: z
    .string()
    .regex(/^\d+$/)
    .transform((value) => Number.parseInt(value, 10))
    .refine((value) => value > 0)
});

const completeUploadSchema = z
  .object({
    checksumSha256: z
      .string()
      .trim()
      .regex(/^[a-fA-F0-9]{64}$/)
      .optional()
  })
  .strict()
  .default({});

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
  completeUploadSchema,
  uploadPartQuerySchema,
  uploadPathParamsSchema,
  parseOrThrow
};
