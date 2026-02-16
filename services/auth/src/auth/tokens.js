const crypto = require("node:crypto");
const jwt = require("jsonwebtoken");
const argon2 = require("argon2");

async function hashRefreshToken(token) {
  return argon2.hash(token, { type: argon2.argon2id });
}

async function verifyRefreshTokenHash(token, hash) {
  if (typeof hash !== "string" || !hash.startsWith("$argon2")) {
    return false;
  }

  try {
    return await argon2.verify(hash, token);
  } catch {
    return false;
  }
}

function createAccessToken({ user, secret, expiresInSeconds }) {
  return jwt.sign(
    {
      type: "access",
      email: user.email
    },
    secret,
    {
      subject: user.id,
      expiresIn: expiresInSeconds
    }
  );
}

function createRefreshToken({ userId, sessionId, secret, expiresInDays }) {
  const refreshToken = jwt.sign(
    {
      type: "refresh",
      sid: sessionId,
      jti: crypto.randomUUID()
    },
    secret,
    {
      subject: userId,
      expiresIn: `${expiresInDays}d`
    }
  );

  return {
    refreshToken,
    refreshExpiresAt: new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000)
  };
}

function verifyAccessToken(token, secret) {
  return jwt.verify(token, secret);
}

function verifyRefreshToken(token, secret) {
  return jwt.verify(token, secret);
}

function verifyRefreshTokenIgnoringExpiration(token, secret) {
  return jwt.verify(token, secret, { ignoreExpiration: true });
}

module.exports = {
  createAccessToken,
  createRefreshToken,
  hashRefreshToken,
  verifyRefreshTokenHash,
  verifyAccessToken,
  verifyRefreshToken,
  verifyRefreshTokenIgnoringExpiration
};
