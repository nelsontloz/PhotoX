const { ApiError, mapJwtError } = require("../errors");
const { verifyAccessToken } = require("./tokens");

function extractBearerToken(headerValue) {
  if (!headerValue || typeof headerValue !== "string") {
    return null;
  }

  const [scheme, token] = headerValue.split(" ");
  if (scheme !== "Bearer" || !token) {
    return null;
  }

  return token;
}

function requireAccessAuth(config) {
  return async function accessAuthPreHandler(request) {
    const token = extractBearerToken(request.headers.authorization);
    if (!token) {
      throw new ApiError(401, "AUTH_TOKEN_INVALID", "Missing bearer token");
    }

    try {
      const payload = verifyAccessToken(token, config.jwtAccessSecret);
      if (payload.type !== "access") {
        throw new ApiError(401, "AUTH_TOKEN_INVALID", "Invalid token type");
      }

      request.userAuth = {
        userId: payload.sub,
        email: payload.email
      };
    } catch (err) {
      if (err instanceof ApiError) {
        throw err;
      }

      throw mapJwtError(err);
    }
  };
}

function requireAdminAuth(config, usersRepo) {
  const requireAccess = requireAccessAuth(config);

  return async function adminAuthPreHandler(request) {
    await requireAccess(request);

    const user = await usersRepo.findById(request.userAuth.userId);
    if (!user || !user.is_active) {
      throw new ApiError(401, "AUTH_TOKEN_INVALID", "Token is invalid");
    }

    if (!user.is_admin) {
      throw new ApiError(403, "AUTH_FORBIDDEN", "Admin access is required");
    }

    request.userAuth = {
      ...request.userAuth,
      isAdmin: true
    };
  };
}

module.exports = {
  extractBearerToken,
  requireAccessAuth,
  requireAdminAuth
};
