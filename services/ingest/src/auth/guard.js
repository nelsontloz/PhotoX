const { ApiError, mapJwtError } = require("../errors");
const { verifyAccessToken } = require("./tokens");

function parseCookieHeader(cookieHeader) {
  if (!cookieHeader || typeof cookieHeader !== "string") {
    return {};
  }

  return cookieHeader
    .split(";")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .reduce((acc, part) => {
      const separatorIndex = part.indexOf("=");
      if (separatorIndex <= 0) {
        return acc;
      }

      const key = part.slice(0, separatorIndex).trim();
      const value = part.slice(separatorIndex + 1).trim();
      if (!key) {
        return acc;
      }

      acc[key] = decodeURIComponent(value);
      return acc;
    }, {});
}

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
    const bearerToken = extractBearerToken(request.headers.authorization);
    const cookies = parseCookieHeader(request.headers.cookie);
    const cookieToken = cookies.access_token;
    const token = bearerToken || cookieToken;

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
        email: payload.email,
        transport: bearerToken ? "bearer" : "cookie"
      };
    } catch (err) {
      if (err instanceof ApiError) {
        throw err;
      }
      throw mapJwtError(err);
    }
  };
}

function requireCsrfForCookieAuth() {
  return async function csrfGuard(request) {
    if (request.userAuth?.transport !== "cookie") {
      return;
    }

    const cookies = parseCookieHeader(request.headers.cookie);
    const csrfCookie = cookies.csrf_token;
    const csrfHeader = request.headers["x-csrf-token"];
    if (!csrfCookie || typeof csrfHeader !== "string" || csrfHeader.length === 0 || csrfHeader !== csrfCookie) {
      throw new ApiError(403, "AUTH_CSRF_INVALID", "CSRF token is missing or invalid");
    }
  };
}

module.exports = {
  requireAccessAuth,
  requireCsrfForCookieAuth
};
