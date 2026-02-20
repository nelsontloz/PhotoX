const jwt = require("jsonwebtoken");
const { ApiError } = require("../errors");

module.exports = async function requireAuth(request) {
    const authHeader = request.headers.authorization;
    if (!authHeader) {
        throw new ApiError(401, "AUTH_TOKEN_INVALID", "Missing bearer token");
    }

    const [scheme, token] = authHeader.split(" ");
    if (scheme !== "Bearer" || !token) {
        throw new ApiError(401, "AUTH_TOKEN_INVALID", "Invalid token format");
    }

    try {
        const decoded = jwt.verify(token, request.server.config.jwtAccessSecret);
        request.user = { id: decoded.sub, email: decoded.email };
    } catch (err) {
        if (err.name === "TokenExpiredError") {
            throw new ApiError(401, "AUTH_TOKEN_EXPIRED", "Token expired");
        }
        throw new ApiError(401, "AUTH_TOKEN_INVALID", "Invalid or expired token");
    }
};
