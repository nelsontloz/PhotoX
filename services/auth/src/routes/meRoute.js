const { ApiError } = require("../errors");
const { requireAccessAuth } = require("../auth/guard");

module.exports = async function meRoute(app) {
  app.get("/api/v1/me", { preHandler: requireAccessAuth(app.config) }, async (request) => {
    const userRow = await app.repos.users.findById(request.userAuth.userId);
    if (!userRow) {
      throw new ApiError(401, "AUTH_TOKEN_INVALID", "Token is invalid");
    }
    return { user: app.repos.users.toPublicUser(userRow) };
  });
};
