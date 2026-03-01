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
  refreshToken: z.string().min(1).optional()
});

const adminCreateUserSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  isAdmin: z.boolean().optional(),
  isActive: z.boolean().optional()
});

const adminUpdateUserSchema = z
  .object({
    email: z.string().email().optional(),
    isAdmin: z.boolean().optional(),
    isActive: z.boolean().optional()
  })
  .refine((payload) => Object.keys(payload).length > 0, {
    message: "At least one field must be provided"
  });

const adminResetPasswordSchema = z.object({
  password: z.string().min(8)
});

const paginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).default(0)
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
  adminCreateUserSchema,
  adminResetPasswordSchema,
  adminUpdateUserSchema,
  paginationSchema,
  refreshSchema,
  registerSchema
};
