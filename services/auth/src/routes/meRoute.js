const { ApiError } = require("../errors");
const { requireAccessAuth } = require("../auth/guard");

module.exports = async function meRoute(app) {
  app.get(
    "/api/v1/me",
    {
      preHandler: requireAccessAuth(app.config),
      schema: {
        tags: ["Me"],
        summary: "Get current user",
        description: "Return the currently authenticated user resolved from the bearer access token.",
        security: [{ bearerAuth: [] }],
        response: {
          200: {
            type: "object",
            required: ["user"],
            properties: {
              user: {
                type: "object",
                required: ["id", "email", "name"],
                properties: {
                  id: { type: "string", format: "uuid" },
                  email: { type: "string", format: "email" },
                  name: {
                    anyOf: [{ type: "string", maxLength: 80 }, { type: "null" }]
                  }
                },
                additionalProperties: false
              }
            },
            additionalProperties: false,
            example: {
              user: {
                id: "0f3c9d30-1307-4c9e-a4d7-75e84606c28d",
                email: "user@example.com",
                name: null
              }
            }
          },
          401: {
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
                code: "AUTH_TOKEN_INVALID",
                message: "Missing bearer token",
                details: {}
              },
              requestId: "req-4xYdA1GspM9n"
            }
          }
        }
      }
    },
    async (request) => {
      const userRow = await app.repos.users.findById(request.userAuth.userId);
      if (!userRow) {
        throw new ApiError(401, "AUTH_TOKEN_INVALID", "Token is invalid");
      }
      return { user: app.repos.users.toPublicUser(userRow) };
    }
  );
};
