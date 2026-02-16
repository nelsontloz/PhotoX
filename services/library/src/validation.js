const { z } = require("zod");

const { ApiError } = require("./errors");

function parseBooleanish(value) {
  if (value === undefined) {
    return undefined;
  }

  if (value === true || value === false) {
    return value;
  }

  if (value === "true") {
    return true;
  }

  if (value === "false") {
    return false;
  }

  return value;
}

const booleanQuerySchema = z.preprocess(parseBooleanish, z.boolean().optional());

const timelineQuerySchema = z
  .object({
    cursor: z.string().min(1).max(500).optional(),
    limit: z
      .preprocess((value) => {
        if (value === undefined || value === "") {
          return undefined;
        }

        if (typeof value === "number") {
          return value;
        }

        if (typeof value === "string") {
          return Number.parseInt(value, 10);
        }

        return value;
      }, z.number().int().min(1).max(100).optional())
      .optional(),
    from: z
      .string()
      .min(1)
      .refine((value) => !Number.isNaN(Date.parse(value)), "Invalid from date")
      .optional(),
    to: z
      .string()
      .min(1)
      .refine((value) => !Number.isNaN(Date.parse(value)), "Invalid to date")
      .optional(),
    favorite: booleanQuerySchema,
    archived: booleanQuerySchema,
    hidden: booleanQuerySchema,
    albumId: z.string().uuid().optional(),
    personId: z.string().uuid().optional(),
    q: z.string().min(1).max(120).optional()
  })
  .strict();

const mediaPathParamsSchema = z
  .object({
    mediaId: z.string().uuid()
  })
  .strict();

const patchMediaSchema = z
  .object({
    favorite: z.boolean().optional(),
    archived: z.boolean().optional(),
    hidden: z.boolean().optional(),
    takenAt: z
      .union([
        z.string().refine((value) => !Number.isNaN(Date.parse(value)), "Invalid takenAt date"),
        z.null()
      ])
      .optional()
  })
  .strict()
  .refine(
    (value) =>
      value.favorite !== undefined ||
      value.archived !== undefined ||
      value.hidden !== undefined ||
      value.takenAt !== undefined,
    {
      message: "At least one field must be provided"
    }
  );

const mediaContentQuerySchema = z
  .object({
    variant: z.enum(["original", "thumb", "small"]).optional()
  })
  .strict();

function parseOrThrow(schema, input) {
  try {
    return schema.parse(input);
  } catch (err) {
    if (err instanceof z.ZodError) {
      throw new ApiError(400, "VALIDATION_ERROR", "Request validation failed", {
        issues: err.issues.map((issue) => ({
          path: issue.path,
          message: issue.message
        }))
      });
    }

    throw err;
  }
}

module.exports = {
  mediaContentQuerySchema,
  mediaPathParamsSchema,
  parseOrThrow,
  patchMediaSchema,
  timelineQuerySchema
};
