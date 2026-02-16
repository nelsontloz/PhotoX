const crypto = require("node:crypto");

const { requireAdminAuth } = require("../auth/guard");
const { hashPassword, normalizeEmail, validatePassword } = require("../auth/password");
const { ApiError } = require("../errors");
const {
  adminCreateUserSchema,
  adminResetPasswordSchema,
  adminUpdateUserSchema,
  paginationSchema,
  parseOrThrow
} = require("../validation");

function buildErrorEnvelopeSchema({ code, message, details = {} }) {
  return {
    type: "object",
    required: ["error", "requestId"],
    properties: {
      error: {
        type: "object",
        required: ["code", "message", "details"],
        properties: {
          code: { type: "string" },
          message: { type: "string" },
          details: {
            type: "object",
            additionalProperties: true
          }
        },
        additionalProperties: false
      },
      requestId: { type: "string" }
    },
    additionalProperties: false,
    example: {
      error: {
        code,
        message,
        details
      },
      requestId: "req-4xYdA1GspM9n"
    }
  };
}

const publicUserSchema = {
  type: "object",
  required: ["id", "email", "name", "isAdmin", "isActive"],
  properties: {
    id: { type: "string", format: "uuid" },
    email: { type: "string", format: "email" },
    name: {
      anyOf: [{ type: "string", maxLength: 80 }, { type: "null" }]
    },
    isAdmin: { type: "boolean" },
    isActive: { type: "boolean" }
  },
  additionalProperties: false
};

module.exports = async function adminRoutes(app) {
  const adminGuard = requireAdminAuth(app.config, app.repos.users);

  app.get(
    "/api/v1/admin/users",
    {
      preHandler: adminGuard,
      schema: {
        tags: ["Admin"],
        summary: "List users",
        description: "List users with admin/active state and active upload counts.",
        security: [{ bearerAuth: [] }],
        querystring: {
          type: "object",
          properties: {
            limit: { type: "integer", minimum: 1, maximum: 100, default: 25 },
            offset: { type: "integer", minimum: 0, default: 0 }
          },
          additionalProperties: false
        },
        response: {
          200: {
            type: "object",
            required: ["items", "totalUsers", "limit", "offset"],
            properties: {
              items: {
                type: "array",
                items: {
                  type: "object",
                  required: ["user", "uploadCount"],
                  properties: {
                    user: publicUserSchema,
                    uploadCount: { type: "integer", minimum: 0 }
                  },
                  additionalProperties: false
                }
              },
              totalUsers: { type: "integer", minimum: 0 },
              limit: { type: "integer", minimum: 1 },
              offset: { type: "integer", minimum: 0 }
            },
            additionalProperties: false
          },
          403: buildErrorEnvelopeSchema({
            code: "AUTH_FORBIDDEN",
            message: "Admin access is required"
          })
        }
      }
    },
    async (request) => {
      const query = parseOrThrow(paginationSchema, request.query || {});
      const result = await app.repos.users.listUsersWithStats({
        limit: query.limit,
        offset: query.offset
      });

      return {
        items: result.users.map((userRow) => ({
          user: app.repos.users.toPublicUser(userRow),
          uploadCount: Number(userRow.upload_count || 0)
        })),
        totalUsers: result.totalUsers,
        limit: query.limit,
        offset: query.offset
      };
    }
  );

  app.post(
    "/api/v1/admin/users",
    {
      preHandler: adminGuard,
      schema: {
        tags: ["Admin"],
        summary: "Create user",
        description: "Create a user account. New users are non-admin by default unless explicitly configured.",
        security: [{ bearerAuth: [] }],
        body: {
          type: "object",
          required: ["email", "password"],
          properties: {
            email: { type: "string", format: "email" },
            password: { type: "string", minLength: 8 },
            isAdmin: { type: "boolean" },
            isActive: { type: "boolean" }
          },
          additionalProperties: false,
          example: {
            email: "managed-user@example.com",
            password: "super-secret-password",
            isAdmin: false,
            isActive: true
          }
        },
        response: {
          201: {
            type: "object",
            required: ["user"],
            properties: {
              user: publicUserSchema
            },
            additionalProperties: false
          },
          409: buildErrorEnvelopeSchema({
            code: "CONFLICT_EMAIL_EXISTS",
            message: "Email is already registered"
          })
        }
      }
    },
    async (request, reply) => {
      const body = parseOrThrow(adminCreateUserSchema, request.body || {});
      const email = normalizeEmail(body.email);
      const passwordStatus = validatePassword(body.password);
      if (!passwordStatus.ok) {
        throw new ApiError(400, "VALIDATION_ERROR", passwordStatus.reason);
      }

      const passwordHash = await hashPassword(body.password);
      const id = crypto.randomUUID();

      try {
        const created = await app.repos.users.createUserByAdmin({
          id,
          email,
          passwordHash,
          isAdmin: body.isAdmin === true
        });

        if (body.isActive === false) {
          await app.repos.users.updateUser({ id: created.id, isActive: false });
          await app.repos.sessions.revokeByUserId(created.id);
          const updated = await app.repos.users.findById(created.id);
          reply.code(201).send({ user: app.repos.users.toPublicUser(updated) });
          return;
        }

        reply.code(201).send({ user: app.repos.users.toPublicUser(created) });
      } catch (err) {
        if (err && err.code === "23505") {
          throw new ApiError(409, "CONFLICT_EMAIL_EXISTS", "Email is already registered");
        }
        throw err;
      }
    }
  );

  app.patch(
    "/api/v1/admin/users/:userId",
    {
      preHandler: adminGuard,
      schema: {
        tags: ["Admin"],
        summary: "Update user",
        description: "Update user email, admin flag, and active status.",
        security: [{ bearerAuth: [] }],
        params: {
          type: "object",
          required: ["userId"],
          properties: {
            userId: { type: "string", format: "uuid" }
          }
        },
        body: {
          type: "object",
          properties: {
            email: { type: "string", format: "email" },
            isAdmin: { type: "boolean" },
            isActive: { type: "boolean" }
          },
          additionalProperties: false,
          example: {
            email: "updated-user@example.com",
            isAdmin: true,
            isActive: true
          }
        },
        response: {
          200: {
            type: "object",
            required: ["user"],
            properties: {
              user: publicUserSchema
            },
            additionalProperties: false
          },
          404: buildErrorEnvelopeSchema({
            code: "NOT_FOUND",
            message: "User not found"
          })
        }
      }
    },
    async (request) => {
      const body = parseOrThrow(adminUpdateUserSchema, request.body || {});
      const userId = request.params.userId;
      const targetUser = await app.repos.users.findById(userId);

      if (!targetUser) {
        throw new ApiError(404, "NOT_FOUND", "User not found");
      }

      if (request.userAuth.userId === userId && body.isAdmin === false) {
        throw new ApiError(400, "ADMIN_SELF_DEMOTE_FORBIDDEN", "Admin cannot remove own admin role");
      }

      const nextIsAdmin = body.isAdmin === undefined ? targetUser.is_admin : body.isAdmin;
      const nextIsActive = body.isActive === undefined ? targetUser.is_active : body.isActive;
      const wasActiveAdmin = targetUser.is_admin && targetUser.is_active;
      const willRemainActiveAdmin = nextIsAdmin && nextIsActive;

      if (wasActiveAdmin && !willRemainActiveAdmin) {
        const activeAdmins = await app.repos.users.countActiveAdmins();
        if (activeAdmins <= 1) {
          throw new ApiError(400, "ADMIN_LAST_ACTIVE_FORBIDDEN", "At least one active admin is required");
        }
      }

      const nextEmail = body.email === undefined ? undefined : normalizeEmail(body.email);

      try {
        const updated = await app.repos.users.updateUser({
          id: userId,
          email: nextEmail,
          isAdmin: body.isAdmin,
          isActive: body.isActive
        });

        if (!updated) {
          throw new ApiError(404, "NOT_FOUND", "User not found");
        }

        if (body.isActive === false) {
          await app.repos.sessions.revokeByUserId(userId);
        }

        return { user: app.repos.users.toPublicUser(updated) };
      } catch (err) {
        if (err && err.code === "23505") {
          throw new ApiError(409, "CONFLICT_EMAIL_EXISTS", "Email is already registered");
        }
        throw err;
      }
    }
  );

  app.post(
    "/api/v1/admin/users/:userId/reset-password",
    {
      preHandler: adminGuard,
      schema: {
        tags: ["Admin"],
        summary: "Reset user password",
        description: "Set a new password for a target user account.",
        security: [{ bearerAuth: [] }],
        params: {
          type: "object",
          required: ["userId"],
          properties: {
            userId: { type: "string", format: "uuid" }
          }
        },
        body: {
          type: "object",
          required: ["password"],
          properties: {
            password: { type: "string", minLength: 8 }
          },
          additionalProperties: false,
          example: {
            password: "next-super-secret-password"
          }
        },
        response: {
          200: {
            type: "object",
            required: ["success"],
            properties: {
              success: { type: "boolean" }
            },
            additionalProperties: false
          }
        }
      }
    },
    async (request) => {
      const body = parseOrThrow(adminResetPasswordSchema, request.body || {});
      const userId = request.params.userId;
      const userRow = await app.repos.users.findById(userId);

      if (!userRow) {
        throw new ApiError(404, "NOT_FOUND", "User not found");
      }

      const passwordStatus = validatePassword(body.password);
      if (!passwordStatus.ok) {
        throw new ApiError(400, "VALIDATION_ERROR", passwordStatus.reason);
      }

      const passwordHash = await hashPassword(body.password);
      await app.repos.users.updateUser({ id: userId, passwordHash });
      await app.repos.sessions.revokeByUserId(userId);

      return { success: true };
    }
  );

  app.delete(
    "/api/v1/admin/users/:userId",
    {
      preHandler: adminGuard,
      schema: {
        tags: ["Admin"],
        summary: "Disable user",
        description: "Soft-disable a user account by setting it inactive.",
        security: [{ bearerAuth: [] }],
        params: {
          type: "object",
          required: ["userId"],
          properties: {
            userId: { type: "string", format: "uuid" }
          }
        },
        response: {
          200: {
            type: "object",
            required: ["success"],
            properties: {
              success: { type: "boolean" }
            },
            additionalProperties: false
          }
        }
      }
    },
    async (request) => {
      const userId = request.params.userId;
      const targetUser = await app.repos.users.findById(userId);

      if (!targetUser) {
        throw new ApiError(404, "NOT_FOUND", "User not found");
      }

      if (request.userAuth.userId === userId) {
        throw new ApiError(400, "ADMIN_SELF_DISABLE_FORBIDDEN", "Admin cannot disable own account");
      }

      if (targetUser.is_admin && targetUser.is_active) {
        const activeAdmins = await app.repos.users.countActiveAdmins();
        if (activeAdmins <= 1) {
          throw new ApiError(400, "ADMIN_LAST_ACTIVE_FORBIDDEN", "At least one active admin is required");
        }
      }

      await app.repos.users.updateUser({ id: userId, isActive: false });
      await app.repos.sessions.revokeByUserId(userId);

      return { success: true };
    }
  );
};
