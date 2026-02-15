class ApiError extends Error {
  constructor(statusCode, code, message, details = {}) {
    super(message);
    this.name = "ApiError";
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

function toErrorBody({ code, message, details }, requestId) {
  return {
    error: {
      code,
      message,
      details
    },
    requestId
  };
}

function mapJwtError(err) {
  if (err && err.name === "TokenExpiredError") {
    return new ApiError(401, "AUTH_TOKEN_EXPIRED", "Token has expired");
  }
  return new ApiError(401, "AUTH_TOKEN_INVALID", "Token is invalid");
}

module.exports = {
  ApiError,
  mapJwtError,
  toErrorBody
};
