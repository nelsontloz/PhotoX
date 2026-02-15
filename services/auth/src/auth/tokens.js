const crypto = require("node:crypto");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");

async function hashRefreshToken(token) {
  // Use a faster salt round for tokens since they are high entropy and verified by signature too
  return bcrypt.hash(token, 8);
}

async function verifyRefreshTokenHash(token, hash) {
  return bcrypt.compare(token, hash);
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
